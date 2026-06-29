import { SupabaseClient } from '@supabase/supabase-js';
import { ChallengeConfig } from './types';
import { addDays, nowInAEST, parseDate, weekStartSunday } from './dates';
import {
  fetchActivities,
  fetchActivityById,
  fetchAthleteProfile,
  refreshAccessToken,
  dateToUnixAEST,
  StravaActivity,
  StravaCredentials,
} from './strava';
import { decryptSecret, encryptSecret } from './secrets';

// =============================================================================
// Sync + score logic.
// Called by the cron route. Idempotent: safe to run multiple times per day.
// =============================================================================

interface UserRow {
  id: string;
  display_name: string;
  strava_athlete_id: number;
  strava_client_id: string | null;
  strava_client_secret: string | null;
  strava_refresh_token: string;
  strava_access_token: string | null;
  strava_token_expires_at: string | null;
  active: boolean;
}

function userCreds(user: UserRow): StravaCredentials {
  return {
    clientId: user.strava_client_id || process.env.STRAVA_CLIENT_ID || '',
    clientSecret: user.strava_client_secret
      ? decryptSecret(user.strava_client_secret)
      : process.env.STRAVA_CLIENT_SECRET || '',
  };
}

/**
 * Ensure we have a non-expired access token for this user.
 * Refreshes if needed and persists the new tokens.
 */
async function ensureAccessToken(
  db: SupabaseClient,
  user: UserRow,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = user.strava_token_expires_at
    ? Math.floor(new Date(user.strava_token_expires_at).getTime() / 1000)
    : 0;

  // Refresh if expiring within 5 minutes.
  if (user.strava_access_token && expiresAt > now + 300) {
    return decryptSecret(user.strava_access_token);
  }

  const tok = await refreshAccessToken(
    userCreds(user),
    decryptSecret(user.strava_refresh_token),
  );
  await db
    .from('users')
    .update({
      strava_access_token: encryptSecret(tok.access_token),
      strava_refresh_token: encryptSecret(tok.refresh_token),
      strava_token_expires_at: new Date(tok.expires_at * 1000).toISOString(),
    })
    .eq('id', user.id);
  return tok.access_token;
}

/**
 * Determine if an activity counts toward this challenge.
 * Currently: type is in counted_activity_types AND moving_time >= min_workout_seconds.
 */
/** Normalize a Postgres `date` or ISO string to YYYY-MM-DD. */
function normalizeWorkoutDate(raw: string): string {
  return raw.slice(0, 10);
}

function matchesCountedType(
  type: string,
  sportType: string,
  allowed: string[],
): boolean {
  const types = [type, sportType].filter(Boolean);
  if (types.some((t) => allowed.includes(t))) return true;
  // Garmin uploads often use TrailRun, VirtualRun, etc.
  if (allowed.includes('Run')) {
    return types.some((t) => /run$/i.test(t));
  }
  return false;
}

function activityCounts(
  activity: StravaActivity,
  config: ChallengeConfig,
): boolean {
  const allowed = config.counted_activity_types.split(',').map((s) => s.trim());
  const matchesType = matchesCountedType(activity.type, activity.sport_type, allowed);
  // GPS glitches often crush moving_time while elapsed_time still reflects the
  // real session length — use the larger of the two for the duration check.
  const duration = Math.max(activity.moving_time, activity.elapsed_time);
  return matchesType && duration >= config.min_workout_seconds;
}

/**
 * Convert a Strava `start_date_local` (a UTC-formatted ISO string that
 * actually represents wall-clock local time) into a YYYY-MM-DD date string.
 * Example: "2026-05-12T07:30:00Z" -> "2026-05-12"
 */
function localDate(activity: StravaActivity): string {
  return activity.start_date_local.slice(0, 10);
}

