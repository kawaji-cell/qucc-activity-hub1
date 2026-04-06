export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

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

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const maybeError = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    const parts = [
      typeof maybeError.message === 'string' ? maybeError.message : null,
      typeof maybeError.details === 'string' && maybeError.details ? maybeError.details : null,
      typeof maybeError.hint === 'string' && maybeError.hint
        ? `Hint: ${maybeError.hint}`
        : null,
      typeof maybeError.code === 'string' && maybeError.code ? `Code: ${maybeError.code}` : null,
    ].filter(Boolean);

    if (parts.length > 0) {
      return parts.join(' ');
    }
  }

  return 'Unknown error';
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');

  const after = searchParams.get('after') || '1262304000';
  const before = searchParams.get('before') || Math.floor(Date.now() / 1000).toString();

  if (!code) return NextResponse.json({ error: 'No code' }, { status: 400 });

  const creds = decodeCredentials(stateParam);
  const clientId = creds?.clientId ?? process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID;
  const clientSecret = creds?.clientSecret ?? process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Strava credentials not found.' }, { status: 400 });
  }

  try {
    const supabaseServer = getSupabaseServerClient();
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
    
    if (!tokenResponse.ok) {
      console.error('Strava Token Error:', tokenData);
      const message =
        tokenData?.message ||
        tokenData?.errors?.[0]?.message ||
        'Token fetch failed';
      throw new Error(`Strava API Error: ${message}`);
    }

    const accessToken = tokenData.access_token;
    const athlete = tokenData.athlete;

    if (!accessToken || !athlete) throw new Error('アクセストークンの取得に失敗しました');

    const { data: userData, error: userError } = await supabaseServer
      .from('profiles')
      .upsert({
        strava_id: athlete.id,
        display_name: `${athlete.firstname} ${athlete.lastname}`,
        entry_year: searchParams.get('entry_year')
          ? parseInt(searchParams.get('entry_year')!, 10)
          : null,
        status: 'pending',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'strava_id' })
      .select()
      .single();

    if (userError) {
      console.error('Supabase Profile Upsert Error:', userError);
      throw new Error(`Supabase profile upsert failed: ${getErrorMessage(userError)}`);
    }

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
          const { error: actError } = await supabaseServer.from('activities').upsert({
            user_id: userData.id,
            strava_activity_id: act.id,
            name: act.name,
            type: act.type,
            distance: act.distance,
            total_elevation_gain: act.total_elevation_gain || 0,
            polyline: act.map?.summary_polyline || null,
            start_date: act.start_date
          }, { onConflict: 'strava_activity_id' });
          
          if (actError) {
            console.error('Supabase Activity Upsert Error:', actError);
            throw new Error(`Supabase activity upsert failed: ${getErrorMessage(actError)}`);
          }
          if (!actError) totalSaved++;
        }
      }
      page++;
      if (page > 10) break; 
    }

    return NextResponse.json({ 
      success: true, 
      strava_id: athlete.id,
      count: totalSaved
    });

  } catch (error: unknown) {
    console.error('API Error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
