export type CatId =
  | "clients"
  | "admin"
  | "training"
  | "adjudication"
  | "social"
  | "money"
  | "faith"
  | "mind"
  | "side";

export type Kind = "daily" | "quest" | "counter";
export type Period = "none" | "week" | "month";

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

export interface Data {
  quests: Quest[];
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
}

/** What one XP change does. Applied by `applyAward`. */
export interface AwardSpec {
  delta: number;
  title: string;
  cat: string;
  events?: string[];
  mut?: (st: Stats, events: string[]) => void;
  quiet?: boolean;
  noEvents?: boolean;
}
