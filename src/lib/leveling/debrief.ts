/* Daily Rhythm: the Evening Debrief. It makes every choice tomorrow morning needs.
   Pure logic; every number comes from config.ts. Partial completion earns the steps done. */
import { RHYTHM, hmToMins, minsToHm, type DebriefStepDef } from "./config.js";
import { dkey, parseD } from "./dates.js";
import { morningStatus, wakeTimeFor } from "./rhythm.js";
import type { AwardSpec, Data, DayPlan, DebriefRun, RhythmDay } from "./types.js";

const D = RHYTHM.debrief;

/** The day a debrief belongs to: one done just after midnight still closes the day before. */
export function debriefDate(now: Date = new Date()): string {
  return dkey(new Date(now.getTime() - hmToMins(RHYTHM.dayStartsAt) * 60000));
}

export function nextDate(date: string): string {
  const d = parseD(date);
  d.setDate(d.getDate() + 1);
  return dkey(d);
}

const run = (day: RhythmDay): DebriefRun => day.debrief || { steps: {}, xp: 0 };

/** The step on screen now, or null once every step is done or passed over. */
export function currentDebriefStep(day: RhythmDay): DebriefStepDef | null {
  const r = run(day);
  return D.steps.find((s) => !r.steps[s.id] && !(r.skipped || []).includes(s.id)) || null;
}

/** A debrief counts as completed once the day has been closed. */
export const debriefDone = (day: RhythmDay | undefined): boolean => !!day?.debrief?.steps.close;

export const debriefStepXp = (s: DebriefStepDef) => Object.values(s.xp).reduce((a, b) => a + (b || 0), 0);

export function completeDebriefStep(
  day: RhythmDay,
  stepId: string,
  at: number,
  patch: Partial<DebriefRun> = {},
): { day: RhythmDay; award: AwardSpec; finished: boolean } | null {
  const step = currentDebriefStep(day);
  if (!step || step.id !== stepId) return null;
  const r = { ...run(day), ...patch };
  r.steps = { ...run(day).steps, [step.id]: at };
  r.xp = run(day).xp + debriefStepXp(step);
  const next: RhythmDay = { ...day, debrief: r };
  const finished = !currentDebriefStep(next);
  if (finished) r.doneAt = at;
  const [[cat, delta], ...rest] = Object.entries(step.xp) as [string, number][];
  return { day: next, finished, award: { delta, cat, title: `${D.title}: ${step.title}`, also: rest.map(([c, d]) => ({ cat: c, delta: d })) } };
}

/** Pass over a step. Nothing is paid and nothing is taken. */
export function skipDebriefStep(day: RhythmDay, stepId: string, at: number): RhythmDay {
  const step = currentDebriefStep(day);
  if (!step || step.id !== stepId) return day;
  const r = { ...run(day), skipped: [...(run(day).skipped || []), step.id] };
  const next: RhythmDay = { ...day, debrief: r };
  if (!currentDebriefStep(next)) r.doneAt = at;
  return next;
}

/**
 * Office day: when to leave, and an earlier wake time for that one day only if the usual
 * one doesn't leave enough time before leaving.
 */
export function officePlan(arrive: string, travelMins: number): Pick<DayPlan, "office" | "leaveBy" | "wakeTime"> {
  const leave = hmToMins(arrive) - Math.max(0, Math.round(travelMins) || 0);
  const need = RHYTHM.morning.office.wakeToLeaveMins;
  const plan: Pick<DayPlan, "office" | "leaveBy" | "wakeTime"> = { office: true, leaveBy: minsToHm(leave) };
  if (hmToMins(RHYTHM.wakeTime) + need > leave) plan.wakeTime = minsToHm(leave - need);
  return plan;
}

/** "Screens down by": the wake time minus the configured wind-down. */
export const screensDownBy = (plan?: DayPlan) => minsToHm(hmToMins(wakeTimeFor(plan)) - RHYTHM.screensDownBeforeWakeMins);

/** What was completed on a day, from what's already logged. Never lists what wasn't done. */
export function doneOn(data: Data, date: string): string[] {
  const on = (t?: number | null) => !!t && dkey(new Date(t)) === date;
  const out: string[] = [];
  const day = data.rhythm.find((d) => d.id === date);
  const ms = morningStatus(day);
  if (ms !== "open") out.push(`${RHYTHM.morning.title}${ms === "low" ? " (low day)" : ""}`);
  for (const q of data.quests) {
    if (q.kind === "daily" ? q.doneOn === date : on(q.doneAt) && (q.kind === "counter" || q.done)) out.push(q.title);
  }
  for (const w of data.workouts) if (w.date === date) out.push(w.type === "cardio" ? w.activity || "Cardio" : w.title || "Gym session");
  for (const s of data.social) if (s.date === date) out.push(s.what);
  if (data.stats.virtue.last === date && data.stats.virtue.name) out.push(`Virtue: ${data.stats.virtue.name}`);
  return out;
}
