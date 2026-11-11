/* Focus Sessions: three work slots, each followed by a break worth half the work actually done.
   Pure logic. Every duration comes from stored timestamps and `now`, never from counting ticks,
   so a backgrounded tab or a locked screen can't make the clock drift. Numbers live in config.ts. */
import { SESSION } from "./config.js";
import { daysAgoKey, dkey, parseD, weekStart } from "./dates.js";
import type { EarlyBreak, FocusPrefs, FocusRun, FocusSlot } from "./types.js";

/* ---------- settings and labels ---------- */

export const cleanLabel = (raw: unknown, fallback: string): string => {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, SESSION.maxLabel) : "";
  return s || fallback;
};

const fallbackLabel = (i: number) => SESSION.defaultLabels[i] ?? "Focus";

export const normLabels = (raw: unknown): string[] =>
  Array.from({ length: SESSION.slots }, (_, i) => cleanLabel(Array.isArray(raw) ? raw[i] : "", fallbackLabel(i)));

export function normalizeFocusPrefs(raw: unknown): FocusPrefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<FocusPrefs>;
  const [lo, hi] = SESSION.workMinRange;
  const wm = Math.round(Number(p.workMin));
  return {
    workMin: Number.isFinite(wm) ? Math.min(hi, Math.max(lo, wm)) : SESSION.workMin,
    earlyBreak: p.earlyBreak === "minimum" || p.earlyBreak === "shorten" ? p.earlyBreak : SESSION.earlyBreak,
    labels: normLabels(p.labels),
  };
}

/** A stored run, checked field by field. Anything malformed means "no run". */
export function normalizeRun(raw: unknown): FocusRun | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<FocusRun>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const stage = r.stage === "work" || r.stage === "break" || r.stage === "summary" ? r.stage : null;
  const id = typeof r.id === "string" && r.id ? r.id : null;
  const startedAt = n(r.startedAt);
  const workMs = n(r.workMs);
  const stageStart = n(r.stageStart);
  const slot = n(r.slot);
  if (!stage || !id || startedAt === null || workMs === null || stageStart === null || slot === null) return null;
  if (slot < 0 || slot >= SESSION.slots || workMs < 60_000) return null;
  const ids = Array.isArray(r.slotIds) ? r.slotIds : [];
  const out: FocusRun = {
    id,
    startedAt,
    workMs,
    earlyBreak: r.earlyBreak === "minimum" ? "minimum" : "shorten",
    labels: normLabels(r.labels),
    slot: Math.floor(slot),
    stage,
    stageStart,
    pausedMs: Math.max(0, n(r.pausedMs) ?? 0),
    breakMs: Math.max(0, n(r.breakMs) ?? 0),
    slotIds: Array.from({ length: SESSION.slots }, (_, i) => (typeof ids[i] === "string" ? (ids[i] as string) : null)),
    alerted: Array.isArray(r.alerted) ? r.alerted.filter((k): k is string => typeof k === "string").slice(0, 16) : [],
    bonusXp: Math.max(0, n(r.bonusXp) ?? 0),
  };
  const pausedAt = n(r.pausedAt);
  if (pausedAt !== null && stage !== "summary") out.pausedAt = pausedAt;
  const endedAt = n(r.endedAt);
  if (endedAt !== null) out.endedAt = endedAt;
  return out;
}

/* ---------- breaks ---------- */

export const roundTo = (ms: number, step: number = SESSION.roundMs): number => Math.round(ms / step) * step;

/**
 * The break for a slot: half the work actually done, to the nearest 30 s.
 * Overtime therefore earns extra break. An early finish shortens it in proportion,
 * unless the setting keeps the planned break as a minimum.
 */
export function computeBreak(actualMs: number, plannedMs: number, earlyBreak: EarlyBreak): number {
  const earned = roundTo(Math.max(0, actualMs) * SESSION.breakRatio);
  const planned = roundTo(plannedMs * SESSION.breakRatio);
  return earlyBreak === "minimum" ? Math.max(planned, earned) : earned;
}

/* ---------- clock ---------- */

export const isPaused = (run: FocusRun): boolean => run.pausedAt !== undefined;

/** Time spent in the current stage, not counting pauses. */
export const elapsedMs = (run: FocusRun, now: number): number =>
  Math.max(0, (run.pausedAt ?? now) - run.stageStart - run.pausedMs);

