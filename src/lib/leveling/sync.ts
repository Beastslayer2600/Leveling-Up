import { normalize } from "./data";
import { applyEvent, EVENT_TYPES } from "./events";
import type { Data, Stats } from "./types";

const COLLS = ["quests", "journal", "workouts", "social", "money", "meals", "days"] as const;

type Rec = { id: string; u?: number };

/** Union two copies of a collection by id. The later edit wins; tombstoned records stay gone. */
function mergeColl<T extends Rec>(a: T[], b: T[], tomb: Record<string, number>): T[] {
  const out = new Map<string, T>();
  for (const x of [...a, ...b]) {
    const prev = out.get(x.id);
    if (!prev || (x.u || 0) >= (prev.u || 0)) out.set(x.id, x);
  }
  return [...out.values()].filter((x) => !(tomb[x.id] && tomb[x.id] >= (x.u || 0)));
}

function mergeStats(newer: Stats, older: Stats): Stats {
  const ach = { ...older.ach };
  for (const [k, t] of Object.entries(newer.ach)) ach[k] = ach[k] ? Math.min(ach[k], t) : t;
  return { ...newer, ach, events: { ...older.events, ...newer.events } };
}

/**
 * Combine the server copy with this device's copy after both changed.
 * Records merge one by one; stats, sheet and the rest come from whichever copy was saved last,
 * keeping every unlocked achievement and every paid event from both.
 */
export function mergeData(serverRaw: unknown, localRaw: unknown): Data {
  const s = normalize(serverRaw);
  const l = normalize(localRaw);
  const tomb: Record<string, number> = { ...s.tomb };
  for (const [k, t] of Object.entries(l.tomb)) tomb[k] = Math.max(tomb[k] || 0, t);
  const localNewer = (l.savedAt || 0) >= (s.savedAt || 0);
  const [newer, older] = localNewer ? [l, s] : [s, l];
  const out: Data = {
    ...newer,
    stats: mergeStats(newer.stats, older.stats),
    tomb,
    savedAt: Math.max(s.savedAt || 0, l.savedAt || 0),
  };
  for (const c of COLLS) (out[c] as Rec[]) = mergeColl(s[c] as Rec[], l[c] as Rec[], tomb);
  return out;
}

export interface ServerEvent {
  key: string;
  type: string;
}

/** Pay any server-recorded events this log hasn't paid yet. Returns the new data and how much XP landed. */
export function applyServerEvents(data: Data, events: ServerEvent[], now: Date = new Date()) {
  let d = data;
  let xp = 0;
  const achEvents: string[] = [];
  for (const e of events) {
    const def = EVENT_TYPES[e.type as keyof typeof EVENT_TYPES];
    if (!def || d.stats.events[e.key]) continue;
    const before = d.stats.xp;
    const r = applyEvent(d, { source: e.key.startsWith("advisor") ? "advisor" : "adjudicator", type: e.type, idempotencyKey: e.key, ...def }, now);
    if (!r.applied) continue;
    d = r.data;
    xp += d.stats.xp - before;
    achEvents.push(...r.events);
  }
  return { data: d, xp, events: achEvents };
}

/** Drop old tombstones so the log doesn't grow forever. */
export function pruneTombs(tomb: Record<string, number>, now = Date.now(), days = 120): Record<string, number> {
  const cut = now - days * 864e5;
  return Object.fromEntries(Object.entries(tomb).filter(([, t]) => t >= cut));
}
