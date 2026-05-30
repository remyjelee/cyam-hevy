import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase';
import {
  ChallengeConfig,
  DashboardData,
  DashboardUser,
} from '@/lib/types';
import {
  addDays,
  currentWeekStart,
  daysBetween,
  parseDate,
  todayAEST,
  weekStartSunday,
  weekDates,
} from '@/lib/dates';

export const dynamic = 'force-dynamic';
// Cache aggressively at the edge so 20 friends refreshing doesn't hammer the DB.
export const revalidate = 30;

function clampSelectedWeek(
  rawWeek: string | null,
  challengeStart: string,
  currentWeek: string,
): string {
  const challengeStartWeek = weekStartSunday(parseDate(challengeStart));
  if (!rawWeek || !/^\d{4}-\d{2}-\d{2}$/.test(rawWeek)) return currentWeek;
  const normalized = weekStartSunday(parseDate(rawWeek));
  if (normalized < challengeStartWeek) return challengeStartWeek;
  if (normalized > currentWeek) return currentWeek;
  return normalized;
}

export async function GET(req: NextRequest) {
  const db = getServerSupabase();

  const { data: configRow } = await db
    .from('challenge_config')
    .select('*')
    .eq('id', 1)
    .single();
  if (!configRow) {
    return NextResponse.json({ error: 'config missing' }, { status: 500 });
  }
  const config = configRow as ChallengeConfig;

  const currentWeek = currentWeekStart();
  const weekStart = clampSelectedWeek(
    req.nextUrl.searchParams.get('week_start'),
    config.start_date,
    currentWeek,
  );
  const challengeStartWeek = weekStartSunday(parseDate(config.start_date));
  const weekNumber = Math.floor(daysBetween(challengeStartWeek, weekStart) / 7) + 1;
  const today = todayAEST();
  const hasStarted = today >= config.start_date;
  const weekDateList = weekDates(weekStart);
  const weekEndExclusive = addDays(weekStart, 7);

  // 1) All active users.
  const { data: users } = await db
    .from('users')
    .select('id, display_name, display_color, profile_image_url, created_at')
    .eq('active', true)
    .order('created_at', { ascending: true });

  if (!users || users.length === 0) {
    return NextResponse.json<DashboardData>({
      challenge_name: config.name,
      start_date: config.start_date,
      end_date: config.end_date,
      week_start: weekStart,
      current_week_start: currentWeek,
      week_number: weekNumber,
      is_current_week: weekStart === currentWeek,
      can_go_prev_week: weekStart > challengeStartWeek,
      can_go_next_week: weekStart < currentWeek,
      required_days_per_week: config.required_days_per_week,
      hearts_per_user: config.hearts_per_user,
      deduction_per_miss: config.deduction_per_miss,
      last_synced_at: null,
      total_pool: 0,
      users: [],
    });
  }

  const userIds = users.map((u: any) => u.id);

  // 2) Hearts remaining.
  const { data: heartsRows } = await db
    .from('user_hearts_remaining')
    .select('user_id, hearts_remaining')
    .in('user_id', userIds);
  const heartsByUser = new Map<string, number>(
    (heartsRows ?? []).map((r: any) => [r.user_id, r.hearts_remaining]),
  );

  // 3) Current week's workouts (one row per workout).
  const { data: weekWorkouts } = await db
    .from('workouts')
    .select('user_id, workout_date')
    .in('user_id', userIds)
    .gte('workout_date', weekStart)
    .lt('workout_date', weekEndExclusive);

  // Group: user_id -> Set<dateStr>
  const daysByUser = new Map<string, Set<string>>();
  for (const w of weekWorkouts ?? []) {
    const set = daysByUser.get((w as any).user_id) ?? new Set<string>();
    set.add((w as any).workout_date);
    daysByUser.set((w as any).user_id, set);
  }

  // 4) Heart-used flags for current week.
  const { data: selectedWeekResults } = await db
    .from('weekly_results')
    .select('user_id, heart_used, week_day_flags, finalized, days_worked_out')
    .in('user_id', userIds)
    .eq('week_start', weekStart);
  const selectedWeekResultsByUser = new Map<string, any>(
    (selectedWeekResults ?? []).map((r: any) => [r.user_id, r]),
  );

  // Cross-check from heart_log in case weekly_results is stale/out-of-sync.
  const { data: selectedWeekHeartLog } = await db
    .from('heart_log')
    .select('user_id, action')
    .in('user_id', userIds)
    .eq('week_start', weekStart);

  const heartNetByUser = new Map<string, number>();
  for (const row of selectedWeekHeartLog ?? []) {
    const userId = (row as any).user_id as string;
    const delta = (row as any).action === 'used' ? 1 : -1;
    heartNetByUser.set(userId, (heartNetByUser.get(userId) ?? 0) + delta);
  }

  // 5) All finalized weekly_results for streaks and total owed.
  const { data: allResults } = await db
    .from('weekly_results')
    .select('user_id, week_start, days_worked_out, heart_used, finalized, points_owed')
    .in('user_id', userIds)
    .order('week_start', { ascending: false });

  const resultsByUser = new Map<string, any[]>();
  for (const r of allResults ?? []) {
    const arr = resultsByUser.get((r as any).user_id) ?? [];
    arr.push(r);
    resultsByUser.set((r as any).user_id, arr);
  }

  const dashboardUsers: DashboardUser[] = users.map((u: any) => {
    const days = daysByUser.get(u.id) ?? new Set<string>();
    const liveDayFlags = weekDateList.map((d) => days.has(d));
    const selectedResult = selectedWeekResultsByUser.get(u.id);
    const frozenDayFlagsCandidate =
      Array.isArray(selectedResult?.week_day_flags) &&
      selectedResult.week_day_flags.length === 7
        ? selectedResult.week_day_flags.map(Boolean)
        : liveDayFlags;
    const frozenCount = frozenDayFlagsCandidate.filter(Boolean).length;
    const dayFlags =
      weekStart === currentWeek
        ? liveDayFlags
        : selectedResult?.finalized &&
            frozenCount === (selectedResult?.days_worked_out ?? frozenCount)
          ? frozenDayFlagsCandidate
          : liveDayFlags;
    const daysCount = dayFlags.filter(Boolean).length;

    const userResults = (resultsByUser.get(u.id) ?? []).filter(
      (r) => r.week_start >= config.start_date,
    );
    // Streak: walk back from most recent FINALIZED week. Stop on a "miss"
    // (didn't hit required AND no heart). Current in-progress week is included
    // only if hearts used or already at required count.
    let streak = 0;
    const sorted = userResults.sort((a, b) =>
      a.week_start < b.week_start ? 1 : -1,
    );
    for (const r of sorted) {
      const passed =
        r.heart_used || r.days_worked_out >= config.required_days_per_week;
      if (r.finalized) {
        if (passed) streak += 1;
        else break;
      } else {
        // current week: count only if already passed or heart used
        if (passed) streak += 1;
        // don't break either way for in-progress; just don't count if not passed
      }
    }

    const totalOwed = userResults
      .filter((r) => r.finalized)
      .reduce((sum, r) => sum + (r.points_owed || 0), 0);

    return {
      id: u.id,
      display_name: u.display_name,
      display_color: u.display_color ?? null,
      profile_image_url: u.profile_image_url,
      hearts_remaining: heartsByUser.get(u.id) ?? config.hearts_per_user,
      // Show live week activity even before challenge start so users can verify
      // their integration and preview the dashboard experience.
      current_week_days: dayFlags,
      current_week_days_count: daysCount,
      current_week_heart_used:
        (selectedResult?.heart_used ?? false) ||
        (heartNetByUser.get(u.id) ?? 0) > 0,
      streak: hasStarted ? streak : 0,
      total_owed: totalOwed,
    };
  });

  // Sort: most days first, then fewest owed, then name.
  dashboardUsers.sort((a, b) => {
    if (b.current_week_days_count !== a.current_week_days_count) {
      return b.current_week_days_count - a.current_week_days_count;
    }
    if (a.total_owed !== b.total_owed) return a.total_owed - b.total_owed;
    return a.display_name.localeCompare(b.display_name);
  });

  // 6) Last sync time = most recent computed_at across weekly_results.
  const { data: lastSync } = await db
    .from('weekly_results')
    .select('computed_at')
    .order('computed_at', { ascending: false })
    .limit(1);

  const totalPool = dashboardUsers.reduce((s, u) => s + u.total_owed, 0);

  const payload: DashboardData = {
    challenge_name: config.name,
    start_date: config.start_date,
    end_date: config.end_date,
    week_start: weekStart,
    current_week_start: currentWeek,
    week_number: weekNumber,
    is_current_week: weekStart === currentWeek,
    can_go_prev_week: weekStart > challengeStartWeek,
    can_go_next_week: weekStart < currentWeek,
    required_days_per_week: config.required_days_per_week,
    hearts_per_user: config.hearts_per_user,
    deduction_per_miss: config.deduction_per_miss,
    last_synced_at: lastSync?.[0]?.computed_at ?? null,
    total_pool: totalPool,
    users: dashboardUsers,
  };

  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 's-maxage=30, stale-while-revalidate=60',
    },
  });
}
