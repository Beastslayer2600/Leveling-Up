import { curKey, dkey } from "./dates.js";
import type { AwardSpec, Quest, QuestStep, Stats } from "./types.js";

/** Effective counter progress: 0 once the reset period has rolled over. */
export function eff(q: Quest, now: Date = new Date()): number {
  if (q.kind !== "counter") return 0;
  const p = q.period || "none";
  if (p !== "none" && q.periodKey !== curKey(p, now)) return 0;
  return q.progress || 0;
}

export function isDone(q: Quest, now: Date = new Date()): boolean {
  if (q.kind === "daily") return q.doneOn === dkey(now);
  if (q.kind === "counter") return eff(q, now) >= (q.target || 1);
  return !!q.done;
}

/** Finished for good (moves to Completed): a done quest, or a non-resetting counter at target. */
export const closed = (q: Quest, now: Date = new Date()) =>
  (q.kind === "quest" && !!q.done) ||
  (q.kind === "counter" && (q.period || "none") === "none" && isDone(q, now));

/* ---------- steps, waiting and locked quests ---------- */

/** The first unfinished step of a stepped quest. */
export const openStep = (q: Quest): QuestStep | null => (q.steps || []).find((s) => !s.done) || null;

/** The next concrete action: the first unfinished step, else the free-text next step. */
export const nextStepOf = (q: Quest): string => (q.steps?.length ? openStep(q)?.title || "" : q.nextStep || "");

/** Not on the board yet: its start date hasn't arrived, or the quest it follows isn't finished. */
export function locked(q: Quest, all: Quest[], now: Date = new Date()): boolean {
  if (q.startFrom && q.startFrom > dkey(now)) return true;
  if (!q.unlockAfter) return false;
  const dep = all.find((x) => x.id === q.unlockAfter);
  return !!dep && !closed(dep, now);
}

/** Open, on the board and not waiting on anyone: something that can be worked on now. */
export const workable = (q: Quest, all: Quest[], now: Date = new Date()) =>
  q.kind !== "daily" && !closed(q, now) && !locked(q, all, now) && !q.waitingOn;

/**
 * Finish the first unfinished step. A step that hands off to someone else leaves the quest
 * waiting; doing the next step clears that. `finished` is true when no steps are left.
 */
export function completeQuestStep(q: Quest): { quest: Quest; finished: boolean } | null {
  const i = (q.steps || []).findIndex((s) => !s.done);
  if (i < 0) return null;
  const steps = q.steps!.map((s, j) => (j === i ? { ...s, done: true } : s));
  const quest: Quest = { ...q, steps };
  if (steps[i].waitingOn) quest.waitingOn = steps[i].waitingOn;
  else delete quest.waitingOn;
  return { quest, finished: steps.every((s) => s.done) };
}

/** Bump (or un-bump, s = -1) the completion counters for a mission. */
export function bump(st: Stats, q: Pick<Quest, "cat" | "xp">, s: 1 | -1): void {
  const n = st.n;
  n.missions = Math.max(0, (n.missions || 0) + s);
  n["c_" + q.cat] = Math.max(0, (n["c_" + q.cat] || 0) + s);
  if (q.xp >= 100) n.boss = Math.max(0, (n.boss || 0) + s);
  if (q.xp >= 50) st.dayHard = Math.max(0, (st.dayHard || 0) + s);
}

/** Tick or untick a daily op or one-off quest. */
export function toggleQuest(
  q: Quest,
  all: Quest[],
  now: Date = new Date(),
): { quest: Quest; award: AwardSpec } {
  const t = dkey(now);
  const next: Quest = { ...q };
  let was: boolean;
  if (q.kind === "daily") {
    was = q.doneOn === t;
    next.doneOn = was ? null : t;
  } else {
    was = !!q.done;
    next.done = !was;
    next.doneAt = was ? null : now.getTime();
  }
  const events: string[] = [];
  if (!was && q.kind === "daily") {
    const doneToday = all.filter((x) => x.kind === "daily" && x.id !== q.id && x.doneOn === t).length + 1;
    if (doneToday >= 3) events.push("hattrick");
  }
  return {
    quest: next,
    award: {
      delta: was ? -q.xp : q.xp,
      title: q.title,
      cat: q.cat,
      events,
      mut: (st, ev) => {
        bump(st, q, was ? -1 : 1);
        if (!was && st.dayHard >= 3) ev.push("pressure");
      },
    },
  };
}

