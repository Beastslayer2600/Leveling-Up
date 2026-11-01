import { blankPrefs, guessCurrency, normalizePrefs } from "./prefs.js";
import { blankRelease } from "./virtues.js";
import { blankStats } from "./xp.js";
import type { Data, Quest, Sheet } from "./types.js";

export const SOC = {
  ig: { label: "Instagram", xp: 20 },
  li: { label: "LinkedIn", xp: 20 },
  irl: { label: "Catch-up", xp: 25 },
  event: { label: "Event", xp: 35 },
} as const;

export const VERD = { good: "Good call", neutral: "Neutral", bad: "Bad call" } as const;

export const ATTRS = [
  { name: "Strength", cats: ["training"], v: "--c-training" },
  { name: "Charisma", cats: ["social"], v: "--c-social" },
  { name: "Spirit", cats: ["faith"], v: "--c-faith" },
  { name: "Focus", cats: ["mind", "admin"], v: "--c-mind" },
  { name: "Hustle", cats: ["clients", "side"], v: "--c-clients" },
  { name: "Wealth", cats: ["money"], v: "--c-money" },
  { name: "Mastery", cats: ["adjudication"], v: "--c-adjudication" },
];

export const blankSheet = (): Sheet => ({
  name: "",
  about: "",
  chapter: [],
  skills: [],
  feats: [],
  stepGoal: 10000,
  kcalTarget: null,
  weightGoal: null,
});

/** Generic starters for a brand-new log. Personal missions come in through the UI or an import. */
const STARTERS: Omit<Quest, "id" | "created">[] = [
  { title: "Gym session", cat: "training", kind: "counter", target: 3, period: "week", xp: 25, progress: 0 },
  { title: "Clear the inbox", cat: "admin", kind: "daily", xp: 10 },
  { title: "Log every spend today", cat: "money", kind: "daily", xp: 10 },
];

export function blankData(now = Date.now()): Data {
  return {
    quests: STARTERS.map((q, i) => ({ ...q, id: "ex" + i, starter: true, created: now + i })),
    journal: [],
    workouts: [],
    social: [],
    money: [],
    meals: [],
    days: [],
    stats: blankStats(),
    coach: { items: [] },
    sheet: blankSheet(),
    release: blankRelease(),
    prefs: blankPrefs(guessCurrency()),
    tomb: {},
    savedAt: 0,
  };
}

/** Fill gaps in stored or imported data so older saves keep loading. */
export function normalize(raw: unknown): Data {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<Data>;
  const arr = <T>(x: T[] | undefined) => (Array.isArray(x) ? x : []);
  return {
    quests: arr(d.quests),
    journal: arr(d.journal),
    workouts: arr(d.workouts),
    social: arr(d.social),
    money: arr(d.money),
    meals: arr(d.meals),
    days: arr(d.days),
    stats: { ...blankStats(), ...(d.stats || {}) },
    coach: { items: [], ...(d.coach || {}) },
    sheet: { ...blankSheet(), ...(d.sheet || {}) },
    release: { ...blankRelease(), ...(d.release || {}) },
    prefs: normalizePrefs(d.prefs, Number(d.savedAt) > 0),
    tomb: d.tomb && typeof d.tomb === "object" ? d.tomb : {},
    savedAt: Number(d.savedAt) || 0,
  };
}
