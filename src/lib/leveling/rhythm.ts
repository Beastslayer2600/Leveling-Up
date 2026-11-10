/* Daily Rhythm: the Morning Sequence. Pure logic; every number comes from config.ts.
   The system never punishes: nothing here ever takes XP away. */
import { RHYTHM, hmToMins, type MorningStepDef } from "./config.js";
import { daysAgoKey, dkey, parseD } from "./dates.js";
import { workable } from "./missions.js";
import type { AwardSpec, DayPlan, Quest, RhythmDay } from "./types.js";

const M = RHYTHM.morning;

export const blankDay = (date: string): RhythmDay => ({ id: date, date, morning: { steps: {}, xp: 0 } });

export const dayFor = (days: RhythmDay[], date: string): RhythmDay => days.find((d) => d.id === date) || blankDay(date);

/**
 * The whole sequence for a day. An office day (chosen in last night's debrief) has a shorter
 * room reset and a sixth step, "Leave by HH:MM", after the Briefing.
 */
export function fullSteps(day: RhythmDay): MorningStepDef[] {
  if (!day.plan?.office) return M.steps;
  const leave = M.office.leaveStep;
  return [
    ...M.steps.map((s) => (s.timer ? { ...s, mins: M.office.roomResetMins } : s)),
    { ...leave, title: day.plan.leaveBy ? `Leave by ${day.plan.leaveBy}` : "Leave" },
  ];
}

/** The steps this day's sequence asks for, in order: all of them, or the low-day pair. */
export function morningSteps(day: RhythmDay): MorningStepDef[] {
  const all = fullSteps(day);
  return day.morning.low ? all.filter((s) => M.lowDaySteps.includes(s.id)) : all;
}

/** The step on screen now, or null once the sequence is finished. */
export function currentStep(day: RhythmDay): MorningStepDef | null {
  return morningSteps(day).find((s) => !day.morning.steps[s.id]) || null;
}

const allDone = (day: RhythmDay, steps: MorningStepDef[]) => steps.every((s) => !!day.morning.steps[s.id]);

export type MorningStatus = "full" | "low" | "open";

/** full: every step done. low: a low day with its steps done. open: neither (yet). */
export function morningStatus(day: RhythmDay | undefined): MorningStatus {
  if (!day) return "open";
  if (allDone(day, fullSteps(day))) return "full";
  if (day.morning.low && allDone(day, morningSteps(day))) return "low";
  return "open";
}

export const stepXp = (s: MorningStepDef) => Object.values(s.xp).reduce((a, b) => a + (b || 0), 0);

/** Wake time for a day: the debrief's one-day override, else the usual anchor. */
export const wakeTimeFor = (plan?: DayPlan) => plan?.wakeTime || RHYTHM.wakeTime;

function atTime(date: string, hm: string): number {
  const d = parseD(date);
  d.setMinutes(hmToMins(hm));
  return d.getTime();
}

/** Step 1 tapped no later than the wake time plus the window (and not in the small hours). */
export function hitWakeAnchor(day: RhythmDay, at: number): boolean {
  const wake = atTime(day.date, wakeTimeFor(day.plan));
  return at <= wake + M.wakeAnchor.windowMins * 60000 && at >= atTime(day.date, M.wakeAnchor.earliest);
}

export interface StepResult {
  day: RhythmDay;
  /** XP to pay through the XP engine, in order: the step, then any bonuses. */
  awards: AwardSpec[];
  /** True when this tap finished the sequence (full or low-day). */
  finished: boolean;
}

function award(title: string, xp: Partial<Record<string, number>>): AwardSpec {
  const [[cat, delta], ...rest] = Object.entries(xp) as [string, number][];
  return { delta, title, cat, also: rest.map(([c, d]) => ({ cat: c, delta: d })) };
}

/**
 * Complete the step on screen. `at` is the completion time (for the timer step, the moment
 * the countdown ended). Returns null if that step isn't the current one.
 */
