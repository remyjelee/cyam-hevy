import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase';
import { currentWeekStart, todayAEST } from '@/lib/dates';
import { ChallengeConfig } from '@/lib/types';
import { recomputeWeek } from '@/lib/scoring';

export const dynamic = 'force-dynamic';

function checkAuth(req: NextRequest): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const got = req.headers.get('x-admin-password');
  return got === expected;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const userId = body.user_id as string;
  const weekStart = (body.week_start as string) ?? currentWeekStart();

  if (!userId) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 });
  }

  const db = getServerSupabase();

  // Check user has hearts remaining.
  const { data: heartsRow, error: heartsErr } = await db
    .from('user_hearts_remaining')
    .select('hearts_remaining')
    .eq('user_id', userId)
    .single();

  if (heartsErr || !heartsRow) {
    console.error('Hearts check failed', heartsErr);
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }

  if (heartsRow.hearts_remaining <= 0) {
    return NextResponse.json({ error: 'no hearts remaining' }, { status: 400 });
  }

  // Cross-check against heart_log so we still block double-use even if
  // weekly_results somehow became out-of-sync.
  const { data: heartLogs, error: heartLogErr } = await db
    .from('heart_log')
    .select('action')
    .eq('user_id', userId)
    .eq('week_start', weekStart);

  if (heartLogErr) {
    console.error('heart_log check failed', heartLogErr);
    return NextResponse.json({ error: 'db read failed' }, { status: 500 });
  }

  const usedCount = (heartLogs ?? []).filter((r: any) => r.action === 'used').length;
  const refundCount = (heartLogs ?? []).filter((r: any) => r.action === 'refund').length;
  const netUsedThisWeek = usedCount - refundCount;

  // Guard: already used this week. `heart_log` is the source of truth; the
  // weekly_results row is a derived projection that recomputeWeek owns.
  if (netUsedThisWeek > 0) {
    return NextResponse.json(
      { error: 'heart already used this week' },
      { status: 400 },
    );
  }

  // Log the heart usage.
  const { error: logErr } = await db.from('heart_log').insert({
    user_id: userId,
    week_start: weekStart,
    action: 'used',
  });

  if (logErr) {
    console.error('heart_log insert failed', logErr);
    return NextResponse.json({ error: 'db insert failed' }, { status: 500 });
  }

  // Recompute so points_owed reflects the heart.
  const { data: configRow, error: configErr } = await db
    .from('challenge_config')
    .select('*')
    .eq('id', 1)
    .single();
  if (configErr || !configRow) {
    return NextResponse.json({ error: 'config missing' }, { status: 500 });
  }

  try {
    await recomputeWeek(
      db,
      userId,
      weekStart,
      configRow as ChallengeConfig,
      todayAEST(),
    );
  } catch (e: any) {
    console.error('recompute after heart use failed', e);
    return NextResponse.json(
      { error: e?.message ?? 'recompute failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, week_start: weekStart });
}