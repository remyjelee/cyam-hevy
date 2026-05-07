import { NextRequest, NextResponse } from 'next/server';
import { buildAuthorizeUrl } from '@/lib/strava';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
  const redirectUri = `${appUrl}/api/auth/strava/callback`;

  // Optional: pass `name` query param to pre-fill display name on completion.
  const name = req.nextUrl.searchParams.get('name') || '';
  const state = name ? encodeURIComponent(name) : '';

  const authorizeUrl = buildAuthorizeUrl(redirectUri, state);
  return NextResponse.redirect(authorizeUrl);
}
