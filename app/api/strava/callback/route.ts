export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function decodeCredentials(state: string | null): { clientId: string; clientSecret: string } | null {
  if (!state) return null;
  try {
    const decoded = Buffer.from(state, 'base64').toString('utf-8');
    const [clientId, clientSecret] = decoded.split(':');
    if (clientId && clientSecret) return { clientId, clientSecret };
  } catch {
    // fall through
  }
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');

  // 期間指定（デフォルトは2010年〜現在）
  const after = searchParams.get('after') || '1262304000';
  const before = searchParams.get('before') || Math.floor(Date.now() / 1000).toString();

  if (!code) return NextResponse.json({ error: 'No code' }, { status: 400 });

  // state から資格情報を取得、なければ環境変数にフォールバック
  const creds = decodeCredentials(stateParam);
  const clientId = creds?.clientId ?? process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID;
  const clientSecret = creds?.clientSecret ?? process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Strava credentials not found. Please provide your own Client ID and Secret.' }, { status: 400 });
  }

  try {
    // 1. Stravaのトークンを取得
    const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    const athlete = tokenData.athlete;

    if (!accessToken) throw new Error('アクセストークンの取得に失敗しました');

    // 2. プロフィールの保存（upsert）
    // route.ts の 51行目付近：upsert の中身を修正
const { data: userData, error: userError } = await supabase
  .from('profiles')
  .upsert({
    strava_id: athlete.id,
    display_name: `${athlete.firstname} ${athlete.lastname}`,
    // 💡 ここを追加：URLから受け取った年度を保存する
    entry_year: searchParams.get('entry_year') ? parseInt(searchParams.get('entry_year')!) : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'strava_id' })
  .select()
  .single();

    if (userError) throw userError;

    // 3. アクティビティをループで取得して保存
    let page = 1;
    let totalSaved = 0;

    while (true) {
      const url = `https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=200&after=${after}&before=${before}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const activities = await response.json();

      if (!activities || !Array.isArray(activities) || activities.length === 0) break;

      for (const act of activities) {
        if (['Ride', 'MountainBikeRide', 'GravelRide', 'EBikeRide'].includes(act.type)) {
          const { error: actError } = await supabase.from('activities').upsert({
            user_id: userData.id,
            strava_activity_id: act.id,
            name: act.name,
            type: act.type,
            distance: act.distance,
            total_elevation_gain: act.total_elevation_gain || 0,
            polyline: act.map?.summary_polyline || null,
            start_date: act.start_date
          }, { onConflict: 'strava_activity_id' });
          
          if (!actError) totalSaved++;
        }
      }
      page++;
      if (page > 10) break; // 最大2000件でストップ
    }

    // 💡 修正のキモ：リダイレクトせず、JSONでIDを返す
    // これにより、フロント側で「今のログインユーザーのID」を受け取れるようになる
    return NextResponse.json({ 
      success: true, 
      strava_id: athlete.id,
      count: totalSaved
    });

  } catch (error: any) {
    console.error('🔥 API Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