export type Phase = "work" | "overtime" | "break" | "breakover" | "summary";

export interface PhaseView {
  phase: Phase;
  /** The label to show: Work, Overtime, Break, Break over, Done. */
  label: string;
  paused: boolean;
  elapsedMs: number;
  /** Length of the block being counted (work or break). */
  targetMs: number;
  /** Counting down: time left. Zero in overtime and after a break. */
  remainingMs: number;
  /** Counting up past the target. */
  overMs: number;
}

export function phaseOf(run: FocusRun, now: number): PhaseView {
  const el = elapsedMs(run, now);
  const paused = isPaused(run);
  if (run.stage === "summary") return { phase: "summary", label: "Done", paused: false, elapsedMs: el, targetMs: 0, remainingMs: 0, overMs: 0 };
  const target = run.stage === "work" ? run.workMs : run.breakMs;
  const over = Math.max(0, el - target);
  const phase: Phase = run.stage === "work" ? (el < target ? "work" : "overtime") : el < target ? "break" : "breakover";
  const label = { work: "Work", overtime: "Overtime", break: "Break", breakover: "Break over", summary: "Done" }[phase];
  return { phase, label, paused, elapsedMs: el, targetMs: target, remainingMs: Math.max(0, target - el), overMs: over };
}

/** m:ss, or h:mm:ss from an hour up. Countdowns round up so they read 0:00 only when truly done. */
export function fmtClock(ms: number, round: "floor" | "ceil" = "floor"): string {
  const s = Math.max(0, round === "ceil" ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Durations for totals: "45s", "42 min", "1h 20m". */
export function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/* ---------- running a session ---------- */

export function startRun(id: string, labels: string[], prefs: Pick<FocusPrefs, "workMin" | "earlyBreak">, now: number): FocusRun {
  return {
    id,
    startedAt: now,
    workMs: Math.round(prefs.workMin * 60_000),
    earlyBreak: prefs.earlyBreak,
    labels: normLabels(labels),
    slot: 0,
    stage: "work",
    stageStart: now,
    pausedMs: 0,
    breakMs: 0,
    slotIds: Array<string | null>(SESSION.slots).fill(null),
    alerted: [],
    bonusXp: 0,
  };
}

/** A copy without the pause marker. */
function unpaused(run: FocusRun): FocusRun {
  const { pausedAt: _gone, ...rest } = run;
  return rest;
}

export function pause(run: FocusRun, now: number): FocusRun {
  return run.stage === "summary" || isPaused(run) ? run : { ...run, pausedAt: now };
}

export function resume(run: FocusRun, now: number): FocusRun {
  if (run.pausedAt === undefined) return run;
  return { ...unpaused(run), pausedMs: run.pausedMs + Math.max(0, now - run.pausedAt) };
}

export const setLabel = (run: FocusRun, i: number, label: string): FocusRun => {
  if (i < 0 || i >= SESSION.slots) return run;
  const labels = [...run.labels];
  labels[i] = cleanLabel(label, fallbackLabel(i));
  return { ...run, labels };
};

/** XP for a slot: full for its planned time, in proportion below that, nothing extra for overtime. */
export const slotXp = (actualMs: number, plannedMs: number): number =>
  plannedMs > 0 ? Math.round(SESSION.slotXp * Math.min(1, Math.max(0, actualMs) / plannedMs)) : 0;

/** True when every slot is saved and each reached its share of the planned time. */
export function earnedBonus(slots: FocusSlot[]): boolean {
  return (
    Array.from({ length: SESSION.slots }, (_, i) => slots.find((s) => s.idx === i)).every(
      (s) => !!s && s.actualMs >= s.plannedMs * SESSION.bonusMinShare,
    )
  );
}

/** What one control press changes. The caller saves the record, updates the break, and pays the XP. */
export interface Step {
  run: FocusRun;
  /** A slot record to add: the work just finished. */
  slot?: FocusSlot;
  /** Break numbers to write onto an earlier slot record. */
  breakFor?: { id: string; takenMs: number; skipped: boolean };
  /** XP for the slot just finished. */
  xp: number;
  /** Bonus XP for completing every slot. */
  bonus: number;
}

/** Move on from a break: start the next slot, or end the session after the last one. */
function advance(run: FocusRun, now: number): FocusRun {
  const base = unpaused(run);
  if (run.slot + 1 < SESSION.slots) return { ...base, stage: "work", slot: run.slot + 1, stageStart: now, pausedMs: 0, breakMs: 0 };
  return { ...base, stage: "summary", stageStart: now, pausedMs: 0, breakMs: 0, endedAt: now };
}

/**
 * Finish the slot in progress (early, on time, or from overtime) and start its break.
 * `slots` are the saved records so far; `id` names the new one.
 */
export function finishSlot(run: FocusRun, now: number, slots: FocusSlot[], id: string): Step | null {
  if (run.stage !== "work") return null;
  const actual = elapsedMs(run, now);
  const breakMs = computeBreak(actual, run.workMs, run.earlyBreak);
  const slot: FocusSlot = {
    id,
    run: run.id,
    idx: run.slot,
    date: dkey(new Date(now)),
    label: cleanLabel(run.labels[run.slot], fallbackLabel(run.slot)),
    plannedMs: run.workMs,
    actualMs: actual,
    overtimeMs: Math.max(0, actual - run.workMs),
    breakPlannedMs: breakMs,
    breakTakenMs: 0,
    breakSkipped: false,
    startedAt: run.stageStart,
    endedAt: now,
    xp: slotXp(actual, run.workMs),
  };
  const mine = [...slots.filter((s) => s.run === run.id && s.id !== id), slot];
  const bonus = run.slot === SESSION.slots - 1 && earnedBonus(mine) ? SESSION.bonusXp : 0;
  const slotIds = [...run.slotIds];
  slotIds[run.slot] = id;
  const next: FocusRun = { ...unpaused(run), stage: "break", stageStart: now, pausedMs: 0, breakMs, slotIds, bonusXp: run.bonusXp + bonus };
  // A rounded-down break of zero means no break phase at all.
  return { run: breakMs > 0 ? next : advance(next, now), slot, xp: slot.xp, bonus };
}

/**
 * Leave the break: skip it early, or start the next slot once it's over.
 * Records how much of the break was actually taken.
 */
export function leaveBreak(run: FocusRun, now: number): Step | null {
  if (run.stage !== "break") return null;
  const el = elapsedMs(run, now);
  const id = run.slotIds[run.slot];
  return {
    run: advance(run, now),
    breakFor: id ? { id, takenMs: Math.min(el, run.breakMs), skipped: el < run.breakMs } : undefined,
    xp: 0,
    bonus: 0,
  };
}

/**
 * End the session now. Work in progress is saved as a finished slot (with no break) unless it's
 * too short to count; a break in progress records the part taken.
 */
export function endRun(run: FocusRun, now: number, slots: FocusSlot[], id: string): Step | null {
  if (run.stage === "summary") return null;
  let step: Step = { run, xp: 0, bonus: 0 };
  if (run.stage === "work" && elapsedMs(run, now) >= SESSION.minRecordMs) step = finishSlot(run, now, slots, id)!;
  if (step.run.stage === "break") {
    const left = leaveBreak(step.run, now)!;
    const own = step.slot && left.breakFor?.id === step.slot.id;
    // A break left right away belongs to the slot just finished: record it there, not as a later update.
    step = {
      ...step,
      run: left.run,
      slot: own ? { ...step.slot!, breakTakenMs: left.breakFor!.takenMs, breakSkipped: left.breakFor!.skipped } : step.slot,
      breakFor: own ? undefined : left.breakFor,
    };
  }
  if (step.run.stage !== "summary") step = { ...step, run: { ...unpaused(step.run), stage: "summary", stageStart: now, pausedMs: 0, breakMs: 0, endedAt: now } };
  return step;
}

/* ---------- alerts ---------- */

export interface DueAlert {
  key: string;
  kind: "work" | "break";
  /** When the boundary was crossed. */
  at: number;
}

/** Boundaries crossed that haven't been alerted yet: the work block ended, or the break ended. */
export function dueAlerts(run: FocusRun, now: number): DueAlert[] {
  if (run.stage === "summary") return [];
  const work = run.stage === "work";
  const target = work ? run.workMs : run.breakMs;
  const key = `${work ? "w" : "b"}${run.slot}`;
  if (target <= 0 || elapsedMs(run, now) < target || run.alerted.includes(key)) return [];
  return [{ key, kind: work ? "work" : "break", at: run.stageStart + run.pausedMs + target }];
}

export const markAlerted = (run: FocusRun, key: string): FocusRun =>
  run.alerted.includes(key) ? run : { ...run, alerted: [...run.alerted, key] };

/* ---------- summary and history ---------- */

export interface TaskTotal {
  label: string;
  focusedMs: number;
  slots: number;
  overtimeMs: number;
}

export interface Summary {
  slots: FocusSlot[];
  completed: number;
  focusedMs: number;
  plannedMs: number;
  overtimeMs: number;
  breakTakenMs: number;
  /** Slot XP plus any bonus. */
  xp: number;
  bonusXp: number;
  /** Largest first. Labels that differ only by case are one task. */
  byTask: TaskTotal[];
}

export function summarize(slots: FocusSlot[], bonusXp = 0): Summary {
  const sorted = [...slots].sort((a, b) => a.idx - b.idx || a.startedAt - b.startedAt);
  const tasks = new Map<string, TaskTotal>();
  for (const s of sorted) {
    const k = s.label.toLowerCase();
    const t = tasks.get(k) ?? { label: s.label, focusedMs: 0, slots: 0, overtimeMs: 0 };
    t.focusedMs += s.actualMs;
    t.slots += 1;
    t.overtimeMs += s.overtimeMs;
    tasks.set(k, t);
  }
  const sum = (f: (s: FocusSlot) => number) => sorted.reduce((n, s) => n + f(s), 0);
  return {
    slots: sorted,
    completed: sorted.length,
    focusedMs: sum((s) => s.actualMs),
    plannedMs: sum((s) => s.plannedMs),
    overtimeMs: sum((s) => s.overtimeMs),
    breakTakenMs: sum((s) => s.breakTakenMs),
    xp: sum((s) => s.xp) + bonusXp,
    bonusXp,
    byTask: [...tasks.values()].sort((a, b) => b.focusedMs - a.focusedMs),
  };
}

export interface Bucket {
  /** The day (YYYY-MM-DD) or the Monday of the week. */
  key: string;
  focusedMs: number;
  slots: number;
  sessions: number;
  overtimeMs: number;
}

function bucket(slots: FocusSlot[], keys: string[], keyOf: (date: string) => string): Bucket[] {
  const by = new Map(keys.map((k) => [k, { key: k, focusedMs: 0, slots: 0, sessions: 0, overtimeMs: 0, runs: new Set<string>() }]));
  for (const s of slots) {
    const b = by.get(keyOf(s.date));
    if (!b) continue;
    b.focusedMs += s.actualMs;
    b.overtimeMs += s.overtimeMs;
    b.slots += 1;
    b.runs.add(s.run);
  }
  return keys.map((k) => {
    const { runs, ...b } = by.get(k)!;
    return { ...b, sessions: runs.size };
  });
}

/** The last `days` days, today first. Days with no focus are included as zeros. */
export function dailyTotals(slots: FocusSlot[], now: Date = new Date(), days = 14): Bucket[] {
  return bucket(slots, Array.from({ length: days }, (_, i) => daysAgoKey(i, now)), (d) => d);
}

/** The last `weeks` weeks (Monday to Sunday), this week first. */
export function weeklyTotals(slots: FocusSlot[], now: Date = new Date(), weeks = 8): Bucket[] {
  const keys = Array.from({ length: weeks }, (_, i) => weekStart(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7 * i)));
  return bucket(slots, keys, (d) => weekStart(parseD(d)));
}

export interface PastSession {
  run: string;
  startedAt: number;
  summary: Summary;
}

/** Finished sessions, newest first, rebuilt from the saved slots. */
export function pastSessions(slots: FocusSlot[], limit = 10): PastSession[] {
  const by = new Map<string, FocusSlot[]>();
  for (const s of slots) by.set(s.run, [...(by.get(s.run) ?? []), s]);
  return [...by.entries()]
    .map(([run, list]) => ({ run, startedAt: Math.min(...list.map((s) => s.startedAt)), summary: summarize(list, earnedBonus(list) ? SESSION.bonusXp : 0) }))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}
