'use client';

import { useEffect, useState } from 'react';
import { DashboardData, DashboardUser } from '@/lib/types';

const STORAGE_KEY = 'cyam_admin_pw_v1';

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [poweredAssetMissing, setPoweredAssetMissing] = useState(false);

  // Load saved password from sessionStorage so admin doesn't have to retype every page.
  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      setPassword(saved);
      verifyPassword(saved);
    }
  }, []);

  async function verifyPassword(pw: string) {
    // No dedicated verify endpoint; we just try a no-op admin call.
    // The trigger-sync endpoint requires auth, so a 401 means wrong password.
    // We do this lazily: just try and let the user proceed to use it.
    setAuthed(true);
    sessionStorage.setItem(STORAGE_KEY, pw);
    await loadData();
  }

  async function loadData() {
    const res = await fetch('/api/data/dashboard', { cache: 'no-store' });
    if (res.ok) setData(await res.json());
  }

  async function adminFetch(path: string, body?: any) {
    setBusy(path);
    setMessage(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': password,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(`Error: ${json.error || res.status}`);
      } else {
        setMessage('Done.');
        await loadData();
      }
    } catch (e: any) {
      setMessage(`Error: ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  }

  if (!authed) {
    return (
      <main className="min-h-screen flex items-center justify-center px-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verifyPassword(password);
          }}
          className="w-full max-w-sm p-6 rounded-xl border border-line bg-surface"
        >
          <h1 className="font-display text-3xl uppercase mb-4">Admin</h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password"
            className="w-full px-4 py-3 rounded-lg bg-elevated border border-line focus:border-flame focus:outline-none text-bone mb-3"
            autoFocus
          />
          <button
            type="submit"
            className="w-full px-6 py-3 rounded-lg bg-flame text-ink font-display uppercase tracking-wider"
          >
            Enter
          </button>
        </form>
      </main>
    );
  }

  if (!data) {
    return <main className="p-8 text-muted">Loading…</main>;
  }

  return (
    <main className="max-w-3xl mx-auto px-5 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-4xl uppercase">Admin</h1>
        <a href="/" className="text-xs text-muted underline">
          Public dashboard →
        </a>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <button
          disabled={busy === '/api/admin/trigger-sync'}
          onClick={() => adminFetch('/api/admin/trigger-sync')}
          className="px-4 py-2 rounded-lg bg-elevated border border-line hover:border-flame disabled:opacity-50 text-sm"
        >
          {busy === '/api/admin/trigger-sync' ? 'Syncing…' : 'Run sync now'}
        </button>
        <button
          onClick={loadData}
          className="px-4 py-2 rounded-lg bg-elevated border border-line text-sm"
        >
          Refresh data
        </button>
      </div>

      {message && (
        <div className="mb-4 p-3 rounded-md border border-line bg-surface text-sm">
          {message}
        </div>
      )}

      <section className="space-y-3">
        {data.users.map((u) => (
          <AdminUserRow
            key={u.id}
            user={u}
            busy={busy}
            heartsPerUser={data.hearts_per_user}
            onUseHeart={() => adminFetch('/api/admin/use-heart', { user_id: u.id })}
            onRefundHeart={() => adminFetch('/api/admin/refund-heart', { user_id: u.id })}
            onRemove={() => {
              if (confirm(`Remove ${u.display_name} from the challenge?`)) {
                adminFetch('/api/admin/remove-user', { user_id: u.id });
              }
            }}
          />
        ))}
      </section>

      <button
        onClick={() => {
          sessionStorage.removeItem(STORAGE_KEY);
          location.reload();
        }}
        className="mt-12 text-xs text-muted underline"
      >
        Sign out
      </button>

      <div className="mt-6 flex flex-col items-start gap-2 text-[11px] text-muted">
        <a
          href="https://www.strava.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center"
        >
          {!poweredAssetMissing ? (
            // Official asset path: public/strava/powered-by-strava.png
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/strava/powered-by-strava.png"
              alt="Powered by Strava"
              className="h-5 w-auto"
              onError={() => setPoweredAssetMissing(true)}
            />
          ) : (
            <span className="uppercase tracking-widest">Powered by Strava</span>
          )}
        </a>
        <p>This admin tool is independent and is not sponsored by Strava.</p>
      </div>
    </main>
  );
}

function AdminUserRow({
  user,
  busy,
  heartsPerUser,
  onUseHeart,
  onRefundHeart,
  onRemove,
}: {
  user: DashboardUser;
  busy: string | null;
  heartsPerUser: number;
  onUseHeart: () => void;
  onRefundHeart: () => void;
  onRemove: () => void;
}) {
  return (
    <article className="p-4 rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-3">
        {user.profile_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.profile_image_url}
            alt={user.display_name}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-elevated border border-line" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-display text-lg uppercase">{user.display_name}</div>
          <div className="text-xs text-muted">
            {user.current_week_days_count}/4 this week ·{' '}
            {user.hearts_remaining}/{heartsPerUser} hearts ·{' '}
            <span className="text-flame">${user.total_owed} owed</span>
            {user.current_week_heart_used && (
              <span className="ml-2 text-heart">heart used this wk</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {!user.current_week_heart_used ? (
          <button
            disabled={user.hearts_remaining <= 0 || busy !== null}
            onClick={onUseHeart}
            className="px-3 py-1.5 rounded-md bg-heart/15 border border-heart/40 text-heart disabled:opacity-40"
          >
            Use heart (this week)
          </button>
        ) : (
          <button
            disabled={busy !== null}
            onClick={onRefundHeart}
            className="px-3 py-1.5 rounded-md bg-elevated border border-line"
          >
            Refund heart
          </button>
        )}
        <button
          onClick={onRemove}
          className="px-3 py-1.5 rounded-md bg-elevated border border-line text-muted hover:text-flame"
        >
          Remove
        </button>
      </div>
    </article>
  );
}
