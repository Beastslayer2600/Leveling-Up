import { stepCounter } from "./missions.js";
import { applyAward, CAT, PLAYER_BASE, levelOf } from "./xp.js";
import type { CatId, Data } from "./types.js";

/**
 * An activity event from another app (an adjudication report, a closed case…).
 * Only a type, a category, a count and a date cross over: never names, ids or notes.
 */
export interface LevelEvent {
  source: "adjudicator" | "advisor" | "manual";
  /** e.g. "adjudication.report_submitted" */
  type: string;
  category: CatId;
  xp: number;
  /** `${source}:${type}:${opaqueHash}`. The same key never pays twice. */
  idempotencyKey: string;
  /** Advance open counter missions in this category whose title contains this text. */
  progress?: string;
  /** Tick an open one-off quest in this category whose title contains this text. */
  completeQuest?: string;
}

export interface EventResult {
  data: Data;
  applied: boolean;
  /** Event achievements to check (time of day, tally). */
  events: string[];
  levelBefore: number;
  levelAfter: number;
}

const has = (title: string, needle?: string) =>
  !!needle && title.toLowerCase().includes(needle.toLowerCase());

/**
 * Pay an event: XP, streak, log and counters; progress matching counters; tick a matching quest.
 * Pure. Achievement data checks run afterwards via `checkAchievements`.
 */
export function applyEvent(data: Data, ev: LevelEvent, now: Date = new Date()): EventResult {
  if (!ev.idempotencyKey || data.stats.events[ev.idempotencyKey] || !CAT[ev.category] || !(ev.xp >= 0)) {
    const lv = levelOf(data.stats.xp, PLAYER_BASE).level;
    return { data, applied: false, events: [], levelBefore: lv, levelAfter: lv };
  }

  const xp = Math.min(500, Math.round(ev.xp));
  const first = applyAward(
    data.stats,
    {
      delta: xp,
      title: ev.type,
      cat: ev.category,
      mut: (st) => {
        st.events[ev.idempotencyKey] = now.getTime();
        st.n["c_" + ev.category] = (st.n["c_" + ev.category] || 0) + 1;
        st.n["e_" + ev.type] = (st.n["e_" + ev.type] || 0) + 1;
      },
    },
    now,
  );
  let stats = first.stats;
  const events = [...first.events];
  const quests = data.quests.map((q) => {
    if (q.cat !== ev.category) return q;
    if (q.kind === "counter" && has(q.title, ev.progress)) {
      const r = stepCounter(q, 1, now);
      if (!r) return q;
      const a = applyAward(stats, r.award, now);
      stats = a.stats;
      events.push(...a.events);
      return r.quest;
    }
    if (q.kind === "quest" && !q.done && has(q.title, ev.completeQuest)) {
      return { ...q, done: true, doneAt: now.getTime() };
    }
    return q;
  });

  return {
    data: { ...data, stats, quests },
    applied: true,
    events: [...new Set(events)],
    levelBefore: first.levelBefore,
    levelAfter: levelOf(stats.xp, PLAYER_BASE).level,
  };
}

/** The integration table from the brief. Hooks call these instead of hand-rolling events. */
export const EVENT_TYPES = {
  "adjudication.report_submitted": { category: "adjudication", xp: 25 },
  "adjudication.session_logged": { category: "adjudication", xp: 50 },
  "adjudication.booking_confirmed": { category: "adjudication", xp: 10, completeQuest: "confirm" },
  "advisor.meeting_held": { category: "clients", xp: 25 },
  "advisor.case_closed": { category: "clients", xp: 50, progress: "close cases" },
  "advisor.study_session": { category: "mind", xp: 10 },
} as const satisfies Record<string, Pick<LevelEvent, "category" | "xp" | "progress" | "completeQuest">>;
