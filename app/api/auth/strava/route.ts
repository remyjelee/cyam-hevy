import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { buildAuthorizeUrl } from '@/lib/strava';
import { getServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const redirectUri = `${appUrl}/api/auth/strava/callback`;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const clientId = ((body.client_id as string) || '').trim();
  const clientSecret = ((body.client_secret as string) || '').trim();
  const name = (body.name as string) || '';

  // Strict mode: require per-user app credentials to avoid silently falling
  // back to the global app that may be athlete-capped.
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'missing_credentials' },
      { status: 400 },
    );
  }

  // Generate a random token and stash credentials server-side.
  const token = randomBytes(32).toString('hex');
  const db = getServerSupabase();

  // Clean up any expired rows while we're here (belt and braces).
  await db
    .from('pending_connections')
    .delete()
    .lt('expires_at', new Date().toISOString());

  const { error: insertError } = await db.from('pending_connections').insert({
    token,
    strava_client_id: clientId,
    strava_client_secret: clientSecret,
    display_name: name,
  });

  if (insertError) {
    console.error('Failed to store pending connection', insertError);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  // Only the opaque token goes into the OAuth state — no secrets in the URL.
  const authorizeUrl = buildAuthorizeUrl(
    { clientId, clientSecret },
    redirectUri,
    token,
  );

  return NextResponse.json({ url: authorizeUrl });
}
