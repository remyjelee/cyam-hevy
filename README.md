# CYAM Hevy Challenge

Private gym accountability tracker for ~10–20 friends.
4 workouts/week, 30+ minutes each, missed days = $10 to the dinner pool.
Pulls workout data from Strava (which Hevy auto-posts to). Free to host.

---

## How it works

1. Each friend connects their Strava account once via a public link.
2. A daily cron job at **3am AEST** fetches each user's recent activities, filters for `WeightTraining` and `Run` (≥30 min), and updates the dashboard.
3. On Sundays the cron also finalizes the week that just ended and computes deductions.
4. The public dashboard at `/` shows everyone's current-week progress, streaks, hearts, and total $ owed.
5. The admin page at `/admin` (password-protected) lets you claim hearts on behalf of users, manually re-sync, or remove someone.

**Stack:** Next.js 14 (App Router) + Supabase + Vercel cron. All free tier.

---

## Quick setup (≈30 minutes total)

There are 4 services to wire up: **Strava**, **Supabase**, **GitHub**, **Vercel**. Do them in this order.

### 1) Strava API app — submit the review form first thing

This is the only step with a long lead time. New Strava apps are capped at 1 athlete until reviewed. Review takes 7–10 business days typically (sometimes longer). **Do this before everything else.**

1. Go to <https://www.strava.com/settings/api> and create an application.
2. Fill in:
   - **Application Name:** CYAM Hevy Challenge (or whatever)
   - **Category:** Training
   - **Website:** put `https://example.com` for now — you'll update it after Vercel deployment
   - **Authorization Callback Domain:** `localhost` for now — update later to your Vercel domain (no `https://`, just the hostname)
3. Save your **Client ID** and **Client Secret** somewhere — you'll need them in step 4.
4. **Submit for review** to lift the 1-athlete cap. The review form is linked at the bottom of <https://developers.strava.com/docs/rate-limits/>. You'll need a privacy policy URL — once you have your Vercel URL after step 4, point it to `https://your-app.vercel.app/privacy`.

While the review is pending, you can authorize **your own** Strava account immediately. Use this time to test end-to-end.

### 2) Supabase project

1. Sign in at <https://supabase.com> and create a new project (free tier).
2. Once the project is ready, go to **SQL Editor** → **New Query**.
3. Copy the entire contents of `supabase/schema.sql` from this repo, paste, and click **Run**. This creates all tables and the seed config row (challenge dates: May 10 → Sep 13 2026).
4. Go to **Settings** → **API** and copy three values:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (keep secret, never commit)

> **Note on free tier pausing:** Supabase pauses free projects after 7 days of inactivity. Your dashboard will be viewed multiple times a week + the daily cron pings the DB, so this won't trigger. No action needed.

### 3) Push to GitHub

```bash
cd cyam-hevy-challenge
git init
git add .
git commit -m "initial"
gh repo create cyam-hevy-challenge --private --source=. --push
# or use the GitHub UI to create a private repo and push manually
```

### 4) Deploy on Vercel

1. Go to <https://vercel.com/new> and import the GitHub repo.
2. Before the first deploy, set environment variables in the Vercel project settings:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | from Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase (secret) |
| `STRAVA_CLIENT_ID` | from Strava |
| `STRAVA_CLIENT_SECRET` | from Strava (secret) |
| `NEXT_PUBLIC_APP_URL` | `https://<your-project>.vercel.app` (no trailing slash) |
| `ADMIN_PASSWORD` | a long random string you'll remember (controls /admin access) |
| `CRON_SECRET` | another long random string (Vercel uses this to authenticate the cron call) |
| `DATA_ENCRYPTION_KEY` | long random string used to encrypt stored Strava secrets/tokens |

3. Deploy. Vercel will give you a URL like `https://cyam-hevy-challenge.vercel.app`.
4. **Update the values you set to placeholders earlier:**
   - In **Vercel env vars**: set `NEXT_PUBLIC_APP_URL` to your real URL, then redeploy (env var changes require redeploy).
   - In **Strava** (`/settings/api`): set Authorization Callback Domain to `<your-project>.vercel.app` (just the hostname, no `https://` or path), and set Website to `https://<your-project>.vercel.app`.

### 5) Test as the first user (you)

