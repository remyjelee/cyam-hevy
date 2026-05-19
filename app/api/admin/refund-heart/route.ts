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

  // Check if a heart is actually used this week.
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

  if (!existing || !existing.heart_used) {
    return NextResponse.json(
      { error: 'no heart to refund this week' },
      { status: 400 },
    );
  }

  // Update by id for precision.
  const { error: updateErr } = await db
    .from('weekly_results')
    .update({ heart_used: false, computed_at: new Date().toISOString() })
    .eq('id', existing.id);

  if (updateErr) {
    console.error('weekly_results update failed', updateErr);
    return NextResponse.json({ error: 'db update failed' }, { status: 500 });
  }

  // Log the refund.
  const { error: logErr } = await db.from('heart_log').insert({
    user_id: userId,
    week_start: weekStart,
    action: 'refund',
  });

  if (logErr) {
    console.error('heart_log insert failed', logErr);
  }

  // Recompute so points_owed and streak reflect the change.
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

  return NextResponse.json({ ok: true });
}