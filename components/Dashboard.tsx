'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DashboardData, DashboardUser } from '@/lib/types';
import { getBrowserSupabase } from '@/lib/supabase';
import { addDays } from '@/lib/dates';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const MOCK_UI_MODE = process.env.NEXT_PUBLIC_DEV_UI_MOCK === 'true';
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

// Compute days remaining and elapsed in browser to keep the page reactive
// even between data fetches.
function useChallengeProgress(startDate: string, endDate: string, initialNowIso: string) {
  const [now, setNow] = useState(() => new Date(initialNowIso));
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return useMemo(() => {
    // AEST = UTC+10 in May-Sep. Shift now into AEST wall-clock.
    const aest = new Date(now.getTime() + 10 * 3600 * 1000);
    const today = aest.toISOString().slice(0, 10);
    const start = startDate;
    const end = endDate;
    const dayMs = 24 * 3600 * 1000;
    const total = Math.round(
      (Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / dayMs,
    );
    const elapsed = Math.max(
      0,
      Math.round(
        (Date.parse(today + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) /
          dayMs,
      ),
    );
    const remaining = Math.max(
      0,
      Math.round(
        (Date.parse(end + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) /
          dayMs,
      ),
    );
    const cappedElapsed = Math.min(Math.max(0, elapsed), total);
    const pct = total === 0 ? 0 : (cappedElapsed / total) * 100;
    return {
      total,
      elapsed: cappedElapsed,
      remaining,
      percent: Math.min(100, Math.max(0, pct)),
      todayDow: aest.getUTCDay(),
      hasStarted: today >= start,
    };
  }, [initialNowIso, now, startDate, endDate]);
}

// Live presence: track how many people are viewing right now via Supabase channel.
function usePresence(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (MOCK_UI_MODE) {
      setCount(0);
      return;
    }
    const sb = getBrowserSupabase();
    const channel = sb.channel('dashboard-presence', {
      config: { presence: { key: crypto.randomUUID() } },
    });
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        setCount(Object.keys(state).length);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ at: Date.now() });
        }
      });
    return () => {
      sb.removeChannel(channel);
    };
  }, []);
  return count;
}

