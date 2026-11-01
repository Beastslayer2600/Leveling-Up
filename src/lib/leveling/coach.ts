import { daysAgoKey, daysSince } from "./dates.js";
import { isDone } from "./missions.js";
import { pbMap } from "./training.js";
import { activeCats, catName } from "./prefs.js";
import { CAT, DIFF, PLAYER_BASE, levelOf, type DiffId } from "./xp.js";
import type { Data, Kind, Period, Suggestion } from "./types.js";

const sum = <T>(a: T[], f: (x: T) => unknown) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);

/** Plain-text summary of recent logs for the coach. Never includes the release plan, and skips modules the player switched off. */
export function digest(data: Data, now: Date = new Date()): string {
  const { stats, sheet, prefs } = data;
  const on = prefs.modules;
  const cur = prefs.currency;
  const u = prefs.unit;
  const cn = (id: string) => catName(prefs, id);
  const d14 = daysAgoKey(14, now);
  const d30 = daysAgoKey(30, now);
  const L: string[] = [];
  const open = data.quests.filter((q) => !isDone(q, now));
  L.push(`Level ${levelOf(stats.xp, PLAYER_BASE).level}. Category XP: ${activeCats(prefs).map((c) => `${cn(c.id)} ${stats.cat[c.id] || 0}`).join(", ")}.`);
  L.push(`Open missions: ${open.slice(0, 15).map((q) => `${q.title} [${cn(q.cat)}]`).join("; ") || "none"}.`);
  const sk = sheet.skills.map((s) => `${s.name} ${s.level}/10`).join(", ");
  if (sk) L.push(`Skills: ${sk}.`);
  if (on.body) {
    const w14 = data.workouts.filter((w) => w.date >= d14);
    L.push(`Last 14 days: ${w14.filter((w) => w.type === "gym").length} gym sessions, ${sum(w14.filter((w) => w.type === "cardio"), (w) => w.mins)} cardio minutes.`);
    const st14 = data.days.filter((d) => d.date >= d14 && d.steps != null);
    if (st14.length) L.push(`Average steps (days logged, last 14): ${Math.round(sum(st14, (d) => d.steps) / st14.length)} vs goal ${sheet.stepGoal}.`);
    const ws = data.days.filter((d) => d.weight).sort((a, b) => a.date.localeCompare(b.date));
    if (ws.length >= 2) L.push(`Weight moved from ${ws[0].weight} to ${ws[ws.length - 1].weight} ${u}${sheet.weightGoal ? ` (goal ${sheet.weightGoal} ${u})` : ""}.`);
    const m14 = data.meals.filter((m) => m.date >= d14);
    if (m14.length) {
      const days = new Set(m14.map((m) => m.date)).size;
      L.push(`Meals last 14 days: ${m14.length} logged over ${days} days, ${m14.filter((m) => m.src === "home").length} home-made${m14.some((m) => m.kcal) ? `, avg ${Math.round(sum(m14, (m) => m.kcal) / days)} kcal/day` : ""}${sheet.kcalTarget ? ` (target ${sheet.kcalTarget})` : ""}.`);
  }
  const pbs = Object.values(pbMap(data.workouts)).slice(0, 6);
  if (pbs.length) L.push(`PBs: ${pbs.map((p) => `${p.name} ${p.best.kg ? `${p.best.kg}${u} x${p.best.reps}` : `${p.best.reps} reps`}`).join("; ")}.`);
  }
  if (on.social) {
    const s30 = data.social.filter((s) => s.date >= d30);
    L.push(`Last 30 days social: ${s30.filter((s) => s.kind === "ig").length} Instagram, ${s30.filter((s) => s.kind === "li").length} LinkedIn, ${s30.filter((s) => s.kind === "irl" || s.kind === "event").length} catch-ups/events.`);
    const g: Record<string, string> = {};
    for (const s of data.social) if (s.group) { const k = s.group.trim(); if (!g[k] || s.date > g[k]) g[k] = s.date; }
    const cold = Object.entries(g).filter(([, d]) => daysSince(d, now) > 21).map(([k, d]) => `${k} (${daysSince(d, now)} days)`);
    if (cold.length) L.push(`Friend groups not seen in 3+ weeks: ${cold.slice(0, 6).join(", ")}.`);
  }
  if (on.money) {
    const m30 = data.money.filter((m) => m.date >= d30);
    const out = m30.filter((m) => m.dir === "out");
    const money = (n: number) => `${cur}${Math.round(n)}`;
    L.push(`Last 30 days money: in ${money(sum(m30.filter((m) => m.dir === "in"), (m) => m.amount))}, out ${money(sum(out, (m) => m.amount))}, good calls ${money(sum(out.filter((m) => m.verdict === "good"), (m) => m.amount))}, bad calls ${money(sum(out.filter((m) => m.verdict === "bad"), (m) => m.amount))}.`);
    const bad = out.filter((m) => m.verdict === "bad").slice(0, 8).map((m) => `${m.what} ${money(m.amount)} (${m.cat})`);
    if (bad.length) L.push(`Recent bad-call spends: ${bad.join("; ")}.`);
  }
  if (on.faith) L.push(`Daily virtues completed: ${stats.virtue.count || 0}${stats.virtue.name ? `, last: ${stats.virtue.name}` : ""}.`);
  return L.join("\n");
}

