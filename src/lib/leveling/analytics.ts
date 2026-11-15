/* Analytics for skills: solve history for cubes, and game records for chess. Pure functions. */
import { PRACTICE } from "./config.js";
import { bestMean3, mean3 } from "./cubes.js";
import { bestAverage, wcaAverage } from "./practice.js";
import { daysAgoKey, parseD, weekStart } from "./dates.js";
import type { ChessGame, GameResult, PracticeLog, TimeControl } from "./types.js";

/* ---------- solves ---------- */

export interface SolvePoint {
  /** Position across every solve ever, from 0. */
  i: number;
  date: string;
  /** Seconds, or null for a DNF. */
  t: number | null;
  session: string;
}

/** Every timed solve in date order. Manual logs with a result count as one solve each. */
export function solveHistory(logs: PracticeLog[]): SolvePoint[] {
  const out: SolvePoint[] = [];
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  for (const l of sorted) {
    const ts = l.solves?.length ? l.solves : l.value != null ? [l.value] : [];
    for (const t of ts) out.push({ i: out.length, date: l.date, t, session: l.id });
  }
  return out;
}

/** The average at every position (undefined until there are enough solves). */
export function rollingAverage(times: (number | null)[], n: number, mo3 = false): (number | null | undefined)[] {
  return times.map((_, i) => (mo3 && n === 3 ? mean3(times.slice(Math.max(0, i - 2), i + 1)) : wcaAverage(times.slice(Math.max(0, i + 1 - n), i + 1), n)));
}

/** Best single so far at every position (a falling staircase). */
export function bestSoFar(times: (number | null)[]): (number | null)[] {
  let b: number | null = null;
  return times.map((t) => (t != null && (b == null || t < b) ? (b = t) : b));
}

export interface Window {
  solves: number;
  best: number | null;
  /** The event's ranked average (ao5 or mo3) over the window, best run. */
  avg: number | null;
  /** Average of 12 over the window, best run. */
  ao12: number | null;
  mean: number | null;
  dnfRate: number;
}

function windowStats(times: (number | null)[], mo3: boolean): Window {
  const ok = times.filter((t) => t != null) as number[];
  return {
    solves: times.length,
    best: ok.length ? Math.min(...ok) : null,
    avg: mo3 ? bestMean3(times) : bestAverage(times, 5),
    ao12: bestAverage(times, 12),
    mean: ok.length ? Math.round((ok.reduce((s, x) => s + x, 0) / ok.length) * 100) / 100 : null,
    dnfRate: times.length ? (times.length - ok.length) / times.length : 0,
  };
}

export interface CubeAnalytics {
  total: number;
  /** Your first 12 solves ever. */
  then: Window;
  /** Your latest 12 solves. */
  now: Window;
  /** The 12 solves before 30 days ago, if any. */
  monthAgo: Window | null;
  allTime: Window;
  last7: Window;
  prev7: Window;
  /** Improvement in mean from then to now, as a share (0.25 = 25% faster). */
  improvement: number | null;
  /** Solve times bucketed for a histogram over the latest 100 solves. */
  histogram: { from: number; to: number; n: number }[];
  sessions: { id: string; date: string; solves: number; best: number | null; avg: number | null; mean: number | null }[];
}

export function cubeAnalytics(logs: PracticeLog[], mo3 = false, now: Date = new Date()): CubeAnalytics {
  const pts = solveHistory(logs);
  const times = pts.map((p) => p.t);
  const W = (ts: (number | null)[]) => windowStats(ts, mo3);
  const d30 = daysAgoKey(30, now);
  const before30 = pts.filter((p) => p.date < d30).map((p) => p.t);
  const d7 = daysAgoKey(7, now);
  const d14 = daysAgoKey(14, now);
  const then = W(times.slice(0, 12));
  const nowW = W(times.slice(-12));
  const recent = (times.slice(-100).filter((t) => t != null) as number[]).sort((a, b) => a - b);
  let histogram: CubeAnalytics["histogram"] = [];
  if (recent.length >= 3) {
    // Trim the slowest 5% so one disaster doesn't flatten the chart.
    const lo = recent[0];
    const hi = recent[Math.max(0, Math.ceil(recent.length * 0.95) - 1)];
    const bins = 10;
    const step = Math.max(0.01, (hi - lo) / bins);
    histogram = Array.from({ length: bins }, (_, k) => ({ from: lo + k * step, to: lo + (k + 1) * step, n: 0 }));
    for (const t of recent) histogram[Math.min(bins - 1, Math.floor((t - lo) / step))].n++;
  }
  const bySession = new Map<string, SolvePoint[]>();
  for (const p of pts) bySession.set(p.session, [...(bySession.get(p.session) || []), p]);
  const sessions = [...bySession.entries()]
    .map(([id, ps]) => {
      const w = W(ps.map((p) => p.t));
      return { id, date: ps[0].date, solves: ps.length, best: w.best, avg: w.avg, mean: w.mean };
    })
    .reverse();
  return {
    total: pts.length,
    then,
    now: nowW,
    monthAgo: before30.length ? W(before30.slice(-12)) : null,
    allTime: W(times),
    last7: W(pts.filter((p) => p.date >= d7).map((p) => p.t)),
    prev7: W(pts.filter((p) => p.date >= d14 && p.date < d7).map((p) => p.t)),
    improvement: pts.length > 12 && then.mean && nowW.mean ? (then.mean - nowW.mean) / then.mean : null,
    histogram,
    sessions,
  };
}

