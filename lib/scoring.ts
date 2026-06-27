import { SupabaseClient } from '@supabase/supabase-js';
import { ChallengeConfig } from './types';
import { addDays, parseDate, weekStartSunday } from './dates';
import {
  fetchActivities,
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
function activityCounts(
  activity: StravaActivity,
  config: ChallengeConfig,
): boolean {
  const allowed = config.counted_activity_types.split(',').map((s) => s.trim());
  // Strava has both `type` (legacy) and `sport_type` (newer). Check both.
  const matchesType =
    allowed.includes(activity.type) || allowed.includes(activity.sport_type);
  return matchesType && activity.moving_time >= config.min_workout_seconds;
}

/**
 * Convert a Strava `start_date_local` (a UTC-formatted ISO string that
 * actually represents wall-clock local time) into a YYYY-MM-DD date string.
 * Example: "2026-05-12T07:30:00Z" -> "2026-05-12"
 */
function localDate(activity: StravaActivity): string {
  return activity.start_date_local.slice(0, 10);
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

  // Persist qualifying activities; ignore conflicts (idempotent re-syncs).
  const qualifying = activities.filter((a) => activityCounts(a, config));
  if (qualifying.length > 0) {
    const rows = qualifying.map((a) => ({
      user_id: user.id,
      strava_activity_id: a.id,
      start_date: a.start_date,
      workout_date: localDate(a),
      moving_time: a.moving_time,
      activity_type: a.sport_type || a.type,
      name: a.name,
    }));
    await db.from('workouts').upsert(rows, {
      onConflict: 'user_id,strava_activity_id',
      ignoreDuplicates: true,
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

/**
 * Whether the user still has a heart to spend, and hasn't already had one
 * applied to this specific week. Mirrors the `user_hearts_remaining` view and
 * the per-week guard used by the manual admin endpoints.
 */
async function heartAvailableForWeek(
  db: SupabaseClient,
  userId: string,
  weekStart: string,
  config: ChallengeConfig,
): Promise<boolean> {
  const { data: logs } = await db
    .from('heart_log')
    .select('action, week_start')
    .eq('user_id', userId);
  const rows = (logs ?? []) as Array<{ action: string; week_start: string }>;
  const used = rows.filter((r) => r.action === 'used').length;
  const refunded = rows.filter((r) => r.action === 'refund').length;
  const remaining = config.hearts_per_user - used + refunded;
  const netThisWeek = rows
    .filter((r) => r.week_start === weekStart)
    .reduce((n, r) => n + (r.action === 'used' ? 1 : -1), 0);
  return remaining > 0 && netThisWeek <= 0;
}

/**
 * Recompute weekly_results for one user/week.
 * - days_worked_out = distinct workout_dates in [weekStart, weekStart+7)
 * - finalized = true once today >= weekStart + 7 (week is in the past)
 * - heart_used preserved from existing row (set by admin endpoints, not here)
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

  const { data: workouts } = await db
    .from('workouts')
    .select('workout_date')
    .eq('user_id', userId)
    .gte('workout_date', weekStart)
    .lt('workout_date', weekEndExclusive);

  const distinctDays = new Set((workouts ?? []).map((w: any) => w.workout_date));
  const daysWorkedOut = Math.min(7, distinctDays.size);
  const weekDayFlags = Array.from({ length: 7 }, (_, i) =>
    distinctDays.has(addDays(weekStart, i)),
  );

  // Read current row (if any) to preserve heart_used.
  const { data: existing } = await db
    .from('weekly_results')
    .select('heart_used, finalized, days_worked_out, week_day_flags, points_owed')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .maybeSingle();

  const finalized = todayDateStr >= weekEndExclusive;
  const missed = Math.max(0, config.required_days_per_week - daysWorkedOut);
  let heartUsed = existing?.heart_used ?? false;

  // Auto-consume hearts: when enabled, the moment a missed week finalizes we
  // spend one of the user's remaining hearts to cover it instead of charging
  // the penalty. Gated on `!existing.finalized` so it only fires on the
  // finalization transition (never retroactively on weeks finalized earlier,
  // and never more than once per week).
  if (
    config.auto_consume_hearts &&
    finalized &&
    !existing?.finalized &&
    missed > 0 &&
    !heartUsed &&
    (await heartAvailableForWeek(db, userId, weekStart, config))
  ) {
    const { error: logErr } = await db.from('heart_log').insert({
      user_id: userId,
      week_start: weekStart,
      action: 'used',
    });
    if (!logErr) heartUsed = true;
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

  await db.from('weekly_results').upsert(
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
}