/** True when Strava/Garmin GPS corruption makes start timestamps unreliable. */
function hasCorruptGpsTimestamps(activity: StravaActivity): boolean {
  if (!activity.flagged) return false;
  // e.g. 42 min moving but 97 hr elapsed on a flagged run
  return (
    activity.elapsed_time > 24 * 3600 &&
    activity.moving_time < activity.elapsed_time / 5
  );
}

/**
 * Challenge workout date in AEST. For GPS-corrupt activities, Strava's
 * start_date_local can be days wrong; on first import we use the sync day
 * (when the upload landed). On later syncs the stored date is kept — using
 * sync day again would slide the workout forward every time sync runs.
 */
function workoutDateForImport(
  activity: StravaActivity,
  syncDateAest: string,
  existingWorkoutDate?: string,
): string {
  if (hasCorruptGpsTimestamps(activity)) {
    return existingWorkoutDate ?? syncDateAest;
  }
  return localDate(activity);
}

/**
 * Sync one user: fetch activities since (current week start - 1 day) through
 * end of today, store qualifying ones, and recompute weekly_results for any
 * weeks touched.
 */
export async function syncUser(
  db: SupabaseClient,
  user: UserRow,
  config: ChallengeConfig,
  todayDateStr: string,
): Promise<{ user_id: string; activities_seen: number; weeks_updated: string[] }> {
  const accessToken = await ensureAccessToken(db, user);

  // Best-effort profile image refresh so stale/expired avatar URLs self-heal
  // without requiring a full reconnect flow.
  try {
    const athlete = await fetchAthleteProfile(accessToken);
    const profileImageUrl = athlete.profile_medium || athlete.profile || null;
    if (profileImageUrl) {
      await db
        .from('users')
        .update({ profile_image_url: profileImageUrl })
        .eq('id', user.id);
    }
  } catch (e) {
    console.error(`Profile refresh failed for user ${user.id}`, e);
  }

  // Fetch from 10 days ago through end of today, in AEST.
  const fromDate = addDays(todayDateStr, -10);
  const toDate = addDays(todayDateStr, 1); // exclusive upper bound
  const after = dateToUnixAEST(fromDate);
  const before = dateToUnixAEST(toDate);

  const activities = await fetchActivities(accessToken, after, before);

  // Persist qualifying activities; upsert updates metadata but must not slide
  // GPS-corrupt workout dates forward on every sync.
  const qualifying = activities.filter((a) => activityCounts(a, config));
  if (qualifying.length > 0) {
    const activityIds = qualifying.map((a) => a.id);
    const { data: existingRows, error: existingErr } = await db
      .from('workouts')
      .select('strava_activity_id, workout_date')
      .eq('user_id', user.id)
      .in('strava_activity_id', activityIds);
    if (existingErr) {
      throw new Error(`workouts read failed for ${user.id}: ${existingErr.message}`);
    }
    const existingDateByActivityId = new Map<number, string>(
      (existingRows ?? []).map((r: any) => [
        r.strava_activity_id as number,
        normalizeWorkoutDate(r.workout_date as string),
      ]),
    );

    const rows = qualifying.map((a) => ({
      user_id: user.id,
      strava_activity_id: a.id,
      start_date: a.start_date,
      workout_date: workoutDateForImport(
        a,
        todayDateStr,
        existingDateByActivityId.get(a.id),
      ),
      moving_time: a.moving_time,
      activity_type: a.sport_type || a.type,
      name: a.name,
    }));
    await db.from('workouts').upsert(rows, {
      onConflict: 'user_id,strava_activity_id',
    });
  }

  // Determine which weeks need recomputation: every week from fromDate..toDate.
  const weeksToUpdate = new Set<string>();
  for (let i = 0; i <= 11; i += 1) {
    const d = parseDate(addDays(fromDate, i));
    weeksToUpdate.add(weekStartSunday(d));
  }

  // Only recompute weeks that fall within the challenge window.
  const challengeStart = config.start_date;
  const challengeLastWeek = weekStartSunday(parseDate(config.end_date));
  const inWindow = Array.from(weeksToUpdate)
    .filter((w) => w >= challengeStart && w <= challengeLastWeek)
    .sort();

  for (const weekStart of inWindow) {
    await recomputeWeek(db, user.id, weekStart, config, todayDateStr);
  }

  return {
    user_id: user.id,
    activities_seen: activities.length,
    weeks_updated: inWindow,
  };
}

