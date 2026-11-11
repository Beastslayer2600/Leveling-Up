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

export interface DebriefStepDef {
  id: string;
  title: string;
  hint: string;
  xp: Partial<Record<CatId, number>>;
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
  /** A debrief done after midnight but before this time still belongs to the day before. */
  dayStartsAt: "04:00",

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
    office: {
      roomResetMins: 5,
      /** The sixth step, added after the Briefing. Its title is "Leave by HH:MM". */
      leaveStep: { id: "leave", mins: 2, hint: "Keys, wallet, phone. Out the door.", xp: { discipline: 10 } as Partial<Record<CatId, number>> },
      /** Minutes needed between waking and leaving. Wake time moves earlier only when the usual one leaves less than this. */
      wakeToLeaveMins: 60,
      /** Defaults for the debrief's office questions. */
      defaultArrive: "08:30",
      defaultTravelMins: 30,
    },
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
    title: "Evening Debrief",
    targetMins: 10,
    /**
     * One screen per step. The six main steps add up to 40 XP (20 Discipline, 20 Emotional
     * Awareness); a step that isn't done simply isn't paid. The daily record pays a flat 5
     * for logging, whatever the ratings are.
     */
    steps: [
      { id: "today", title: "Today", hint: "What got done. Add anything that's missing.", xp: { emotional: 5 } },
      { id: "feeling", title: "One feeling", hint: "Name one feeling from today, and what caused it.", xp: { emotional: 15 } },
      { id: "record", title: "Daily record", hint: "Quick taps. There are no right answers.", xp: { emotional: 5 } },
      { id: "where", title: "Tomorrow", hint: "Home or Office?", xp: { discipline: 5 } },
      { id: "quests", title: "Tomorrow's quests", hint: "One main quest and up to three must-dos.", xp: { discipline: 5 } },
      { id: "prep", title: "Prep", hint: "Set the morning up now.", xp: { discipline: 5 } },
      { id: "close", title: "Close", hint: "That's the day.", xp: { discipline: 5 } },
    ] as DebriefStepDef[],
    mustDoCount: 3,
    feelings: ["Calm", "Content", "Proud", "Grateful", "Hopeful", "Tired", "Anxious", "Frustrated", "Sad", "Angry", "Lonely", "Overwhelmed"],
    feelingPrompt: "One feeling from today, and what caused it",
    sleepHourOptions: [4, 5, 6, 7, 8, 9, 10],
    /** The 1-5 ratings on the daily record. */
    ratings: [
      { id: "sleepQuality", label: "Sleep quality" },
      { id: "mood", label: "Mood" },
      { id: "energy", label: "Energy" },
      { id: "irritability", label: "Irritability" },
      { id: "focus", label: "Focus" },
    ],
    prep: [
      { id: "water", label: "Water bottle filled and by the bed" },
      { id: "breakfast", label: "Breakfast chosen" },
      { id: "clothes", label: "Clothes laid out", office: "Office clothes laid out" },
    ],
  },

  review: {
    days: 7,
    /** Baseline: the average over this many days before the review window. */
    baselineDays: 28,
    /** Fewer logged days than this in the baseline window, and no baseline is shown. */
    minBaselineDays: 5,
    /** "Well below/above" baseline: this many hours of sleep, or this many points on a 1-5 rating. */
    sleepHoursDelta: 1.5,
    ratingDelta: 1,
    /** Pattern note: this many short-sleep nights alongside raised energy or mood... */
    shortSleepNights: 3,
    /** ...or this many low-mood days. */
    lowMoodDays: 5,
    patternNote: "This is a change from your usual pattern. Worth mentioning to your psychiatrist.",
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

/* Focus Sessions: three slots of work, each followed by a break worth half the work actually done. */
export const SESSION = {
  slots: 3,
  /** Default planned work per slot, and the range the setup screen allows. */
  workMin: 20,
  workMinRange: [5, 60] as [number, number],
  /** Break = actual work x this. 0.5 is the one-to-two ratio: 20 min of work earns a 10 min break. */
  breakRatio: 0.5,
  /** Breaks are rounded to the nearest this. */
  roundMs: 30_000,
  /** What an early finish does to the break by default: "shorten" it in proportion, or keep the planned "minimum". */
  earlyBreak: "shorten" as "shorten" | "minimum",
  defaultLabels: ["Admin", "Content", "Outreach"],
  /** Category that gets the XP (Mind is the Focus attribute). */
  cat: "mind" as CatId,
  /** XP for a slot worked to its planned time. Shorter work pays in proportion; overtime doesn't pay extra. */
  slotXp: 20,
  /** Bonus for finishing every slot, if each reached this share of its planned time. */
  bonusXp: 25,
  bonusMinShare: 0.5,
  /** Ending a session in the middle of a slot discards that slot if it's shorter than this. */
  minRecordMs: 10_000,
  /** An alert is played only if the boundary passed this recently; otherwise it is reported quietly. */
  alertLiveMs: 5_000,
  maxLabel: 24,
};
