import Dashboard from '@/components/Dashboard';
import { DashboardData } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getInitialData(): Promise<DashboardData> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
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