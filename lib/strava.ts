// =============================================================================
// Strava API client.
// Docs: https://developers.strava.com/docs/reference/
// =============================================================================

const STRAVA_OAUTH = 'https://www.strava.com/oauth';
const STRAVA_API = 'https://www.strava.com/api/v3';

export interface StravaCredentials {
  clientId: string;
  clientSecret: string;
}

export interface StravaTokenResponse {
  token_type: string;
  expires_at: number; // unix seconds
  expires_in: number;
  refresh_token: string;
  access_token: string;
  athlete?: {
    id: number;
    username: string | null;
    firstname: string;
    lastname: string;
    profile: string;
    profile_medium: string;
  };
}

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date: string;        // UTC ISO
  start_date_local: string;  // local ISO without tz
  moving_time: number;       // seconds
  elapsed_time: number;
}

export interface StravaAthleteProfile {
  id: number;
  profile: string | null;
  profile_medium: string | null;
}

/**
 * Build the URL we send users to so they can authorize the app.
 * Scope `activity:read_all` is required to see private activities.
 */
export function buildAuthorizeUrl(creds: StravaCredentials, redirectUri: string, state?: string): string {
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
  });
  if (state) params.set('state', state);
  return `${STRAVA_OAUTH}/authorize?${params.toString()}`;
}

/**
 * Exchange the one-time `code` from the OAuth callback for a refresh+access token.
 */
export async function exchangeCodeForToken(creds: StravaCredentials, code: string): Promise<StravaTokenResponse> {
  const res = await fetch(`${STRAVA_OAUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Strava token exchange failed (${res.status}): ${body}`);
  }
  return res.json();
}

/**
 * Refresh an expired access token using a refresh token.
 * Strava may rotate the refresh token; the response is the source of truth.
 */
export async function refreshAccessToken(creds: StravaCredentials, refreshToken: string): Promise<StravaTokenResponse> {
  const res = await fetch(`${STRAVA_OAUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Strava token refresh failed (${res.status}): ${body}`);
  }
  return res.json();
}

/**
 * Fetch activities between two unix-seconds timestamps. Paginates if needed.
 * Strava's `/athlete/activities` returns activities for the authenticated user only.
 */
export async function fetchActivities(
  accessToken: string,
  afterUnix: number,
  beforeUnix: number,
): Promise<StravaActivity[]> {
  const all: StravaActivity[] = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const url = new URL(`${STRAVA_API}/athlete/activities`);
    url.searchParams.set('after', String(afterUnix));
    url.searchParams.set('before', String(beforeUnix));
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(perPage));
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Strava activities fetch failed (${res.status}): ${body}`);
    }
    const batch = (await res.json()) as StravaActivity[];
    all.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
    if (page > 10) break; // safety: no one's logging 1000 workouts in a week
  }
  return all;
}

/** Fetch authenticated athlete profile metadata. */
export async function fetchAthleteProfile(
  accessToken: string,
): Promise<StravaAthleteProfile> {
  const res = await fetch(`${STRAVA_API}/athlete`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Strava athlete fetch failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<StravaAthleteProfile>;
}

/** Convert a YYYY-MM-DD date string to unix seconds at AEST midnight. */
export function dateToUnixAEST(dateStr: string): number {
  // AEST = UTC+10. AEST midnight = 14:00 UTC the previous day.
  const [y, m, d] = dateStr.split('-').map(Number);
  // Build a UTC instant that represents AEST midnight: UTC Y-M-D 00:00 minus 10 hours.
  const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0);
  return Math.floor((utcMidnight - 10 * 3600 * 1000) / 1000);
}
