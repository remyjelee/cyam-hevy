'use client';

import { useEffect, useMemo, useState } from 'react';
import { DashboardData, DashboardUser } from '@/lib/types';
import { getBrowserSupabase } from '@/lib/supabase';

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
  const progress = useChallengeProgress(data.start_date, data.end_date);
  const viewers = usePresence();

  // Refresh dashboard data every 60s.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch('/api/data/dashboard', { cache: 'no-store' });
        if (res.ok) setData(await res.json());
      } catch { /* ignore */ }
    }, 60_000);
    return () => clearInterval(t);
  }, []);

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
                <span className="font-display text-5xl sm:text-6xl text-bone">
                  {progress.remaining}
                </span>
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
            <Stat label="Miss" value={`-$${data.deduction_per_miss}`} />
          </div>
        </header>

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
              <UserRow key={u.id} user={u} index={i} todayDow={progress.todayDow} required={data.required_days_per_week} />
            ))
          )}
        </section>

        {/* FOOTER ----------------------------------------------------------- */}
        <footer className="mt-12 text-[10px] text-muted uppercase tracking-widest text-center">
          Synced{' '}
          {data.last_synced_at
            ? new Date(data.last_synced_at).toLocaleString('en-AU', {
                hour: '2-digit',
                minute: '2-digit',
                day: '2-digit',
                month: 'short',
              })
            : 'never'}
        </footer>
      </div>
    </main>
  );
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
}: {
  user: DashboardUser;
  index: number;
  todayDow: number;
  required: number;
}) {
  const isOnTrack = user.current_week_days_count >= required || user.current_week_heart_used;
  const danger =
    !isOnTrack &&
    user.current_week_days_count < required &&
    todayDow >= 5; // Fri+ and behind = danger zone

  return (
    <article
      className="relative p-4 rounded-xl border border-line bg-surface animate-pop-in"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center gap-3">
        <Avatar src={user.profile_image_url} name={user.display_name} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-display text-xl leading-none truncate">
              {user.display_name}
            </span>
            {user.streak > 0 && <StreakBadge value={user.streak} />}
            <Hearts total={3} remaining={user.hearts_remaining} />
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
                –${user.total_owed}
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
            isToday={dow === todayDow}
            isPast={dow < todayDow}
          />
        ))}
      </div>

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
    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-br from-ember/30 to-flame/20 border border-flame/40">
      <span className="text-[14px] leading-none animate-flicker">🔥</span>
      <span className="font-mono text-xs font-bold text-ember">{value}</span>
    </div>
  );
}

function Hearts({ total, remaining }: { total: number; remaining: number }) {
  return (
    <div className="inline-flex items-center gap-0.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`text-xs leading-none ${
            i < remaining ? 'opacity-100' : 'opacity-25 grayscale'
          }`}
        >
          ❤️
        </span>
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
  let classes = 'aspect-square rounded-md flex items-center justify-center text-[10px] font-mono uppercase border transition-all ';
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
