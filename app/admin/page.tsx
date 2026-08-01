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
    // Dashboard endpoint is edge-cached for public traffic; bust cache in admin
    // so heart/use-refund state reflects writes immediately.
    const res = await fetch(`/api/data/dashboard?admin_ts=${Date.now()}`, {
      cache: 'no-store',
    });
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
        const details =
          Array.isArray(json.errors) && json.errors.length > 0
            ? json.errors
                .map(
                  (e: { display_name?: string; user_id?: string; error?: string }) =>
                    e.display_name
                      ? `${e.display_name}: ${e.error}`
                      : e.error || e.user_id,
                )
                .join('; ')
            : json.error;
        const partial =
          typeof json.synced === 'number' && typeof json.failed === 'number'
            ? ` (${json.synced} ok, ${json.failed} failed)`
            : '';
        setMessage(`Error: ${details || res.status}${partial}`);
      } else if (json.ok === false && Array.isArray(json.errors) && json.errors.length > 0) {
        setMessage(
          `Partial sync: ${json.synced} ok, ${json.failed} failed — ${json.errors
            .map((e: { error?: string }) => e.error)
            .join('; ')}`,
        );
        await loadData();
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

      <div className="mb-6 p-4 rounded-xl border border-line bg-surface flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-display text-lg uppercase">Auto-spend hearts</div>
          <p className="text-xs text-muted mt-0.5">
            When a week finalizes short, spend a remaining heart instead of
            charging the penalty.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={data.auto_consume_hearts}
          disabled={busy === '/api/admin/set-auto-consume'}
          onClick={() =>
            adminFetch('/api/admin/set-auto-consume', {
              enabled: !data.auto_consume_hearts,
            })
          }
          className={`relative shrink-0 inline-flex h-7 w-12 items-center rounded-full border transition-colors disabled:opacity-50 ${
            data.auto_consume_hearts
              ? 'bg-flame/80 border-flame'
              : 'bg-elevated border-line'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-bone transition-transform ${
              data.auto_consume_hearts ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
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
            requiredDaysPerWeek={data.required_days_per_week}
            deductionPerMiss={data.deduction_per_miss}
            onUseHeart={() => adminFetch('/api/admin/use-heart', { user_id: u.id })}
            onRefundHeart={() => adminFetch('/api/admin/refund-heart', { user_id: u.id })}
            onSetLeft={(left) => {
              if (
                left &&
                !confirm(
                  `Mark ${u.display_name} as having left, starting this week?\n\nThey keep every previous week — on the dashboard and on the chart — but drop off the roster from this week on and stop being synced. Reversible.`,
                )
              ) {
                return;
              }
              adminFetch('/api/admin/set-left-week', { user_id: u.id, left });
            }}
            onRemove={() => {
              if (
                confirm(
                  `Remove ${u.display_name} from the challenge entirely?\n\nThis hides them from every week, including past ones. To let them keep their history, use "Mark as left" instead.`,
                )
              ) {
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
  requiredDaysPerWeek,
  deductionPerMiss,
  onUseHeart,
  onRefundHeart,
  onSetLeft,
  onRemove,
}: {
  user: DashboardUser;
  busy: string | null;
  heartsPerUser: number;
  requiredDaysPerWeek: number;
  deductionPerMiss: number;
  onUseHeart: () => void;
  onRefundHeart: () => void;
  onSetLeft: (left: boolean) => void;
  onRemove: () => void;
}) {
  const owedUnits = user.total_owed / deductionPerMiss;
  const hasLeft = Boolean(user.left_week_start);
  return (
    <article
      className={`p-4 rounded-xl border border-line bg-surface ${
        hasLeft ? 'opacity-60' : ''
      }`}
    >
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
          <div className="font-display text-lg uppercase">
            {user.display_name}
            {hasLeft && (
              <span className="ml-2 font-sans normal-case tracking-normal text-[10px] uppercase text-muted border border-line rounded px-1.5 py-0.5 align-middle">
                left from {user.left_week_start}
              </span>
            )}
          </div>
          <div className="text-xs text-muted">
            {user.current_week_days_count}/{requiredDaysPerWeek} this week ·{' '}
            {user.hearts_remaining}/{heartsPerUser} hearts ·{' '}
            <span className="text-flame">
              -{Number.isInteger(owedUnits) ? owedUnits : owedUnits.toFixed(1)} owed
            </span>
            {user.current_week_heart_used && (
              <span className="ml-2 text-heart">heart used this wk</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {!hasLeft &&
          (!user.current_week_heart_used ? (
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
          ))}
        <button
          disabled={busy !== null}
          onClick={() => onSetLeft(!hasLeft)}
          className="px-3 py-1.5 rounded-md bg-elevated border border-line disabled:opacity-40"
          title={
            hasLeft
              ? 'Put them back on the roster from this week on'
              : 'Keep every past week, drop off the roster from this week on'
          }
        >
          {hasLeft ? 'Bring back' : 'Mark as left'}
        </button>
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
