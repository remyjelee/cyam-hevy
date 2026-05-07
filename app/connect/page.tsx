'use client';

import { useEffect, useState } from 'react';

export default function ConnectPage() {
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [statusName, setStatusName] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setStatus(params.get('status'));
    setStatusName(params.get('name'));
  }, []);

  const handleConnect = () => {
    const url = name.trim()
      ? `/api/auth/strava?name=${encodeURIComponent(name.trim())}`
      : '/api/auth/strava';
    window.location.href = url;
  };

  const stravaButtonClass =
    'w-full px-6 py-4 rounded-lg transition-colors text-white font-semibold text-base';
  const stravaButtonStyle = { backgroundColor: '#FC4C02' } as const;

  if (status === 'success') {
    return (
      <Frame>
        <h1 className="font-display text-4xl uppercase mb-4">
          You&apos;re in.
        </h1>
        <p className="text-bone/80 mb-2">
          Welcome, <span className="text-flame font-medium">{statusName}</span>.
        </p>
        <p className="text-sm text-muted mb-8">
          Your workouts will appear automatically.
        </p>
        <a
          href="/"
          className="inline-block px-6 py-3 rounded-lg bg-flame text-ink font-display uppercase tracking-wider"
        >
          See dashboard →
        </a>
      </Frame>
    );
  }

  if (status === 'denied') {
    return (
      <Frame>
        <h1 className="font-display text-4xl uppercase mb-4">Authorization denied</h1>
        <p className="text-muted mb-6">
          You need to allow access for the challenge to track your workouts.
        </p>
        <button
          onClick={handleConnect}
          className="px-5 py-3 rounded-lg flex items-center justify-center hover:brightness-110 text-white font-semibold"
          style={{ backgroundColor: '#FC4C02' }}
        >
          Try again with Strava
        </button>
      </Frame>
    );
  }

  if (status === 'missing_scope') {
    return (
      <Frame>
        <h1 className="font-display text-3xl uppercase mb-4">
          Almost — but missing one box
        </h1>
        <p className="text-muted mb-6">
          On the Strava permission screen, please leave the{' '}
          <span className="text-bone">&ldquo;View data about your activities&rdquo;</span>{' '}
          checkbox ticked. Otherwise we can&apos;t see your workouts.
        </p>
        <button
          onClick={handleConnect}
          className="px-5 py-3 rounded-lg flex items-center justify-center hover:brightness-110 text-white font-semibold"
          style={{ backgroundColor: '#FC4C02' }}
        >
          Try again with Strava
        </button>
      </Frame>
    );
  }

  if (status === 'error') {
    return (
      <Frame>
        <h1 className="font-display text-3xl uppercase mb-4">Something went wrong</h1>
        <p className="text-muted mb-6">
          Please try again, or message the organizer.
        </p>
        <button
          onClick={handleConnect}
          className="px-5 py-3 rounded-lg flex items-center justify-center hover:brightness-110 text-white font-semibold"
          style={{ backgroundColor: '#FC4C02' }}
        >
          Try again with Strava
        </button>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="text-[11px] uppercase tracking-[0.2em] text-muted mb-2">
        CYAM Hevy Challenge
      </div>
      <h1 className="font-display text-5xl uppercase leading-none mb-4">
        Join the <span className="text-flame">grind</span>
      </h1>
      <p className="text-bone/80 mb-1">4 workouts a week. 30+ minutes each.</p>
      <p className="text-muted text-sm mb-8">
        Miss one? -$10. The pool buys dinner on the final week.
      </p>

      <div className="space-y-3">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-widest text-muted mb-1.5">
            Display name (optional)
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What should we call you?"
            className="w-full px-4 py-3 rounded-lg bg-elevated border border-line focus:border-flame focus:outline-none text-bone"
          />
        </label>

        <button
          onClick={handleConnect}
          className={stravaButtonClass}
          style={stravaButtonStyle}
          aria-label="Connect with Strava"
        >
          Connect with Strava
        </button>

        <p className="text-[11px] text-muted leading-relaxed pt-2">
          We read your activity list to count qualifying workouts. We never
          post anything. Your refresh token is stored encrypted at Supabase
          and only used by the Sunday cron.{' '}
          <a href="/privacy" className="underline hover:text-bone">
            Privacy
          </a>
          .
        </p>
        <p className="text-[11px] text-muted leading-relaxed">
          This app is independent and is not developed or sponsored by Strava.
        </p>
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen flex items-center justify-center px-5">
      <div className="grain absolute inset-0 pointer-events-none" />
      <div className="relative w-full max-w-md p-7 rounded-2xl border border-line bg-surface">
        {children}
      </div>
    </main>
  );
}