/* ---------- practice time ---------- */

/** Practice minutes per week for the last n weeks, oldest first. */
export function weeklyMinutes(logs: PracticeLog[], weeks = 12, now: Date = new Date()): { week: string; mins: number }[] {
  const out: { week: string; mins: number }[] = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const d = parseD(weekStart(now));
    d.setDate(d.getDate() - 7 * k);
    const ws = weekStart(d);
    const end = new Date(d);
    end.setDate(end.getDate() + 7);
    const we = weekStart(end);
    out.push({ week: ws, mins: logs.filter((l) => l.date >= ws && l.date < we).reduce((s, l) => s + (+l.mins || 0), 0) });
  }
  return out;
}

/* ---------- chess games ---------- */

export const RESULT_SCORE: Record<GameResult, number> = { win: 1, draw: 0.5, loss: 0 };
export const CONTROLS: { id: TimeControl; label: string }[] = [
  { id: "classical", label: "Classical" },
  { id: "rapid", label: "Rapid" },
  { id: "blitz", label: "Blitz" },
  { id: "bullet", label: "Bullet" },
  { id: "daily", label: "Daily / correspondence" },
];

/** Elo expected score against an opponent. */
export const expectedScore = (me: number, opp: number) => 1 / (1 + Math.pow(10, (opp - me) / 400));

/** XP for a logged game: a flat amount, plus more for writing a review. The result doesn't matter. */
export function gameXp(g: Pick<ChessGame, "keyMoment" | "lesson">): number {
  return PRACTICE.gameXp + ((g.keyMoment || "").trim() || (g.lesson || "").trim() ? PRACTICE.reviewXp : 0);
}

export interface Record3 {
  games: number;
  win: number;
  draw: number;
  loss: number;
  /** Points scored / games, 0..1. */
  score: number;
}

const record = (gs: ChessGame[]): Record3 => {
  const win = gs.filter((g) => g.result === "win").length;
  const draw = gs.filter((g) => g.result === "draw").length;
  const loss = gs.filter((g) => g.result === "loss").length;
  return { games: gs.length, win, draw, loss, score: gs.length ? (win + draw / 2) / gs.length : 0 };
};

export interface ChessAnalytics {
  all: Record3;
  white: Record3;
  black: Record3;
  byControl: { id: TimeControl; label: string; rec: Record3 }[];
  last10: Record3;
  /** Linear performance rating over games with a known opponent rating: avg opponent + 400 × (W − L) / N. */
  performance: number | null;
  /** Your score against what Elo expected, over games where both ratings are known. +1.5 means 1.5 points more than expected. */
  vsExpected: { games: number; actual: number; expected: number } | null;
  rating: { date: string; value: number }[];
  peak: number | null;
  current: number | null;
  /** Rating change over the last 30 days. */
  change30: number | null;
  accuracy: { date: string; value: number }[];
  avgAccuracy: number | null;
  /** Blunders / mistakes / inaccuracies per reviewed game. */
  errors: { blunders: number; mistakes: number; inaccuracies: number; games: number } | null;
  openings: { name: string; rec: Record3 }[];
  reviewed: number;
  lessons: { date: string; text: string; id: string }[];
  /** Current streak of games without a loss. */
  unbeaten: number;
}

