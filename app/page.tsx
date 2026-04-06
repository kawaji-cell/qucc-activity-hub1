'use client';

import Link from 'next/link';
import type { Session } from '@supabase/supabase-js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { Layer, Popup, Source } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  APP_NAME,
  STRAVA_MANAGE_APPS_URL,
  STRAVA_TRAINING_URL,
  SUPPORT_EMAIL,
  SUPPORT_MAILTO,
} from '@/lib/site';
import { supabase } from '@/lib/supabase';

type Profile = {
  id: string;
  strava_id: number | string | null;
  display_name: string;
  status: 'active' | 'pending' | string;
  entry_year: number | null;
  bio: string | null;
  bike_model: string | null;
};

type Activity = {
  user_id: string;
  strava_activity_id: number | string;
  name: string;
  distance: number | null;
  total_elevation_gain: number | null;
  polyline: string | null;
  start_date: string;
};

type PopupFeatureProps = {
  user_id: string;
  userName: string;
  name: string;
  distance: number;
  elevation: number;
  start_date: string;
  activityId: number | string;
};

type PopupState = {
  lngLat: { lng: number; lat: number };
  props: PopupFeatureProps;
};

type FeatureCollectionData = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: PopupFeatureProps;
    geometry: {
      type: 'LineString';
      coordinates: [number, number][];
    };
  }>;
};

function createPopupState(
  lngLat: { lng: number; lat: number },
  properties: Record<string, unknown> | null | undefined
): PopupState | null {
  if (!properties) {
    return null;
  }

  return {
    lngLat,
    props: {
      user_id: String(properties.user_id ?? ''),
      userName: String(properties.userName ?? 'Unknown'),
      name: String(properties.name ?? 'Ride'),
      distance: Number(properties.distance ?? 0),
      elevation: Number(properties.elevation ?? 0),
      start_date: String(properties.start_date ?? ''),
      activityId: String(properties.activityId ?? ''),
    },
  };
}

function decodePolyline(str: string) {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates: [number, number][] = [];
  let shift = 0;
  let result = 0;
  let byte = null;

  while (index < str.length) {
    byte = null;
    shift = 0;
    result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;

    byte = null;
    shift = 0;
    result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;

    coordinates.push([lng * 1e-5, lat * 1e-5]);
  }

  return coordinates;
}

function createOAuthState() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildStravaAuthUrl({
  clientId,
  redirectUri,
  state,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    approval_prompt: 'auto',
    scope: 'activity:read_all',
    state,
  });

  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

function formatAuthError(message: string) {
  const normalized = message.toLowerCase();

  if (
    normalized.includes('limit') ||
    normalized.includes('capacity') ||
    normalized.includes('single player')
  ) {
    return 'Strava 側の athlete capacity 上限に達しているため、新しい部員を追加できません。審査承認後に再度お試しください。';
  }

  if (normalized.includes('access denied')) {
    return 'Strava 連携がキャンセルされました。必要であればもう一度お試しください。';
  }

  return message;
}

