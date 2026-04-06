import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured.');
}

if (!supabaseServiceRoleKey && !supabaseAnonKey) {
  throw new Error('Supabase server credentials are not configured.');
}

export const supabaseServer = createClient(
  supabaseUrl,
  supabaseServiceRoleKey ?? supabaseAnonKey!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
