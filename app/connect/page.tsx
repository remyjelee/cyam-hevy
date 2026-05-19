'use client';

import { useEffect, useState } from 'react';

const COLOR_PRESETS = [
  '#F5F2EA',
  '#FF7B72',
  '#7EE787',
  '#79C0FF',
  '#D2A8FF',
  '#F2CC60',
  '#FF9BCE',
  '#56D4DD',
] as const;

export default function ConnectPage() {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(COLOR_PRESETS[0]);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [statusName, setStatusName] = useState<string | null>(null);
  const [connectAssetMissing, setConnectAssetMissing] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setStatus(params.get('status'));
    setStatusName(params.get('name'));
  }, []);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/strava', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId.trim() || undefined,
          client_secret: clientSecret.trim() || undefined,
          name: name.trim() || undefined,
          color: color || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        window.location.href = `/connect?status=error&reason=${data.error || 'unknown'}`;
        return;
      }
      window.location.href = data.url;
    } catch {
      window.location.href = '/connect?status=error&reason=network';
    }
  };

  const stravaButtonClass =
    'w-full flex items-center justify-center rounded-lg transition-colors hover:brightness-110 disabled:opacity-60';
  const stravaButtonStyle = { backgroundColor: '#FC4C02' } as const;

  if (status === 'success') {
    return (
      <Frame>
        <h1 className="font-display text-4xl uppercase mb-4">
          You&apos;re in.
        </h1>
        <p className="text-bone/80 mb-2">
          Welcome, <span className="font-medium" style={{ color }}>{statusName}</span>.
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
        <a href="/connect" className="text-flame hover:underline">
          ← Start over
        </a>
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
        <a href="/connect" className="text-flame hover:underline">
          ← Start over
        </a>
      </Frame>
    );
  }

  if (status === 'error') {
    return (
      <Frame>
        <h1 className="font-display text-3xl uppercase mb-4">Something went wrong</h1>
        <p className="text-muted mb-4">
          Please try again, or message the organizer.
        </p>
        <p className="text-muted text-sm mb-6">
          If you created your own Strava app, check that Callback Domain is set
          to <span className="font-mono text-bone">{typeof window !== 'undefined' ? window.location.hostname : ''}</span>.
        </p>
        <a href="/connect" className="text-flame hover:underline">
          ← Start over
        </a>
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
        Miss one? -$10. The pool will fund a glorious camping trip with unlimited meat.
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

        <label className="block">
          <span className="block text-[11px] uppercase tracking-widest text-muted mb-1.5">
            Name color
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setColor(preset)}
                className="w-7 h-7 rounded-full border"
                style={{
                  backgroundColor: preset,
                  borderColor: color === preset ? '#FC4C02' : '#3B3B3B',
                }}
                aria-label={`Use color ${preset}`}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-10 h-8 bg-transparent border border-line rounded"
              aria-label="Custom color"
            />
          </div>
        </label>

        <label className="block">
          <span className="block text-[11px] uppercase tracking-widest text-muted mb-1.5">
            Strava Client ID
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="e.g. 123456"
            className="w-full px-4 py-3 rounded-lg bg-elevated border border-line focus:border-flame focus:outline-none text-bone"
          />
        </label>

        <label className="block">
          <span className="block text-[11px] uppercase tracking-widest text-muted mb-1.5">
            Strava Client Secret
          </span>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="Paste your Client Secret"
            className="w-full px-4 py-3 rounded-lg bg-elevated border border-line focus:border-flame focus:outline-none text-bone"
          />
        </label>

        <p className="text-sm text-muted leading-relaxed">
          Create your app at{' '}
          <a
            href="https://www.strava.com/settings/api"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-bone"
          >
            strava.com/settings/api
          </a>
          . Use Callback Domain: {typeof window !== 'undefined' ? window.location.hostname : ''}.
        </p>

        <button
          onClick={handleConnect}
          disabled={loading}
          className={stravaButtonClass}
          style={stravaButtonStyle}
          aria-label="Connect with Strava"
        >
          {loading ? (
            <span className="px-6 py-4 text-white font-semibold text-base">
              Connecting...
            </span>
          ) : !connectAssetMissing ? (
            // Official asset path: public/strava/connect-with-strava.png
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/strava/connect-with-strava.png"
              alt="Connect with Strava"
              className="h-12 w-auto"
              onError={() => setConnectAssetMissing(true)}
            />
          ) : (
            <span className="px-6 py-4 text-white font-semibold text-base">
              Connect with Strava
            </span>
          )}
        </button>

        <p className="text-[11px] text-muted leading-relaxed pt-2">
          We read your activity list to count qualifying workouts. We never
          post anything. Your Client Secret and refresh token are stored securely
          on the server and only used by the Sunday cron.{' '}
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
    <main className="relative min-h-screen flex items-center justify-center px-5 py-8">
      <div className="grain absolute inset-0 pointer-events-none" />
      <div className="relative w-full max-w-md p-7 rounded-2xl border border-line bg-surface">
        {children}
      </div>
    </main>
  );
}
