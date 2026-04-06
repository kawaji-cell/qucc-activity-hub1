import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabaseServerSingleton: SupabaseClient | null = null;

export function getSupabaseServerClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured.');
  }

  if (!supabaseServiceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured. Add it to the server environment for Strava callback writes.'
    );
  }

  if (supabaseServerSingleton) {
    return supabaseServerSingleton;
  }

  supabaseServerSingleton = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseServerSingleton;
}
