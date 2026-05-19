-- =============================================================================
-- CYAM HEVY CHALLENGE - Supabase schema
-- Run this entire file in your Supabase project's SQL Editor.
-- (Dashboard > SQL Editor > New Query > paste this > Run)
-- =============================================================================

-- ----- challenge_config: a single row holding all challenge settings ---------
create table if not exists challenge_config (
  id int primary key default 1,
  name text not null default 'CYAM HEVY CHALLENGE',
  start_date date not null,
  end_date date not null,
  required_days_per_week int not null default 4,
  min_workout_seconds int not null default 1800,
  deduction_per_miss int not null default 10,
  hearts_per_user int not null default 2,
  -- Comma-separated Strava activity types we count.
  -- Hevy posts as "WeightTraining"; we also include "Run".
  counted_activity_types text not null default 'WeightTraining,Run',
  constraint singleton check (id = 1)
);

-- Seed the config: challenge runs Sun May 24 2026 -> Sun Sep 6 2026
insert into challenge_config (id, start_date, end_date)
values (1, '2026-05-24', '2026-09-06')
on conflict (id) do nothing;

-- ----- users: one row per friend in the challenge ----------------------------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  display_color text,
  strava_athlete_id bigint unique not null,
  strava_client_id text,
  strava_client_secret text,
  strava_refresh_token text not null,
  -- access token and expiry are cached but re-fetched as needed
  strava_access_token text,
  strava_token_expires_at timestamptz,
  profile_image_url text,
  created_at timestamptz not null default now(),
  -- soft-delete flag in case someone drops out mid-challenge
  active boolean not null default true
);

create index if not exists users_active_idx on users(active);

-- ----- weekly_results: scored result for one user, one week ------------------
-- week_start is the Sunday (00:00 local) that begins the week.
create table if not exists weekly_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  week_start date not null,
  days_worked_out int not null default 0,
  heart_used boolean not null default false,
  -- True once the cron has finalized this week (Sunday after the week ends).
  -- During an in-progress week this is false and points_owed is 0.
  finalized boolean not null default false,
  points_owed int not null default 0,
  computed_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create index if not exists weekly_results_user_idx on weekly_results(user_id);
create index if not exists weekly_results_week_idx on weekly_results(week_start desc);

-- ----- workouts: audit log of qualifying activities pulled from Strava -------
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  strava_activity_id bigint not null,
  start_date timestamptz not null,
  workout_date date not null, -- start_date_local cast to date, used for grouping
  moving_time int not null,   -- seconds
  activity_type text not null,
  name text,
  fetched_at timestamptz not null default now(),
  unique (user_id, strava_activity_id)
);

create index if not exists workouts_user_date_idx on workouts(user_id, workout_date);

-- ----- heart_log: audit trail of heart claims (admin actions) ----------------
create table if not exists heart_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  week_start date not null,
  -- 'used' = burned a heart, 'refund' = admin reversed it
  action text not null check (action in ('used', 'refund')),
  created_at timestamptz not null default now()
);

create index if not exists heart_log_user_idx on heart_log(user_id, created_at desc);

-- ----- pending_connections: short-lived credential stash for OAuth flow ------
-- Credentials are stored here server-side during the OAuth redirect dance,
-- then deleted on callback. Rows auto-expire as a safety net.
create table if not exists pending_connections (
  token text primary key,
  strava_client_id text not null,
  strava_client_secret text not null,
  display_name text not null default '',
  display_color text not null default '',
  created_at timestamptz not null default now(),
  -- rows older than 10 minutes are stale and should be ignored/cleaned up
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

-- =============================================================================
-- Row Level Security
-- The dashboard reads via a server-side API route using the service role key,
-- so we keep RLS enabled but add no public policies. Default-deny.
-- =============================================================================

alter table challenge_config enable row level security;
alter table users enable row level security;
alter table weekly_results enable row level security;
alter table workouts enable row level security;
alter table heart_log enable row level security;
alter table pending_connections enable row level security;

-- =============================================================================
-- Helper view: how many hearts each user has remaining
-- (hearts_per_user from config) - (count of 'used' actions) + (count of 'refund')
--
-- security_invoker = on makes the view run with the caller's permissions
-- rather than the creator's (the Postgres default of SECURITY DEFINER can leak
-- past RLS). Recommended by Supabase's Security Advisor.
-- =============================================================================
create or replace view user_hearts_remaining
with (security_invoker = on)
as
select
  u.id as user_id,
  (select hearts_per_user from challenge_config where id = 1)
    - coalesce((select count(*) from heart_log where user_id = u.id and action = 'used'), 0)
    + coalesce((select count(*) from heart_log where user_id = u.id and action = 'refund'), 0)
    as hearts_remaining
from users u;