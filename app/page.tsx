'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
    const { data: pData } = await supabase.from('profiles').select('*').order('updated_at', { ascending: false });
    if (pData) setProfiles(pData);
    const { data: aData } = await supabase.from('activities').select('*');
    if (aData && pData) {
      setAllActivities(aData);
      const features = aData.filter(act => act.polyline).map(act => {
        const rider = pData.find(p => p.id === act.user_id);
        return {
          type: 'Feature',
          properties: { user_id: act.user_id, userName: rider?.display_name || 'Unknown', name: act.name, distance: act.distance, elevation: act.total_elevation_gain || 0, start_date: act.start_date },
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
    if (code) {
      setLoading(true);
      const start = new Date(`${entryYear}-04-01T00:00:00Z`).getTime() / 1000;
      const end = new Date(`${entryYear + years}-03-31T23:59:59Z`).getTime() / 1000;
      fetch(`/api/strava/callback?code=${code}&after=${start}&before=${end}`)
        .then(res => res.json())
        .then(data => {
          if (data.strava_id) {
            localStorage.setItem('qucc_strava_id', String(data.strava_id));
            setMyStravaId(String(data.strava_id));
          }
          window.history.replaceState({}, '', '/');
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

  const lineLayer: any = { id: 'strava-path', type: 'line', paint: { 'line-color': '#85023e', 'line-width': selectedUserId ? ['case', ['==', ['get', 'user_id'], selectedUserId], 1.5, 0.3] : 0.7, 'line-opacity': selectedUserId ? ['case', ['==', ['get', 'user_id'], selectedUserId], 0.7, 0.03] : 0.15 } };
  // 💡 redirect_uri を localhost 固定から自動取得に変更
const [origin, setOrigin] = useState('');
useEffect(() => {
  setOrigin(window.location.origin);
}, []);

const stravaAuthUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${origin}/&approval_prompt=force&scope=activity:read_all`;
  return (
    <main className="flex flex-col h-screen bg-white text-gray-900 overflow-hidden relative font-sans">
      <header className="flex p-4 justify-between items-center border-b bg-white z-10 shadow-sm">
        <div>
          <h1 className="text-xl font-black text-[#85023e] tracking-tighter italic leading-none">QUCC Hub</h1>
          <p className="text-[9px] font-bold text-gray-400 mt-1 uppercase tracking-widest italic">{isAdmin ? '🛡️ Admin Mode' : `Total: ${totalDistance.toFixed(1)} km Logged`}</p>
        </div>
        <div className="flex gap-4 items-center">
          {!session ? (
            <button onClick={handleAdminLogin} className="text-[10px] font-black border-2 border-gray-100 px-4 py-2 rounded-full hover:bg-gray-50 transition-colors">ADMIN LOGIN</button>
          ) : (
            <button onClick={handleLogout} className="text-[10px] font-black text-red-500 border-2 border-red-50 px-4 py-2 rounded-full hover:bg-red-50 transition-colors">LOGOUT</button>
          )}
          <button onClick={() => setShowJoinModal(true)} className="bg-[#FC4C02] text-white text-[10px] font-black px-6 py-2 rounded-full shadow-md hover:scale-105 active:scale-95 transition-all">
            {loading ? 'SYNCING...' : 'JOIN HUB'}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 border-r overflow-y-auto p-4 flex flex-col gap-6 bg-gray-50 shadow-inner">
          <div>
            <h2 className="text-[10px] font-black text-gray-400 mb-4 uppercase tracking-[0.2em] border-b pb-1">Members</h2>
            <div className="flex flex-col gap-2">
              <button onClick={() => { setSelectedUserId(null); setPopupInfo(null); }} className={`text-left px-4 py-3 rounded-xl text-[11px] font-black transition-all ${!selectedUserId ? 'bg-[#85023e] text-white shadow-lg' : 'bg-white border border-gray-100 text-gray-500 hover:border-[#85023e]'}`}>
                ALL ROUTES
              </button>
              {profiles.filter(p => p.status === 'active').map(p => {
                const generation = p.joined_at ? new Date(p.joined_at).getFullYear() - 1973 : (p.entry_year ? p.entry_year - 1973 : 50); 
                return (
                  <div key={p.id} className="w-full">
                    <button onClick={() => { setSelectedUserId(p.id); setPopupInfo(null); }} className={`w-full text-left px-4 py-3 rounded-xl transition-all ${selectedUserId === p.id ? 'bg-[#85023e] text-white shadow-lg' : 'bg-white border border-gray-100 text-gray-600 hover:border-[#85023e]'}`}>
                      <div className="flex justify-between items-start">
                        <span className="text-[11px] font-black uppercase tracking-tight">{p.display_name} <span className={`ml-1 text-[9px] font-bold ${selectedUserId === p.id ? 'text-white/60' : 'text-gray-400'}`}>({generation}回生)</span></span>
                        {String(p.strava_id) === String(myStravaId) && (
                          <span onClick={(e) => { e.stopPropagation(); setTargetProfileId(p.id); setEditForm({ display_name: p.display_name, bio: p.bio || '', bike_model: p.bike_model || '' }); setIsEditModalOpen(true); }} className="text-[8px] bg-[#FC4C02] text-white px-2 py-0.5 rounded font-black cursor-pointer hover:scale-110 transition-transform">EDIT</span>
                        )}
                      </div>
                      <p className={`text-[8px] font-bold mt-1 ${selectedUserId === p.id ? 'text-white/80' : 'text-gray-400'}`}>🚲 {p.bike_model || 'Bicycle'}</p>
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
              <h2 className="text-[10px] font-black text-red-500 mb-4 uppercase tracking-widest text-center font-black">🛡️ Admin: Pending</h2>
              {profiles.filter(p => p.status === 'pending').map(p => (
                <div key={p.id} className="bg-white p-3 rounded-xl border border-red-100 mb-2 shadow-sm text-center">
                  <p className="text-[10px] font-black text-gray-800 mb-2">{p.display_name}</p>
                  <button onClick={() => approveMember(p.id)} className="w-full bg-green-500 hover:bg-green-600 text-white text-[9px] font-black py-2 rounded-lg uppercase tracking-widest transition-colors shadow-sm">Approve Member</button>
                </div>
              ))}
            </div>
          )}
        </aside>

        <div className="flex-1 relative bg-gray-100">
          <Map {...viewState} onMove={evt => setViewState(evt.viewState)} mapStyle="mapbox://styles/mapbox/light-v11" mapboxAccessToken={MAPBOX_TOKEN} interactiveLayerIds={['strava-path']}
            onMouseMove={e => { const f = e.features && e.features[0]; if (f) setHoverInfo({ lngLat: e.lngLat, props: f.properties }); else setHoverInfo(null); }}
            onMouseLeave={() => setHoverInfo(null)}
            onClick={e => { const f = e.features && e.features[0]; if (f) setPopupInfo({ lngLat: e.lngLat, props: f.properties }); else setPopupInfo(null); }}>
            {geoData && <Source id="strava-data" type="geojson" data={geoData}><Layer {...lineLayer} /></Source>}
            {hoverInfo && !popupInfo && (
              <Popup longitude={hoverInfo.lngLat.lng} latitude={hoverInfo.lngLat.lat} anchor="bottom" closeButton={false} className="pointer-events-none z-40">
                <div className="p-2 text-[9px] font-bold text-gray-800 bg-white/95 rounded shadow-xl border border-gray-100 min-w-[130px]">
                  <div className="border-b pb-1 mb-1 text-gray-900 uppercase font-black tracking-tighter">👤 {hoverInfo.props.userName}</div>
                  <p className="text-[#85023e] mb-1 leading-tight">{hoverInfo.props.name}</p>
                  <div className="flex flex-col gap-0.5 text-gray-500 font-mono text-[8px]">
                    <p>📅 {new Date(hoverInfo.props.start_date).toLocaleDateString()}</p>
                    <p>📏 {(hoverInfo.props.distance / 1000).toFixed(1)} km</p>
                    <p>⛰️ {Math.round(hoverInfo.props.elevation)} m UP</p>
                  </div>
                </div>
              </Popup>
            )}
          </Map>
        </div>
      </div>

      {showJoinModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[200] backdrop-blur-md p-4" onClick={() => setShowJoinModal(false)}>
          <div className="bg-white rounded-[40px] p-10 w-full max-w-sm shadow-2xl text-center" onClick={e => e.stopPropagation()}>
            <div className="text-5xl mb-6">🚴‍♂️</div>
            <h2 className="text-2xl font-black text-[#85023e] mb-2 uppercase italic tracking-tighter">Register to Hub</h2>
            <div className="flex flex-col gap-4 mb-8 text-left">
              <div>
                <label className="text-[9px] font-black text-gray-300 uppercase tracking-widest ml-4 mb-1 block">Enrollment Year</label>
                <select value={entryYear} onChange={(e) => setEntryYear(Number(e.target.value))} className="w-full bg-gray-50 border rounded-2xl p-4 font-black text-sm outline-none cursor-pointer">
                  {Array.from({length: 21}, (_, i) => 2016 + i).map(y => (<option key={y} value={y}>{y}年度入学 ({y - 1973}回生)</option>))}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-300 uppercase tracking-widest ml-4 mb-1 block">Course Duration (Years)</label>
                <select value={years} onChange={(e) => setYears(Number(e.target.value))} className="w-full bg-gray-50 border rounded-2xl p-4 font-black text-sm outline-none cursor-pointer">
                  {Array.from({length: 13}, (_, i) => i + 1).map(y => (<option key={y} value={y}>{y}年間</option>))}
                </select>
              </div>
            </div>
            <a href={stravaAuthUrl} className="block w-full bg-[#FC4C02] text-white font-black py-5 rounded-[25px] text-xs uppercase shadow-xl hover:translate-y-[-2px] transition-all">Connect Strava</a>
            <button onClick={() => setShowJoinModal(false)} className="mt-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Later</button>
          </div>
        </div>
      )}

      {isEditModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-md p-4" onClick={() => setIsEditModalOpen(false)}>
          <div className="bg-white rounded-[35px] p-10 w-full max-w-md shadow-2xl border border-gray-100" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-black text-[#85023e] mb-8 tracking-tighter uppercase italic text-center">Update Profile</h2>
            <div className="flex flex-col gap-6">
              <input type="text" placeholder="Name" value={editForm.display_name} onChange={(e) => setEditForm({...editForm, display_name: e.target.value})} className="w-full bg-gray-50 rounded-2xl px-5 py-4 font-bold text-sm outline-none" />
              <input type="text" placeholder="My Bike" value={editForm.bike_model} onChange={(e) => setEditForm({...editForm, bike_model: e.target.value})} className="w-full bg-gray-50 rounded-2xl px-5 py-4 font-bold text-sm outline-none" />
              <textarea rows={3} placeholder="Bio" value={editForm.bio} onChange={(e) => setEditForm({...editForm, bio: e.target.value})} className="w-full bg-gray-50 rounded-2xl px-5 py-4 font-medium text-xs outline-none resize-none" />
              <div className="flex gap-4"><button onClick={() => setIsEditModalOpen(false)} className="flex-1 bg-gray-100 text-gray-400 font-black py-4 rounded-3xl text-[10px] uppercase">Cancel</button><button onClick={handleUpdateProfile} className="flex-1 bg-[#85023e] text-white font-black py-4 rounded-3xl text-[10px] uppercase shadow-xl shadow-[#85023e]/30">Save</button></div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}