export function chessAnalytics(games: ChessGame[], ratingLogs: { date: string; value: number }[] = [], now: Date = new Date()): ChessAnalytics {
  const gs = [...games].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  const withOpp = gs.filter((g) => g.oppRating != null);
  const performance = withOpp.length
    ? Math.round(withOpp.reduce((s, g) => s + g.oppRating!, 0) / withOpp.length + (400 * (withOpp.filter((g) => g.result === "win").length - withOpp.filter((g) => g.result === "loss").length)) / withOpp.length)
    : null;
  // Expected score uses your rating going into each game: the last known rating before it.
  let known: number | null = null;
  const pts = [...ratingLogs, ...gs.filter((g) => g.myRating != null).map((g) => ({ date: g.date, value: g.myRating! }))].sort((a, b) => a.date.localeCompare(b.date));
  let actual = 0;
  let expected = 0;
  let n = 0;
  for (const g of gs) {
    const before = [...pts].reverse().find((p) => p.date < g.date)?.value ?? known;
    if (before != null && g.oppRating != null) {
      actual += RESULT_SCORE[g.result];
      expected += expectedScore(before, g.oppRating);
      n++;
    }
    if (g.myRating != null) known = g.myRating;
  }
  const d30 = daysAgoKey(30, now);
  const current = pts.length ? pts[pts.length - 1].value : null;
  const base30 = [...pts].reverse().find((p) => p.date < d30)?.value ?? (pts.length ? pts[0].value : null);
  const acc = gs.filter((g) => g.accuracy != null).map((g) => ({ date: g.date, value: g.accuracy! }));
  const errG = gs.filter((g) => g.blunders != null || g.mistakes != null || g.inaccuracies != null);
  const byOpening = new Map<string, ChessGame[]>();
  for (const g of gs) {
    const k = g.opening.trim();
    if (k) byOpening.set(k, [...(byOpening.get(k) || []), g]);
  }
  let unbeaten = 0;
  for (const g of [...gs].reverse()) {
    if (g.result === "loss") break;
    unbeaten++;
  }
  return {
    all: record(gs),
    white: record(gs.filter((g) => g.colour === "white")),
    black: record(gs.filter((g) => g.colour === "black")),
    byControl: CONTROLS.map((c) => ({ ...c, rec: record(gs.filter((g) => g.control === c.id)) })).filter((x) => x.rec.games),
    last10: record(gs.slice(-10)),
    performance,
    vsExpected: n ? { games: n, actual, expected: Math.round(expected * 10) / 10 } : null,
    rating: pts,
    peak: pts.length ? Math.max(...pts.map((p) => p.value)) : null,
    current,
    change30: current != null && base30 != null && pts.length > 1 ? current - base30 : null,
    accuracy: acc,
    avgAccuracy: acc.length ? Math.round((acc.reduce((s, a) => s + a.value, 0) / acc.length) * 10) / 10 : null,
    errors: errG.length
      ? {
          games: errG.length,
          blunders: Math.round((errG.reduce((s, g) => s + (g.blunders || 0), 0) / errG.length) * 10) / 10,
          mistakes: Math.round((errG.reduce((s, g) => s + (g.mistakes || 0), 0) / errG.length) * 10) / 10,
          inaccuracies: Math.round((errG.reduce((s, g) => s + (g.inaccuracies || 0), 0) / errG.length) * 10) / 10,
        }
      : null,
    openings: [...byOpening.entries()].map(([name, list]) => ({ name, rec: record(list) })).sort((a, b) => b.rec.games - a.rec.games).slice(0, 8),
    reviewed: gs.filter((g) => g.keyMoment.trim() || g.lesson.trim()).length,
    lessons: gs.filter((g) => g.lesson.trim()).map((g) => ({ date: g.date, text: g.lesson.trim(), id: g.id })).reverse().slice(0, 8),
    unbeaten,
  };
}

/** Clean a game from storage or the form. */
export function normalizeGame(raw: Partial<ChessGame> & { id: string; skill: string }, now = Date.now()): ChessGame {
  const num = (v: unknown, lo: number, hi: number) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.min(hi, Math.max(lo, Number(v))));
  const txt = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
  return {
    id: raw.id,
    skill: raw.skill,
    date: txt(raw.date, 10) || new Date(now).toISOString().slice(0, 10),
    created: Number(raw.created) || now,
    result: raw.result === "win" || raw.result === "draw" ? raw.result : "loss",
    colour: raw.colour === "white" || raw.colour === "black" ? raw.colour : null,
    opponent: txt(raw.opponent, 60),
    oppRating: num(raw.oppRating, 100, 3500),
    myRating: num(raw.myRating, 100, 3500),
    control: CONTROLS.some((c) => c.id === raw.control) ? raw.control! : "rapid",
    rated: raw.rated !== false,
    opening: txt(raw.opening, 60),
    accuracy: num(raw.accuracy, 0, 100),
    blunders: num(raw.blunders, 0, 99),
    mistakes: num(raw.mistakes, 0, 99),
    inaccuracies: num(raw.inaccuracies, 0, 99),
    keyMoment: txt(raw.keyMoment, 400),
    lesson: txt(raw.lesson, 400),
    selfRating: num(raw.selfRating, 1, 5),
    link: txt(raw.link, 300),
    xp: Number(raw.xp) || 0,
    ...(raw.u ? { u: raw.u } : {}),
  };
}