1. Visit `https://your-app.vercel.app/connect`
2. Type your name, click **Connect Strava**, approve.
3. You should land on a "You're in" page.
4. In the Supabase SQL editor: `select * from users;` — you should see your row.
5. Visit `https://your-app.vercel.app/admin`, log in with `ADMIN_PASSWORD`, click **Run sync now**. After ~5 seconds it should report `synced: 1, failed: 0`.
6. Visit `/` — you should see yourself on the dashboard.

If any of this fails, check Vercel's **Functions logs** for the exact error.

### 6) When Strava review is approved

You'll get an email confirming. From then on, friends can use the same `/connect` link and successfully authorize. Send them the URL.

---

## Onboarding friends

Send each friend two things:

1. The connect link: `https://your-app.vercel.app/connect`
2. **Critical instruction:** "On the Strava permission screen, leave the *‘View data about your activities’* checkbox ticked. If you uncheck it the app can't see your private workouts."

Also remind them to keep **Hevy → Strava sync turned on** for the duration. (In the Hevy app: Settings → Integrations → Strava). And to not flip individual workouts to "Strava: off" when finishing a session.

---

## Daily life

- **Sunday morning:** the 3am AEST cron runs. By the time anyone wakes up, last week's deductions are computed and the new week's dashboard is fresh.
- **Mid-week:** the dashboard auto-refreshes every 60 seconds in the browser. The daily cron fills in everyone's current-week days each morning. If you want it more current, hit **Run sync now** on `/admin`.
- **Using a heart:** open `/admin` before Saturday night ends. Tap **Use heart** on the friend's row. They get $0 deduction for the week, and the dashboard will show their hearts decremented.
- **Refunding a heart:** if you misclicked, **Refund heart** on the same row reverses it.

---

## Troubleshooting

**"Limit of connected athletes exceeded" when a friend tries to connect**
Your Strava review hasn't been approved yet. Wait, or follow up at `developers@strava.com` with your Client ID.

**Friend connected but no workouts appearing**
Most likely: Hevy isn't syncing to Strava for that user. Have them open Hevy → Settings → Integrations → confirm Strava is connected. Then have them re-finish a recent workout (or just wait until their next one). Then hit **Run sync now** on `/admin`.

**A workout is too short to count but they swear they were there 30 minutes**
The `moving_time` field from Strava is what we filter on. Hevy reports the actual session duration. If they hit "Finish" early or paused a lot, it can come in short. There's no remedy from our side; the rule is the rule.

**Cron didn't run**
Vercel cron timing on Hobby is "anywhere within the hour." `0 17 * * *` UTC = between 17:00 and 17:59 UTC = between 3:00 and 3:59 AEST. Check Vercel → Logs → filter by `cron`. If it didn't fire at all, redeploy (env var changes require a redeploy to pick up cron schedule too).

**Supabase project paused**
Only happens after 7 days of zero activity. Unpause from Supabase dashboard. Won't realistically happen with friends viewing the dashboard.

---

## Adjusting the rules mid-challenge

Open Supabase SQL editor and update the `challenge_config` row directly:

```sql
update challenge_config set required_days_per_week = 5 where id = 1;
update challenge_config set deduction_per_miss = 15 where id = 1;
update challenge_config set counted_activity_types = 'WeightTraining,Run,Ride' where id = 1;
```

Past finalized weekly_results aren't auto-recomputed. If you want a retroactive change, also run:

```sql
delete from weekly_results where finalized = true;
-- then trigger sync from /admin
```

---

## Local development

```bash
npm install
cp .env.example .env.local
# fill in .env.local with the same values as Vercel (use http://localhost:3000 for NEXT_PUBLIC_APP_URL)
npm run dev
```

Visit `http://localhost:3000`. To test OAuth locally, also set Strava's Authorization Callback Domain to `localhost`. To trigger a sync locally:

```bash
curl http://localhost:3000/api/cron/sync \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

---

## File map

```
supabase/schema.sql            -- run once, sets up all tables
lib/dates.ts                   -- AEST week math (Sun→Sat)
lib/strava.ts                  -- OAuth + activity fetch
lib/scoring.ts                 -- the brain: sync + recompute weeks
app/api/cron/sync/route.ts     -- daily cron entry point
app/api/auth/strava/...        -- OAuth flow
app/api/admin/...              -- heart claim, sync trigger, remove user
app/page.tsx                   -- public dashboard (server-rendered)
components/Dashboard.tsx       -- the gamified UI
app/admin/page.tsx             -- password-gated admin panel
app/connect/page.tsx           -- friend onboarding page
```

---

Built for one challenge. Ship it.