export default function Home() {
  const [geoData, setGeoData] = useState<FeatureCollectionData | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [allActivities, setAllActivities] = useState<Activity[]>([]);
  const [viewState, setViewState] = useState({
    longitude: 130.22,
    latitude: 33.57,
    zoom: 11,
  });
  const [loading, setLoading] = useState(false);
  const [popupInfo, setPopupInfo] = useState<PopupState | null>(null);
  const [hoverInfo, setHoverInfo] = useState<PopupState | null>(null);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [myStravaId, setMyStravaId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({ display_name: '', bio: '', bike_model: '' });
  const [targetProfileId, setTargetProfileId] = useState<string | null>(null);
  const [entryYear, setEntryYear] = useState(2025);
  const [years, setYears] = useState(4);
  const [shareConsent, setShareConsent] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const callbackHandled = useRef(false);

  const isAdmin = useMemo(
    () => session?.user?.email === SUPPORT_EMAIL,
    [session]
  );

  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  const STRAVA_CLIENT_ID = process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID;

  const stats = useMemo(() => {
    const userStats: Record<string, { distance: number; elevation: number }> = {};
    allActivities.forEach((act) => {
      if (!userStats[act.user_id]) {
        userStats[act.user_id] = { distance: 0, elevation: 0 };
      }

      userStats[act.user_id].distance += act.distance || 0;
      userStats[act.user_id].elevation += act.total_elevation_gain || 0;
    });
    return userStats;
  }, [allActivities]);

  const totalDistance = useMemo(
    () => Object.values(stats).reduce((acc, curr) => acc + curr.distance, 0) / 1000,
    [stats]
  );

  const activePopup = popupInfo || hoverInfo;

  const loadData = useCallback(async () => {
    const { data: pData } = await supabase
      .from('profiles')
      .select('*')
      .order('updated_at', { ascending: true });

    if (!pData) {
      return;
    }

    const profileRows = pData as Profile[];
    setProfiles(profileRows);

    const activeProfiles = profileRows.filter((profile) => profile.status === 'active');
    const activeProfileIds = new Set(activeProfiles.map((profile) => String(profile.id)));

    const { data: aData } = await supabase.from('activities').select('*');
    if (!aData) {
      setAllActivities([]);
      setGeoData(null);
      return;
    }

    const activityRows = aData as Activity[];
    const visibleActivities = activityRows.filter((activity) =>
      activeProfileIds.has(String(activity.user_id))
    );
    setAllActivities(visibleActivities);

    const features: FeatureCollectionData['features'] = visibleActivities
      .filter((activity): activity is Activity & { polyline: string } => Boolean(activity.polyline))
      .map((activity) => {
        const rider = activeProfiles.find((profile) => profile.id === activity.user_id);
        return {
          type: 'Feature' as const,
          properties: {
            user_id: String(activity.user_id),
            userName: rider?.display_name || 'Unknown',
            name: activity.name,
            distance: activity.distance || 0,
            elevation: activity.total_elevation_gain || 0,
            start_date: activity.start_date,
            activityId: activity.strava_activity_id,
          },
          geometry: {
            type: 'LineString' as const,
            coordinates: decodePolyline(activity.polyline),
          },
        };
      });

    setGeoData({ type: 'FeatureCollection', features });
  }, []);

  useEffect(() => {
    const initialize = async () => {
      await loadData();
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();
      setSession(currentSession);
    };

    void initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
    });

    const savedId = localStorage.getItem('qucc_strava_id');
    if (savedId) {
      queueMicrotask(() => setMyStravaId(savedId));
    }

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const stateParam = urlParams.get('state');
    const errorParam = urlParams.get('error');

    if (errorParam === 'access_denied') {
      localStorage.removeItem('qucc_strava_oauth_state');
      window.history.replaceState({}, '', '/');
      queueMicrotask(() => setAuthError('Strava 連携がキャンセルされました。'));
    }

    if (code && !callbackHandled.current) {
      callbackHandled.current = true;

      const expectedState = localStorage.getItem('qucc_strava_oauth_state');
      if (stateParam && expectedState && stateParam !== expectedState) {
        localStorage.removeItem('qucc_strava_oauth_state');
        window.history.replaceState({}, '', '/');
        queueMicrotask(() =>
          setAuthError('Strava 連携の確認に失敗しました。もう一度お試しください。')
        );
        return () => subscription.unsubscribe();
      }

      localStorage.removeItem('qucc_strava_oauth_state');
      window.history.replaceState({}, '', '/');
      queueMicrotask(() => {
        setLoading(true);
        setAuthError(null);
        setAuthNotice('Strava からライド履歴を取り込んでいます...');
      });

      const savedEntryYear = parseInt(
        localStorage.getItem('qucc_entry_year') || String(entryYear),
        10
      );
      const savedYears = parseInt(localStorage.getItem('qucc_years') || String(years), 10);
      const start = new Date(`${savedEntryYear}-04-01T00:00:00Z`).getTime() / 1000;
      const end = new Date(`${savedEntryYear + savedYears}-03-31T23:59:59Z`).getTime() / 1000;

      const callbackParams = new URLSearchParams({
        code,
        after: String(start),
        before: String(end),
        entry_year: String(savedEntryYear),
      });

      fetch(`/api/strava/callback?${callbackParams.toString()}`)
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || 'Strava 連携に失敗しました。');
          }
          return payload;
        })
        .then((payload) => {
          localStorage.removeItem('qucc_entry_year');
          localStorage.removeItem('qucc_years');

          if (payload.strava_id) {
            const stravaId = String(payload.strava_id);
            localStorage.setItem('qucc_strava_id', stravaId);
            setMyStravaId(stravaId);
          }

          loadData();
          setAuthNotice(`Strava と連携し、${payload.count ?? 0} 件のライドを同期しました。`);
        })
        .catch((error: Error) => {
          setAuthNotice(null);
          setAuthError(formatAuthError(error.message));
        })
        .finally(() => {
          setLoading(false);
        });
    }

    return () => subscription.unsubscribe();
  }, [entryYear, years, loadData]);

  const handleAdminLogin = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google' });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const approveMember = async (id: string) => {
    if (!isAdmin) {
      return;
    }

    await supabase.from('profiles').update({ status: 'active' }).eq('id', id);
    loadData();
  };

  const handleUpdateProfile = async () => {
    if (!targetProfileId) {
      return;
    }

    await supabase.from('profiles').update(editForm).eq('id', targetProfileId);
    setIsEditModalOpen(false);
    loadData();
  };

  const handleConnectWithStrava = () => {
    if (!STRAVA_CLIENT_ID) {
      setAuthNotice(null);
      setAuthError('Strava アプリがまだ設定されていません。管理者にご連絡ください。');
      return;
    }

    if (!shareConsent) {
      setAuthNotice(null);
      setAuthError('利用規約と共有内容を確認のうえ、同意にチェックしてください。');
      return;
    }

    const oauthState = createOAuthState();
    const redirectUri =
      process.env.NEXT_PUBLIC_APP_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '') ||
      'https://qucc-activity-hub1.vercel.app';

    localStorage.setItem('qucc_strava_oauth_state', oauthState);
    localStorage.setItem('qucc_entry_year', String(entryYear));
    localStorage.setItem('qucc_years', String(years));
    setAuthNotice(null);
    setAuthError(null);

    window.location.href = buildStravaAuthUrl({
      clientId: STRAVA_CLIENT_ID,
      redirectUri,
      state: oauthState,
    });
  };

  const lineLayer = {
    id: 'strava-path',
    type: 'line',
    paint: {
      'line-color': '#85023e',
      'line-width': selectedUserId
        ? ['case', ['==', ['to-string', ['get', 'user_id']], selectedUserId], 2.5, 0.4]
        : 0.8,
      'line-opacity': selectedUserId
        ? ['case', ['==', ['to-string', ['get', 'user_id']], selectedUserId], 0.8, 0.05]
        : 0.2,
    },
  } as React.ComponentProps<typeof Layer>;

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-white text-gray-900">
      <header className="z-20 flex items-center justify-between border-b bg-white p-4 shadow-sm">
        <div>
          <h1 className="text-xl font-black leading-none tracking-tighter text-[#85023e] italic md:text-2xl">
            {APP_NAME}
          </h1>
          <p className="mt-1 text-[8px] font-bold uppercase tracking-widest text-gray-400 italic md:text-[9px]">
            {isAdmin
              ? 'Admin Mode'
              : session
                ? `LOGGED IN AS: ${session?.user?.email}`
                : `Total: ${totalDistance.toFixed(1)} km Logged`}
          </p>
        </div>
        <div className="origin-right scale-90 flex items-center gap-2 md:scale-100 md:gap-4">
          {!session ? (
            <button
              onClick={handleAdminLogin}
              className="rounded-full border-2 border-gray-100 px-3 py-2 text-[10px] font-black hover:bg-gray-50 md:px-4"
            >
              ADMIN
            </button>
          ) : (
            <button
              onClick={handleLogout}
              className="rounded-full border-2 border-red-50 px-3 py-2 text-[10px] font-black text-red-500 hover:bg-red-50 md:px-4"
            >
              OUT
            </button>
          )}
          <button
            onClick={() => setShowJoinModal(true)}
            className="rounded-full bg-[#FC4C02] px-4 py-2 text-[10px] font-black text-white shadow-md md:px-6"
          >
            {loading ? 'SYNCING...' : 'JOIN'}
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <div className="order-1 h-[55vh] flex-1 bg-gray-100 md:order-2 md:h-full">
          <Map
            {...viewState}
            onMove={(evt) => setViewState(evt.viewState)}
            mapStyle="mapbox://styles/mapbox/light-v11"
            mapboxAccessToken={MAPBOX_TOKEN}
            interactiveLayerIds={['strava-path']}
            onMouseMove={(event) => {
              const feature = event.features && event.features[0];
              if (feature) {
                setHoverInfo(createPopupState(event.lngLat, feature.properties));
              } else {
                setHoverInfo(null);
              }
            }}
            onMouseLeave={() => setHoverInfo(null)}
            onClick={(event) => {
              const feature = event.features && event.features[0];
              if (feature) {
                setPopupInfo(createPopupState(event.lngLat, feature.properties));
              } else {
                setPopupInfo(null);
              }
            }}
          >
            {geoData && (
              <Source id="strava-data" type="geojson" data={geoData}>
                <Layer {...lineLayer} />
              </Source>
            )}

            {activePopup && (
              <Popup
                longitude={activePopup.lngLat.lng}
                latitude={activePopup.lngLat.lat}
                anchor="bottom"
                closeButton={!!popupInfo}
                onClose={() => setPopupInfo(null)}
                className="z-40"
              >
                <div className="min-w-[140px] rounded bg-white/95 p-2 text-[9px] font-bold text-gray-800 shadow-xl">
                  <div className="mb-1 border-b pb-1 font-black uppercase tracking-tighter text-gray-900">
                    {activePopup.props.userName}
                  </div>
                  <p className="mb-1 leading-tight text-[#85023e]">{activePopup.props.name}</p>
                  <div className="flex flex-col gap-0.5 font-mono text-[8px] text-gray-500">
                    <p>DATE {new Date(activePopup.props.start_date).toLocaleDateString()}</p>
                    <p>DIST {((activePopup.props.distance || 0) / 1000).toFixed(1)} km</p>
                    <p>GAIN {Math.round(activePopup.props.elevation || 0)} m</p>
                  </div>
                  {activePopup.props.activityId && (
                    <a
                      href={`https://www.strava.com/activities/${activePopup.props.activityId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex text-[8px] font-black uppercase tracking-wide text-[#FC4C02] underline"
                    >
                      View on Strava
                    </a>
                  )}
                </div>
              </Popup>
            )}
          </Map>
        </div>

        <aside className="order-2 flex h-[45vh] w-full flex-col gap-6 overflow-y-auto border-t bg-gray-50 p-4 md:order-1 md:h-full md:w-80 md:border-r md:border-t-0">
          {(authNotice || authError) && (
            <div
              className={`rounded-2xl border px-4 py-3 text-[11px] font-bold leading-relaxed shadow-sm ${
                authError
                  ? 'border-red-100 bg-red-50 text-red-600'
                  : 'border-orange-100 bg-orange-50 text-[#85023e]'
              }`}
            >
              {authError || authNotice}
            </div>
          )}

          <div>
            <h2 className="mb-4 border-b pb-1 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
              Members
            </h2>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setSelectedUserId(null);
                  setPopupInfo(null);
                }}
                className={`rounded-xl px-4 py-3 text-left text-[11px] font-black transition-all ${
                  !selectedUserId
                    ? 'bg-[#85023e] text-white shadow-lg'
                    : 'border border-gray-100 bg-white text-gray-500 hover:border-[#85023e]'
                }`}
              >
                ALL ROUTES
              </button>

              {profiles
                .filter((profile) => profile.status === 'active')
                .map((profile) => {
                  const generation = profile.entry_year ? profile.entry_year - 1973 : 50;
                  return (
                    <div key={profile.id}>
                      <button
                        onClick={() => {
                          setSelectedUserId(profile.id);
                          setPopupInfo(null);
                        }}
                        className={`w-full rounded-xl px-4 py-3 text-left transition-all ${
                          selectedUserId === profile.id
                            ? 'bg-[#85023e] text-white shadow-lg'
                            : 'border border-gray-100 bg-white text-gray-600 hover:border-[#85023e]'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <span className="text-[11px] font-black uppercase tracking-tight">
                            {profile.display_name}{' '}
                            <span
                              className={`ml-1 text-[9px] font-bold ${
                                selectedUserId === profile.id ? 'text-white/60' : 'text-gray-400'
                              }`}
                            >
                              ({generation}回生)
                            </span>
                          </span>
                          {String(profile.strava_id) === String(myStravaId) && (
                            <span
                              onClick={(event) => {
                                event.stopPropagation();
                                setTargetProfileId(profile.id);
                                setEditForm({
                                  display_name: profile.display_name,
                                  bio: profile.bio || '',
                                  bike_model: profile.bike_model || '',
                                });
                                setIsEditModalOpen(true);
                              }}
                              className="cursor-pointer rounded bg-[#FC4C02] px-2 py-0.5 text-[8px] font-black text-white"
                            >
                              EDIT
                            </span>
                          )}
                        </div>
                        <p
                          className={`mt-1 text-[8px] font-bold ${
                            selectedUserId === profile.id ? 'text-white/80' : 'text-gray-400'
                          }`}
                        >
                          BIKE {profile.bike_model || 'Bicycle'}
                        </p>
                        {profile.bio && (
                          <p
                            className={`mt-0.5 text-[8px] italic leading-tight ${
                              selectedUserId === profile.id ? 'text-white/70' : 'text-gray-400'
                            }`}
                          >
                            &quot;{profile.bio}&quot;
                          </p>
                        )}
                        <div className="mt-1 flex gap-2 text-[9px] font-bold opacity-70">
                          <span>DIST {((stats[profile.id]?.distance || 0) / 1000).toFixed(1)} km</span>
                          <span>
                            GAIN {Math.round(stats[profile.id]?.elevation || 0).toLocaleString()} m
                          </span>
                        </div>
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>

          {isAdmin && (
            <div className="rounded-2xl border border-red-200 bg-red-50/50 p-3">
              <h2 className="mb-4 text-center text-[10px] font-black uppercase tracking-widest text-red-500">
                Admin: Pending
              </h2>
              {profiles
                .filter((profile) => profile.status === 'pending')
                .map((profile) => (
                  <div
                    key={profile.id}
                    className="mb-2 rounded-xl border border-red-100 bg-white p-3 text-center shadow-sm last:mb-0"
                  >
                    <p className="mb-2 text-[10px] font-black text-gray-800">
                      {profile.display_name}
                    </p>
                    <button
                      onClick={() => approveMember(profile.id)}
                      className="w-full rounded-lg bg-green-500 py-2 text-[9px] font-black uppercase tracking-widest text-white transition-colors hover:bg-green-600"
                    >
                      Approve
                    </button>
                  </div>
                ))}
            </div>
          )}

          <div className="mt-auto rounded-[24px] border border-orange-100 bg-white p-4 shadow-sm">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#FC4C02]">
              Community App
            </p>
            <p className="mt-2 text-[11px] font-semibold leading-relaxed text-gray-600">
              Approved QUCC members can view shared routes and ride summaries inside this members-only
              app.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wide">
              <Link
                href="/privacy"
                className="rounded-full border border-gray-200 px-3 py-2 text-gray-500 transition-colors hover:border-[#FC4C02] hover:text-[#FC4C02]"
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                className="rounded-full border border-gray-200 px-3 py-2 text-gray-500 transition-colors hover:border-[#FC4C02] hover:text-[#FC4C02]"
              >
                Terms
              </Link>
              <a
                href={SUPPORT_MAILTO}
                className="rounded-full border border-gray-200 px-3 py-2 text-gray-500 transition-colors hover:border-[#FC4C02] hover:text-[#FC4C02]"
              >
                Support
              </a>
              <a
                href={STRAVA_MANAGE_APPS_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-gray-200 px-3 py-2 text-gray-500 transition-colors hover:border-[#FC4C02] hover:text-[#FC4C02]"
              >
                Strava Apps
              </a>
            </div>
            <p className="mt-3 text-[9px] font-black uppercase tracking-[0.2em] text-gray-400">
              Powered by Strava
            </p>
          </div>
        </aside>
      </div>

      {showJoinModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          onClick={() => setShowJoinModal(false)}
        >
          <div
            className="max-h-[95vh] w-full max-w-md overflow-y-auto rounded-[30px] bg-white p-6 text-center shadow-2xl md:rounded-[40px] md:p-10"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto inline-flex rounded-full bg-orange-100 px-4 py-2 text-[9px] font-black uppercase tracking-[0.2em] text-[#FC4C02]">
              Members Only
            </div>
            <h2 className="mt-4 text-2xl font-black uppercase tracking-tighter text-[#85023e] italic md:text-3xl">
              Connect Strava
            </h2>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              QUCC の公式 Strava アプリでライド履歴を取り込みます。承認後は、共有対象のルートと集計値が
              他の承認済みメンバーにも表示されます。
            </p>

            <div className="mt-6 flex flex-col gap-3 text-left">
              <div>
                <label className="mb-1 ml-4 block text-[9px] font-black uppercase tracking-widest text-gray-300">
                  Enrollment Year
                </label>
                <select
                  value={entryYear}
                  onChange={(event) => setEntryYear(Number(event.target.value))}
                  className="w-full rounded-xl border bg-gray-50 p-3 text-sm font-black outline-none"
                >
                  {Array.from({ length: 21 }, (_, index) => 2016 + index).map((year) => (
                    <option key={year} value={year}>
                      {year}年度入学 ({year - 1973}回生)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 ml-4 block text-[9px] font-black uppercase tracking-widest text-gray-300">
                  Course Duration
                </label>
                <select
                  value={years}
                  onChange={(event) => setYears(Number(event.target.value))}
                  className="w-full rounded-xl border bg-gray-50 p-3 text-sm font-black outline-none"
                >
                  {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>
                      {value}年間（卒業まで）
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-2xl border border-orange-100 bg-orange-50 p-4 text-[11px] leading-relaxed text-gray-600">
                <p className="font-black uppercase tracking-[0.2em] text-[#FC4C02]">Before you connect</p>
                <p className="mt-2">
                  取り込み対象は選択した在籍期間のライドです。接続後も{' '}
                  <a
                    href={STRAVA_MANAGE_APPS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold text-[#FC4C02] underline"
                  >
                    Strava のアプリ設定
                  </a>
                  から連携を見直せます。
                </p>
                <p className="mt-2">
                  サポート窓口: <a href={SUPPORT_MAILTO} className="font-bold text-[#FC4C02] underline">{SUPPORT_EMAIL}</a>
                </p>
              </div>

              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 p-4 text-left text-[11px] leading-relaxed text-gray-600">
                <input
                  type="checkbox"
                  checked={shareConsent}
                  onChange={(event) => setShareConsent(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-gray-300"
                />
                <span>
                  承認済みの QUCC メンバーが、このアプリ内で私の共有対象ルートとライド集計を閲覧できることを理解し、
                  利用に同意します。
                </span>
              </label>

              <div className="flex flex-wrap justify-center gap-3 text-[10px] font-black uppercase tracking-wide">
                <Link href="/privacy" className="text-gray-400 underline hover:text-[#FC4C02]">
                  Privacy Policy
                </Link>
                <Link href="/terms" className="text-gray-400 underline hover:text-[#FC4C02]">
                  Terms
                </Link>
                <a
                  href={STRAVA_TRAINING_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gray-400 underline hover:text-[#FC4C02]"
                >
                  Open Strava
                </a>
              </div>
            </div>

            <button
              type="button"
              onClick={handleConnectWithStrava}
              disabled={!STRAVA_CLIENT_ID || !shareConsent || loading}
              className="mt-6 w-full rounded-[20px] bg-[#FC4C02] py-4 text-xs font-black uppercase tracking-[0.2em] text-white shadow-xl transition-opacity disabled:pointer-events-none disabled:bg-gray-300"
            >
              Connect with Strava
            </button>
            <p className="mt-3 text-[9px] font-black uppercase tracking-[0.2em] text-gray-400">
              Powered by Strava
            </p>
            <button
              onClick={() => setShowJoinModal(false)}
              className="mt-4 text-[10px] font-black uppercase tracking-widest text-gray-400"
            >
              Later
            </button>
          </div>
        </div>
      )}

      {isEditModalOpen && (
        <div
          className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
          onClick={() => setIsEditModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-[30px] border border-gray-100 bg-white p-8 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="mb-6 text-center text-xl font-black uppercase tracking-tighter text-[#85023e] italic">
              Update Profile
            </h2>
            <div className="flex flex-col gap-4">
              <input
                type="text"
                placeholder="Name"
                value={editForm.display_name}
                onChange={(event) =>
                  setEditForm({ ...editForm, display_name: event.target.value })
                }
                className="w-full rounded-xl bg-gray-50 px-5 py-4 text-sm font-bold outline-none"
              />
              <input
                type="text"
                placeholder="My Bike"
                value={editForm.bike_model}
                onChange={(event) => setEditForm({ ...editForm, bike_model: event.target.value })}
                className="w-full rounded-xl bg-gray-50 px-5 py-4 text-sm font-bold outline-none"
              />
              <textarea
                rows={3}
                placeholder="Bio"
                value={editForm.bio}
                onChange={(event) => setEditForm({ ...editForm, bio: event.target.value })}
                className="w-full resize-none rounded-xl bg-gray-50 px-5 py-4 text-xs font-medium outline-none"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setIsEditModalOpen(false)}
                  className="flex-1 rounded-2xl bg-gray-100 py-3 text-[10px] font-black uppercase text-gray-400"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateProfile}
                  className="flex-1 rounded-2xl bg-[#85023e] py-3 text-[10px] font-black uppercase text-white"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