/** Pull one Strava activity by id and score it (for list-endpoint lag / manual fixes). */
export async function backfillStravaActivity(
  db: SupabaseClient,
  user: UserRow,
  activityId: number,
  config: ChallengeConfig,
  todayDateStr: string,
): Promise<{
  ok: boolean;
  reason?: string;
  workout_date?: string;
  qualifies?: boolean;
  name?: string;
}> {
  const accessToken = await ensureAccessToken(db, user);
  const activity = await fetchActivityById(accessToken, activityId);
  const qualifies = activityCounts(activity, config);
  const duration = Math.max(activity.moving_time, activity.elapsed_time);

  if (!qualifies) {
    return {
      ok: false,
      qualifies: false,
      name: activity.name,
      reason: `does not qualify (type=${activity.sport_type || activity.type}, duration=${duration}s, need ${config.min_workout_seconds}s)`,
    };
  }

  const workoutDateStr = workoutDateForImport(activity, todayDateStr);
  const { error: upsertErr } = await db.from('workouts').upsert(
    {
      user_id: user.id,
      strava_activity_id: activity.id,
      start_date: activity.start_date,
      workout_date: workoutDateStr,
      moving_time: activity.moving_time,
      activity_type: activity.sport_type || activity.type,
      name: activity.name,
    },
    { onConflict: 'user_id,strava_activity_id' },
  );
  if (upsertErr) {
    throw new Error(`workout upsert failed: ${upsertErr.message}`);
  }

  const weekStart = weekStartSunday(parseDate(workoutDateStr));
  await recomputeWeek(db, user.id, weekStart, config, todayDateStr);

  return {
    ok: true,
    qualifies: true,
    workout_date: workoutDateStr,
    name: activity.name,
  };
}

interface HeartState {
  remaining: number;
  netThisWeek: number;
  usedThisWeek: boolean;
}

async function getHeartState(
  db: SupabaseClient,
  userId: string,
  weekStart: string,
  config: ChallengeConfig,
): Promise<HeartState> {
  const { data: logs, error } = await db
    .from('heart_log')
    .select('action, week_start')
    .eq('user_id', userId);
  if (error) {
    throw new Error(`heart_log read failed for ${userId}: ${error.message}`);
  }
  const rows = (logs ?? []) as Array<{ action: string; week_start: string }>;
  const used = rows.filter((r) => r.action === 'used').length;
  const refunded = rows.filter((r) => r.action === 'refund').length;
  const remaining = config.hearts_per_user - used + refunded;
  const netThisWeek = rows
    .filter((r) => r.week_start === weekStart)
    .reduce((n, r) => n + (r.action === 'used' ? 1 : -1), 0);
  return {
    remaining,
    netThisWeek,
    usedThisWeek: netThisWeek > 0,
  };
}

function isFinalizedAfterGrace(weekEndExclusive: string, todayDateStr: string): boolean {
  if (todayDateStr > weekEndExclusive) return true;
  if (todayDateStr < weekEndExclusive) return false;

  // Give Strava/Hevy until Sunday noon AEST to settle Saturday uploads before
  // charging money or auto-spending hearts.
  const threshold = parseDate(weekEndExclusive);
  threshold.setUTCHours(12, 0, 0, 0);
  return nowInAEST().getTime() >= threshold.getTime();
}

/**
 * Recompute weekly_results for one user/week.
 * - days_worked_out = distinct workout_dates in [weekStart, weekStart+7)
 * - finalized = true once today >= weekStart + 7 (week is in the past)
 * - heart_used is derived from heart_log (the audit/source-of-truth table)
 * - points_owed = 0 if heart_used OR not finalized,
 *                 else max(0, required - days) * deduction_per_miss
 */
