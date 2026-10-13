import { daysAgoKey, parseD } from "./dates";
import { CATEGORY_BASE, CATS, PLAYER_BASE, levelOf } from "./xp";
import type { Data } from "./types";

export interface Ctx {
  n: Record<string, number>;
  gym: number;
  cardio: number;
  km: number;
  pbs: number;
  maxSteps: number;
  wDays: number;
  home: number;
  irl30: number;
  posts: number;
  comeback: boolean;
  good: number;
  bad: number;
  black: boolean;
  virtues: number;
  fruits: number;
  streak: number;
  level: number;
  rrDone: boolean;
  reach: number;
  poly: number;
  journalDays: number;
  voiceNotes: number;
}

export interface Achievement {
  id: string;
  name: string;
  d: string;
  hidden?: boolean;
  /** Data check. Achievements without one are granted by events. */
  f?: (c: Ctx) => boolean;
}

export const ACHIEVEMENT_XP = 50;

export const ACH: Achievement[] = [
  { id: "first", name: "First Blood", d: "Complete your first mission.", f: (c) => (c.n.missions || 0) >= 1 },
  { id: "hattrick", name: "Hat Trick", d: "Finish three daily ops in one day." },
  { id: "boss", name: "Boss Slayer", d: "Complete a Boss-difficulty mission.", f: (c) => (c.n.boss || 0) >= 1 },
  { id: "closer", name: "The Closer", d: "Hit a tracked Clients target.", f: (c) => (c.n.closer || 0) >= 1 },
  { id: "adjeye", name: "Adjudicator's Eye", d: "Complete 5 adjudication missions.", f: (c) => (c.n.c_adjudication || 0) >= 5 },
  { id: "iron", name: "Iron Initiate", d: "Log your first gym session.", f: (c) => c.gym >= 1 },
  { id: "pbhunter", name: "PB Hunter", d: "Set 5 personal bests.", f: (c) => c.pbs >= 5 },
  { id: "cardio", name: "Cardio Convert", d: "Log 5 cardio sessions.", f: (c) => c.cardio >= 5 },
  { id: "marathon", name: "Marathoner", d: "Cover 42.2 km of cardio in total.", f: (c) => c.km >= 42.2 },
  { id: "tenk", name: "10K Day", d: "Walk 10 000 steps in a day.", f: (c) => c.maxSteps >= 10000 },
  { id: "steplord", name: "Step Lord", d: "Walk 20 000 steps in a single day.", hidden: true, f: (c) => c.maxSteps >= 20000 },
  { id: "scale", name: "Scale Watcher", d: "Log your weight on 10 different days.", f: (c) => c.wDays >= 10 },
  { id: "chef", name: "Home Chef", d: "Log 10 home-made meals.", f: (c) => c.home >= 10 },
  { id: "butterfly", name: "Social Butterfly", d: "8 catch-ups or events in 30 days.", f: (c) => c.irl30 >= 8 },
  { id: "content", name: "Content Machine", d: "Publish 10 posts across Instagram and LinkedIn.", f: (c) => c.posts >= 10 },
  { id: "comeback", name: "The Comeback", d: "Reconnect with a group after a month apart.", hidden: true, f: (c) => c.comeback },
  { id: "pincher", name: "Penny Pincher", d: "Log 10 good-call spends.", f: (c) => c.good >= 10 },
  { id: "confess", name: "Confession Booth", d: "Own up to 5 bad-call spends.", hidden: true, f: (c) => c.bad >= 5 },
  { id: "black", name: "In the Black", d: "Finish a month with more in than out.", f: (c) => c.black },
  { id: "journal7", name: "Field Notes", d: "Journal on 7 different days.", f: (c) => c.journalDays >= 7 },
  { id: "voice", name: "On the Record", d: "Save a voice note in your journal.", hidden: true, f: (c) => c.voiceNotes >= 1 },
  { id: "grateful", name: "Grateful Heart", d: "Complete 7 daily virtues.", f: (c) => c.virtues >= 7 },
  { id: "fruit", name: "Fruit of the Spirit", d: "Practise all nine fruits of the Spirit (Galatians 5).", f: (c) => c.fruits >= 9 },
  { id: "openhand", name: "Open Hand", d: "Finish the 7-day Release Reset.", f: (c) => c.rrDone },
  { id: "returner", name: "Return Again", d: "Use the reach-back tool 5 times. Coming back is part of it.", hidden: true, f: (c) => c.reach >= 5 },
  { id: "sabbath", name: "Sabbath Keeper", d: "Complete a daily virtue on a Sunday.", hidden: true },
  { id: "streak7", name: "On a Roll", d: "Keep a 7-day streak.", f: (c) => c.streak >= 7 },
  { id: "streak30", name: "Unbreakable", d: "Keep a 30-day streak.", f: (c) => c.streak >= 30 },
  { id: "lvl5", name: "Field Agent", d: "Reach level 5.", f: (c) => c.level >= 5 },
  { id: "lvl10", name: "Double Digits", d: "Reach level 10.", f: (c) => c.level >= 10 },
  { id: "poly", name: "Polymath", d: "Reach LV3 in five categories.", f: (c) => c.poly >= 5 },
  { id: "recruited", name: "Recruited", d: "Accept a mission from the Coach." },
  { id: "deadeye", name: "Deadeye", d: "Land exactly 100 XP in one day. A sharpshooter's grouping.", hidden: true },
  { id: "pressure", name: "Pressure Is a Privilege", d: "Clear 3 Hard or Boss missions in one day.", hidden: true },
  { id: "renaissance", name: "Renaissance Man", d: "Earn XP in 6 categories in one day.", hidden: true },
  { id: "nightowl", name: "Night Owl", d: "Earn XP between midnight and 4am.", hidden: true },
  { id: "earlybird", name: "Early Bird", d: "Earn XP between 4am and 6am.", hidden: true },
  { id: "curious", name: "Curious Cat", d: "Poke the level badge seven times.", hidden: true },
];

