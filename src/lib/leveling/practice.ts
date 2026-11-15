/* Skills: things the player chooses to level up (Rubik's cube, chess, guitar…).
   Practice time pays XP and builds the skill's own level; an optional result
   (solve time, rating, score) is tracked with personal bests and a goal. */
import { PRACTICE } from "./config.js";
import { daysAgoKey, dkey, weekStart } from "./dates.js";
import { CAT, levelOf } from "./xp.js";
import type { CatId, ChessGame, MetricKind, PracticeLog, Pursuit, SkillMetric, Standard, Tier } from "./types.js";

export const METRIC_KINDS: { id: MetricKind; label: string }[] = [
  { id: "time", label: "Time · lower is better" },
  { id: "higher", label: "Number · higher is better" },
  { id: "lower", label: "Number · lower is better" },
  { id: "level", label: "Grade or level (from the standard)" },
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
  if (kind === "level") {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
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

/** A result in the metric's own format. Levels show the matching grade name from the standard. */
export function fmtValue(v: number | null | undefined, metric: SkillMetric | null, standard?: Standard | null): string {
  if (v == null || !metric) return "—";
  if (metric.kind === "time") return fmtTime(v);
  if (metric.kind === "level") return standard?.tiers.find((t) => t.value === v)?.name || `Level ${v}`;
  const n = Number.isInteger(v) ? v.toLocaleString("en-ZA").replace(/[,\s]/g, " ") : String(round2(v));
  return metric.unit ? `${n} ${metric.unit}` : n;
}

/** True if result a beats result b under this metric. */
export const beats = (a: number, b: number, kind: MetricKind) => (kind === "higher" || kind === "level" ? a > b : a < b);

/** Anything that carries a result: a practice log, or a game with your rating after it. */
export interface ResultPoint {
  id: string;
  date: string;
  created: number;
  value: number | null;
}

/** A skill's games as result points: your rating after each game. */
export const gamePoints = (games: ChessGame[] | undefined, skillId: string): ResultPoint[] =>
  (games || []).filter((g) => g.skill === skillId && g.myRating != null).map((g) => ({ id: g.id, date: g.date, created: g.created, value: g.myRating }));

/** Best result logged for a skill, optionally ignoring one log (the one being edited). */
export function bestOf(logs: ResultPoint[], metric: SkillMetric | null, excludeId?: string): { value: number; date: string; id: string } | null {
  if (!metric) return null;
  let best: ResultPoint | null = null;
  for (const l of logs) {
    if (l.id === excludeId || l.value == null) continue;
    if (!best || beats(l.value, best.value!, metric.kind) || (l.value === best.value && l.date < best.date)) best = l;
  }
  return best ? { value: best.value!, date: best.date, id: best.id } : null;
}

/** A result is a PB if it beats every other logged result. The very first result is the baseline, not a PB. */
export function isPb(value: number | null, logs: ResultPoint[], metric: SkillMetric | null, excludeId?: string): boolean {
  if (value == null || !metric) return false;
  const best = bestOf(logs, metric, excludeId);
  return !!best && beats(value, best.value, metric.kind);
}

/** Has the result reached the goal? */
export function goalMet(value: number | null | undefined, p: Pursuit): boolean {
  if (value == null || p.goal == null || !p.metric) return false;
  return reaches(value, p.goal, p.metric.kind);
}

/** Has a result reached a threshold, under this metric? */
export const reaches = (value: number, at: number, kind: MetricKind) => (kind === "higher" || kind === "level" ? value >= at : value <= at);

export interface StandardStatus {
  /** Hardest tier reached. */
  current: Tier | null;
  next: Tier | null;
  /** Index of the current tier, -1 if none. */
  index: number;
}

/** Where a result sits on the skill's standard. */
export function standardStatus(p: Pursuit, best: number | null | undefined): StandardStatus {
  const tiers = p.standard?.tiers || [];
  if (!p.metric || !tiers.length) return { current: null, next: null, index: -1 };
  let index = -1;
  if (best != null) tiers.forEach((t, i) => { if (reaches(best, t.value, p.metric!.kind)) index = i; });
  return { current: index >= 0 ? tiers[index] : null, next: tiers[index + 1] || null, index };
}

/** "Name = value" lines -> tiers, easiest first. For levels the value is optional and defaults to the line number. */
export function parseLadder(text: string, kind: MetricKind): Tier[] {
  const out: Tier[] = [];
  String(text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 20).forEach((line, i) => {
    const m = line.match(/^(.*?)\s*=\s*(.+)$/);
    const name = (kind === "level" && !m ? line : m?.[1] || "").trim().slice(0, 40);
    const value = kind === "level" ? (m ? parseValue(m[2], "level") : i + 1) : m ? parseValue(m[2], kind) : null;
    if (name && value != null) out.push({ name, value });
  });
  // Easiest first: ascending for higher-is-better, descending for lower-is-better.
  const up = kind === "higher" || kind === "level";
  return out.sort((a, b) => (up ? a.value - b.value : b.value - a.value));
}

/** Tiers back to editable lines. */
export const ladderText = (s: Standard | null | undefined, kind: MetricKind) =>
  (s?.tiers || []).map((t) => `${t.name} = ${kind === "time" ? fmtTime(t.value).replace(/s$/, "") : t.value}`).join("\n");

/**
 * WCA average of the last n solves: drop the best and the worst, mean the rest.
 * A DNF (null) counts as the worst; two or more DNFs make the average a DNF (null).
 * Returns undefined if there aren't n solves yet.
 */
export function wcaAverage(solves: (number | null)[], n = 5): number | null | undefined {
  if (solves.length < n) return undefined;
  const last = solves.slice(-n);
  const dnf = last.filter((x) => x == null).length;
  if (dnf >= 2) return null;
  const ok = (last.filter((x) => x != null) as number[]).sort((a, b) => a - b);
  const kept = dnf ? ok.slice(1) : ok.slice(1, -1);
  return round2(kept.reduce((s, x) => s + x, 0) / kept.length);
}

/** Best average of n over every run of n consecutive solves. */
export function bestAverage(solves: (number | null)[], n = 5): number | null {
  let best: number | null = null;
  for (let i = n; i <= solves.length; i++) {
    const a = wcaAverage(solves.slice(i - n, i), n);
    if (a != null && (best == null || a < best)) best = a;
  }
  return best;
}

/**
 * A 3x3 scramble in WCA notation: 20 random moves, never the same face twice in a row
 * and never three moves on one axis in a row. (Official WCA scrambles are random-state;
 * this is the usual practice approximation.)
 */
export function scramble333(rand: () => number = Math.random, len = 20): string {
  const faces = ["U", "D", "R", "L", "F", "B"];
  const axis = (f: string) => "UDRLFB".indexOf(f) >> 1;
  const mods = ["", "'", "2"];
  const out: string[] = [];
  while (out.length < len) {
    const f = faces[Math.floor(rand() * 6)];
    const a = out[out.length - 1]?.[0];
    const b = out[out.length - 2]?.[0];
    if (f === a) continue;
    if (a && b && axis(f) === axis(a) && axis(a) === axis(b)) continue;
    out.push(f + mods[Math.floor(rand() * 3)]);
  }
  return out.join(" ");
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
export function skillSummary(p: Pursuit, all: PracticeLog[], now: Date = new Date(), games?: ChessGame[]): SkillSummary {
  const logs = all.filter((l) => l.skill === p.id);
  const points: ResultPoint[] = [...logs, ...gamePoints(games, p.id)];
  const xp = logs.reduce((s, l) => s + (Number(l.xp) || 0), 0);
  const L = levelOf(xp, PRACTICE.levelBase);
  const totalMins = logs.reduce((s, l) => s + (Number(l.mins) || 0), 0);
  const ws = weekStart(now);
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  const best = bestOf(points, p.metric);
  const pts = [...points].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
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
    series: p.metric ? pts.filter((l) => l.value != null).map((l) => ({ date: l.date, value: l.value! })) : [],
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
  const kind: MetricKind = m && (["time", "higher", "lower", "level"] as MetricKind[]).includes(m.kind) ? m.kind : "higher";
  const metric: SkillMetric | null =
    m && String(m.name || "").trim() ? { name: String(m.name).trim().slice(0, 40), kind, unit: kind === "time" || kind === "level" ? "" : String(m.unit || "").trim().slice(0, 12) } : null;
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
    standard: metric ? normalizeStandard(raw.standard, kind) : null,
    cube: !!raw.cube && kind === "time",
    games: !!raw.games,
    ...(raw.cube && kind === "time" ? { event: String(raw.event || "333").slice(0, 8) } : {}),
    ...(raw.u ? { u: raw.u } : {}),
  };
}

function normalizeStandard(raw: unknown, kind: MetricKind): Standard | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<Standard>;
  const up = kind === "higher" || kind === "level";
  const tiers = (Array.isArray(s.tiers) ? s.tiers : [])
    .map((t) => ({ name: String(t?.name || "").trim().slice(0, 40), value: Number(t?.value) }))
    .filter((t) => t.name && Number.isFinite(t.value) && t.value > 0)
    .slice(0, 20)
    .sort((a, b) => (up ? a.value - b.value : b.value - a.value));
  if (!tiers.length) return null;
  return { name: String(s.name || "Standard").trim().slice(0, 60) || "Standard", note: String(s.note || "").trim().slice(0, 240), tiers };
}

/** Ideas offered when adding a skill. Picking one fills the form; everything stays editable. */
export interface SkillPreset {
  name: string;
  icon: string;
  metric: SkillMetric | null;
  cat: CatId;
  standard: Standard | null;
  cube?: boolean;
  event?: string;
  games?: boolean;
}

/** Ideas offered when adding a skill, each with the recognised standard it's ranked against. Everything stays editable. */
export const SKILL_PRESETS: SkillPreset[] = [
  {
    name: "Rubik's cube",
    icon: "🧊",
    metric: { name: "Best single", kind: "time", unit: "" },
    cat: "mind",
    cube: true,
    event: "333",
    standard: {
      name: "WCA 3x3x3",
      note: "World Cube Association rules, as used at CubingZA competitions in South Africa. Cubers rank themselves by sub-X singles; the WCA also ranks the average of 5.",
      tiers: [
        { name: "Sub-2:00", value: 120 },
        { name: "Sub-1:00", value: 60 },
        { name: "Sub-40", value: 40 },
        { name: "Sub-30", value: 30 },
        { name: "Sub-20", value: 20 },
        { name: "Sub-15", value: 15 },
        { name: "Sub-10", value: 10 },
        { name: "SA record (4.82)", value: 4.82 },
      ],
    },
  },
  {
    name: "Chess",
    icon: "♟️",
    metric: { name: "Rating", kind: "higher", unit: "elo" },
    cat: "mind",
    games: true,
    standard: {
      name: "Chess SA rating (Elo)",
      note: "Chess South Africa runs the national Elo rating. The top rungs are the ratings FIDE needs for its titles; the titles also need norms from rated events.",
      tiers: [
        { name: "Beginner", value: 800 },
        { name: "Club player", value: 1200 },
        { name: "Strong club player", value: 1600 },
        { name: "Expert", value: 2000 },
        { name: "Candidate Master level", value: 2200 },
        { name: "FIDE Master level", value: 2300 },
        { name: "International Master level", value: 2400 },
        { name: "Grandmaster level", value: 2500 },
      ],
    },
  },
  {
    name: "Guitar",
    icon: "🎸",
    metric: { name: "Grade passed", kind: "level", unit: "" },
    cat: "personal",
    standard: {
      name: "UNISA music grades",
      note: "The University of South Africa's Directorate Music exams, Pre-grade 1 to Grade 8. Grade 8 is the highest graded qualification.",
      tiers: ["Pre-grade 1", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8"].map((name, i) => ({ name, value: i + 1 })),
    },
  },
  {
    name: "Language",
    icon: "🗣️",
    metric: { name: "CEFR level", kind: "level", unit: "" },
    cat: "mind",
    standard: {
      name: "CEFR",
      note: "The Common European Framework of Reference, the scale most language courses and tests report against.",
      tiers: [
        { name: "A1 Beginner", value: 1 },
        { name: "A2 Elementary", value: 2 },
        { name: "B1 Intermediate", value: 3 },
        { name: "B2 Upper intermediate", value: 4 },
        { name: "C1 Advanced", value: 5 },
        { name: "C2 Proficient", value: 6 },
      ],
    },
  },
  {
    name: "Typing",
    icon: "⌨️",
    metric: { name: "Speed", kind: "higher", unit: "wpm" },
    cat: "mind",
    standard: {
      name: "Typing speed benchmarks",
      note: "There's no national body for typing, so these are the usual benchmarks on typing tests.",
      tiers: [
        { name: "Average typist", value: 40 },
        { name: "Fast", value: 60 },
        { name: "Professional", value: 80 },
        { name: "Elite", value: 100 },
        { name: "Competitive", value: 130 },
      ],
    },
  },
  { name: "Drawing", icon: "✏️", metric: null, cat: "personal", standard: null },
];
