/* Tunable values for the Daily Rhythm (Morning Sequence + Evening Debrief).
   Every time, XP amount and threshold lives here, so tuning never touches logic.
   All of them are starting values. */
import type { CatId } from "./types.js";

export interface MorningStepDef {
  id: string;
  title: string;
  /** Estimated minutes. For a timer step this is the countdown length. */
  mins: number;
  /** One line shown under the title. */
  hint: string;
  /** XP by category. The first category is the primary one; the rest are secondary shares. */
  xp: Partial<Record<CatId, number>>;
  /** Runs a countdown; when it ends the step completes by itself. */
  timer?: boolean;
}

export const RHYTHM = {
  /** Wake anchor, seven days a week. The debrief can override it for a single day. */
  wakeTime: "08:00",
  /** Evening Debrief reminder. */
  debriefTime: "21:30",
  /** "Screens down by" = the next wake time minus this many minutes (8h 30m). */
  screensDownBeforeWakeMins: 510,
  /** A new recurring habit can join the daily rhythm once every this many days. */
  habitAddCooldownDays: 14,

  morning: {
    title: "Morning Sequence",
    /** Fixed order. One step on screen at a time. */
    steps: [
      { id: "drink", title: "Drink", mins: 1, hint: "The bottle is next to your bed.", xp: { vitality: 8, discipline: 2 } },
      { id: "bed", title: "Make bed", mins: 2, hint: "Two minutes. Good enough counts.", xp: { vitality: 8, discipline: 2 } },
      { id: "room", title: "Room reset", mins: 10, hint: "Tidy until the timer ends. Stopping on time counts as done.", xp: { vitality: 8, discipline: 2 }, timer: true },
      { id: "food", title: "Food + daylight", mins: 10, hint: "Eat it outside or at a window.", xp: { vitality: 8, discipline: 2 } },
      { id: "briefing", title: "Briefing", mins: 2, hint: "Today at a glance.", xp: { discipline: 10 } },
    ] as MorningStepDef[],
    /** Low-day mode reduces the quest to these steps. */
    lowDaySteps: ["drink", "bed"],
    /** Bonus when every step is done within this many minutes of the first tap. */
    combo: { xp: 25, cat: "discipline" as CatId, windowMins: 45 },
    /** Bonus when step 1 is tapped within this many minutes of the wake time. Earlier counts too, back to `earliest`. */
    wakeAnchor: { xp: 15, cat: "discipline" as CatId, windowMins: 20, earliest: "04:00" },
    /** Office days: a shorter room reset, and a "Leave by" step after the Briefing. */
    office: { roomResetMins: 5 },
    /** Shown on Food + daylight when no breakfast was chosen the night before. */
    breakfastFallback: "Whatever is quickest",
    /** Briefing fallback when the debrief was skipped: pick one main quest. */
    fallbackPickMins: 2,
    /** How many open quests the fallback offers. */
    fallbackPickCount: 6,
    streak: {
      /** This many missed days in a row pauses the streak. */
      freezeAfterMissed: 1,
      /** This many missed days in a row resets it. */
      resetAfterMissed: 2,
    },
  },

  debrief: {
    targetMins: 10,
    /** Paid across the steps on completion, split between these categories. */
    xp: { discipline: 20, emotional: 20 } as Partial<Record<CatId, number>>,
    /** Flat XP for logging the daily record, whatever the ratings are. */
    recordXp: 5,
  },
};

/** "HH:MM" -> minutes after midnight. */
export function hmToMins(hm: string): number {
  const [h, m] = String(hm).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Minutes after midnight (wrapping across days) -> "HH:MM". */
export function minsToHm(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
