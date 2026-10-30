import { curKey, dkey } from "./dates.js";
import type { AwardSpec, Quest, Stats } from "./types.js";

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
