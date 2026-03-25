'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Map, { Source, Layer, Popup } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/lib/supabase';

function decodePolyline(str: string) {
  let index = 0, lat = 0, lng = 0, coordinates = [];
  let shift = 0, result = 0, byte = null;
  while (index < str.length) {
    byte = null; shift = 0; result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += ((result & 1) ? ~(result >> 1) : (result >> 1));
    byte = null; shift = 0; result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += ((result & 1) ? ~(result >> 1) : (result >> 1));
    coordinates.push([lng * 1e-5, lat * 1e-5]);
  }
  return coordinates;
}

export default function Home() {
  const [geoData, setGeoData] = useState<any>(null);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [allActivities, setAllActivities] = useState<any[]>([]);
  const [viewState, setViewState] = useState({ longitude: 130.22, latitude: 33.57, zoom: 11 });
  const [loading, setLoading] = useState(false);
  const [popupInfo, setPopupInfo] = useState<any>(null);
  const [hoverInfo, setHoverInfo] = useState<any>(null);
  const [showJoinModal, setShowJoinModal] = useState(false);

  const [session, setSession] = useState<any>(null);
  const isAdmin = useMemo(() => session?.user?.email === 'qucc.cycling@gmail.com', [session]);
  const [myStravaId, setMyStravaId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({ display_name: '', bio: '', bike_model: '' });
  const [targetProfileId, setTargetProfileId] = useState<string | null>(null);

  const [entryYear, setEntryYear] = useState(2025);
  const [years, setYears] = useState(4);
  const [ownClientId, setOwnClientId] = useState('');
  const [ownClientSecret, setOwnClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const callbackHandled = useRef(false);

  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  const STRAVA_CLIENT_ID = process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID;

  const stats = useMemo(() => {
    const userStats: Record<string, { distance: number; elevation: number }> = {};
    allActivities.forEach(act => {
      if (!userStats[act.user_id]) userStats[act.user_id] = { distance: 0, elevation: 0 };
      userStats[act.user_id].distance += act.distance || 0;
      userStats[act.user_id].elevation += act.total_elevation_gain || 0;
    });
    return userStats;
  }, [allActivities]);

  const totalDistance = useMemo(() => 
    Object.values(stats).reduce((acc, curr) => acc + curr.distance, 0) / 1000, [stats]);

  const loadData = useCallback(async () => {
    const { data: pData } = await supabase.from('profiles').select('*').order('updated_at', { ascending: true });
    if (pData) setProfiles(pData);
    const { data: aData } = await supabase.from('activities').select('*');
    if (aData && pData) {
      setAllActivities(aData);
      const features = aData.filter(act => act.polyline).map(act => {
        const rider = pData.find(p => p.id === act.user_id);
        return {
          type: 'Feature',
          properties: { user_id: String(act.user_id), userName: rider?.display_name || 'Unknown', name: act.name, distance: act.distance, elevation: act.total_elevation_gain || 0, start_date: act.start_date },
          geometry: { type: 'LineString', coordinates: decodePolyline(act.polyline) }
        };
      });
      setGeoData({ type: 'FeatureCollection', features });
    }
  }, []);

  useEffect(() => {
    loadData();
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    const savedId = localStorage.getItem('qucc_strava_id');
    if (savedId) setMyStravaId(savedId);

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const stateParam = urlParams.get('state');
    if (code && !callbackHandled.current) {
      callbackHandled.current = true;
      window.history.replaceState({}, '', '/');
      setLoading(true);
      
      const savedEntryYear = parseInt(localStorage.getItem('qucc_entry_year') || String(entryYear));
      const savedYears = parseInt(localStorage.getItem('qucc_years') || String(years));
      
      const start = new Date(`${savedEntryYear}-04-01T00:00:00Z`).getTime() / 1000;
      const end = new Date(`${savedEntryYear + savedYears}-03-31T23:59:59Z`).getTime() / 1000;
      
      const callbackParams = new URLSearchParams({ 
        code, 
        after: String(start), 
        before: String(end),
        entry_year: String(savedEntryYear) 
      });
      if (stateParam) callbackParams.set('state', stateParam);

      fetch(`/api/strava/callback?${callbackParams.toString()}`)
        .then(res => res.json())
        .then(() => {
          localStorage.removeItem('qucc_entry_year');
          localStorage.removeItem('qucc_years');
          loadData();
          setLoading(false);
        });
    }
    return () => subscription.unsubscribe();
  }, [loadData, entryYear, years]);

  const handleAdminLogin = async () => { await supabase.auth.signInWithOAuth({ provider: 'google' }); };
  const handleLogout = async () => { await supabase.auth.signOut(); };
  const approveMember = async (id: string) => { if (isAdmin) { await supabase.from('profiles').update({ status: 'active' }).eq('id', id); loadData(); } };
  const handleUpdateProfile = async () => { if (targetProfileId) { await supabase.from('profiles').update(editForm).eq('id', targetProfileId); setIsEditModalOpen(false); loadData(); } };

  const lineLayer: any = { 
    id: 'strava-path', 
    type: 'line', 
    paint: { 
      'line-color': '#85023e', 
      'line-width': selectedUserId ? ['case', ['==', ['to-string', ['get', 'user_id']], selectedUserId], 2.5, 0.4] : 0.8, 
      'line-opacity': selectedUserId ? ['case', ['==', ['to-string', ['get', 'user_id']], selectedUserId], 0.8, 0.05] : 0.2 
    } 
  };

  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const stravaAuthUrl = (() => {
    const clientId = ownClientId.trim() || STRAVA_CLIENT_ID;
    const redirectUri = origin || 'https://qucc-activity-hub1.vercel.app';
    const state = ownClientId.trim() && ownClientSecret.trim() ? btoa(`${ownClientId.trim()}:${ownClientSecret.trim()}`) : '';
    const params = new URLSearchParams({
      client_id: clientId ?? '',
      response_type: 'code',
      redirect_uri: redirectUri,
      approval_prompt: 'force',
      scope: 'activity:read_all',
      ...(state ? { state } : {}),
    });
    return `https://www.strava.com/oauth/authorize?${params.toString()}`;
  })();

  return (
    <main className="flex flex-col h-screen bg-white text-gray-900 overflow-hidden relative font-sans">
      <header className="flex p-4 justify-between items-center border-b bg-white z-20 shadow-sm">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-[#85023e] tracking-tighter italic leading-none">QUCC Hub</h1>
          <p className="text-[8px] md:text-[9px] font-bold text-gray-400 mt-1 uppercase tracking-widest italic">{isAdmin ? '🛡️ Admin Mode' : (session ? `LOGGED IN AS: ${session?.user?.email}` : `Total: ${totalDistance.toFixed(1)} km Logged`)}</p>
        </div>
        <div className="flex gap-2 md:gap-4 items-center scale-90 md:scale-100 origin-right">
          {!session ? (
            <button onClick={handleAdminLogin} className="text-[10px] font-black border-2 border-gray-100 px-3 md:px-4 py-2 rounded-full hover:bg-gray-50">ADMIN</button>
          ) : (
            <button onClick={handleLogout} className="text-[10px] font-black text-red-500 border-2 border-red-50 px-3 md:px-4 py-2 rounded-full hover:bg-red-50">OUT</button>
          )}
          <button onClick={() => setShowJoinModal(true)} className="bg-[#FC4C02] text-white text-[10px] font-black px-4 md:px-6 py-2 rounded-full shadow-md">
            {loading ? 'SYNCING...' : 'JOIN'}
          </button>
        </div>
      </header>

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        <div className="flex-1 relative bg-gray-100 order-1 md:order-2 h-[55vh] md:h-full">
          <Map {...viewState} onMove={evt => setViewState(evt.viewState)} mapStyle="mapbox://styles/mapbox/light-v11" mapboxAccessToken={MAPBOX_TOKEN} interactiveLayerIds={['strava-path']}
            onMouseMove={e => { const f = e.features && e.features[0]; if (f) setHoverInfo({ lngLat: e.lngLat, props: f.properties }); else setHoverInfo(null); }}
            onMouseLeave={() => setHoverInfo(null)}
            onClick={e => { const f = e.features && e.features[0]; if (f) setPopupInfo({ lngLat: e.lngLat, props: f.properties }); else setPopupInfo(null); }}>
            {geoData && <Source id="strava-data" type="geojson" data={geoData}><Layer {...lineLayer} /></Source>}
            {(hoverInfo || popupInfo) && (
              <Popup longitude={(popupInfo || hoverInfo).lngLat.lng} latitude={(popupInfo || hoverInfo).lngLat.lat} anchor="bottom" closeButton={!!popupInfo} onClose={() => setPopupInfo(null)} className="z-40">
                <div className="p-2 text-[9px] font-bold text-gray-800 bg-white/95 rounded shadow-xl min-w-[130px]">
                  <div className="border-b pb-1 mb-1 text-gray-900 uppercase font-black tracking-tighter">👤 {(popupInfo || hoverInfo).props.userName}</div>
                  <p className="text-[#85023e] mb-1 leading-tight">{(popupInfo || hoverInfo).props.name}</p>
                  <div className="flex flex-col gap-0.5 text-gray-500 font-mono text-[8px]">
                    <p>📅 {new Date((popupInfo || hoverInfo).props.start_date).toLocaleDateString()}</p>
                    <p>📏 {((popupInfo || hoverInfo).props.distance / 1000).toFixed(1)} km</p>
                    <p>⛰️ {Math.round((popupInfo || hoverInfo).props.elevation)} m UP</p>
                  </div>
                </div>
              </Popup>
            )}
          </Map>
        </div>

        <aside className="w-full md:w-72 border-t md:border-t-0 md:border-r overflow-y-auto p-4 flex flex-col gap-6 bg-gray-50 order-2 md:order-1 h-[45vh] md:h-full z-10">
          <div>
            <h2 className="text-[10px] font-black text-gray-400 mb-4 uppercase tracking-[0.2em] border-b pb-1">Members</h2>
            <div className="flex flex-col gap-2">
              <button onClick={() => { setSelectedUserId(null); setPopupInfo(null); }} className={`text-left px-4 py-3 rounded-xl text-[11px] font-black transition-all ${!selectedUserId ? 'bg-[#85023e] text-white shadow-lg' : 'bg-white border border-gray-100 text-gray-500 hover:border-[#85023e]'}`}>
                ALL ROUTES
              </button>
              {profiles.filter(p => p.status === 'active').map(p => {
                const generation = p.entry_year ? p.entry_year - 1973 : 50; 
                return (
                  <div key={p.id} className="w-full">
                    <button onClick={() => { setSelectedUserId(p.id); setPopupInfo(null); }} className={`w-full text-left px-4 py-3 rounded-xl transition-all ${selectedUserId === p.id ? 'bg-[#85023e] text-white shadow-lg' : 'bg-white border border-gray-100 text-gray-600 hover:border-[#85023e]'}`}>
                      <div className="flex justify-between items-start">
                        <span className="text-[11px] font-black uppercase tracking-tight">{p.display_name} <span className={`ml-1 text-[9px] font-bold ${selectedUserId === p.id ? 'text-white/60' : 'text-gray-400'}`}>({generation}回生)</span></span>
                        {String(p.strava_id) === String(myStravaId) && (
                          <span onClick={(e) => { e.stopPropagation(); setTargetProfileId(p.id); setEditForm({ display_name: p.display_name, bio: p.bio || '', bike_model: p.bike_model || '' }); setIsEditModalOpen(true); }} className="text-[8px] bg-[#FC4C02] text-white px-2 py-0.5 rounded font-black cursor-pointer">EDIT</span>
                        )}
                      </div>
                      <p className={`text-[8px] font-bold mt-1 ${selectedUserId === p.id ? 'text-white/80' : 'text-gray-400'}`}>🚲 {p.bike_model || 'Bicycle'}</p>
                      {p.bio && <p className={`text-[8px] italic mt-0.5 leading-tight ${selectedUserId === p.id ? 'text-white/70' : 'text-gray-400'}`}>"{p.bio}"</p>}
                      <div className="flex gap-2 mt-1 opacity-70 text-[9px] font-bold">
                        <span>📏 {((stats[p.id]?.distance || 0) / 1000).toFixed(1)} km</span>
                        <span>⛰️ {Math.round(stats[p.id]?.elevation || 0).toLocaleString()} m</span>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          {isAdmin && (
            <div className="pt-4 border-t border-red-200 bg-red-50/50 p-2 rounded-2xl">
              <h2 className="text-[10px] font-black text-red-500 mb-4 uppercase tracking-widest text-center">🛡️ Admin: Pending</h2>
              {profiles.filter(p => p.status === 'pending').map(p => (
                <div key={p.id} className="bg-white p-3 rounded-xl border border-red-100 mb-2 shadow-sm text-center">
                  <p className="text-[10px] font-black text-gray-800 mb-2">{p.display_name}</p>
                  <button onClick={() => approveMember(p.id)} className="w-full bg-green-500 hover:bg-green-600 text-white text-[9px] font-black py-2 rounded-lg uppercase tracking-widest transition-colors">Approve</button>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {showJoinModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[200] backdrop-blur-md p-4" onClick={() => setShowJoinModal(false)}>
          <div className="bg-white rounded-[30px] md:rounded-[40px] p-6 md:p-10 w-full max-w-sm shadow-2xl text-center max-h-[95vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="text-4xl md:text-5xl mb-4">🚴‍♂️</div>
            <h2 className="text-xl md:text-2xl font-black text-[#85023e] mb-2 uppercase italic tracking-tighter">Register to Hub</h2>
            <div className="flex flex-col gap-3 mb-6 text-left">
              <div>
                <label className="text-[9px] font-black text-gray-300 uppercase tracking-widest ml-4 mb-1 block">Enrollment Year</label>
                <select value={entryYear} onChange={(e) => setEntryYear(Number(e.target.value))} className="w-full bg-gray-50 border rounded-xl p-3 font-black text-sm outline-none">
                  {Array.from({length: 21}, (_, i) => 2016 + i).map(y => (<option key={y} value={y}>{y}年度入学 ({y - 1973}回生)</option>))}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-300 uppercase tracking-widest ml-4 mb-1 block">Course Duration (Years)</label>
                <select value={years} onChange={(e) => setYears(Number(e.target.value))} className="w-full bg-gray-50 border rounded-xl p-3 font-black text-sm outline-none">
                  {Array.from({length: 10}, (_, i) => i + 1).map(y => (<option key={y} value={y}>{y}年間（卒業まで）</option>))}
                </select>
              </div>
              <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 text-[8px] text-gray-500 leading-tight">
                Callback Domain: <span className="font-bold">qucc-activity-hub1.vercel.app</span>
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-300 uppercase tracking-widest ml-4 mb-1 block">Client ID</label>
                <input type="text" placeholder="123456" value={ownClientId} onChange={e => setOwnClientId(e.target.value)} className="w-full bg-gray-50 border rounded-xl p-3 font-bold text-sm outline-none" />
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-300 uppercase tracking-widest ml-4 mb-1 block">Client Secret</label>
                <div className="relative">
                  <input type={showSecret ? 'text' : 'password'} placeholder="40文字" value={ownClientSecret} onChange={e => setOwnClientSecret(e.target.value)} className="w-full bg-gray-50 border rounded-xl p-3 font-bold text-sm outline-none pr-16" />
                  <button type="button" onClick={() => setShowSecret(s => !s)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-gray-400 uppercase">{showSecret ? 'HIDE' : 'SHOW'}</button>
                </div>
              </div>
            </div>
            <a href={stravaAuthUrl} onClick={() => { localStorage.setItem('qucc_entry_year', String(entryYear)); localStorage.setItem('qucc_years', String(years)); }} className={`block w-full text-white font-black py-4 rounded-[20px] text-xs uppercase shadow-xl ${ownClientId.trim() && ownClientSecret.trim() ? 'bg-[#FC4C02]' : 'bg-gray-300 pointer-events-none'}`}>Connect Strava</a>
            <button onClick={() => setShowJoinModal(false)} className="mt-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Later</button>
          </div>
        </div>
      )}

      {isEditModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[250] backdrop-blur-md p-4" onClick={() => setIsEditModalOpen(false)}>
          <div className="bg-white rounded-[30px] p-8 w-full max-w-md shadow-2xl border border-gray-100" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-black text-[#85023e] mb-6 tracking-tighter uppercase italic text-center">Update Profile</h2>
            <div className="flex flex-col gap-4">
              <input type="text" placeholder="Name" value={editForm.display_name} onChange={(e) => setEditForm({...editForm, display_name: e.target.value})} className="w-full bg-gray-50 rounded-xl px-5 py-4 font-bold text-sm outline-none" />
              <input type="text" placeholder="My Bike" value={editForm.bike_model} onChange={(e) => setEditForm({...editForm, bike_model: e.target.value})} className="w-full bg-gray-50 rounded-xl px-5 py-4 font-bold text-sm outline-none" />
              <textarea rows={3} placeholder="Bio" value={editForm.bio} onChange={(e) => setEditForm({...editForm, bio: e.target.value})} className="w-full bg-gray-50 rounded-xl px-5 py-4 font-medium text-xs outline-none resize-none" />
              <div className="flex gap-3"><button onClick={() => setIsEditModalOpen(false)} className="flex-1 bg-gray-100 text-gray-400 font-black py-3 rounded-2xl text-[10px] uppercase">Cancel</button><button onClick={handleUpdateProfile} className="flex-1 bg-[#85023e] text-white font-black py-3 rounded-2xl text-[10px] uppercase">Save</button></div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
