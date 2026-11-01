import { ACH_BY, ACHIEVEMENT_XP, checkAchievements, freshAchievements } from "../lib/leveling/achievements";
import { blankData, normalize } from "../lib/leveling/data";
import { dkey } from "../lib/leveling/dates";
import { catName } from "../lib/leveling/prefs";
import { applyAward, CAT } from "../lib/leveling/xp";
import type { AwardSpec, Data } from "../lib/leveling/types";
import { levelUp, toast, toastAch } from "./fx";

export type Tab = "missions" | "journal" | "body" | "social" | "money" | "character";
export const VIEWS: Tab[] = ["missions", "journal", "body", "social", "money", "character"];

/** Tabs this player has switched on. Missions and Character are always there. */
export const enabledViews = (): Tab[] =>
  VIEWS.filter((v) => v === "missions" || v === "character" || S.data.prefs.modules[v]);

const KEY = "leveling-up.v1";
const TAB_KEY = "leveling-up.tab";

function load(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    /* corrupt or blocked storage: start fresh */
  }
  return blankData();
}

/** UI state alongside the saved data. */
export const S = {
  data: load(),
  tab: "missions" as Tab,
  filter: "all",
  month: dkey().slice(0, 7),
  vSwap: 0,
  armClear: false,
  sheetName: null as string | null,
  editId: null as string | null,
  entryType: "skill" as "chapter" | "skill" | "feat",
  rb: 0,
};

let rerender = () => {};
export const onRender = (f: () => void) => (rerender = f);
export const render = () => rerender();

let afterSave = () => {};
/** Sync registers here to push changes to the server. */
export const onSave = (f: () => void) => (afterSave = f);

/** Write the log to this device only (no push). */
export function persistLocal(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(S.data));
  } catch {
    toast("Couldn't save on this device. Storage may be full or blocked.");
  }
}

export function save(): void {
  S.data.savedAt = Date.now();
  persistLocal();
  afterSave();
}

export function setTab(t: Tab): void {
  S.tab = t;
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    /* tab memory is optional */
  }
  if (location.hash.slice(1) !== t) history.replaceState(null, "", "#" + t);
}

export function initialTab(): Tab {
  const h = location.hash.slice(1) as Tab;
  if (VIEWS.includes(h)) return h;
  try {
    const t = localStorage.getItem(TAB_KEY) as Tab;
    if (VIEWS.includes(t)) return t;
  } catch {
    /* ignore */
  }
  return "missions";
}

/** Upsert a record in one of the collections. */
export function put<K extends "quests" | "journal" | "workouts" | "social" | "money" | "meals" | "days">(
  coll: K,
  obj: Data[K][number],
): void {
  const arr = S.data[coll] as Data[K][number][];
  (obj as { u?: number }).u = Date.now();
  const i = arr.findIndex((x) => x.id === obj.id);
  if (i < 0) arr.push(obj);
  else arr[i] = obj;
  save();
}

export function drop(coll: "quests" | "journal" | "workouts" | "social" | "money" | "meals" | "days", id: string): void {
  (S.data[coll] as { id: string }[]) = (S.data[coll] as { id: string }[]).filter((x) => x.id !== id);
  S.data.tomb = { ...S.data.tomb, [id]: Date.now() };
  save();
}

export const newId = () => "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Apply an XP change, then toast, level-up and event achievements. */
export function award(spec: AwardSpec): void {
  if (!spec.delta && !spec.mut) return;
  const r = applyAward(S.data.stats, spec);
  S.data.stats = r.stats;
  save();
  if (!spec.quiet && spec.delta)
    toast(`${spec.delta > 0 ? "+" : ""}${spec.delta} XP · ${CAT[spec.cat] ? catName(S.data.prefs, spec.cat) : spec.title}`, spec.delta > 0 ? "xp" : "");
  if (r.levelAfter > r.levelBefore) setTimeout(() => levelUp(r.levelAfter), 500);
  const fresh = freshAchievements(r.events, S.data.stats.ach);
  if (fresh.length) setTimeout(() => grant(fresh), 1300);
}

export function grant(ids: string[]): void {
  const fresh = freshAchievements(ids, S.data.stats.ach);
  if (!fresh.length) return;
  const now = Date.now();
  award({
    delta: ACHIEVEMENT_XP * fresh.length,
    title: "Achievement: " + fresh.map((i) => ACH_BY[i].name).join(", "),
    cat: "ach",
    quiet: true,
    noEvents: true,
    mut: (st) => fresh.forEach((i) => (st.ach[i] = now)),
  });
  fresh.forEach((id, k) => setTimeout(() => toastAch(ACH_BY[id].name), k * 2300));
  render();
}

/** Run the data achievement check shortly after a change. */
export const after = () => setTimeout(() => grant(checkAchievements(S.data)), 1500);

export function replaceData(next: Data): void {
  S.data = normalize(next);
  save();
}
