import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only client using the service role key.
 * NEVER import this from a Client Component. It bypasses RLS.
 *
 * `cache: 'no-store'` is critical: the Next.js App Router patches global
 * `fetch` and caches GET responses by default. supabase-js issues SELECTs as
 * GETs, so without this those reads get frozen in the Next.js Data Cache
 * (which even persists across deployments) while writes (PATCH/POST) hit the
 * live DB — producing stale reads + live writes. Opt every query out of caching.
 */
export function getServerSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, cache: 'no-store' }),
    },
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