/** The coach prompt. Who the player is comes from their own sheet, never from this file. */
export function buildPrompt(data: Data, focus: string, now: Date = new Date()): string {
  const name = data.sheet.name.trim() || "the player";
  const about = data.sheet.about.trim();
  const { prefs } = data;
  const on = prefs.modules;
  const areas = ["habits", on.body && "health", "character", on.social && "relationships", on.money && "money decisions", "a skill"].filter(Boolean).join(", ");
  const cats = activeCats(prefs);
  return (
    `You are the mission coach inside a gamified life tracker for ${name}.${about ? ` About them: ${about}` : ""}\n\n` +
    `Using their data below${focus ? " and their chosen focus" : ""}, unlock 3 or 4 new missions that would most improve their ${areas}. Make each concrete, doable and measurable, framed like a game mission but plainly worded. Base them on what the data shows (for example repeated bad-call spending, friend groups gone quiet, low steps or cardio, few home-made meals, missing posts).${on.faith ? " Character and faith missions may draw on Bible principles; cite a verse reference in the why when you do." : ""} Do not repeat a mission they already have open. If a mission touches food or appetite, keep it about eating regular, balanced meals, enough protein and cooking more; never restriction, skipping meals or calorie cuts.\n\n` +
    (focus ? `Their focus right now: ${focus}\n\n` : "") +
    `Their data:\n${digest(data, now)}\n\n` +
    `Their mission categories: ${cats.map((c) => `"${c.id}" = ${catName(prefs, c.id)}`).join(", ")}.\n` +
    `Reply with only a JSON array. Each item: {"title": short imperative mission name, "why": one sentence linking it to their data, "cat": one of ${cats.map((c) => `"${c.id}"`).join(", ")}, "kind": "daily" | "quest" | "counter", "target": number (counter only), "period": "week" | "month" | "none" (counter only), "difficulty": "easy" | "std" | "hard" | "boss"}.\n` +
    `Example: [{"title":"Read 20 pages","why":"No skill missions have been open for a while.","cat":"${cats[0].id}","kind":"counter","target":4,"period":"week","difficulty":"std"}]`
  );
}

/** Validate whatever the model returned into at most four safe suggestions, in the categories allowed. */
export function parseSuggestions(raw: unknown, allowed: string[] = Object.keys(CAT)): Suggestion[] {
  const fallback = (allowed.includes("mind") ? "mind" : allowed[0] || "mind") as Suggestion["cat"];
  let v = raw;
  if (typeof v === "string") {
    const m = v.match(/\[[\s\S]*\]/);
    try {
      v = m ? JSON.parse(m[0]) : [];
    } catch {
      v = [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !!(x as { title?: unknown }).title)
    .slice(0, 4)
    .map((x) => {
      const kind: Kind = ["daily", "quest", "counter"].includes(x.kind as string) ? (x.kind as Kind) : "quest";
      const diff: DiffId = (x.difficulty as string) in DIFF ? (x.difficulty as DiffId) : "std";
      const period: Period =
        kind === "counter" && ["week", "month", "none"].includes(x.period as string) ? (x.period as Period) : "week";
      return {
        title: String(x.title).slice(0, 120),
        why: String(x.why || "").slice(0, 220),
        cat: CAT[x.cat as string] && allowed.includes(x.cat as string) ? (x.cat as Suggestion["cat"]) : fallback,
        kind,
        target: kind === "counter" ? Math.max(1, Math.min(99, parseInt(String(x.target), 10) || 3)) : null,
        period,
        xp: DIFF[diff].xp,
      };
    });
}
