import type { Prefs } from "./prefs.js";

export type CatId =
  | "clients"
  | "admin"
  | "training"
  | "adjudication"
  | "social"
  | "money"
  | "faith"
  | "mind"
  | "side"
  | "vitality"
  | "discipline"
  | "emotional"
  | "personal";

export type Kind = "daily" | "quest" | "counter";
export type Period = "none" | "week" | "month";

/** One piece of a quest, about ten minutes of work. */
export interface QuestStep {
  title: string;
  mins?: number;
  done?: boolean;
  /** Finishing this step leaves the quest waiting on someone else. */
  waitingOn?: string;
  /** This step ends in a choice the player makes. */
  decision?: boolean;
}

export interface Quest {
  id: string;
  title: string;
  note?: string;
  cat: CatId;
  kind: Kind;
  /** XP for a quest/daily, or XP per step for a counter. */
  xp: number;
  created: number;
  target?: number;
  period?: Period;
  progress?: number;
  periodKey?: string;
  done?: boolean;
  doneAt?: number | null;
  doneOn?: string | null;
  due?: string;
  starter?: boolean;
  coach?: boolean;
  /** A main quest: offered first when picking the day's main quest. */
  main?: boolean;
  /** The next concrete action on this quest. With `steps`, the first unfinished step is used instead. */
  nextStep?: string;
  steps?: QuestStep[];
  /** Blocked on someone else. Cleared when the next step is done. */
  waitingOn?: string;
  /** Hidden from the board until the quest with this id is finished. */
  unlockAfter?: string;
  /** Hidden from the board until this date (YYYY-MM-DD). */
  startFrom?: string;
}

export interface SetRec {
  kg: number;
  reps: number;
}

export interface Exercise {
  name: string;
  sets: SetRec[];
}

export interface Workout {
  id: string;
  type: "gym" | "cardio";
  date: string;
  created: number;
  note: string;
  title?: string;
  ex?: Exercise[];
  activity?: string;
  mins?: number;
  km?: number | null;
  pbs: number;
  xp: number;
}

export interface Meal {
  id: string;
  meal: string;
  what: string;
  src: "home" | "bought";
  date: string;
  kcal: number | null;
  protein: number | null;
  xp: number;
  created: number;
}

export type SocialKind = "ig" | "li" | "irl" | "event";

export interface Social {
  id: string;
  kind: SocialKind;
  what: string;
  date: string;
  note: string;
  group?: string;
  eng?: number | null;
  xp: number;
  created: number;
}

export type Verdict = "good" | "neutral" | "bad";

export interface Money {
  id: string;
  dir: "in" | "out";
  amount: number;
  what: string;
  cat: string;
  date: string;
  verdict?: Verdict;
  xp: number;
  created: number;
}

export interface Day {
  id: string;
  date: string;
  steps?: number | null;
  weight?: number | null;
  goalHit?: boolean;
  xp: number;
}

export interface LogEntry {
  t: number;
  title: string;
  xp: number;
  cat: string;
}

export interface VirtueProgress {
  count: number;
  fruits: string[];
  last?: string;
  name?: string;
  streak?: number;
}

export interface Stats {
  xp: number;
  cat: Record<string, number>;
  streak: number;
  lastDay: string | null;
  dayKey: string | null;
  dayXp: number;
  dayCats: string[];
  dayHard: number;
  log: LogEntry[];
  /** Counters: missions, boss, closer, c_<category>. */
  n: Record<string, number>;
  /** Achievement id -> unlock time (ms). */
  ach: Record<string, number>;
  virtue: VirtueProgress;
  /** Idempotency keys of integration events already paid, -> time (ms). */
  events: Record<string, number>;
}

export interface ChapterLine {
  id: string;
  label: string;
  value: string;
}
export interface Skill {
  id: string;
  name: string;
  level: number;
  note: string;
}
export interface Feat {
  id: string;
  title: string;
  detail: string;
}

export interface Sheet {
  /** Player name shown on the HUD. */
  name: string;
  /** A sentence or two about you, used only to brief the coach. */
  about: string;
  chapter: ChapterLine[];
  skills: Skill[];
  feats: Feat[];
  stepGoal: number;
  kcalTarget: number | null;
  weightGoal: number | null;
}

