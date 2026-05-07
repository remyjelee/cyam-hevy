import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase';
import { currentWeekStart, addDays } from '@/lib/dates';
import { ChallengeConfig } from '@/lib/types';
import { recomputeWeek } from '@/lib/scoring';
import { todayAEST } from '@/lib/dates';

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
  // Hearts can only be claimed for the current (in-progress) week to enforce
  // the rule "must decide that week before it ends."
  const weekStart = currentWeekStart();

  if (!userId) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 });
  }

  const db = getServerSupabase();

  // Check user has hearts remaining.
  const { data: heartsRow } = await db
    .from('user_hearts_remaining')
    .select('hearts_remaining')
    .eq('user_id', userId)
    .single();
  if (!heartsRow || heartsRow.hearts_remaining <= 0) {
    return NextResponse.json(
      { error: 'no hearts remaining' },
      { status: 400 },
    );
  }

  // Check not already used this week.
  const { data: existing } = await db
    .from('weekly_results')
    .select('heart_used')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .maybeSingle();
  if (existing?.heart_used) {
    return NextResponse.json(
      { error: 'heart already used this week' },
      { status: 400 },
    );
  }

  // Mark heart as used: upsert weekly_results, then log it.
  await db.from('weekly_results').upsert(
    {
      user_id: userId,
      week_start: weekStart,
      heart_used: true,
      days_worked_out: existing ? undefined : 0,
    },
    { onConflict: 'user_id,week_start' },
  );

  await db.from('heart_log').insert({
    user_id: userId,
    week_start: weekStart,
    action: 'used',
  });

  // Recompute this week so points_owed reflects the heart.
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
