import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase';
import { todayAEST } from '@/lib/dates';
import { ChallengeConfig } from '@/lib/types';
import { backfillStravaActivity } from '@/lib/scoring';

export const dynamic = 'force-dynamic';

function checkAuth(req: NextRequest): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return req.headers.get('x-admin-password') === expected;
}

/** Parse a Strava activity id from a bare number or activity URL. */
function parseActivityId(raw: string | number): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/\/activities\/(\d+)/);
  return m ? Number(m[1]) : null;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const userId = body.user_id as string | undefined;
  const activityId = parseActivityId(body.strava_activity_id ?? body.activity_url ?? '');
  if (!userId || !activityId) {
    return NextResponse.json(
      { error: 'user_id and strava_activity_id (or activity_url) required' },
      { status: 400 },
    );
  }

  const db = getServerSupabase();
  const { data: user, error: userErr } = await db
    .from('users')
    .select(
      'id, display_name, strava_athlete_id, strava_client_id, strava_client_secret, strava_refresh_token, strava_access_token, strava_token_expires_at, active',
    )
    .eq('id', userId)
    .single();
  if (userErr || !user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }

  const { data: config, error: configErr } = await db
    .from('challenge_config')
    .select('*')
    .eq('id', 1)
    .single();
  if (configErr || !config) {
    return NextResponse.json({ error: 'config missing' }, { status: 500 });
  }

  try {
    const result = await backfillStravaActivity(
      db,
      user as any,
      activityId,
      config as ChallengeConfig,
      todayAEST(),
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (e: any) {
    console.error('backfill-activity failed', e);
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
