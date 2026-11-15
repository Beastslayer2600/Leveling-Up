/* Skills: things the player chooses to level up (Rubik's cube, chess, guitar…).
   Practice time pays XP and builds the skill's own level; an optional result
   (solve time, rating, score) is tracked with personal bests and a goal. */
import { PRACTICE } from "./config.js";
import { daysAgoKey, dkey, weekStart } from "./dates.js";
import { CAT, levelOf } from "./xp.js";
import type { CatId, MetricKind, PracticeLog, Pursuit, SkillMetric } from "./types.js";

export const METRIC_KINDS: { id: MetricKind; label: string }[] = [
  { id: "time", label: "Time · lower is better" },
  { id: "higher", label: "Number · higher is better" },
  { id: "lower", label: "Number · lower is better" },
];

/** Skill rank titles by skill level. */
export const SKILL_RANKS: [number, string][] = [
  [1, "Novice"],
  [3, "Apprentice"],
  [5, "Adept"],
  [8, "Skilled"],
  [12, "Expert"],
  [17, "Master"],
  [25, "Grandmaster"],
];

export function skillRank(level: number): string {
  let t = SKILL_RANKS[0][1];
  for (const [min, name] of SKILL_RANKS) if (level >= min) t = name;
  return t;
}

/** XP for one practice log. */
export function practiceXp(mins: number, pb = false): number {
  const m = Math.max(0, Number(mins) || 0);
  const base = m > 0 ? Math.min(PRACTICE.maxSessionXp, Math.max(PRACTICE.minSessionXp, Math.round(m * PRACTICE.xpPerMin))) : 0;
  return base + (pb ? PRACTICE.pbXp : 0);
}

/**
 * Read a result typed by the player. Time takes "1:23.45", "1:02:03", "83.4" (seconds) or "1m 23s";
 * numbers take anything numeric. Returns null for blank or unreadable input.
 */
