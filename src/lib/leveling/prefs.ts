/* Per-player settings: what the app tracks and how it labels things.
   Everything here lives in the log, so it syncs with the rest of it. */
import type { CatId } from "./types.js";
import { CATS } from "./xp.js";

export type ModuleId = "faith" | "journal" | "body" | "social" | "money";
export type Unit = "kg" | "lb";

export interface Prefs {
  /** Currency symbol shown before amounts, e.g. "R", "$", "€". */
  currency: string;
  unit: Unit;
  modules: Record<ModuleId, boolean>;
  /** Category renames, by id. Missing ids keep the default name. */
  catNames: Partial<Record<CatId, string>>;
  /** Categories switched off (hidden from pickers and the HUD). */
  catOff: CatId[];
  inCats: string[];
  outCats: string[];
  /** True once the player has been through first-run setup. */
  setup: boolean;
}

export const MODULES: { id: ModuleId; name: string; d: string }[] = [
  { id: "faith", name: "Faith", d: "Daily Bible virtue and the 7-day Release Reset" },
  { id: "journal", name: "Journal", d: "Daily debrief with voice notes" },
  { id: "body", name: "Body", d: "Gym, cardio, steps, weight and meals" },
  { id: "social", name: "Social", d: "Posts, catch-ups and friend groups" },
  { id: "money", name: "Money", d: "Monthly ledger with good and bad calls" },
];

export const DEFAULT_OUT_CATS = [
  "Groceries",
  "Eating out & takeaways",
  "Going out",
  "Transport & fuel",
  "Housing & bills",
  "Health & gym",
  "Shopping",
  "Subscriptions",
  "Business & tools",
  "Savings & investing",
  "Gifts & family",
  "Giving",
  "Other",
];
export const DEFAULT_IN_CATS = ["Salary", "Clients & freelance", "Side income", "Gifts", "Other income"];

/** Generic names for the two categories that started out personal. */
const GENERIC_NAMES: Partial<Record<CatId, string>> = { clients: "Work", adjudication: "Craft" };

/** Logs from before settings existed: keep the labels they were built with. */
const LEGACY: Pick<Prefs, "currency" | "catNames" | "inCats" | "outCats"> = {
  currency: "R",
  catNames: {},
  inCats: ["Salary & commission", "Studio clients", "Adjudication fees", "Side income", "Other income"],
  outCats: [...DEFAULT_OUT_CATS.slice(0, 11), "Giving & tithe", "Other"],
};

export const CURRENCIES = ["R", "$", "€", "£", "₹", "¥", "₦", "KSh", "A$", "C$", "NZ$", "CHF", "kr", "R$"];

/** Best guess at a currency from the browser's region; the player can change it. */
export function guessCurrency(lang = typeof navigator !== "undefined" ? navigator.language : ""): string {
  const region = (lang.split("-")[1] || "").toUpperCase();
  const by: Record<string, string> = {
    ZA: "R", US: "$", GB: "£", IE: "€", DE: "€", FR: "€", NL: "€", ES: "€", IT: "€", PT: "€", BE: "€", AT: "€", FI: "€",
    IN: "₹", JP: "¥", CN: "¥", NG: "₦", KE: "KSh", AU: "A$", CA: "C$", NZ: "NZ$", CH: "CHF", SE: "kr", NO: "kr", DK: "kr", BR: "R$",
  };
  return by[region] || "$";
}

export function blankPrefs(currency = "$"): Prefs {
  return {
    currency,
    unit: "kg",
    modules: { faith: true, journal: true, body: true, social: true, money: true },
    catNames: { ...GENERIC_NAMES },
    catOff: [],
    inCats: [...DEFAULT_IN_CATS],
    outCats: [...DEFAULT_OUT_CATS],
    setup: false,
  };
}

const cleanList = (v: unknown, fallback: string[]) => {
  const out = Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 30) : [];
  return out.length ? out : fallback;
};

/**
 * Settings from a stored log. A log saved before settings existed keeps its original
 * labels (Rand, Clients, Adjudication) and skips first-run setup.
 */
export function normalizePrefs(raw: unknown, legacyLog: boolean): Prefs {
  const base = blankPrefs(guessCurrency());
  if (!raw || typeof raw !== "object") {
    return legacyLog ? { ...base, ...LEGACY, catNames: { ...LEGACY.catNames }, setup: true } : base;
  }
  const p = raw as Partial<Prefs>;
  const ids = new Set(CATS.map((c) => c.id));
  const names: Partial<Record<CatId, string>> = {};
  for (const [k, v] of Object.entries(p.catNames || {})) {
    const n = String(v ?? "").trim().slice(0, 24);
    if (ids.has(k as CatId) && n) names[k as CatId] = n;
  }
  return {
    currency: String(p.currency ?? base.currency).trim().slice(0, 4) || base.currency,
    unit: p.unit === "lb" ? "lb" : "kg",
    modules: { ...base.modules, ...(p.modules || {}) },
    catNames: names,
    catOff: Array.isArray(p.catOff) ? p.catOff.filter((c) => ids.has(c)) : [],
    inCats: cleanList(p.inCats, base.inCats),
    outCats: cleanList(p.outCats, base.outCats),
    setup: !!p.setup,
  };
}

/** Display name for a category under these settings. */
export const catName = (prefs: Prefs, id: string): string =>
  prefs.catNames[id as CatId] || CATS.find((c) => c.id === id)?.name || id;

/** Categories the player uses, in display order. Never empty. */
export function activeCats(prefs: Prefs) {
  const on = CATS.filter((c) => !prefs.catOff.includes(c.id));
  return on.length ? on : CATS;
}

/** Sensible weight bounds for validation in the player's unit. */
export const weightRange = (unit: Unit): [number, number] => (unit === "lb" ? [44, 660] : [20, 300]);
