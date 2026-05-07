import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken } from '@/lib/strava';
import { getServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const error = url.searchParams.get('error');
  if (error) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/connect?status=denied`,
    );
  }

  const code = url.searchParams.get('code');
  const scope = url.searchParams.get('scope') || '';
  const stateName = url.searchParams.get('state') || '';

  if (!code) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/connect?status=error&reason=no_code`,
    );
  }

  // Strava requires the user to grant activity:read_all - if they unchecked it,
  // bounce back. We can't read their workouts otherwise.
  if (!scope.includes('activity:read_all')) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/connect?status=missing_scope`,
    );
  }

  let token;
  try {
    token = await exchangeCodeForToken(code);
  } catch (e) {
    console.error('Token exchange failed', e);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/connect?status=error&reason=exchange_failed`,
    );
  }

  if (!token.athlete) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/connect?status=error&reason=no_athlete`,
    );
  }

  const db = getServerSupabase();

  // Build display name: prefer ?name= from invite link; else "First L."
  const fallbackName =
    `${token.athlete.firstname} ${token.athlete.lastname.charAt(0)}.`.trim();
  const displayName = decodeURIComponent(stateName).trim() || fallbackName;

  // Upsert by strava_athlete_id so re-authorizing the same person is idempotent.
  const { error: upsertError } = await db.from('users').upsert(
    {
      strava_athlete_id: token.athlete.id,
      display_name: displayName,
      strava_access_token: token.access_token,
      strava_refresh_token: token.refresh_token,
      strava_token_expires_at: new Date(token.expires_at * 1000).toISOString(),
      profile_image_url: token.athlete.profile_medium || token.athlete.profile,
      active: true,
    },
    { onConflict: 'strava_athlete_id' },
  );

  if (upsertError) {
    console.error('User upsert failed', upsertError);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/connect?status=error&reason=db`,
    );
  }

  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_APP_URL}/connect?status=success&name=${encodeURIComponent(displayName)}`,
  );
}
