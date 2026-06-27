import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase';
import { currentWeekStart, todayAEST } from '@/lib/dates';
import { recomputeWeek } from '@/lib/scoring';
import { ChallengeConfig } from '@/lib/types';

export const dynamic = 'force-dynamic';

function checkAuth(req: NextRequest): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return req.headers.get('x-admin-password') === expected;
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

  // Check heart_log, the source of truth for heart usage.
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

  if (netUsedThisWeek <= 0) {
    return NextResponse.json(
      { error: 'no heart to refund this week' },
      { status: 400 },
    );
  }

  // Log the refund.
  const { error: logErr } = await db.from('heart_log').insert({
    user_id: userId,
    week_start: weekStart,
    action: 'refund',
  });

  if (logErr) {
    console.error('heart_log insert failed', logErr);
    return NextResponse.json({ error: 'db insert failed' }, { status: 500 });
  }

  // Recompute so points_owed and streak reflect the change.
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
    console.error('recompute after heart refund failed', e);
    return NextResponse.json(
      { error: e?.message ?? 'recompute failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}