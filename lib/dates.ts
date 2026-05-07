// =============================================================================
// Date utilities for the challenge.
//
// Weeks are Sunday -> Saturday.
// All "today" / "now" calculations use the user's local time on the server side
// (which on Vercel is UTC) but interpret week boundaries relative to AEST since
// that's where the organizer and most users are. We use a fixed offset rather
// than full Intl.DateTimeFormat machinery to keep things simple and predictable.
// =============================================================================

// Australia/Sydney is UTC+10 in standard time, UTC+11 with DST.
// DST starts first Sunday of October, ends first Sunday of April.
// The challenge runs May 10 - Sep 13, which is entirely AEST (UTC+10).
// We use UTC+10 throughout. If you ever extend the challenge into Oct-April,
// rewrite this to handle DST properly.
const AEST_OFFSET_HOURS = 10;

/** Returns "now" as a JS Date but shifted into AEST wall-clock time. */
export function nowInAEST(): Date {
  const now = new Date();
  return new Date(now.getTime() + AEST_OFFSET_HOURS * 3600 * 1000);
}

/** Format a Date as YYYY-MM-DD using its UTC fields. */
export function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string into a Date at UTC midnight. */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Sunday of the week containing `date`, returned as YYYY-MM-DD. */
export function weekStartSunday(date: Date): string {
  // getUTCDay: 0 = Sunday, 6 = Saturday
  const day = date.getUTCDay();
  const sunday = new Date(date);
  sunday.setUTCDate(sunday.getUTCDate() - day);
  sunday.setUTCHours(0, 0, 0, 0);
  return isoDate(sunday);
}

/** Add N days to a YYYY-MM-DD string. */
export function addDays(dateStr: string, n: number): string {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

/** Whole days from `from` to `to`, inclusive of `from`, exclusive of `to`. */
export function daysBetween(from: string, to: string): number {
  const a = parseDate(from).getTime();
  const b = parseDate(to).getTime();
  return Math.round((b - a) / (24 * 3600 * 1000));
}

/** The Sunday that begins the week containing today (in AEST). */
export function currentWeekStart(): string {
  return weekStartSunday(nowInAEST());
}

/** The Sunday that began the previous Sun-Sat week. */
export function previousWeekStart(): string {
  const cur = currentWeekStart();
  return addDays(cur, -7);
}

/** Today's date in AEST as YYYY-MM-DD. */
export function todayAEST(): string {
  return isoDate(nowInAEST());
}

/**
 * Returns 0 (Sunday) through 6 (Saturday) for AEST today.
 * Used to determine which day-of-week column to highlight in the grid.
 */
export function todayDayOfWeekAEST(): number {
  return nowInAEST().getUTCDay();
}

/**
 * For a given week_start (Sunday), returns the 7 dates Sun..Sat as YYYY-MM-DD.
 */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/**
 * Inclusive day count from challenge start to today, capped to total days.
 * Used for the "days elapsed / total days" progress bar.
 */
export function challengeProgress(startDate: string, endDate: string): {
  daysElapsed: number;
  totalDays: number;
  daysRemaining: number;
  percentComplete: number;
} {
  const today = todayAEST();
  const totalDays = daysBetween(startDate, endDate);
  const elapsed = Math.max(0, daysBetween(startDate, today));
  const cappedElapsed = Math.min(elapsed, totalDays);
  const remaining = Math.max(0, daysBetween(today, endDate));
  const pct = totalDays === 0 ? 0 : (cappedElapsed / totalDays) * 100;
  return {
    daysElapsed: cappedElapsed,
    totalDays,
    daysRemaining: remaining,
    percentComplete: Math.min(100, Math.max(0, pct)),
  };
}