/** Step a tracked target by d (+1 / -1). Hitting the target pays a 2× bonus. */
export function stepCounter(
  q: Quest,
  d: number,
  now: Date = new Date(),
): { quest: Quest; award: AwardSpec; hit: boolean } | null {
  const tgt = q.target || 1;
  const p = eff(q, now);
  const np = Math.min(tgt, Math.max(0, p + d));
  if (np === p) return null;
  const hit = np >= tgt && p < tgt;
  const unhit = p >= tgt && np < tgt;
  const next: Quest = { ...q, progress: np, periodKey: curKey(q.period || "none", now) };
  if (hit) next.doneAt = now.getTime();
  let gain = (np - p) * q.xp;
  if (hit) gain += q.xp * 2;
  if (unhit) gain -= q.xp * 2;
  return {
    quest: next,
    hit,
    award: {
      delta: gain,
      title: q.title,
      cat: q.cat,
      mut: (st) => {
        if (!hit && !unhit) return;
        const s = hit ? 1 : -1;
        bump(st, q, s);
        if (q.cat === "clients") st.n.closer = Math.max(0, (st.n.closer || 0) + s);
      },
    },
  };
}

export function kindLabel(q: Quest): string {
  if (q.kind === "daily") return "Daily";
  if (q.kind === "counter")
    return q.period === "week" ? "Weekly target" : q.period === "month" ? "Monthly target" : "Target";
  return "Quest";
}

/** A mission from a local seed file: the fields a player would type into the mission sheet. */
export type SeedMission = Pick<Quest, "id" | "title" | "cat" | "kind" | "xp"> &
  Partial<Pick<Quest, "note" | "due" | "target" | "period" | "main" | "nextStep" | "steps" | "waitingOn" | "unlockAfter" | "startFrom">>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function seedSteps(raw: unknown): QuestStep[] {
  if (!Array.isArray(raw)) return [];
  const out: QuestStep[] = [];
  for (const r of raw.slice(0, 40)) {
    const x = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const title = String(x.title ?? "").trim().slice(0, 200);
    if (!title) continue;
    const st: QuestStep = { title };
    const mins = Math.round(Number(x.mins ?? x.estMinutes));
    if (mins > 0) st.mins = Math.min(600, mins);
    if (x.waitingOn) st.waitingOn = String(x.waitingOn).slice(0, 80);
    if (x.decision === true) st.decision = true;
    if (x.done === true) st.done = true;
    out.push(st);
  }
  return out;
}

const KINDS: Quest["kind"][] = ["daily", "quest", "counter"];

/**
 * Add seed missions the log doesn't have yet. A seed already in the log, or one the
 * player deleted (tombstoned), is left alone, so loading the same file twice is a no-op.
 */
export function seedMissions(
  quests: Quest[],
  tomb: Record<string, number>,
  seeds: unknown,
  cats: Set<string>,
  now = Date.now(),
): Quest[] {
  if (!Array.isArray(seeds)) return [];
  const have = new Set(quests.map((q) => q.id));
  const out: Quest[] = [];
  seeds.forEach((raw, i) => {
    const s = (raw && typeof raw === "object" ? raw : {}) as Partial<SeedMission>;
    const id = String(s.id ?? "").trim();
    const title = String(s.title ?? "").trim();
    if (!id || !title || have.has(id) || tomb[id] || !cats.has(String(s.cat))) return;
    const kind = KINDS.includes(s.kind as Quest["kind"]) ? (s.kind as Quest["kind"]) : "quest";
    const q: Quest = {
      id,
      title: title.slice(0, 120),
      cat: s.cat as Quest["cat"],
      kind,
      xp: Math.max(1, Math.min(500, Math.round(Number(s.xp) || 25))),
      created: now + i,
    };
    if (s.note) q.note = String(s.note).slice(0, 1000);
    if (s.nextStep) q.nextStep = String(s.nextStep).slice(0, 200);
    if (s.main === true && kind !== "daily") q.main = true;
    if (kind !== "daily" && s.due && DATE.test(String(s.due))) q.due = String(s.due);
    if (kind !== "daily") {
      const steps = kind === "quest" ? seedSteps(s.steps) : [];
      if (steps.length) q.steps = steps;
      if (s.waitingOn) q.waitingOn = String(s.waitingOn).slice(0, 80);
      if (s.unlockAfter) q.unlockAfter = String(s.unlockAfter).slice(0, 80);
      if (s.startFrom && DATE.test(String(s.startFrom))) q.startFrom = String(s.startFrom);
    }
    if (kind === "counter") {
      q.target = Math.max(1, Math.min(999, Math.round(Number(s.target) || 1)));
      q.period = s.period === "week" || s.period === "month" ? s.period : "none";
      q.progress = 0;
    }
    have.add(id);
    out.push(q);
  });
  return out;
}
