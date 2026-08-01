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

function isMockMode(): boolean {
  return (
    process.env.DEV_UI_MOCK === 'true' ||
    process.env.NEXT_PUBLIC_DEV_UI_MOCK === 'true'
  );
}

function dayFlagsFromCount(count: number, offset: number): boolean[] {
  const positions = [1, 2, 4, 5, 6, 0, 3];
  const flags = Array.from({ length: 7 }, () => false);
  for (let i = 0; i < Math.max(0, Math.min(7, count)); i += 1) {
    flags[positions[(i + offset) % 7]] = true;
  }
  return flags;
}

function mockDashboard(req: NextRequest): DashboardData {
  const mockConfig = {
    name: 'CYAM HEVY CHALLENGE',
    start_date: '2026-05-24',
    end_date: '2026-09-06',
    required_days_per_week: 3,
    hearts_per_user: 2,
    deduction_per_miss: 10,
  };
  const currentWeek = currentWeekStart();
  const weekStart = clampSelectedWeek(
    req.nextUrl.searchParams.get('week_start'),
    mockConfig.start_date,
    currentWeek,
  );
  const challengeStartWeek = weekStartSunday(parseDate(mockConfig.start_date));
  const weekNumber = Math.floor(daysBetween(challengeStartWeek, weekStart) / 7) + 1;
  const allWeekStarts: string[] = [];
  for (let w = challengeStartWeek; w <= currentWeek; w = addDays(w, 7)) {
    allWeekStarts.push(w);
  }
  const weekIdx = allWeekStarts.indexOf(weekStart);

  const mockPeople = [
    { id: 'mock-amy', name: 'amy', color: '#FF7CC8', hearts: 2, offset: 0 },
    { id: 'mock-yehoo', name: 'yehoo', color: '#9AD7FF', hearts: 1, offset: 2 },
    { id: 'mock-justin', name: 'JUSTIN', color: '#FFD37A', hearts: 2, offset: 4 },
    { id: 'mock-patrick', name: 'patrick', color: '#C7B7FF', hearts: 1, offset: 1 },
  ];

  const users: DashboardUser[] = mockPeople.map((p) => {
    const weekCounts = allWeekStarts.map((_, idx) => {
      const sample = [2, 3, 1, 4, 2, 3, 0, 4];
      return sample[(idx + p.offset) % sample.length];
    });
    const selectedCount = weekCounts[Math.max(0, weekIdx)] ?? 0;
    const currentWeekDays = dayFlagsFromCount(selectedCount, p.offset);
    const currentWeekHeartUsed = p.id === 'mock-patrick';

    let cumulative = 0;
    const chartSeries = allWeekStarts.map((ws, idx) => {
      cumulative += weekCounts[idx] ?? 0;
      return {
        week_start: ws,
        week_number: idx + 1,
        cumulative_days: cumulative,
      };
    });

    const weekdayTotals = Array.from({ length: 7 }, () => 0);
    for (let idx = 0; idx < allWeekStarts.length; idx += 1) {
      const flags = dayFlagsFromCount(weekCounts[idx] ?? 0, p.offset + idx);
      for (let i = 0; i < 7; i += 1) {
        if (flags[i]) weekdayTotals[i] += 1;
      }
    }
    const consistencyWeekCount = Math.max(1, allWeekStarts.length);
    const consistencyWeekdayIntensity = weekdayTotals.map(
      (n) => n / consistencyWeekCount,
    );

    const finalizedWeeks = weekCounts.slice(0, Math.max(0, allWeekStarts.length - 1));
    const misses = finalizedWeeks.reduce(
      (sum, count) => sum + Math.max(0, mockConfig.required_days_per_week - count),
      0,
    );
    const totalOwed = misses * mockConfig.deduction_per_miss;

    return {
      id: p.id,
      display_name: p.name,
      display_color: p.color,
      profile_image_url: null,
      left_week_start: null,
      hearts_remaining: p.hearts,
      current_week_days: currentWeekDays,
      current_week_days_count: currentWeekDays.filter(Boolean).length,
      current_week_heart_used: currentWeekHeartUsed,
      streak: 2 + (p.offset % 3),
      total_owed: totalOwed,
      total_days_worked_out: weekCounts.reduce((sum, n) => sum + n, 0),
      penalty_count:
        mockConfig.deduction_per_miss > 0
          ? totalOwed / mockConfig.deduction_per_miss
          : 0,
      consistency_weekday_intensity: consistencyWeekdayIntensity,
      consistency_week_count: consistencyWeekCount,
      chart_series: chartSeries,
    };
  });

  users.sort((a, b) => {
    if (b.current_week_days_count !== a.current_week_days_count) {
      return b.current_week_days_count - a.current_week_days_count;
    }
    return a.display_name.localeCompare(b.display_name);
  });

  return {
    challenge_name: mockConfig.name,
    start_date: mockConfig.start_date,
    end_date: mockConfig.end_date,
    week_start: weekStart,
    current_week_start: currentWeek,
    week_number: weekNumber,
    is_current_week: weekStart === currentWeek,
    can_go_prev_week: weekStart > challengeStartWeek,
    can_go_next_week: weekStart < currentWeek,
    required_days_per_week: mockConfig.required_days_per_week,
    hearts_per_user: mockConfig.hearts_per_user,
    deduction_per_miss: mockConfig.deduction_per_miss,
    auto_consume_hearts: false,
    last_synced_at: new Date().toISOString(),
    total_pool: users.reduce((sum, u) => sum + u.total_owed, 0),
    chart_weeks: allWeekStarts.map((ws, idx) => ({
      week_start: ws,
      week_number: idx + 1,
    })),
    users,
  };
}

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
  if (isMockMode()) {
    return NextResponse.json<DashboardData>(mockDashboard(req), {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }

  const db = getServerSupabase();

  const { data: configRow, error: configErr } = await db
    .from('challenge_config')
    .select('*')
    .eq('id', 1)
    .single();
  if (configErr || !configRow) {
    console.error('dashboard config read failed', configErr);
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
  const allWeekStarts: string[] = [];
  for (
    let w = challengeStartWeek;
    w <= currentWeek;
    w = addDays(w, 7)
  ) {
    allWeekStarts.push(w);
  }

  // 1) All active users.
  const { data: users, error: usersErr } = await db
    .from('users')
    .select('id, display_name, display_color, profile_image_url, created_at, left_week_start')
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (usersErr) {
    console.error('dashboard users read failed', usersErr);
    return NextResponse.json({ error: 'users read failed' }, { status: 500 });
  }

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
      auto_consume_hearts: config.auto_consume_hearts ?? false,
      last_synced_at: null,
      total_pool: 0,
      chart_weeks: [],
      users: [],
    });
  }

  const userIds = users.map((u: any) => u.id);

  // 2) Hearts remaining.
  const { data: heartsRows, error: heartsErr } = await db
    .from('user_hearts_remaining')
    .select('user_id, hearts_remaining')
    .in('user_id', userIds);
  if (heartsErr) {
    console.error('dashboard hearts read failed', heartsErr);
    return NextResponse.json({ error: 'hearts read failed' }, { status: 500 });
  }
  const heartsByUser = new Map<string, number>(
    (heartsRows ?? []).map((r: any) => [r.user_id, r.hearts_remaining]),
  );

  // 3) Selected week's workouts (one row per workout).
  const { data: weekWorkouts, error: weekWorkoutsErr } = await db
    .from('workouts')
    .select('user_id, workout_date')
    .in('user_id', userIds)
    .gte('workout_date', weekStart)
    .lt('workout_date', weekEndExclusive);
  if (weekWorkoutsErr) {
    console.error('dashboard selected workouts read failed', weekWorkoutsErr);
    return NextResponse.json({ error: 'workouts read failed' }, { status: 500 });
  }

  // Group: user_id -> Set<dateStr>
  const daysByUser = new Map<string, Set<string>>();
  for (const w of weekWorkouts ?? []) {
    const set = daysByUser.get((w as any).user_id) ?? new Set<string>();
    set.add(String((w as any).workout_date).slice(0, 10));
    daysByUser.set((w as any).user_id, set);
  }

  // 3b) All challenge workouts for heatmap + cumulative chart.
  const { data: challengeWorkouts, error: challengeWorkoutsErr } = await db
    .from('workouts')
    .select('user_id, workout_date')
    .in('user_id', userIds)
    .gte('workout_date', challengeStartWeek)
    .lt('workout_date', addDays(currentWeek, 7));
  if (challengeWorkoutsErr) {
    console.error('dashboard challenge workouts read failed', challengeWorkoutsErr);
    return NextResponse.json({ error: 'workouts read failed' }, { status: 500 });
  }

  const challengeWeekDaysByUser = new Map<string, Map<string, Set<string>>>();
  for (const w of challengeWorkouts ?? []) {
    const userId = (w as any).user_id as string;
    const workoutDate = String((w as any).workout_date).slice(0, 10);
    const ws = weekStartSunday(parseDate(workoutDate));
    const byWeek = challengeWeekDaysByUser.get(userId) ?? new Map<string, Set<string>>();
    const set = byWeek.get(ws) ?? new Set<string>();
    set.add(workoutDate);
    byWeek.set(ws, set);
    challengeWeekDaysByUser.set(userId, byWeek);
  }

  // 4) Heart-used flags for current week.
  const { data: selectedWeekResults, error: selectedWeekResultsErr } = await db
    .from('weekly_results')
    .select('user_id, heart_used, week_day_flags, finalized, days_worked_out')
    .in('user_id', userIds)
    .eq('week_start', weekStart);
  if (selectedWeekResultsErr) {
    console.error('dashboard selected results read failed', selectedWeekResultsErr);
    return NextResponse.json({ error: 'results read failed' }, { status: 500 });
  }
  const selectedWeekResultsByUser = new Map<string, any>(
    (selectedWeekResults ?? []).map((r: any) => [r.user_id, r]),
  );

  // Cross-check from heart_log in case weekly_results is stale/out-of-sync.
  const { data: selectedWeekHeartLog, error: selectedWeekHeartLogErr } = await db
    .from('heart_log')
    .select('user_id, action')
    .in('user_id', userIds)
    .eq('week_start', weekStart);
  if (selectedWeekHeartLogErr) {
    console.error('dashboard selected heart_log read failed', selectedWeekHeartLogErr);
    return NextResponse.json({ error: 'heart log read failed' }, { status: 500 });
  }

  const heartNetByUser = new Map<string, number>();
  for (const row of selectedWeekHeartLog ?? []) {
    const userId = (row as any).user_id as string;
    const delta = (row as any).action === 'used' ? 1 : -1;
    heartNetByUser.set(userId, (heartNetByUser.get(userId) ?? 0) + delta);
  }

  const { data: allHeartLogs, error: allHeartLogsErr } = await db
    .from('heart_log')
    .select('user_id, week_start, action')
    .in('user_id', userIds)
    .gte('week_start', challengeStartWeek);
  if (allHeartLogsErr) {
    console.error('dashboard heart_log read failed', allHeartLogsErr);
    return NextResponse.json({ error: 'heart log read failed' }, { status: 500 });
  }

  const heartNetByUserWeek = new Map<string, number>();
  for (const row of allHeartLogs ?? []) {
    const userId = (row as any).user_id as string;
    const ws = (row as any).week_start as string;
    const key = `${userId}:${ws}`;
    const delta = (row as any).action === 'used' ? 1 : -1;
    heartNetByUserWeek.set(key, (heartNetByUserWeek.get(key) ?? 0) + delta);
  }

  // 5) All finalized weekly_results for streaks and total owed.
  const { data: allResults, error: allResultsErr } = await db
    .from('weekly_results')
    .select('user_id, week_start, days_worked_out, week_day_flags, heart_used, finalized, points_owed')
    .in('user_id', userIds)
    .order('week_start', { ascending: false });
  if (allResultsErr) {
    console.error('dashboard results read failed', allResultsErr);
    return NextResponse.json({ error: 'results read failed' }, { status: 500 });
  }

  const resultsByUser = new Map<string, any[]>();
  for (const r of allResults ?? []) {
    const arr = resultsByUser.get((r as any).user_id) ?? [];
    arr.push(r);
    resultsByUser.set((r as any).user_id, arr);
  }

  const dashboardUsers: DashboardUser[] = users.map((u: any) => {
    // A member who left mid-challenge counts for every week BEFORE
    // left_week_start and is absent from that week onward. We still return them
    // so the chart can show the weeks they were part of; the roster hides them.
    const leftWeekStart: string | null = u.left_week_start
      ? String(u.left_week_start).slice(0, 10)
      : null;
    const participatesIn = (ws: string) => !leftWeekStart || ws < leftWeekStart;
    const inSelectedWeek = participatesIn(weekStart);

    const days = inSelectedWeek
      ? daysByUser.get(u.id) ?? new Set<string>()
      : new Set<string>();
    const liveDayFlags = weekDateList.map((d) => days.has(d));
    const selectedResult = inSelectedWeek
      ? selectedWeekResultsByUser.get(u.id)
      : undefined;
    const dayFlags = liveDayFlags;
    const daysCount = dayFlags.filter(Boolean).length;

    const userResults = (resultsByUser.get(u.id) ?? []).filter(
      (r) => r.week_start >= config.start_date,
    );
    const userResultsByWeek = new Map<string, any>(
      userResults.map((r) => [r.week_start, r]),
    );
    const derivedWeeks = allWeekStarts
      .map((ws, idx) => ({ ws, idx }))
      .filter(({ ws }) => participatesIn(ws))
      .map(({ ws, idx }) => {
      const sourceSet = challengeWeekDaysByUser.get(u.id)?.get(ws) ?? new Set<string>();
      const sourceFlags = weekDates(ws).map((d) => sourceSet.has(d));
      const sourceDays = sourceFlags.filter(Boolean).length;
      const weekRow = userResultsByWeek.get(ws);
      const heartUsed = (heartNetByUserWeek.get(`${u.id}:${ws}`) ?? 0) > 0;
      const finalized = Boolean(weekRow?.finalized);
      const pointsOwed =
        finalized && !heartUsed
          ? Math.max(0, config.required_days_per_week - sourceDays) *
            config.deduction_per_miss
          : 0;

      return {
        week_start: ws,
        week_number: idx + 1,
        day_flags: sourceFlags,
        days_worked_out: sourceDays,
        heart_used: heartUsed,
        finalized,
        points_owed: pointsOwed,
      };
    });
    // Streak: walk back from most recent FINALIZED week. Stop on a "miss"
    // (didn't hit required AND no heart). Current in-progress week is included
    // only if hearts used or already at required count.
    let streak = 0;
    const sorted = [...derivedWeeks].sort((a, b) =>
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

    const totalOwed = derivedWeeks
      .filter((r) => r.finalized)
      .reduce((sum, r) => sum + (r.points_owed || 0), 0);

    const consistencyWeeks = derivedWeeks;
    const consistencyWeekCount = consistencyWeeks.length;
    const weekdayTotals = Array.from({ length: 7 }, () => 0);
    for (const w of consistencyWeeks) {
      for (let i = 0; i < 7; i += 1) {
        if (w.day_flags[i]) weekdayTotals[i] += 1;
      }
    }
    const consistencyWeekdayIntensity = weekdayTotals.map((n) =>
      consistencyWeekCount > 0 ? n / consistencyWeekCount : 0,
    );

    let cumulative = 0;
    const chartSeries = consistencyWeeks.map((w) => {
      const daysWorked = w.day_flags.filter(Boolean).length;
      cumulative += daysWorked;
      return {
        week_start: w.week_start,
        week_number: w.week_number,
        cumulative_days: cumulative,
      };
    });
    const totalDaysWorkedOut = consistencyWeeks.reduce(
      (sum, w) => sum + w.day_flags.filter(Boolean).length,
      0,
    );
    const penaltyCount = config.deduction_per_miss > 0 ? totalOwed / config.deduction_per_miss : 0;

    return {
      id: u.id,
      display_name: u.display_name,
      display_color: u.display_color ?? null,
      profile_image_url: u.profile_image_url,
      left_week_start: leftWeekStart,
      hearts_remaining: heartsByUser.get(u.id) ?? config.hearts_per_user,
      // Show live week activity even before challenge start so users can verify
      // their integration and preview the dashboard experience.
      current_week_days: dayFlags,
      current_week_days_count: daysCount,
      current_week_heart_used:
        inSelectedWeek &&
        ((selectedResult?.heart_used ?? false) ||
          (heartNetByUser.get(u.id) ?? 0) > 0),
      streak: hasStarted ? streak : 0,
      total_owed: totalOwed,
      total_days_worked_out: totalDaysWorkedOut,
      penalty_count: penaltyCount,
      consistency_weekday_intensity: consistencyWeekdayIntensity,
      consistency_week_count: consistencyWeekCount,
      chart_series: chartSeries,
    };
  });

  // Sort: most days first, then who reached that count earlier in the week,
  // then fewest owed, then name.
  dashboardUsers.sort((a, b) => {
    // Members who left before the selected week sink to the end; the dashboard
    // hides them from the roster but still charts the weeks they were here for.
    const aGone = Boolean(a.left_week_start && weekStart >= a.left_week_start);
    const bGone = Boolean(b.left_week_start && weekStart >= b.left_week_start);
    if (aGone !== bGone) return aGone ? 1 : -1;
    if (b.current_week_days_count !== a.current_week_days_count) {
      return b.current_week_days_count - a.current_week_days_count;
    }
    for (let i = 0; i < 7; i += 1) {
      const aDone = a.current_week_days[i] ? 1 : 0;
      const bDone = b.current_week_days[i] ? 1 : 0;
      if (aDone !== bDone) return bDone - aDone;
    }
    if (a.total_owed !== b.total_owed) return a.total_owed - b.total_owed;
    return a.display_name.localeCompare(b.display_name);
  });

  // 6) Last sync time = most recent computed_at across weekly_results.
  const { data: lastSync, error: lastSyncErr } = await db
    .from('weekly_results')
    .select('computed_at')
    .order('computed_at', { ascending: false })
    .limit(1);
  if (lastSyncErr) {
    console.error('dashboard last sync read failed', lastSyncErr);
    return NextResponse.json({ error: 'last sync read failed' }, { status: 500 });
  }

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
    auto_consume_hearts: config.auto_consume_hearts ?? false,
    last_synced_at: lastSync?.[0]?.computed_at ?? null,
    total_pool: totalPool,
    chart_weeks: allWeekStarts.map((ws, idx) => ({
      week_start: ws,
      week_number: idx + 1,
    })),
    users: dashboardUsers,
  };

  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 's-maxage=30, stale-while-revalidate=60',
    },
  });
}