export const ACH_BY: Record<string, Achievement> = Object.fromEntries(ACH.map((a) => [a.id, a]));

const sum = <T>(a: T[], f: (x: T) => unknown) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);

export function ctx(data: Data, now: Date = new Date()): Ctx {
  const st = data.stats;
  const gym = data.workouts.filter((w) => w.type === "gym");
  const cardio = data.workouts.filter((w) => w.type === "cardio");
  const d30 = daysAgoKey(30, now);
  const irl = data.social.filter((s) => s.kind === "irl" || s.kind === "event");

  let comeback = false;
  const lastByGroup: Record<string, string> = {};
  for (const s of [...irl].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!s.group) continue;
    const k = s.group.trim().toLowerCase();
    if (lastByGroup[k] && (parseD(s.date).getTime() - parseD(lastByGroup[k]).getTime()) / 864e5 >= 30) comeback = true;
    lastByGroup[k] = s.date;
  }

  const months: Record<string, { i: number; o: number }> = {};
  for (const m of data.money) {
    const k = (m.date || "").slice(0, 7);
    months[k] ??= { i: 0, o: 0 };
    months[k][m.dir === "in" ? "i" : "o"] += +m.amount || 0;
  }

  return {
    n: st.n || {},
    gym: gym.length,
    cardio: cardio.length,
    km: sum(cardio, (w) => w.km),
    pbs: sum(gym, (w) => w.pbs),
    maxSteps: Math.max(0, ...data.days.map((d) => +(d.steps || 0))),
    wDays: data.days.filter((d) => d.weight).length,
    home: data.meals.filter((m) => m.src === "home").length,
    irl30: irl.filter((s) => s.date >= d30).length,
    posts: data.social.filter((s) => s.kind === "ig" || s.kind === "li").length,
    comeback,
    good: data.money.filter((m) => m.verdict === "good").length,
    bad: data.money.filter((m) => m.verdict === "bad").length,
    black: Object.values(months).some((x) => x.i > 0 && x.o > 0 && x.i > x.o),
    virtues: st.virtue?.count || 0,
    fruits: (st.virtue?.fruits || []).length,
    streak: st.streak || 0,
    level: levelOf(st.xp, PLAYER_BASE).level,
    rrDone: (data.release.cycles || 0) > 0 || Object.keys(data.release.days || {}).length >= 7,
    reach: data.release.reach || 0,
    journalDays: new Set(data.journal.map((e) => e.date)).size,
    voiceNotes: data.journal.filter((e) => e.audio).length,
    poly: CATS.filter((c) => levelOf(st.cat[c.id] || 0, CATEGORY_BASE).level >= 3).length,
  };
}

/** Data-driven achievements now met but not yet unlocked. */
export function checkAchievements(data: Data, now: Date = new Date()): string[] {
  const c = ctx(data, now);
  return ACH.filter((a) => a.f && !data.stats.ach[a.id] && a.f(c)).map((a) => a.id);
}

/** Keep only real, not-yet-unlocked ids. */
export const freshAchievements = (ids: string[], ach: Record<string, number>) =>
  [...new Set(ids)].filter((id) => ACH_BY[id] && !ach[id]);
