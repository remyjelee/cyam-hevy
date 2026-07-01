/** Palette for auto-assigned and preset name colours (white excluded). */
export const CHALLENGE_DISPLAY_COLORS = [
  '#FF7B72',
  '#7EE787',
  '#79C0FF',
  '#D2A8FF',
  '#F2CC60',
  '#FF9BCE',
  '#56D4DD',
  '#FFA657',
  '#A8B1FF',
  '#7DDBB5',
] as const;

const BANNED_HEX = new Set(['ffffff', 'fff', 'f5f2ea']);

function normalizeHex(hex: string): string {
  return hex.trim().toLowerCase().replace(/^#/, '');
}

/** True for white / bone and other near-white picks we disallow. */
export function isBannedDisplayColor(hex: string): boolean {
  const n = normalizeHex(hex);
  if (BANNED_HEX.has(n)) return true;
  if (n.length !== 6 && n.length !== 3) return false;
  const full =
    n.length === 3
      ? n
          .split('')
          .map((c) => c + c)
          .join('')
      : n;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Reject colours that read as white on the dark dashboard.
  return r >= 240 && g >= 240 && b >= 240;
}

export function sanitizeChosenDisplayColor(hex: string): string | null {
  const trimmed = hex.trim();
  if (!trimmed || isBannedDisplayColor(trimmed)) return null;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

/** Pick a random palette colour not already used by another active user. */
export function pickUnusedDisplayColor(taken: string[]): string {
  const takenSet = new Set(
    taken.map((c) => sanitizeChosenDisplayColor(c)?.toLowerCase()).filter(Boolean),
  );
  const available = CHALLENGE_DISPLAY_COLORS.filter(
    (c) => !takenSet.has(c.toLowerCase()),
  );
  const pool = available.length > 0 ? available : [...CHALLENGE_DISPLAY_COLORS];
  return pool[Math.floor(Math.random() * pool.length)];
}
