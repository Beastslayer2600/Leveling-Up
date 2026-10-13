import { dkey, yday } from "./dates";
import type { AwardSpec, CatId, Stats } from "./types";

export interface Category {
  id: CatId;
  name: string;
  /** CSS custom property holding the category colour. */
  v: string;
}

export const CATS: Category[] = [
  { id: "clients", name: "Clients", v: "--c-clients" },
  { id: "admin", name: "Admin", v: "--c-admin" },
  { id: "training", name: "Training", v: "--c-training" },
  { id: "adjudication", name: "Adjudication", v: "--c-adjudication" },
  { id: "social", name: "Social", v: "--c-social" },
  { id: "money", name: "Money", v: "--c-money" },
  { id: "faith", name: "Faith", v: "--c-faith" },
  { id: "mind", name: "Mind", v: "--c-mind" },
  { id: "side", name: "Side Quests", v: "--c-side" },
];
export const CAT: Record<string, Category> = Object.fromEntries(CATS.map((c) => [c.id, c]));

export const DIFF = {
  easy: { label: "Easy", xp: 10 },
  std: { label: "Standard", xp: 25 },
  hard: { label: "Hard", xp: 50 },
  boss: { label: "Boss", xp: 100 },
} as const;
export type DiffId = keyof typeof DIFF;

export const RANKS: [number, string][] = [
  [1, "Recruit"],
  [3, "Rookie"],
  [5, "Field Agent"],
  [8, "Operator"],
  [12, "Specialist"],
  [16, "Veteran"],
  [21, "Elite"],
  [30, "Legend"],
];

/** Player levels cost 100 × L XP to go from L to L+1. */
export const PLAYER_BASE = 100;
/** Category levels cost 50 × L. */
export const CATEGORY_BASE = 50;

export function levelOf(xp: number, base: number) {
  let level = 1;
  let r = Math.max(0, xp || 0);
  while (r >= base * level) {
    r -= base * level;
    level++;
  }
  return { level, into: r, need: base * level };
}

export function rankOf(level: number): string {
  let title = RANKS[0][1];
  for (const [min, name] of RANKS) if (level >= min) title = name;
  return title;
}

export const blankStats = (): Stats => ({
  xp: 0,
  cat: {},
  streak: 0,
  lastDay: null,
  dayKey: null,
  dayXp: 0,
  dayCats: [],
  dayHard: 0,
  log: [],
  n: {},
  ach: {},
  virtue: { count: 0, fruits: [] },
  events: {},
});

export interface AwardResult {
  stats: Stats;
  /** Event-based achievement ids triggered by this award (not yet filtered). */
  events: string[];
  levelBefore: number;
  levelAfter: number;
}

/**
 * Apply one XP change. Pure: returns a new Stats.
 * Updates total + category XP, today's tally, the streak, the XP log, and
 * collects time-of-day / tally achievements.
 */
export function applyAward(prev: Stats, spec: AwardSpec, now: Date = new Date()): AwardResult {
  const st: Stats = structuredClone({ ...blankStats(), ...prev });
  const { delta, title, cat } = spec;
  const levelBefore = levelOf(st.xp, PLAYER_BASE).level;
  st.xp = Math.max(0, st.xp + delta);
  st.cat[cat] = Math.max(0, (st.cat[cat] || 0) + delta);
  const t = dkey(now);
  if (st.dayKey !== t) {
    st.dayKey = t;
    st.dayXp = 0;
    st.dayCats = [];
    st.dayHard = 0;
  }
  st.dayXp = Math.max(0, st.dayXp + delta);
  const events = [...(spec.events || [])];
  if (spec.mut) spec.mut(st, events);
  if (delta > 0) {
    if (st.lastDay !== t) {
      st.streak = st.lastDay === yday(now) ? st.streak + 1 : 1;
      st.lastDay = t;
    }
    st.log = [{ t: now.getTime(), title, xp: delta, cat }, ...st.log].slice(0, 25);
    if (!spec.noEvents) {
      const h = now.getHours();
      if (h < 4) events.push("nightowl");
      else if (h < 6) events.push("earlybird");
      if (st.dayXp === 100) events.push("deadeye");
      if (CAT[cat]) {
        st.dayCats = [...new Set([...st.dayCats, cat])];
        if (st.dayCats.length >= 6) events.push("renaissance");
      }
    }
  }
  return {
    stats: st,
    events: [...new Set(events)],
    levelBefore,
    levelAfter: levelOf(st.xp, PLAYER_BASE).level,
  };
}

/** Streak as displayed: it lapses once a full day passes with no XP. */
export function liveStreak(st: Stats, now: Date = new Date()): number {
  return st.lastDay === dkey(now) || st.lastDay === yday(now) ? st.streak : 0;
}
