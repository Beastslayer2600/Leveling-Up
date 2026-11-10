/* Build cap: a new recurring habit (a daily op) can join the rhythm only once per cooldown.
   Editing and removing existing habits is never blocked. */
import { RHYTHM } from "./config.js";
import { dkey } from "./dates.js";
import type { Habits, Quest } from "./types.js";

export interface HabitSlot {
  open: boolean;
  /** The date (YYYY-MM-DD) the next slot opens. Today or earlier when it's open. */
  opensOn: string;
}

export function habitSlot(h: Habits, now: Date = new Date()): HabitSlot {
  if (!h.lastAddAt) return { open: true, opensOn: dkey(now) };
  const d = new Date(h.lastAddAt);
  d.setDate(d.getDate() + RHYTHM.habitAddCooldownDays);
  const opensOn = dkey(d);
  return { open: opensOn <= dkey(now), opensOn };
}

/** True when saving this quest would add a new recurring habit. */
export const addsHabit = (next: Pick<Quest, "kind">, prev?: Pick<Quest, "kind">) => next.kind === "daily" && prev?.kind !== "daily";

export const useSlot = (h: Habits, at: number): Habits => ({ ...h, lastAddAt: at });

export const parkHabit = (h: Habits, quest: Quest, at: number): Habits => ({ ...h, later: [...h.later, { id: quest.id, at, quest }] });

export const unparkHabit = (h: Habits, id: string): Habits => ({ ...h, later: h.later.filter((x) => x.id !== id) });
