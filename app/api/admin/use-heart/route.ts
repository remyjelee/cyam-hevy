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
  const weekStart = currentWeekStart();

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

  // Check if a weekly_results row exists for this user+week.
  const { data: existing, error: existErr } = await db
    .from('weekly_results')
    .select('id, heart_used')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .maybeSingle();

  if (existErr) {
    console.error('weekly_results check failed', existErr);
    return NextResponse.json({ error: 'db read failed' }, { status: 500 });
  }

  // Guard: already used this week.
  if (existing?.heart_used || netUsedThisWeek > 0) {
    return NextResponse.json(
      { error: 'heart already used this week' },
      { status: 400 },
    );
  }

  // Either update the existing row or insert a new one.
  if (existing) {
    const { error: updateErr } = await db
      .from('weekly_results')
      .update({ heart_used: true, computed_at: new Date().toISOString() })
      .eq('id', existing.id);

    if (updateErr) {
      console.error('weekly_results update failed', updateErr);
      return NextResponse.json({ error: 'db update failed' }, { status: 500 });
    }
  } else {
    const { error: insertErr } = await db
      .from('weekly_results')
      .insert({
        user_id: userId,
        week_start: weekStart,
        days_worked_out: 0,
        heart_used: true,
        finalized: false,
        points_owed: 0,
        computed_at: new Date().toISOString(),
      });

    if (insertErr) {
      console.error('weekly_results insert failed', insertErr);
      return NextResponse.json({ error: 'db insert failed' }, { status: 500 });
    }
  }

  // Log the heart usage.
  const { error: logErr } = await db.from('heart_log').insert({
    user_id: userId,
    week_start: weekStart,
    action: 'used',
  });

  if (logErr) {
    console.error('heart_log insert failed', logErr);
    // Don't fail the whole request — the heart_used flag is already set.
  }

  // Recompute so points_owed reflects the heart.
  const { data: configRow } = await db
    .from('challenge_config')
    .select('*')
    .eq('id', 1)
    .single();
  if (configRow) {
    await recomputeWeek(
      db,
      userId,
      weekStart,
      configRow as ChallengeConfig,
      todayAEST(),
    );
  }

  return NextResponse.json({ ok: true, week_start: weekStart });
}