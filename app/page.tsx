import Dashboard from '@/components/Dashboard';
import { DashboardData } from '@/lib/types';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

async function getInitialData(): Promise<DashboardData> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? (host ? `${proto}://${host}` : undefined);
  if (!appUrl) {
    throw new Error(
      'Missing NEXT_PUBLIC_APP_URL and could not infer request host. Set NEXT_PUBLIC_APP_URL (e.g. https://your-app.vercel.app).',
    );
  }

  // Forward request auth/cookies so protected Vercel deployments can call
  // internal routes during SSR without getting a 401 auth wall.
  const res = await fetch(`${appUrl}/api/data/dashboard`, {
    cache: 'no-store',
    headers: {
      cookie: h.get('cookie') ?? '',
      authorization: h.get('authorization') ?? '',
      'x-vercel-protection-bypass': h.get('x-vercel-protection-bypass') ?? '',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '<no body>');
    throw new Error(
      `Dashboard API failed (${res.status}): ${body.slice(0, 500)}`,
    );
  }
  return res.json();
}

export default async function HomePage() {
  const data = await getInitialData();
  return <Dashboard initialData={data} />;
}