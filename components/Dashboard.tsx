'use client';

import { useEffect, useMemo, useState } from 'react';
import { DashboardData, DashboardUser } from '@/lib/types';
import { getBrowserSupabase } from '@/lib/supabase';
import { addDays } from '@/lib/dates';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

// Compute days remaining and elapsed in browser to keep the page reactive
// even between data fetches.
function useChallengeProgress(startDate: string, endDate: string) {
  const [now, setNow] = useState(() => new Date());
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
  }, [now, startDate, endDate]);
}

// Live presence: track how many people are viewing right now via Supabase channel.
function usePresence(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
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

export default function Dashboard({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [selectedWeekStart, setSelectedWeekStart] = useState(initialData.week_start);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [weekLoading, setWeekLoading] = useState(false);
  const [poweredAssetMissing, setPoweredAssetMissing] = useState(false);
  const progress = useChallengeProgress(data.start_date, data.end_date);
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
          <div className="flex items-center justify-between mb-1 text-[11px] uppercase tracking-[0.2em] text-muted">
            <span>{progress.hasStarted ? 'In progress' : 'Starts ' + data.start_date}</span>
            <PresenceChip count={viewers} />
          </div>

          <h1 className="font-display text-[clamp(2.5rem,9vw,4.5rem)] leading-[0.92] uppercase">
            <span className="block">CYAM</span>
            <span className="block text-flame">Hevy Challenge</span>
          </h1>

          {/* Days remaining + progress bar */}
          <div className="mt-6">
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
          </div>

          {/* Pool + rules summary */}
          <div className="mt-6 flex flex-wrap gap-3 text-xs">
            <Stat label="Pool" value={`$${data.total_pool}`} accent />
            <Stat
              label="Required"
              value={`${data.required_days_per_week}× / week`}
            />
            <Stat label="Min" value="30 min" />
            <Stat label="Penalty" value={`-$${data.deduction_per_miss}`} />
          </div>
        </header>

        <section className="relative mb-5 min-h-[32px]">
          <button
            onClick={() => setSelectedWeekStart(addDays(data.week_start, -7))}
            disabled={!data.can_go_prev_week || weekLoading}
            className="inline-flex items-center px-3 py-1.5 rounded-md bg-elevated/65 border border-line text-[11px] uppercase tracking-wider text-bone/90 hover:border-flame/50 hover:text-bone transition-colors disabled:opacity-0 disabled:pointer-events-none"
          >
            ← Previous week
          </button>

          <button
            onClick={() => setSelectedWeekStart(addDays(data.week_start, 7))}
            disabled={!data.can_go_next_week || weekLoading}
            className="absolute right-0 inline-flex items-center px-3 py-1.5 rounded-md bg-elevated/65 border border-line text-[11px] uppercase tracking-wider text-bone/90 hover:border-flame/50 hover:text-bone transition-colors disabled:opacity-0 disabled:pointer-events-none"
          >
            Next week →
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
              ? new Date(data.last_synced_at).toLocaleString('en-AU', {
                  hour: '2-digit',
                  minute: '2-digit',
                  day: '2-digit',
                  month: 'short',
                })
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
            transform: translateY(-8px);
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
      `}</style>

      {selectedUser && (
        <UserDetailModal
          user={selectedUser}
          deductionPerMiss={data.deduction_per_miss}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </main>
  );
}

function formatPenaltyUnits(amount: number): string {
  const units = amount / 10;
  return Number.isInteger(units) ? `-${units}` : `-${units.toFixed(1)}`;
}

// =============================================================================
function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`px-3 py-2 rounded-md border ${
        accent
          ? 'border-flame/40 bg-flame/10 text-flame'
          : 'border-line bg-surface text-bone'
      }`}
    >
      <div className="text-[9px] uppercase tracking-widest text-muted">
        {label}
      </div>
      <div className="font-display text-lg leading-none mt-0.5">{value}</div>
    </div>
  );
}

function PresenceChip({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full border border-line bg-surface">
      <span className="relative flex w-2 h-2">
        <span className="absolute inset-0 rounded-full bg-live animate-ping opacity-75" />
        <span className="relative w-2 h-2 rounded-full bg-live" />
      </span>
      <span className="font-mono text-[10px] text-bone">
        {count} {count === 1 ? 'viewer' : 'viewers'}
      </span>
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
  const danger =
    isCurrentWeekView &&
    !isOnTrack &&
    user.current_week_days_count < required &&
    todayDow >= 5; // Fri+ and behind = danger zone

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
            {user.current_week_heart_used && (
              <span className="text-heart font-medium">heart used</span>
            )}
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

      {isCurrentWeekView ? (
        <>
          {danger && !user.current_week_heart_used && (
            <div className="mt-3 text-[10px] uppercase tracking-widest text-flame/80 font-medium">
              Behind pace
            </div>
          )}
          {isOnTrack && (
            <div className="mt-3 text-[10px] uppercase tracking-widest text-live/90 font-medium">
              {user.current_week_heart_used ? 'Safe — heart used' : 'On pace'}
            </div>
          )}
        </>
      ) : (
        <div
          className={`mt-3 text-[10px] uppercase tracking-widest font-medium ${
            isOnTrack ? 'text-live/90' : 'text-flame/85'
          }`}
        >
          {isOnTrack ? 'Passed' : 'Failed'}
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
      <span className="text-[14px] leading-none animate-flicker text-orange-400">🔥</span>
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
      'bg-live/20 border-live/60 text-live';
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
      className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-line bg-surface p-5 sm:p-6"
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
                Athlete profile
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
            Consistency Heatmap
          </div>
          <ConsistencyHeatmap weeks={user.consistency_weeks} />
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
  weeks,
}: {
  weeks: Array<{ week_start: string; week_number: number; day_flags: boolean[] }>;
}) {
  const shown = weeks.slice(-10);
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] gap-1 mb-1">
          <div />
          {DAY_LABELS.map((d) => (
            <div key={d} className="text-[10px] text-muted uppercase tracking-wider text-center">
              {d}
            </div>
          ))}
        </div>
        <div className="space-y-1">
          {shown.map((w) => (
            <div
              key={w.week_start}
              className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] gap-1 items-center"
            >
              <div className="text-[10px] text-muted uppercase tracking-wider">
                Wk {w.week_number}
              </div>
              {w.day_flags.map((done, i) => (
                <div
                  key={`${w.week_start}-${i}`}
                  className={`h-6 rounded-sm border ${
                    done
                      ? 'bg-live/25 border-live/60'
                      : 'bg-elevated/40 border-line'
                  }`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GroupCumulativeChart({
  users,
  weeks,
}: {
  users: DashboardUser[];
  weeks: Array<{ week_start: string; week_number: number }>;
}) {
  const width = 920;
  const height = 260;
  const padding = { top: 16, right: 18, bottom: 28, left: 30 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const maxY = Math.max(
    1,
    ...users.map((u) =>
      u.chart_series.length > 0
        ? u.chart_series[u.chart_series.length - 1].cumulative_days
        : 0,
    ),
  );

  const x = (index: number) =>
    padding.left +
    (weeks.length <= 1 ? innerW / 2 : (index / (weeks.length - 1)) * innerW);
  const y = (value: number) =>
    padding.top + innerH - (value / maxY) * innerH;

  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[760px] h-[220px]">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const v = Math.round(maxY * t);
            const yy = y(v);
            return (
              <g key={t}>
                <line
                  x1={padding.left}
                  y1={yy}
                  x2={width - padding.right}
                  y2={yy}
                  stroke="rgba(122,122,122,0.22)"
                  strokeDasharray="3 4"
                />
                <text
                  x={4}
                  y={yy + 4}
                  fill="#7A7A7A"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {v}
                </text>
              </g>
            );
          })}

          {users.map((u) => {
            const points = weeks.map((w, idx) => {
              const p = u.chart_series.find((s) => s.week_start === w.week_start);
              return `${x(idx)},${y(p?.cumulative_days ?? 0)}`;
            });
            return (
              <polyline
                key={u.id}
                fill="none"
                stroke={withReadableAlpha(u.display_color ?? '#F5F2EA', 0.85)}
                strokeWidth="2.4"
                points={points.join(' ')}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {weeks.length > 0 && (
            <>
              <text
                x={padding.left}
                y={height - 8}
                fill="#7A7A7A"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                Wk {weeks[0].week_number}
              </text>
              <text
                x={width - padding.right - 32}
                y={height - 8}
                fill="#7A7A7A"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                Wk {weeks[weeks.length - 1].week_number}
              </text>
            </>
          )}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {users.map((u) => (
          <div
            key={u.id}
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted"
          >
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: withReadableAlpha(u.display_color ?? '#F5F2EA', 0.9) }}
            />
            <span>{u.display_name}</span>
          </div>
        ))}
      </div>
    </div>
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
