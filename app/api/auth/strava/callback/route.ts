import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken } from '@/lib/strava';
import { getServerSupabase } from '@/lib/supabase';
import { syncUser } from '@/lib/scoring';
import { todayAEST } from '@/lib/dates';
import { ChallengeConfig } from '@/lib/types';
import { decryptSecret, encryptSecret } from '@/lib/secrets';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const url = req.nextUrl;

  const error = url.searchParams.get('error');
  if (error) {
    return NextResponse.redirect(`${appUrl}/connect?status=denied`);
  }

  const code = url.searchParams.get('code');
  const scope = url.searchParams.get('scope') || '';
  const token = url.searchParams.get('state') || '';

  if (!code) {
    return NextResponse.redirect(
      `${appUrl}/connect?status=error&reason=no_code`,
    );
  }

  if (!token) {
    return NextResponse.redirect(
      `${appUrl}/connect?status=error&reason=no_state`,
    );
  }

  const db = getServerSupabase();

  // Look up the stashed credentials using the token.
  const { data: pending, error: lookupError } = await db
    .from('pending_connections')
    .select('strava_client_id, strava_client_secret, display_name, display_color, expires_at')
    .eq('token', token)
    .single();

  if (lookupError || !pending) {
    return NextResponse.redirect(
      `${appUrl}/connect?status=error&reason=expired_or_invalid`,
    );
  }

  // Check expiry.
  if (new Date(pending.expires_at) < new Date()) {
    // Clean up the expired row.
    await db.from('pending_connections').delete().eq('token', token);
    return NextResponse.redirect(
      `${appUrl}/connect?status=error&reason=expired_or_invalid`,
    );
  }

  // Delete the pending row immediately — it's single-use.
  await db.from('pending_connections').delete().eq('token', token);

  // Strava requires the user to grant activity:read_all.
  if (!scope.includes('activity:read_all')) {
    return NextResponse.redirect(`${appUrl}/connect?status=missing_scope`);
  }

  const creds = {
    clientId: pending.strava_client_id,
    clientSecret: decryptSecret(pending.strava_client_secret),
  };

  let tokenResponse;
  try {
    tokenResponse = await exchangeCodeForToken(creds, code);
  } catch (e) {
    console.error('Token exchange failed', e);
    return NextResponse.redirect(
      `${appUrl}/connect?status=error&reason=exchange_failed`,
    );
  }

  if (!tokenResponse.athlete) {
    return NextResponse.redirect(
      `${appUrl}/connect?status=error&reason=no_athlete`,
    );
  }

  // Build display name: prefer user-provided name; else "First L."
  const fallbackName =
    `${tokenResponse.athlete.firstname} ${tokenResponse.athlete.lastname.charAt(0)}.`.trim();
  const displayName = (pending.display_name || '').trim() || fallbackName;
  const displayColor = (pending.display_color || '').trim() || null;

  // Upsert by strava_athlete_id so re-authorizing the same person is idempotent.
  const { error: upsertError } = await db.from('users').upsert(
    {
      strava_athlete_id: tokenResponse.athlete.id,
      display_name: displayName,
      display_color: displayColor,
      strava_client_id: creds.clientId,
      strava_client_secret: encryptSecret(creds.clientSecret),
      strava_access_token: encryptSecret(tokenResponse.access_token),
      strava_refresh_token: encryptSecret(tokenResponse.refresh_token),
      strava_token_expires_at: new Date(
        tokenResponse.expires_at * 1000,
      ).toISOString(),
      profile_image_url:
        tokenResponse.athlete.profile_medium ||
        tokenResponse.athlete.profile,
      active: true,
    },
    { onConflict: 'strava_athlete_id' },
  );

  if (upsertError) {
    console.error('User upsert failed', upsertError);
    return NextResponse.redirect(
      `${appUrl}/connect?status=error&reason=db`,
    );
  }

  // Best-effort immediate sync so newly joined users see their workouts quickly.
  try {
    const { data: userRow } = await db
      .from('users')
      .select('id, display_name, strava_athlete_id, strava_client_id, strava_client_secret, strava_refresh_token, strava_access_token, strava_token_expires_at, active')
      .eq('strava_athlete_id', tokenResponse.athlete.id)
      .single();
    const { data: configRow } = await db
      .from('challenge_config')
      .select('*')
      .eq('id', 1)
      .single();
    if (userRow && configRow) {
      await syncUser(db, userRow as any, configRow as ChallengeConfig, todayAEST());
    }
  } catch (syncErr) {
    console.error('Post-connect sync failed', syncErr);
  }

  return NextResponse.redirect(
    `${appUrl}/connect?status=success&name=${encodeURIComponent(displayName)}`,
  );
}
