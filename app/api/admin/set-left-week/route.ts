import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase';
import { currentWeekStart, parseDate, weekStartSunday } from '@/lib/dates';

export const dynamic = 'force-dynamic';

function checkAuth(req: NextRequest): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return req.headers.get('x-admin-password') === expected;
}

/**
 * Mark a member as having left the challenge from a given week onward, or
 * reinstate them.
 *
 * Body: { user_id, left: true, week_start? }  -> they are out from week_start
 *                                                (defaults to the current week)
 *       { user_id, left: false }              -> they are back in
 *
 * Leaving is non-destructive: nothing is deleted, so reinstating restores their
 * full history and chart line. While they are out, the cron skips them, the
 * roster hides them, and they accrue no penalties.
 */
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const userId = body.user_id as string | undefined;
  if (!userId) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 });
  }

  const leaving = body.left !== false;

  let leftWeekStart: string | null = null;
  if (leaving) {
    const raw = (body.week_start as string | undefined) ?? currentWeekStart();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return NextResponse.json(
        { error: 'week_start must be YYYY-MM-DD' },
        { status: 400 },
      );
    }
    // Snap to the Sunday that begins the week so the comparison in the
    // dashboard and cron (week_start < left_week_start) is always well-formed.
    leftWeekStart = weekStartSunday(parseDate(raw));
  }

  const db = getServerSupabase();
  const { error } = await db
    .from('users')
    .update({ left_week_start: leftWeekStart })
    .eq('id', userId);

  if (error) {
    console.error('set-left-week failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, left_week_start: leftWeekStart });
}