export interface Release {
  days: Record<string, string>;
  cycles: number;
  reach: number;
  plan: Record<string, string>;
}

export interface Suggestion {
  title: string;
  why: string;
  cat: CatId;
  kind: Kind;
  target: number | null;
  period: Period;
  xp: number;
}

export interface CoachState {
  items: Suggestion[];
  at?: number;
  focus?: string;
}

export interface JournalEntry {
  id: string;
  date: string;
  created: number;
  prompt: string;
  text: string;
  /** 1 (rough) to 5 (great). */
  mood: number | null;
  /** Voice note kept in this device's IndexedDB under the entry id. */
  audio?: { mime: string; secs: number } | null;
  xp: number;
}

/** Tomorrow's choices, made in the evening debrief so the morning needs no decisions. */
export interface DayPlan {
  office?: boolean;
  /** "HH:MM" wake time for this one day, when it differs from the usual one. */
  wakeTime?: string;
  /** "HH:MM", office days only. */
  leaveBy?: string;
  breakfast?: string;
  mainQuestId?: string;
  mustDoIds?: string[];
}

/** One day's Morning Sequence progress. */
export interface MorningRun {
  /** Step id -> completion time (ms). */
  steps: Record<string, number>;
  /** Low-day mode: the quest is reduced to the low-day steps. */
  low?: boolean;
  /** When the room-reset countdown was started (ms). */
  timerAt?: number | null;
  /** When the sequence (full or low-day) was finished (ms). */
  doneAt?: number | null;
  /** Bonuses already paid. */
  anchor?: boolean;
  combo?: boolean;
  xp: number;
}

/** The quick end-of-day ratings. Kept as a record; never scored. */
export interface DailyRecord {
  sleepHours?: number | null;
  sleepQuality?: number | null;
  mood?: number | null;
  energy?: number | null;
  irritability?: number | null;
  focus?: number | null;
  note?: string;
}

/** One day's Evening Debrief progress. */
export interface DebriefRun {
  /** Step id -> completion time (ms). */
  steps: Record<string, number>;
  /** Steps passed over. They earn nothing and cost nothing. */
  skipped?: string[];
  doneAt?: number | null;
  xp: number;
  /** Things done today that weren't logged anywhere else. */
  extra?: string[];
  feeling?: string;
  cause?: string;
  /** "Is anything still open?" */
  open?: string;
  prep?: Record<string, boolean>;
}

/** The daily rhythm for one calendar day. `id` is the date, so each day has one record. */
export interface RhythmDay {
  id: string;
  date: string;
  plan?: DayPlan;
  morning: MorningRun;
  debrief?: DebriefRun;
  record?: DailyRecord;
}

/** A habit idea parked until the next slot opens. */
export interface LaterHabit {
  id: string;
  at: number;
  quest: Quest;
}

/** The build cap: when a recurring habit was last added, and the parked ideas. */
export interface Habits {
  lastAddAt: number;
  later: LaterHabit[];
}

export interface Data {
  quests: Quest[];
  rhythm: RhythmDay[];
  journal: JournalEntry[];
  workouts: Workout[];
  social: Social[];
  money: Money[];
  meals: Meal[];
  days: Day[];
  stats: Stats;
  coach: CoachState;
  sheet: Sheet;
  release: Release;
  habits: Habits;
  /** What this player tracks and how it's labelled. */
  prefs: Prefs;
  /** Deleted record id -> deletion time (ms), so a deletion survives a sync merge. */
  tomb: Record<string, number>;
  /** Last local save (ms). Decides which copy's stats and sheet win in a merge. */
  savedAt: number;
}

/** What one XP change does. Applied by `applyAward`. */
export interface AwardSpec {
  delta: number;
  title: string;
  cat: string;
  /** Secondary shares of the same award, paid to other categories on top of `delta`. */
  also?: { cat: string; delta: number }[];
  events?: string[];
  mut?: (st: Stats, events: string[]) => void;
  quiet?: boolean;
  noEvents?: boolean;
}
