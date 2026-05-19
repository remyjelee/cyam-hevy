// Shared types used across server and client code.

export interface ChallengeConfig {
  id: number;
  name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  required_days_per_week: number;
  min_workout_seconds: number;
  deduction_per_miss: number;
  hearts_per_user: number;
  counted_activity_types: string; // comma-separated
}

export interface User {
  id: string;
  display_name: string;
  strava_athlete_id: number;
  strava_client_id: string | null;
  strava_client_secret: string | null;
  strava_refresh_token: string;
  strava_access_token: string | null;
  strava_token_expires_at: string | null;
  profile_image_url: string | null;
  created_at: string;
  active: boolean;
}

export interface WeeklyResult {
  id: string;
  user_id: string;
  week_start: string; // YYYY-MM-DD (Sunday)
  days_worked_out: number;
  heart_used: boolean;
  finalized: boolean;
  points_owed: number;
  computed_at: string;
}

export interface Workout {
  id: string;
  user_id: string;
  strava_activity_id: number;
  start_date: string;
  workout_date: string;
  moving_time: number;
  activity_type: string;
  name: string | null;
  fetched_at: string;
}

// Shape returned by /api/data/dashboard for the public page.
export interface DashboardUser {
  id: string;
  display_name: string;
  profile_image_url: string | null;
  hearts_remaining: number;
  // current week's day-by-day completion: array of 7 booleans, Sun..Sat
  current_week_days: boolean[];
  current_week_days_count: number;
  current_week_heart_used: boolean;
  // streak: consecutive completed weeks (>=4 days OR heart used)
  streak: number;
  // total dollars owed across all finalized weeks
  total_owed: number;
}

export interface DashboardData {
  challenge_name: string;
  start_date: string;
  end_date: string;
  required_days_per_week: number;
  hearts_per_user: number;
  deduction_per_miss: number;
  // ISO timestamp of when the data was last refreshed by cron
  last_synced_at: string | null;
  // total $ pool across all users
  total_pool: number;
  users: DashboardUser[];
}
