/** Local-calendar date helpers. Every function takes `now` so tests can pin time. */

const z = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD in local time. */
export const dkey = (d: Date = new Date()) =>
  `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;

export function daysAgoKey(n: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return dkey(d);
}

export const yday = (now: Date = new Date()) => daysAgoKey(1, now);

/** Monday of the current week. */
export function weekStart(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dkey(d);
}

/** Key of the current reset period for a counter mission. */
export function curKey(period: string | undefined, now: Date = new Date()): string {
  if (period === "week") return "w" + weekStart(now);
  if (period === "month") return "m" + dkey(now).slice(0, 7);
  return "all";
}

export function parseD(s: string): Date {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export const daysSince = (s: string, now: Date = new Date()) =>
  Math.round((parseD(dkey(now)).getTime() - parseD(s).getTime()) / 864e5);

export function dayOfYear(now: Date = new Date()): number {
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now.getTime() - start.getTime()) / 864e5);
}

export const zpad = z;
