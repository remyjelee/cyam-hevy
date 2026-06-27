import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function checkAuth(req: NextRequest): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return req.headers.get('x-admin-password') === expected;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 });
  }

  const db = getServerSupabase();
  const { error } = await db
    .from('challenge_config')
    .update({ auto_consume_hearts: body.enabled })
    .eq('id', 1);

  if (error) {
    console.error('set-auto-consume update failed', error);
    return NextResponse.json({ error: 'db update failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, auto_consume_hearts: body.enabled });
}
