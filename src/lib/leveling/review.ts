/* Weekly review of the daily rhythm. Information only: counts, times and trends,
   with no judgement and no advice. */
import { RHYTHM, hmToMins, minsToHm } from "./config.js";
import { daysAgoKey, dkey, parseD } from "./dates.js";
import { debriefDone } from "./debrief.js";
import { morningStatus, wakeTimeFor } from "./rhythm.js";
import type { DailyRecord, RhythmDay } from "./types.js";

const R = RHYTHM.review;

/** The review window: the last seven dates, oldest first, ending today. */
export const reviewDates = (now: Date = new Date()): string[] =>
  Array.from({ length: R.days }, (_, i) => daysAgoKey(R.days - 1 - i, now));

export type DayMark = "full" | "low" | "missed" | "open" | "none";

/** One mark per day. "open" is today, still in progress; "none" is before the rhythm was first used. */
export function morningMarks(days: RhythmDay[], now: Date = new Date()): DayMark[] {
  const by = new Map(days.map((d) => [d.date, d]));
  const first = [...by.keys()].sort()[0];
  const today = dkey(now);
  return reviewDates(now).map((k) => {
    const st = morningStatus(by.get(k));
    if (st !== "open") return st;
    if (!first || k < first) return "none";
    return k === today ? "open" : "missed";
  });
}

export const countMarks = (marks: DayMark[]) => ({
  full: marks.filter((m) => m === "full").length,
  low: marks.filter((m) => m === "low").length,
  missed: marks.filter((m) => m === "missed").length,
});

export function debriefCount(days: RhythmDay[], now: Date = new Date()): number {
  const set = new Set(reviewDates(now));
  return days.filter((d) => set.has(d.date) && debriefDone(d)).length;
}

export interface FirstTaps {
  /** "HH:MM" of the first morning tap for each review day, or null. */
  taps: (string | null)[];
  /** Minutes after (+) or before (-) that day's wake time. */
  offsets: (number | null)[];
  avg: string | null;
  avgOffset: number | null;
  wake: string;
}

export function firstTaps(days: RhythmDay[], now: Date = new Date()): FirstTaps {
  const by = new Map(days.map((d) => [d.date, d]));
  const mins: (number | null)[] = [];
  const offsets: (number | null)[] = [];
  for (const k of reviewDates(now)) {
    const d = by.get(k);
    const times = Object.values(d?.morning.steps || {});
    if (!d || !times.length) {
      mins.push(null);
      offsets.push(null);
      continue;
    }
    const t = new Date(Math.min(...times));
    const m = Math.round((t.getTime() - parseD(k).getTime()) / 60000);
    mins.push(m);
    offsets.push(m - hmToMins(wakeTimeFor(d.plan)));
  }
  const mean = (a: (number | null)[]) => {
    const v = a.filter((x): x is number => x != null);
    return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
  };
  const avg = mean(mins);
  return { taps: mins.map((m) => (m == null ? null : minsToHm(m))), offsets, avg: avg == null ? null : minsToHm(avg), avgOffset: mean(offsets), wake: RHYTHM.wakeTime };
}

export type Metric = "sleepHours" | "mood" | "energy" | "irritability" | "focus";
export const METRICS: { id: Metric; label: string; unit: string }[] = [
  { id: "sleepHours", label: "Sleep", unit: "h" },
  { id: "mood", label: "Mood", unit: "" },
  { id: "energy", label: "Energy", unit: "" },
  { id: "irritability", label: "Irritability", unit: "" },
  { id: "focus", label: "Focus", unit: "" },
];

const num = (r: DailyRecord | undefined, m: Metric): number | null => (r && typeof r[m] === "number" ? (r[m] as number) : null);

export interface Trend {
  id: Metric;
  label: string;
  unit: string;
  /** One value per review day, oldest first. */
  values: (number | null)[];
  /** Average over the four weeks before the window, or null with too little data. */
  baseline: number | null;
}

/** Baseline for a metric: the mean over the days before the review window. */
function baseline(by: Map<string, RhythmDay>, m: Metric, now: Date): number | null {
  const v: number[] = [];
  for (let i = R.days; i < R.days + R.baselineDays; i++) {
    const x = num(by.get(daysAgoKey(i, now))?.record, m);
    if (x != null) v.push(x);
  }
  return v.length >= R.minBaselineDays ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

export function trends(days: RhythmDay[], now: Date = new Date()): Trend[] {
  const by = new Map(days.map((d) => [d.date, d]));
  const dates = reviewDates(now);
  return METRICS.map((m) => ({ ...m, values: dates.map((k) => num(by.get(k)?.record, m.id)), baseline: baseline(by, m.id, now) }));
}

/**
 * True when this week departs from the usual pattern in one of two ways: several short-sleep
 * nights alongside raised energy or mood, or several low-mood days. It only reports the change.
 */
export function patternFlag(days: RhythmDay[], now: Date = new Date()): boolean {
  const t = Object.fromEntries(trends(days, now).map((x) => [x.id, x])) as Record<Metric, Trend>;
  const { sleepHours: sleep, mood, energy } = t;
  if (mood.baseline != null) {
    const low = mood.values.filter((v) => v != null && v <= mood.baseline! - R.ratingDelta).length;
    if (low >= R.lowMoodDays) return true;
  }
  if (sleep.baseline == null) return false;
  const short = sleep.values.map((v) => v != null && v <= sleep.baseline! - R.sleepHoursDelta);
  if (short.filter(Boolean).length < R.shortSleepNights) return false;
  const raised = (x: Trend) => {
    if (x.baseline == null) return false;
    const v = x.values.filter((val, i): val is number => short[i] && val != null);
    return v.length > 0 && v.reduce((s, a) => s + a, 0) / v.length >= x.baseline + R.ratingDelta;
  };
  return raised(energy) || raised(mood);
}

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The whole record as CSV, oldest day first, for taking to an appointment. */
export function recordCsv(days: RhythmDay[]): string {
  const head = ["date", "sleep_hours", "sleep_quality", "mood", "energy", "irritability", "focus", "note", "morning", "first_tap", "debrief"];
  const rows = [...days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => {
      const r = d.record || {};
      const times = Object.values(d.morning.steps);
      const tap = times.length ? minsToHm(Math.round((Math.min(...times) - parseD(d.date).getTime()) / 60000)) : "";
      const ms = morningStatus(d);
      return [d.date, r.sleepHours, r.sleepQuality, r.mood, r.energy, r.irritability, r.focus, r.note, ms === "open" ? "" : ms === "low" ? "low day" : "full", tap, debriefDone(d) ? "yes" : ""].map(cell).join(",");
    });
  return [head.join(","), ...rows].join("\n") + "\n";
}