export default function Dashboard({
  initialData,
  initialNowIso,
}: {
  initialData: DashboardData;
  initialNowIso: string;
}) {
  const [data, setData] = useState(initialData);
  const [selectedWeekStart, setSelectedWeekStart] = useState(initialData.week_start);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [weekLoading, setWeekLoading] = useState(false);
  const [poweredAssetMissing, setPoweredAssetMissing] = useState(false);
  const progress = useChallengeProgress(data.start_date, data.end_date, initialNowIso);
  const viewers = usePresence();
  const selectedUser = data.users.find((u) => u.id === selectedUserId) ?? null;

  async function refreshData(weekStart = selectedWeekStart, showLoading = false) {
    if (showLoading) setWeekLoading(true);
    try {
      const params = new URLSearchParams({
        t: String(Date.now()),
        week_start: weekStart,
      });
      const res = await fetch(`/api/data/dashboard?${params.toString()}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const next = (await res.json()) as DashboardData;
        setData(next);
        setSelectedWeekStart(next.week_start);
      }
    } catch {
      // ignore transient refresh failures
    } finally {
      if (showLoading) setWeekLoading(false);
    }
  }

  useEffect(() => {
    if (selectedWeekStart !== data.week_start) {
      refreshData(selectedWeekStart, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeekStart]);

  // Refresh dashboard data frequently so new joins appear quickly.
  useEffect(() => {
    const t = setInterval(() => refreshData(selectedWeekStart), 15_000);
    const onFocus = () => refreshData(selectedWeekStart);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshData(selectedWeekStart);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeekStart]);

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <div className="grain absolute inset-0 pointer-events-none" />

      <div className="relative max-w-3xl mx-auto px-5 pt-6 pb-24 sm:px-8">
        {/* HEADER ----------------------------------------------------------- */}
        <header className="mb-8">
          <div
            className={`flex items-center gap-3 mb-1 text-[11px] uppercase tracking-[0.2em] text-muted ${
              progress.hasStarted ? 'justify-end' : 'justify-between'
            }`}
          >
            {!progress.hasStarted && <span>{'Starts ' + data.start_date}</span>}
            <div className="inline-flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setRulesOpen(true)}
                className="inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted/75 hover:text-bone/90 transition-colors"
              >
                View rules
              </button>
              <PresenceChip count={viewers} />
            </div>
          </div>

          <h1 className="font-display text-[clamp(2.5rem,9vw,4.5rem)] leading-[0.92] uppercase">
            <span className="block">CYAM</span>
            <span className="block text-flame">Hevy Challenge</span>
          </h1>

          {/* Days remaining + progress bar */}
          <div className="mt-5">
            <div className="flex items-baseline justify-between mb-2">
              <div>
                <div className="days-float">
                  <div className="days-outline" aria-hidden="true">
                    {progress.remaining}
                  </div>
                  <div className="days-fill">
                    {progress.remaining}
                  </div>
                </div>
                <span className="ml-2 text-xs uppercase tracking-widest text-muted">
                  days left
                </span>
              </div>
              <div className="text-right text-xs text-muted font-mono">
                {progress.elapsed} / {progress.total}
              </div>
            </div>
            <div className="h-2 rounded-full bg-elevated overflow-hidden border border-line">
              <div
                className="h-full bg-gradient-to-r from-flame to-ember transition-all duration-700"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="mt-6 flex justify-center">
              <div className="relative inline-flex flex-col items-center gap-1 px-6 py-3 bg-surface border-2 border-flame/75">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-[3px] border border-flame/25"
                />
                <span className="relative font-pixel text-[7px] uppercase tracking-[0.4em] text-muted">
                  Pool
                </span>
                <span className="relative flex items-center gap-1">
                  <span className="font-pixel text-[1.05rem] leading-none text-gold">$</span>
                  <span className="font-pixel text-[1.35rem] leading-none text-bone">
                    {data.total_pool}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </header>

        <section className="relative mb-5 min-h-[32px]">
          <button
            onClick={() => setSelectedWeekStart(addDays(data.week_start, -7))}
            disabled={!data.can_go_prev_week || weekLoading}
            className="inline-flex items-center px-2.5 py-1.5 rounded-md bg-elevated/65 border border-line text-[12px] text-bone/90 hover:border-flame/50 hover:text-bone transition-colors disabled:opacity-0 disabled:pointer-events-none"
            aria-label="Previous week"
          >
            ←
          </button>

          <button
            onClick={() => setSelectedWeekStart(addDays(data.week_start, 7))}
            disabled={!data.can_go_next_week || weekLoading}
            className="absolute right-0 inline-flex items-center px-2.5 py-1.5 rounded-md bg-elevated/65 border border-line text-[12px] text-bone/90 hover:border-flame/50 hover:text-bone transition-colors disabled:opacity-0 disabled:pointer-events-none"
            aria-label="Next week"
          >
            →
          </button>

          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted">
              {data.is_current_week
                ? `Week ${data.week_number} (Current)`
                : `Week ${data.week_number}`}
            </span>
          </div>
        </section>

        {/* USER LIST -------------------------------------------------------- */}
        <section className="space-y-3">
          {data.users.length === 0 ? (
            <div className="p-8 rounded-xl border border-line bg-surface text-center">
              <p className="text-bone/70">No friends connected yet.</p>
              <p className="text-xs text-muted mt-2">
                Send them <code className="font-mono">/connect</code> to join.
              </p>
            </div>
          ) : (
            data.users.map((u, i) => (
              <UserRow
                key={u.id}
                user={u}
                index={i}
                todayDow={data.is_current_week ? progress.todayDow : null}
                required={data.required_days_per_week}
                heartsPerUser={data.hearts_per_user}
                onOpen={() => setSelectedUserId(u.id)}
              />
            ))
          )}
        </section>

        <section className="mt-10">
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted mb-3">
            Group Momentum
          </h2>
          <GroupCumulativeChart users={data.users} weeks={data.chart_weeks} />
        </section>

        {/* FOOTER ----------------------------------------------------------- */}
        <footer className="mt-12 flex flex-col items-center gap-3">
          <a
            href="https://www.strava.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-2.5 py-1 text-[10px] uppercase tracking-widest text-muted hover:text-bone transition-colors"
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
              'Powered by Strava'
            )}
          </a>
          <div className="text-[10px] text-muted uppercase tracking-widest text-center">
            Synced{' '}
            {data.last_synced_at
              ? formatSyncedAt(data.last_synced_at)
              : 'never'}
          </div>
        </footer>
      </div>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

        .days-float {
          position: relative;
          display: inline-block;
          animation: floatBob 3s ease-in-out infinite;
        }

        @keyframes floatBob {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-6px);
          }
        }

        .days-outline {
          font-family: 'Press Start 2P', monospace;
          font-size: clamp(25px, 7vw, 36px);
          line-height: 1;
          background: linear-gradient(
            135deg,
            #ff4d2e 0%,
            #ffc93c 20%,
            #00d26a 40%,
            #4d9eff 60%,
            #b44dff 80%,
            #ff4d2e 100%
          );
          background-size: 300% 300%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          -webkit-text-stroke: 3px transparent;
          animation: prismatic 4s ease infinite;
          filter: drop-shadow(0 0 12px rgba(255, 201, 60, 0.2))
            drop-shadow(0 0 24px rgba(77, 158, 255, 0.12));
        }

        .days-fill {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          font-family: 'Press Start 2P', monospace;
          font-size: clamp(25px, 7vw, 36px);
          line-height: 1;
          color: #ffffff;
          pointer-events: none;
        }

        @keyframes prismatic {
          0%,
          100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }

        .day-prismatic {
          position: relative;
          isolation: isolate;
          --prism: 0.8;
          --hueshift: 0deg;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }

        .day-prismatic::before {
          content: '';
          position: absolute;
          inset: -2px;
          z-index: -1;
          border-radius: inherit;
          background: conic-gradient(
            from 0deg,
            rgba(110, 231, 183, 0.85),
            rgba(45, 212, 191, 0.7),
            rgba(163, 255, 214, 0.8),
            rgba(110, 231, 183, 0.85)
          );
          filter: blur(4.5px) hue-rotate(var(--hueshift));
          opacity: calc(0.25 * var(--prism));
          pointer-events: none;
          animation: prismBloom 6.5s ease-in-out infinite;
        }

        .day-prismatic::after {
          content: '';
          position: absolute;
          inset: 0;
          z-index: -1;
          border-radius: inherit;
          padding: 1px;
          background: conic-gradient(
            from 140deg,
            rgba(163, 255, 214, 0.85),
            rgba(45, 212, 191, 0.75),
            rgba(110, 231, 183, 0.85),
            rgba(163, 255, 214, 0.85)
          );
          -webkit-mask:
            linear-gradient(#000 0 0) content-box,
            linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          filter: hue-rotate(var(--hueshift));
          opacity: calc(0.7 * var(--prism));
          pointer-events: none;
          animation: prismRim 6.5s ease-in-out infinite;
        }

        @keyframes prismBloom {
          0%,
          100% {
            opacity: calc(0.2 * var(--prism));
            filter: blur(4.5px) hue-rotate(var(--hueshift));
          }
          50% {
            opacity: calc(0.32 * var(--prism));
            filter: blur(5px) hue-rotate(calc(var(--hueshift) + 18deg));
          }
        }

        @keyframes prismRim {
          0%,
          100% {
            opacity: calc(0.6 * var(--prism));
            filter: hue-rotate(var(--hueshift)) brightness(1);
          }
          50% {
            filter: hue-rotate(calc(var(--hueshift) + 18deg)) brightness(1.1);
            opacity: calc(0.78 * var(--prism));
          }
        }

        .day-prismatic:nth-child(7n + 1)::before,
        .day-prismatic:nth-child(7n + 1)::after {
          animation-delay: -0s;
          --prism: 0.82;
          --hueshift: 0deg;
        }
        .day-prismatic:nth-child(7n + 2)::before,
        .day-prismatic:nth-child(7n + 2)::after {
          animation-delay: -1.1s;
          --prism: 0.74;
          --hueshift: -6deg;
        }
        .day-prismatic:nth-child(7n + 3)::before,
        .day-prismatic:nth-child(7n + 3)::after {
          animation-delay: -2.1s;
          --prism: 0.9;
          --hueshift: 8deg;
        }
        .day-prismatic:nth-child(7n + 4)::before,
        .day-prismatic:nth-child(7n + 4)::after {
          animation-delay: -3.2s;
          --prism: 0.78;
          --hueshift: -4deg;
        }
        .day-prismatic:nth-child(7n + 5)::before,
        .day-prismatic:nth-child(7n + 5)::after {
          animation-delay: -4.2s;
          --prism: 0.86;
          --hueshift: 6deg;
        }
        .day-prismatic:nth-child(7n + 6)::before,
        .day-prismatic:nth-child(7n + 6)::after {
          animation-delay: -5.2s;
          --prism: 0.76;
          --hueshift: -8deg;
        }
        .day-prismatic:nth-child(7n + 7)::before,
        .day-prismatic:nth-child(7n + 7)::after {
          animation-delay: -6.3s;
          --prism: 0.88;
          --hueshift: 4deg;
        }

        @media (prefers-reduced-motion: reduce) {
          .day-prismatic::before,
          .day-prismatic::after {
            animation: none;
          }
          .day-prismatic::before {
            opacity: calc(0.22 * var(--prism));
          }
          .day-prismatic::after {
            opacity: calc(0.62 * var(--prism));
          }
        }

        .flame-sprite {
          width: 20px;
          height: 20px;
          display: inline-block;
          flex: 0 0 auto;
          background-image: url('/ui/Sheets/IdleLoop-Sheet.png');
          background-repeat: no-repeat;
          background-size: auto 300%;
          background-position: -20px -18px;
          image-rendering: pixelated;
          transform: translateY(-1px) scale(1.14);
          transform-origin: center;
          animation: flameSprite 0.8s steps(1, end) infinite;
        }

        @keyframes flameSprite {
          0%,
          24.99% {
            background-position: -20px -18px;
          }
          25%,
          49.99% {
            background-position: -80px -18px;
          }
          50%,
          74.99% {
            background-position: -140px -18px;
          }
          75%,
          100% {
            background-position: -200px -18px;
          }
        }
      `}</style>

      {selectedUser && (
        <UserDetailModal
          user={selectedUser}
          deductionPerMiss={data.deduction_per_miss}
          onClose={() => setSelectedUserId(null)}
        />
      )}
      {rulesOpen && (
        <RulesModal
          requiredDays={data.required_days_per_week}
          minSeconds={1800}
          penalty={data.deduction_per_miss}
          onClose={() => setRulesOpen(false)}
        />
      )}
    </main>
  );
}

function formatPenaltyUnits(amount: number): string {
  const units = amount / 10;
  return Number.isInteger(units) ? `-${units}` : `-${units.toFixed(1)}`;
}

function PresenceChip({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-muted">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="w-3.5 h-3.5 text-muted/85"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2.3 12s3.6-6 9.7-6 9.7 6 9.7 6-3.6 6-9.7 6-9.7-6-9.7-6z" />
        <circle cx="12" cy="12" r="2.6" />
      </svg>
      <span className="font-mono normal-case tracking-normal text-bone/85">
        {count}
      </span>
    </div>
  );
}

function RulesModal({
  requiredDays,
  minSeconds,
  penalty,
  onClose,
}: {
  requiredDays: number;
  minSeconds: number;
  penalty: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = old;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div className="min-h-full flex items-start sm:items-center justify-center p-4">
        <div
          className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 my-4 sm:my-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Rules</div>
            </div>
            <button
              onClick={onClose}
              className="px-2 py-1 rounded-md border border-line bg-elevated text-muted hover:text-bone"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="mt-4 space-y-2">
            <RuleRow label="Required" value={`${requiredDays}× / week`} />
            <RuleRow label="Minimum" value={`${Math.round(minSeconds / 60)} min`} />
            <RuleRow label="Penalty" value={`-$${penalty}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function RuleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-elevated px-3 py-2.5 flex items-center justify-between gap-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="font-mono text-sm text-bone">{value}</div>
    </div>
  );
}

// =============================================================================
function UserRow({
  user,
  index,
  todayDow,
  required,
  heartsPerUser,
  onOpen,
}: {
  user: DashboardUser;
  index: number;
  todayDow: number | null;
  required: number;
  heartsPerUser: number;
  onOpen: () => void;
}) {
  const isCurrentWeekView = todayDow !== null;
  const isOnTrack = user.current_week_days_count >= required || user.current_week_heart_used;
  const statusHeart = user.current_week_heart_used;
  const statusClass = isOnTrack ? 'text-live/95' : 'text-flame/90';

  return (
    <article
      className="relative p-4 rounded-xl border border-line bg-surface animate-pop-in cursor-pointer"
      style={{ animationDelay: `${index * 60}ms` }}
      onClick={onOpen}
    >
      <div className="flex items-center gap-3">
        <Avatar src={user.profile_image_url} name={user.display_name} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-pixel text-sm sm:text-base leading-none truncate"
              style={{ color: user.display_color ?? '#F5F2EA' }}
            >
              {user.display_name}
            </span>
            {user.streak > 0 && <StreakBadge value={user.streak} />}
            <Hearts total={heartsPerUser} remaining={user.hearts_remaining} />
          </div>

          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted">
            <span className="font-mono">
              <span className="text-bone">{user.current_week_days_count}</span>
              /{required} this wk
            </span>
            {user.total_owed > 0 && (
              <span className="font-mono text-flame">
                {formatPenaltyUnits(user.total_owed)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Days grid */}
      <div className="mt-3.5 grid grid-cols-7 gap-1.5">
        {user.current_week_days.map((done, dow) => (
          <DayCell
            key={dow}
            label={DAY_LABELS[dow]}
            done={done}
            isToday={isCurrentWeekView && dow === todayDow}
            isPast={isCurrentWeekView && dow < todayDow}
          />
        ))}
      </div>

      {statusHeart ? (
        <div className="mt-3 leading-none font-mono text-flame/90 inline-flex items-center gap-1.5">
          <span className="text-[13px]">♥</span>
          <span className="text-[11px]">used a heart</span>
        </div>
      ) : (
        <div className={`mt-3 text-[13px] leading-none font-mono ${statusClass}`}>
          {isOnTrack ? '✓' : '✕'}
        </div>
      )}
    </article>
  );
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  const initial = name.charAt(0).toUpperCase();
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={name}
        className="w-12 h-12 rounded-full object-cover border border-line bg-elevated"
      />
    );
  }
  return (
    <div className="w-12 h-12 rounded-full bg-elevated border border-line flex items-center justify-center font-display text-xl text-bone/80">
      {initial}
    </div>
  );
}

function StreakBadge({ value }: { value: number }) {
  return (
    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-br from-orange-500/25 to-amber-400/20 border border-orange-400/45">
      <span aria-hidden="true" className="flame-sprite" />
      <span className="font-mono text-xs font-bold text-orange-300">{value}</span>
    </div>
  );
}

function Hearts({ total, remaining }: { total: number; remaining: number }) {
  return (
    <div className="inline-flex items-center gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          aria-label={i < remaining ? 'heart available' : 'heart depleted'}
          className={`nes-heart ${i < remaining ? '' : 'is-empty'}`}
        />
      ))}
    </div>
  );
}

function DayCell({
  label,
  done,
  isToday,
  isPast,
}: {
  label: string;
  done: boolean;
  isToday: boolean;
  isPast: boolean;
}) {
  let classes = 'aspect-square rounded-md flex items-center justify-center text-[10px] font-mono uppercase border transition-all duration-200 ';
  if (done) {
    classes +=
      'bg-live/20 border-live/60 text-live day-prismatic';
  } else if (isPast) {
    classes += 'bg-elevated/50 border-line text-muted';
  } else if (isToday) {
    classes += 'bg-elevated border-flame/60 text-flame animate-pulse-soft';
  } else {
    classes += 'bg-elevated/30 border-line/60 text-muted/60';
  }
  return (
    <div className={classes}>
      {done ? '✓' : label}
    </div>
  );
}

function UserDetailModal({
  user,
  deductionPerMiss,
  onClose,
}: {
  user: DashboardUser;
  deductionPerMiss: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = old;
    };
  }, [onClose]);

  const penaltyUnits =
    deductionPerMiss > 0
      ? Number.isInteger(user.total_owed / deductionPerMiss)
        ? user.total_owed / deductionPerMiss
        : Number((user.total_owed / deductionPerMiss).toFixed(1))
      : 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div className="min-h-full flex items-start sm:items-center justify-center p-4">
        <div
          className="w-full max-w-2xl rounded-2xl border border-line bg-surface p-5 sm:p-6 my-4 sm:my-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Avatar src={user.profile_image_url} name={user.display_name} />
              <div>
                <div
                  className="font-pixel text-sm sm:text-base"
                  style={{ color: user.display_color ?? '#F5F2EA' }}
                >
                  {user.display_name}
                </div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted mt-1">
                  Profile
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="px-2 py-1 rounded-md border border-line bg-elevated text-muted hover:text-bone"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ModalStat label="Penalty" value={`-${penaltyUnits}`} />
            <ModalStat label="Days Worked" value={String(user.total_days_worked_out)} />
            <ModalStat label="Hearts Left" value={String(user.hearts_remaining)} />
            <ModalStat label="Streak" value={String(user.streak)} />
          </div>

          <div className="mt-5">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted mb-2">
              Weekday Heatmap
            </div>
            <ConsistencyHeatmap
              weekdayIntensity={user.consistency_weekday_intensity}
              weekCount={user.consistency_week_count}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-elevated px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="font-mono text-sm text-bone mt-1">{value}</div>
    </div>
  );
}

function ConsistencyHeatmap({
  weekdayIntensity,
  weekCount,
}: {
  weekdayIntensity: number[]; // Sun..Sat
  weekCount: number;
}) {
  const cells = Array.from({ length: 7 }, (_, i) => weekdayIntensity[i] ?? 0);
  const cellClass = (v: number) => {
    if (v <= 0) return 'bg-elevated/40 border-line';
    if (v < 0.2) return 'bg-live/15 border-live/30';
    if (v < 0.4) return 'bg-live/25 border-live/45';
    if (v < 0.6) return 'bg-live/35 border-live/60';
    if (v < 0.8) return 'bg-live/50 border-live/70';
    return 'bg-live/70 border-live/85';
  };

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-[9px] sm:text-[10px] text-muted uppercase tracking-wider text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((v, i) => (
          <div
            key={i}
            className={`h-8 rounded-sm border ${cellClass(v)}`}
            title={`${DAY_LABELS[i]}: ${Math.round(v * 100)}% over ${weekCount} week${weekCount === 1 ? '' : 's'}`}
          />
        ))}
      </div>
      <div className="mt-2 text-[10px] text-muted uppercase tracking-wider">
        Based on {weekCount} week{weekCount === 1 ? '' : 's'}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        {[0.1, 0.3, 0.5, 0.7, 0.9].map((v) => (
          <div key={v} className={`w-4 h-2 rounded-sm border ${cellClass(v)}`} />
        ))}
        <span className="text-[9px] text-muted uppercase tracking-wider">less → more</span>
      </div>
    </div>
  );
}

function shortWeekDate(weekStart: string): string {
  const [_, m, d] = weekStart.split('-').map(Number);
  const month = MONTH_SHORT[Math.max(0, Math.min(11, (m || 1) - 1))];
  return `${String(d || 1).padStart(2, '0')} ${month}`;
}

function formatSyncedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTH_SHORT[d.getMonth()] ?? '---';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} ${day} ${month}`;
}

function GroupCumulativeChart({
  users,
  weeks,
}: {
  users: DashboardUser[];
  weeks: Array<{ week_start: string; week_number: number }>;
}) {
  const [metric, setMetric] = useState<'cumulative' | 'weekly'>('cumulative');
  const [focusUserId, setFocusUserId] = useState<string | null>(null);
  const [hasTappedName, setHasTappedName] = useState(false);
  const [activeWeekIdx, setActiveWeekIdx] = useState(
    weeks.length > 0 ? weeks.length - 1 : 0,
  );

  useEffect(() => {
    if (weeks.length === 0) return;
    setActiveWeekIdx((prev) => Math.min(Math.max(prev, 0), weeks.length - 1));
  }, [weeks.length]);

  const chartRows = useMemo(
    () =>
      users.map((u) => {
        const cumulativeByWeek = new Map<string, number>(
          u.chart_series.map((s) => [s.week_start, s.cumulative_days]),
        );
        const cumulative: number[] = [];
        let running = 0;
        for (const w of weeks) {
          const explicit = cumulativeByWeek.get(w.week_start);
          if (typeof explicit === 'number') running = explicit;
          cumulative.push(running);
        }
        const weekly = cumulative.map((v, idx) => (idx === 0 ? v : Math.max(0, v - cumulative[idx - 1])));
        return { user: u, cumulative, weekly };
      }),
    [users, weeks],
  );

  const seriesFor = (row: { cumulative: number[]; weekly: number[] }) =>
    metric === 'weekly' ? row.weekly : row.cumulative;
  const maxY = Math.max(
    1,
    ...chartRows.flatMap((row) => seriesFor(row)),
  );

  const { max: niceMax, ticks: yTicks } = niceScale(maxY);

  return (
    <div className="mx-[-10px] sm:mx-[-14px]">
      <div>
        <div className="flex items-center justify-end gap-1.5 mb-2.5 flex-wrap">
          <div className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMetric('cumulative')}
              className={`px-2 py-1 rounded-md border text-[10px] uppercase tracking-widest ${
                metric === 'cumulative'
                  ? 'border-line bg-elevated text-bone'
                  : 'border-line bg-transparent text-muted hover:text-bone'
              }`}
            >
              Cumulative
            </button>
            <button
              type="button"
              onClick={() => setMetric('weekly')}
              className={`px-2 py-1 rounded-md border text-[10px] uppercase tracking-widest ${
                metric === 'weekly'
                  ? 'border-line bg-elevated text-bone'
                  : 'border-line bg-transparent text-muted hover:text-bone'
              }`}
            >
              Weekly
            </button>
          </div>
        </div>

        <ChartSurface
          weeks={weeks}
          chartRows={chartRows}
          metric={metric}
          niceMax={niceMax}
          yTicks={yTicks}
          activeWeekIdx={activeWeekIdx}
          setActiveWeekIdx={setActiveWeekIdx}
          focusUserId={focusUserId}
          setFocusUserId={setFocusUserId}
          hasTappedName={hasTappedName}
          setHasTappedName={setHasTappedName}
        />

        {weeks.length > 5 && (
          <p className="mt-2 px-1 text-[10px] uppercase tracking-[0.14em] text-muted">
            Swipe horizontally to see every week
          </p>
        )}
      </div>
    </div>
  );
}

type ChartRow = {
  user: DashboardUser;
  cumulative: number[];
  weekly: number[];
};

function niceScale(rawMax: number): { max: number; ticks: number[] } {
  const max = Math.max(1, Math.ceil(rawMax));
  const steps = [1, 2, 5, 10, 20, 25, 50, 100];
  const targetTicks = 4;
  const rawStep = max / targetTicks;
  let step = steps[steps.length - 1];
  for (const s of steps) {
    if (s >= rawStep) {
      step = s;
      break;
    }
  }
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= niceMax + 1e-9; v += step) ticks.push(v);
  return { max: niceMax, ticks };
}

function ChartSurface({
  weeks,
  chartRows,
  metric,
  niceMax,
  yTicks,
  activeWeekIdx,
  setActiveWeekIdx,
  focusUserId,
  setFocusUserId,
  hasTappedName,
  setHasTappedName,
}: {
  weeks: Array<{ week_start: string; week_number: number }>;
  chartRows: ChartRow[];
  metric: 'cumulative' | 'weekly';
  niceMax: number;
  yTicks: number[];
  activeWeekIdx: number;
  setActiveWeekIdx: (idx: number) => void;
  focusUserId: string | null;
  setFocusUserId: (updater: (prev: string | null) => string | null) => void;
  hasTappedName: boolean;
  setHasTappedName: (value: boolean) => void;
}) {
  const height = 356;
  const xStep = 74;
  const padding = { top: 20, right: 8, bottom: 44, left: 40 };
  const baseWidth =
    padding.left +
    padding.right +
    Math.max(0, weeks.length - 1) * xStep;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setViewportWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const seriesFor = (row: ChartRow) =>
    metric === 'weekly' ? row.weekly : row.cumulative;

  const width = Math.max(baseWidth, viewportWidth || 0);
  const innerW = Math.max(1, width - padding.left - padding.right);
  const innerH = height - padding.top - padding.bottom;
  const step = weeks.length > 1 ? innerW / (weeks.length - 1) : innerW;

  const x = (index: number) =>
    padding.left +
    (weeks.length <= 1 ? innerW / 2 : (index / (weeks.length - 1)) * innerW);
  const y = (value: number) => padding.top + innerH - (value / niceMax) * innerH;

  const yOffsetPxByUserWeek = new Map<string, number[]>();
  for (let w = 0; w < weeks.length; w += 1) {
    const buckets = new Map<number, string[]>();
    for (const row of chartRows) {
      const val = seriesFor(row)[w] ?? 0;
      const arr = buckets.get(val) ?? [];
      arr.push(row.user.id);
      buckets.set(val, arr);
    }
    for (const ids of buckets.values()) {
      if (ids.length <= 1) continue;
      ids.forEach((id, idx) => {
        const centered = idx - (ids.length - 1) / 2;
        const offsets = yOffsetPxByUserWeek.get(id) ?? Array(weeks.length).fill(0);
        offsets[w] = centered * (focusUserId ? 1.4 : 2.2);
        yOffsetPxByUserWeek.set(id, offsets);
      });
    }
  }

  const activeWeek = weeks[activeWeekIdx];
  const activeRows = chartRows
    .map((row) => ({
      user: row.user,
      value: seriesFor(row)[activeWeekIdx] ?? 0,
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <>
      <div ref={viewportRef} className="overflow-x-auto pb-1">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMinYMid meet"
          className="block w-max min-w-full h-auto"
        >
          {yTicks.map((v) => {
            const yy = y(v);
            return (
              <g key={v}>
                <line
                  x1={padding.left}
                  y1={yy}
                  x2={width - padding.right}
                  y2={yy}
                  stroke="rgba(122,122,122,0.22)"
                  strokeDasharray="3 4"
                />
                <text
                  x={6}
                  y={yy + 4}
                  fill="#7A7A7A"
                  fontSize="11"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {v}
                </text>
              </g>
            );
          })}

          {weeks.map((w, idx) => (
            <g key={w.week_start}>
              <line
                x1={x(idx)}
                y1={padding.top}
                x2={x(idx)}
                y2={height - padding.bottom}
                stroke={
                  idx === activeWeekIdx
                    ? 'rgba(245,242,234,0.25)'
                    : 'rgba(122,122,122,0.14)'
                }
              />
              <text
                x={x(idx)}
                y={height - 9}
                textAnchor="middle"
                fill={idx === activeWeekIdx ? '#F5F2EA' : '#7A7A7A'}
                fontSize="10.5"
                fontFamily="JetBrains Mono, monospace"
                className="cursor-pointer select-none"
                onClick={() => setActiveWeekIdx(idx)}
                onMouseEnter={() => setActiveWeekIdx(idx)}
              >
                W{w.week_number}
              </text>
            </g>
          ))}

          {chartRows.map((row) => {
            const points = weeks.map((_, idx) => {
              const baseY = y(seriesFor(row)[idx] ?? 0);
              const yOffset = yOffsetPxByUserWeek.get(row.user.id)?.[idx] ?? 0;
              return `${x(idx)},${baseY + yOffset}`;
            });
            const focused = !focusUserId || row.user.id === focusUserId;
            return (
              <polyline
                key={row.user.id}
                fill="none"
                stroke={withReadableAlpha(row.user.display_color ?? '#F5F2EA', focused ? 0.92 : 0.22)}
                strokeWidth={focused ? 2.35 : 1.1}
                points={points.join(' ')}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {chartRows.map((row) => {
            const focused = !focusUserId || row.user.id === focusUserId;
            const value = seriesFor(row)[activeWeekIdx] ?? 0;
            const yOffset = yOffsetPxByUserWeek.get(row.user.id)?.[activeWeekIdx] ?? 0;
            return (
              <circle
                key={`${row.user.id}-${activeWeekIdx}`}
                cx={x(activeWeekIdx)}
                cy={y(value) + yOffset}
                r={focused ? 3.5 : 2.5}
                fill={withReadableAlpha(row.user.display_color ?? '#F5F2EA', focused ? 0.95 : 0.48)}
                stroke="rgba(16,16,16,0.7)"
                strokeWidth="1"
              />
            );
          })}

          {weeks.map((_, idx) => (
            <rect
              key={`hit-${idx}`}
              x={x(idx) - step / 2}
              y={padding.top}
              width={step}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setActiveWeekIdx(idx)}
              onMouseMove={() => setActiveWeekIdx(idx)}
              onClick={() => setActiveWeekIdx(idx)}
            />
          ))}
        </svg>
      </div>

      {activeWeek && (
        <div className="mt-3 rounded-md border border-line bg-elevated/50 p-2.5 sm:p-3">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div className="text-[11px] sm:text-[12px] uppercase tracking-[0.14em] text-bone">
              Week {activeWeek.week_number} · {shortWeekDate(activeWeek.week_start)}
            </div>
            <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.16em] text-muted/70">
              {hasTappedName ? (metric === 'weekly' ? 'Weekly days' : 'Cumulative days') : 'Tap a name'}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
            {activeRows.map((row, idx) => {
              const focused = !focusUserId || row.user.id === focusUserId;
              const medal = ['#FFC93C', '#C7CBD1', '#C8864F'][idx];
              return (
                <button
                  type="button"
                  key={row.user.id}
                  onClick={() => {
                    setHasTappedName(true);
                    setFocusUserId((prev) => (prev === row.user.id ? null : row.user.id));
                  }}
                  className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left bg-surface/45 border border-line/50 transition-all hover:bg-surface/70 active:bg-surface/90 active:scale-[0.98] ${
                    focused ? '' : 'opacity-45'
                  } ${focusUserId === row.user.id ? 'bg-surface/80 border-flame/40' : ''}`}
                  title="Tap to isolate this line"
                >
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <span
                      className="font-mono text-[9px] text-muted/70 tabular-nums w-3 text-right shrink-0"
                      style={medal ? { color: medal } : undefined}
                    >
                      {idx + 1}
                    </span>
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: withReadableAlpha(
                          row.user.display_color ?? '#F5F2EA',
                          0.9,
                        ),
                      }}
                    />
                    <span className="font-pixel normal-case tracking-normal leading-none text-[8px] sm:text-[9px] text-bone/85 truncate">
                      {row.user.display_name}
                    </span>
                  </span>
                  <span className="font-mono text-[12px] font-medium text-bone tabular-nums shrink-0">
                    {row.value}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function withReadableAlpha(color: string, alpha: number): string {
  if (!color.startsWith('#')) return color;
  const hex = color.replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  if (full.length !== 6) return color;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const boost = luminance < 0.28 ? 1.25 : 1;
  const rr = Math.min(255, Math.round(r * boost));
  const gg = Math.min(255, Math.round(g * boost));
  const bb = Math.min(255, Math.round(b * boost));
  return `rgba(${rr}, ${gg}, ${bb}, ${alpha})`;
}
