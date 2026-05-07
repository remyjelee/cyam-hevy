import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only client using the service role key.
 * NEVER import this from a Client Component. It bypasses RLS.
 */
export function getServerSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

/**
 * Browser/anon client. Used only for Realtime presence (live viewer count).
 * Reads/writes are restricted by RLS - and we have no public policies, so this
 * client cannot read any data. It can still join Realtime channels.
 */
export function getBrowserSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}
