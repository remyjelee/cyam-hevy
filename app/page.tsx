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

  const res = await fetch(`${appUrl}/api/data/dashboard`, { cache: 'no-store' });
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