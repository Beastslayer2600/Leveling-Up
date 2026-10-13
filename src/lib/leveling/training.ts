import type { Exercise, SetRec, Workout } from "./types";

/** Parse "80x8, 80x8, 85x6" (or "80kg×8"); bare numbers are bodyweight reps. */
export function parseSets(str: string): SetRec[] {
  return String(str || "")
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.replace(/\s/g, "").match(/^(\d+(?:\.\d+)?)(?:kg)?[x×*](\d+)$/i);
      if (m) return { kg: +m[1], reps: +m[2] };
      const r = s.match(/^(\d+)$/);
      return r ? { kg: 0, reps: +r[1] } : null;
    })
    .filter((s): s is SetRec => s !== null);
}

export const fmtSets = (sets: SetRec[] = []) =>
  sets.map((s) => (s.kg ? `${s.kg}x${s.reps}` : String(s.reps))).join(", ");

/** Heavier wins; at equal weight, more reps wins. */
export const better = (a: SetRec, b?: SetRec | null) =>
  !b || a.kg > b.kg || (a.kg === b.kg && a.reps > b.reps);

export const topSet = (sets: SetRec[]) =>
  sets.reduce<SetRec | null>((a, b) => (better(b, a) ? b : a), null);

/** Estimated one-rep max (Epley). */
export const e1rm = (s: SetRec) => Math.round(s.kg * (1 + s.reps / 30));

export interface PB {
  name: string;
  best: SetRec;
  date: string;
}

/** Best set per lift across gym sessions, keyed by lower-cased name. */
export function pbMap(workouts: Workout[], excludeId?: string): Record<string, PB> {
  const m: Record<string, PB> = {};
  for (const w of workouts) {
    if (w.id === excludeId || w.type !== "gym") continue;
    for (const e of w.ex || []) {
      const k = e.name.trim().toLowerCase();
      if (!k) continue;
      for (const s of e.sets || [])
        if (better(s, m[k]?.best)) m[k] = { name: e.name.trim(), best: s, date: w.date };
    }
  }
  return m;
}

/** Lifts in `ex` that beat an existing best. A first-ever lift is not a PB. */
export function findNewPbs(ex: Exercise[], workouts: Workout[], excludeId?: string): string[] {
  const old = pbMap(workouts, excludeId);
  const out: string[] = [];
  for (const x of ex) {
    const prev = old[x.name.trim().toLowerCase()];
    const top = topSet(x.sets);
    if (prev && top && better(top, prev.best))
      out.push(`${x.name} ${top.kg ? `${top.kg}kg × ${top.reps}` : `${top.reps} reps`}`);
  }
  return out;
}

/** Gym: 30 + 40 per PB. Cardio: 15 + 1 per 3 minutes, capped at +30. */
export function workoutXp(type: "gym" | "cardio", pbs: number, mins = 0): number {
  return type === "gym" ? 30 + 40 * pbs : 15 + Math.min(30, Math.round(mins / 3));
}

export function exSummary(w: Workout): string {
  if (w.type === "cardio")
    return [w.mins ? `${w.mins} min` : "", w.km ? `${(+w.km).toFixed(1)} km` : ""].filter(Boolean).join(" · ");
  return (w.ex || [])
    .map((e) => {
      const top = topSet(e.sets || []);
      return `${e.name} ${e.sets.length}×${top ? (top.kg ? top.kg + "kg" : top.reps + " reps") : ""}`;
    })
    .join(" · ");
}