export async function recomputeWeek(
  db: SupabaseClient,
  userId: string,
  weekStart: string,
  config: ChallengeConfig,
  todayDateStr: string,
): Promise<void> {
  const weekEndExclusive = addDays(weekStart, 7);

  const { data: workouts, error: workoutsErr } = await db
    .from('workouts')
    .select('workout_date')
    .eq('user_id', userId)
    .gte('workout_date', weekStart)
    .lt('workout_date', weekEndExclusive);
  if (workoutsErr) {
    throw new Error(`workouts read failed for ${userId}: ${workoutsErr.message}`);
  }

  const distinctDays = new Set(
    (workouts ?? []).map((w: any) => normalizeWorkoutDate(w.workout_date)),
  );
  const daysWorkedOut = Math.min(7, distinctDays.size);
  const weekDayFlags = Array.from({ length: 7 }, (_, i) =>
    distinctDays.has(addDays(weekStart, i)),
  );

  const { data: existing, error: existingErr } = await db
    .from('weekly_results')
    .select('heart_used, finalized, days_worked_out, week_day_flags, points_owed')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .maybeSingle();
  if (existingErr) {
    throw new Error(`weekly_results read failed for ${userId}: ${existingErr.message}`);
  }

  const finalized = isFinalizedAfterGrace(weekEndExclusive, todayDateStr);
  const missed = Math.max(0, config.required_days_per_week - daysWorkedOut);
  let heartState = await getHeartState(db, userId, weekStart, config);
  let heartUsed = heartState.usedThisWeek;

  // Auto-consume hearts: when enabled, the moment a missed week finalizes we
  // spend one of the user's remaining hearts to cover it instead of charging
  // the penalty. Gated on `!existing.finalized` so it only fires on the
  // finalization transition (never retroactively on weeks finalized earlier,
  // and never more than once per week).
  if (
    config.auto_consume_hearts &&
    finalized &&
    !existing?.finalized &&
    daysWorkedOut < config.required_days_per_week &&
    missed > 0 &&
    !heartUsed &&
    heartState.remaining > 0 &&
    heartState.netThisWeek <= 0
  ) {
    const { error: logErr } = await db.from('heart_log').insert({
      user_id: userId,
      week_start: weekStart,
      action: 'used',
    });
    if (logErr) {
      throw new Error(`heart_log auto-use failed for ${userId}: ${logErr.message}`);
    }
    heartState = await getHeartState(db, userId, weekStart, config);
    heartUsed = heartState.usedThisWeek;
  }

  let pointsOwed = 0;
  if (finalized && !heartUsed) {
    pointsOwed = missed * config.deduction_per_miss;
  }

  // Keep finalized weeks frozen unless something they depend on actually
  // changed (workout days, or the heart/penalty outcome — e.g. an admin refund).
  if (existing?.finalized) {
    const existingFlags =
      Array.isArray((existing as any).week_day_flags) &&
      (existing as any).week_day_flags.length === 7
        ? (existing as any).week_day_flags.map(Boolean)
        : [];
    const unchanged =
      (existing as any).days_worked_out === daysWorkedOut &&
      existingFlags.length === 7 &&
      existingFlags.every((v: boolean, i: number) => v === weekDayFlags[i]) &&
      Boolean((existing as any).heart_used) === heartUsed &&
      ((existing as any).points_owed ?? 0) === pointsOwed;
    if (unchanged) return;
  }

  const { error: upsertErr } = await db.from('weekly_results').upsert(
    {
      user_id: userId,
      week_start: weekStart,
      days_worked_out: daysWorkedOut,
      week_day_flags: weekDayFlags,
      heart_used: heartUsed,
      finalized,
      points_owed: pointsOwed,
      computed_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,week_start' },
  );
  if (upsertErr) {
    throw new Error(`weekly_results upsert failed for ${userId}: ${upsertErr.message}`);
  }
}
