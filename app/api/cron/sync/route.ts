import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase';
import { syncUser } from '@/lib/scoring';
import { todayAEST } from '@/lib/dates';
import { ChallengeConfig } from '@/lib/types';

export const dynamic = 'force-dynamic';
// Allow up to 60s. Hobby plan max is 60s on the default runtime.
export const maxDuration = 60;

/**
 * Verify request came from Vercel cron (or manual trigger with the right secret).
 * Vercel sets `Authorization: Bearer <CRON_SECRET>` automatically when CRON_SECRET
 * is set as an env var in the Vercel project. Manual triggers from the admin
 * page also send the same bearer.
 */
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // no secret configured -> allow (dev mode)
  const got = req.headers.get('authorization');
  return got === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getServerSupabase();

  // Load config.
  const { data: configRow, error: configErr } = await db
    .from('challenge_config')
    .select('*')
    .eq('id', 1)
    .single();
  if (configErr || !configRow) {
    return NextResponse.json({ error: 'config missing' }, { status: 500 });
  }
  const config = configRow as ChallengeConfig;

  // Load active users.
  const { data: users, error: usersErr } = await db
    .from('users')
    .select('*')
    .eq('active', true);
  if (usersErr) {
    return NextResponse.json({ error: usersErr.message }, { status: 500 });
  }

  const today = todayAEST();
  const results: any[] = [];
  const errors: any[] = [];

  // Sync sequentially to stay well under Strava's 200/15min rate limit.
  for (const user of users ?? []) {
    try {
      const r = await syncUser(db, user as any, config, today);
      results.push(r);
    } catch (e: any) {
      errors.push({ user_id: (user as any).id, error: e?.message ?? String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    synced: results.length,
    failed: errors.length,
    today,
    results,
    errors,
  });
}