export function completeStep(day: RhythmDay, stepId: string, at: number): StepResult | null {
  const step = currentStep(day);
  if (!step || step.id !== stepId) return null;
  const first = Object.keys(day.morning.steps).length === 0;
  const m = { ...day.morning, steps: { ...day.morning.steps, [step.id]: at }, timerAt: null };
  const awards = [award(`${M.title}: ${step.title}`, step.xp)];
  m.xp += stepXp(step);
  const next: RhythmDay = { ...day, morning: m };

  if (first && !m.anchor && hitWakeAnchor(next, at)) {
    m.anchor = true;
    m.xp += M.wakeAnchor.xp;
    awards.push({ delta: M.wakeAnchor.xp, title: `${M.title}: On-time start`, cat: M.wakeAnchor.cat });
  }
  if (!m.combo && allDone(next, fullSteps(next))) {
    const start = Math.min(...Object.values(m.steps));
    if (at - start <= M.combo.windowMins * 60000) {
      m.combo = true;
      m.xp += M.combo.xp;
      awards.push({ delta: M.combo.xp, title: `${M.title}: Combo`, cat: M.combo.cat });
    }
  }
  const finished = !currentStep(next);
  if (finished) m.doneAt = at;
  return { day: next, awards, finished };
}

/** Switch to low-day mode. No questions asked; steps already done stay done. */
export function setLowDay(day: RhythmDay, at: number): RhythmDay {
  if (day.morning.low || morningStatus(day) === "full") return day;
  const next: RhythmDay = { ...day, morning: { ...day.morning, low: true, timerAt: null } };
  if (!currentStep(next)) next.morning.doneAt = at;
  return next;
}

/** Back to the full sequence after a low day turned out better than expected. */
export function clearLowDay(day: RhythmDay): RhythmDay {
  if (!day.morning.low) return day;
  const next: RhythmDay = { ...day, morning: { ...day.morning, low: false } };
  if (currentStep(next)) next.morning.doneAt = null;
  return next;
}

/* ---------- room-reset timer ---------- */

export function startTimer(day: RhythmDay, at: number): RhythmDay {
  const step = currentStep(day);
  if (!step?.timer || day.morning.timerAt) return day;
  return { ...day, morning: { ...day.morning, timerAt: at } };
}

/** When the running countdown ends (ms), or null if it isn't running. */
export function timerEndsAt(day: RhythmDay): number | null {
  const step = currentStep(day);
  if (!step?.timer || !day.morning.timerAt) return null;
  return day.morning.timerAt + step.mins * 60000;
}

export const fmtCountdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/* ---------- streak ---------- */

export interface MorningStreak {
  count: number;
  /** A missed day has frozen the streak; one more in a row resets it. */
  paused: boolean;
  keptToday: boolean;
}

/**
 * Kept days are full or low-day completions. One missed day freezes the streak,
 * two in a row reset it. Today only counts once it's kept; until then it isn't a miss.
 */
export function morningStreak(days: RhythmDay[], now: Date = new Date()): MorningStreak {
  const kept = new Set(days.filter((d) => morningStatus(d) !== "open").map((d) => d.date));
  const keptToday = kept.has(dkey(now));
  if (!kept.size) return { count: 0, paused: false, keptToday };
  const earliest = [...kept].sort()[0];
  let count = 0;
  let misses = 0;
  let trailing = -1;
  for (let i = keptToday ? 0 : 1; ; i++) {
    const k = daysAgoKey(i, now);
    if (k < earliest) break;
    if (kept.has(k)) {
      if (trailing < 0) trailing = misses;
      count++;
      misses = 0;
    } else if (++misses >= M.streak.resetAfterMissed) break;
  }
  if (trailing < 0) return { count: 0, paused: false, keptToday };
  return { count, paused: !keptToday && trailing >= M.streak.freezeAfterMissed && count > 0, keptToday };
}

/* ---------- briefing ---------- */

export interface Briefing {
  office: boolean;
  main: Quest | null;
  mustDos: Quest[];
  /** No main quest was chosen last night: offer these to pick one from. */
  pick: Quest[];
}

/** What the Briefing step shows. Works without a debrief: Home by default, and a short pick list. */
export function briefing(day: RhythmDay, quests: Quest[], now: Date = new Date()): Briefing {
  const open = quests.filter((q) => workable(q, quests, now));
  const byId = (id?: string) => open.find((q) => q.id === id) || null;
  const main = byId(day.plan?.mainQuestId);
  const mustDos = (day.plan?.mustDoIds || []).map(byId).filter((q): q is Quest => !!q);
  const pick = main
    ? []
    : [...open].sort((a, b) => Number(!!b.main) - Number(!!a.main) || (a.due || "9999").localeCompare(b.due || "9999") || a.created - b.created).slice(0, M.fallbackPickCount);
  return { office: !!day.plan?.office, main, mustDos, pick };
}

/** Record the morning's fallback pick as today's main quest. */
export const pickMainQuest = (day: RhythmDay, questId: string): RhythmDay => ({ ...day, plan: { ...day.plan, mainQuestId: questId } });
