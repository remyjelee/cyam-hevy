import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CYAM Hevy Challenge',
  description: '100+ days. 3 workouts a week.',
  metadataBase: process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL)
    : undefined,
  openGraph: {
    title: 'CYAM Hevy Challenge',
    description: '100+ days. 3 workouts a week.',
    type: 'website',
    images: [{ url: '/og-cover.jpg' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CYAM Hevy Challenge',
    description: '100+ days. 3 workouts a week.',
    images: ['/og-cover.jpg'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0A0A0A',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