export function parseValue(raw: string, kind: MetricKind): number | null {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  if (kind !== "time") {
    const n = Number(s.replace(/\s/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  const hms = s.match(/^(?:(\d+)h)?\s*(?:(\d+)m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)s)?$/i);
  if (hms && (hms[1] || hms[2] || hms[3])) {
    const v = (+(hms[1] || 0)) * 3600 + (+(hms[2] || 0)) * 60 + (+(hms[3] || 0));
    return v > 0 ? round2(v) : null;
  }
  const parts = s.split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  if (parts.slice(0, -1).some((p) => p.includes("."))) return null;
  const v = parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  return v > 0 ? round2(v) : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Seconds -> "1:23.45", "45.20s" or "1:02:03". */
export function fmtTime(sec: number): string {
  const t = Math.max(0, round2(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = round2(t - h * 3600 - m * 60);
  const frac = Math.round((s % 1) * 100);
  const ss = Math.floor(s);
  const sStr = frac ? `${String(ss).padStart(h || m ? 2 : 1, "0")}.${String(frac).padStart(2, "0")}` : String(ss).padStart(h || m ? 2 : 1, "0");
  if (h) return `${h}:${String(m).padStart(2, "0")}:${sStr}`;
  if (m) return `${m}:${sStr}`;
  return `${sStr}s`;
}

/** A result in the metric's own format. */
export function fmtValue(v: number | null | undefined, metric: SkillMetric | null): string {
  if (v == null || !metric) return "—";
  if (metric.kind === "time") return fmtTime(v);
  const n = Number.isInteger(v) ? v.toLocaleString("en-ZA").replace(/[,\s]/g, " ") : String(round2(v));
  return metric.unit ? `${n} ${metric.unit}` : n;
}

/** True if result a beats result b under this metric. */
export const beats = (a: number, b: number, kind: MetricKind) => (kind === "higher" ? a > b : a < b);

/** Best result logged for a skill, optionally ignoring one log (the one being edited). */
export function bestOf(logs: PracticeLog[], metric: SkillMetric | null, excludeId?: string): { value: number; date: string; id: string } | null {
  if (!metric) return null;
  let best: PracticeLog | null = null;
  for (const l of logs) {
    if (l.id === excludeId || l.value == null) continue;
    if (!best || beats(l.value, best.value!, metric.kind) || (l.value === best.value && l.date < best.date)) best = l;
  }
  return best ? { value: best.value!, date: best.date, id: best.id } : null;
}

/** A result is a PB if it beats every other logged result. The very first result is the baseline, not a PB. */
export function isPb(value: number | null, logs: PracticeLog[], metric: SkillMetric | null, excludeId?: string): boolean {
  if (value == null || !metric) return false;
  const best = bestOf(logs, metric, excludeId);
  return !!best && beats(value, best.value, metric.kind);
}

/** Has the result reached the goal? */
export function goalMet(value: number | null | undefined, p: Pursuit): boolean {
  if (value == null || p.goal == null || !p.metric) return false;
  return p.metric.kind === "higher" ? value >= p.goal : value <= p.goal;
}

/** Consecutive days with practice, ending today (or yesterday, while today is still open). */
export function practiceStreak(logs: PracticeLog[], now: Date = new Date()): number {
  const days = new Set(logs.map((l) => l.date));
  let i = days.has(dkey(now)) ? 0 : 1;
  let n = 0;
  while (days.has(daysAgoKey(i, now))) {
    n++;
    i++;
  }
  return n;
}

export interface SkillSummary {
  xp: number;
  level: number;
  into: number;
  need: number;
  rank: string;
  totalMins: number;
  sessions: number;
  weekMins: number;
  streak: number;
  best: { value: number; date: string; id: string } | null;
  latest: PracticeLog | null;
  /** Results in date order, for the trend chart. */
  series: { date: string; value: number }[];
  /** Next practice-hours milestone, and the last one passed. */
  nextHours: number | null;
  lastHours: number | null;
  goalReached: boolean;
}

/** Everything the tracker shows for one skill. */
export function skillSummary(p: Pursuit, all: PracticeLog[], now: Date = new Date()): SkillSummary {
  const logs = all.filter((l) => l.skill === p.id);
  const xp = logs.reduce((s, l) => s + (Number(l.xp) || 0), 0);
  const L = levelOf(xp, PRACTICE.levelBase);
  const totalMins = logs.reduce((s, l) => s + (Number(l.mins) || 0), 0);
  const ws = weekStart(now);
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  const best = bestOf(logs, p.metric);
  const hours = totalMins / 60;
  return {
    xp,
    ...L,
    rank: skillRank(L.level),
    totalMins,
    sessions: logs.length,
    weekMins: logs.filter((l) => l.date >= ws).reduce((s, l) => s + (Number(l.mins) || 0), 0),
    streak: practiceStreak(logs, now),
    best,
    latest: sorted[sorted.length - 1] || null,
    series: p.metric ? sorted.filter((l) => l.value != null).map((l) => ({ date: l.date, value: l.value! })) : [],
    nextHours: PRACTICE.milestones.find((h) => h > hours) ?? null,
    lastHours: [...PRACTICE.milestones].reverse().find((h) => h <= hours) ?? null,
    goalReached: goalMet(best?.value, p),
  };
}

/** "1h 30m", "45m", "12h". */
export function fmtMins(mins: number): string {
  const m = Math.round(Math.max(0, mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** Clean a skill from storage or the form. */
export function normalizePursuit(raw: Partial<Pursuit> & { id: string }, now = Date.now()): Pursuit {
  const m = raw.metric;
  const kind: MetricKind = m && (["time", "higher", "lower"] as const).includes(m.kind) ? m.kind : "higher";
  const metric: SkillMetric | null =
    m && String(m.name || "").trim() ? { name: String(m.name).trim().slice(0, 40), kind, unit: kind === "time" ? "" : String(m.unit || "").trim().slice(0, 12) } : null;
  const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Number(v));
  return {
    id: raw.id,
    name: String(raw.name || "Skill").trim().slice(0, 60) || "Skill",
    icon: String(raw.icon || "").trim().slice(0, 4),
    cat: (raw.cat && CAT[raw.cat] ? raw.cat : PRACTICE.cat) as CatId,
    created: Number(raw.created) || now,
    metric,
    weeklyMins: num(raw.weeklyMins),
    goal: metric ? num(raw.goal) : null,
    note: String(raw.note || "").trim().slice(0, 200),
    ...(raw.u ? { u: raw.u } : {}),
  };
}

/** Ideas offered when adding a skill. Picking one fills the form; everything stays editable. */
export const SKILL_PRESETS: { name: string; icon: string; metric: SkillMetric | null; cat: CatId }[] = [
  { name: "Rubik's cube", icon: "🧊", metric: { name: "Best solve", kind: "time", unit: "" }, cat: "mind" },
  { name: "Chess", icon: "♟️", metric: { name: "Rating", kind: "higher", unit: "elo" }, cat: "mind" },
  { name: "Guitar", icon: "🎸", metric: null, cat: "personal" },
  { name: "Typing", icon: "⌨️", metric: { name: "Speed", kind: "higher", unit: "wpm" }, cat: "mind" },
  { name: "Language", icon: "🗣️", metric: { name: "Words known", kind: "higher", unit: "words" }, cat: "mind" },
  { name: "Drawing", icon: "✏️", metric: null, cat: "personal" },
];
