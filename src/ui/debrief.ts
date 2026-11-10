/* Evening Debrief: one screen per step, about ten minutes. Every choice tomorrow morning
   needs is made here, so the morning has none left. */
import { RHYTHM } from "../lib/leveling/config";
import { parseD } from "../lib/leveling/dates";
import {
  completeDebriefStep,
  currentDebriefStep,
  debriefDate,
  debriefDone,
  debriefStepXp,
  doneOn,
  nextDate,
  officePlan,
  screensDownBy,
  skipDebriefStep,
} from "../lib/leveling/debrief";
import { nextStepOf, workable } from "../lib/leveling/missions";
import { catName } from "../lib/leveling/prefs";
import { dayFor, wakeTimeFor } from "../lib/leveling/rhythm";
import { awardTotal } from "../lib/leveling/xp";
import type { DailyRecord, DayPlan, DebriefRun, Quest, RhythmDay } from "../lib/leveling/types";
import { $, ICON, cvar, esc } from "./dom";
import { toast } from "./fx";
import { longDate, rhythmOn, shell } from "./focus";
import { S, after, award, newId, put, render } from "./state";

const D = RHYTHM.debrief;
const O = RHYTHM.morning.office;

/** What's been tapped and typed on the current screen, before the step is completed. */
const draft = {
  date: "",
  extra: "",
  feeling: "",
  other: "",
  cause: "",
  open: "",
  rec: {} as DailyRecord,
  note: "",
  office: false,
  arrive: O.defaultArrive,
  travel: String(O.defaultTravelMins),
  main: "",
  /** The player has chosen (or cleared) the main quest, so the default no longer applies. */
  mainTouched: false,
  must: [] as string[],
  next: {} as Record<string, string>,
  prep: {} as Record<string, boolean>,
  breakfast: "",
};
type TextKey = "extra" | "other" | "cause" | "open" | "note" | "arrive" | "travel" | "breakfast";

const day = (): RhythmDay => dayFor(S.data.rhythm, debriefDate());
const tomorrow = (): RhythmDay => dayFor(S.data.rhythm, nextDate(debriefDate()));
const pool = (): Quest[] =>
  S.data.quests.filter((q) => workable(q, S.data.quests)).sort((a, b) => Number(!!b.main) - Number(!!a.main) || a.created - b.created);

/** Start each evening from what's already known: tomorrow's plan if there is one, else today's choices. */
function ensureDraft(): void {
  const date = debriefDate();
  if (draft.date === date) return;
  const d = day();
  const t = tomorrow().plan || {};
  const ids = new Set(pool().map((q) => q.id));
  const keep = (id?: string) => (id && ids.has(id) ? id : "");
  Object.assign(draft, {
    date,
    extra: "",
    feeling: d.debrief?.feeling || "",
    other: "",
    cause: d.debrief?.cause || "",
    open: d.debrief?.open || "",
    rec: { ...(d.record || {}) },
    note: d.record?.note || "",
    office: !!t.office,
    arrive: O.defaultArrive,
    travel: String(O.defaultTravelMins),
    main: keep(t.mainQuestId) || keep(d.plan?.mainQuestId) || "",
    mainTouched: false,
    must: (t.mustDoIds || d.plan?.mustDoIds || []).filter((id) => ids.has(id)).slice(0, D.mustDoCount),
    next: {},
    prep: { ...(d.debrief?.prep || {}) },
    breakfast: t.breakfast || d.plan?.breakfast || "",
  });
  draft.must = draft.must.filter((id) => id !== draft.main);
}

const withRun = (d: RhythmDay, patch: Partial<DebriefRun>): RhythmDay => ({ ...d, debrief: { ...(d.debrief || { steps: {}, xp: 0 }), ...patch } });

function savePlan(patch: Partial<DayPlan>): void {
  const t = tomorrow();
  const plan: DayPlan = { ...t.plan, ...patch };
  (Object.keys(plan) as (keyof DayPlan)[]).forEach((k) => plan[k] === undefined && delete plan[k]);
  put("rhythm", { ...t, plan });
}

/* ---------- actions ---------- */

function finish(base: RhythmDay, stepId: string, patch: Partial<DebriefRun> = {}): void {
  const r = completeDebriefStep(base, stepId, Date.now(), patch);
  if (!r) return;
  put("rhythm", r.day);
  award({ ...r.award, quiet: true });
  toast(`+${awardTotal(r.award)} XP · ${r.award.title.split(": ")[1]}`, "xp");
  after();
}

function done(stepId: string): void {
  const d = day();
  switch (stepId) {
    case "feeling": {
      const feeling = draft.feeling || draft.other.trim();
      if (!feeling) return toast("Tap a feeling or type one. Or skip this step.");
      const cause = draft.cause.trim();
      const open = draft.open.trim();
      if (S.data.prefs.modules.journal) {
        const text = [`I felt ${feeling.toLowerCase()}.`, cause && `What caused it: ${cause}`, open && `Still open: ${open}`].filter(Boolean).join("\n");
        put("journal", { id: newId(), date: d.date, created: Date.now(), prompt: D.feelingPrompt, text, mood: null, audio: null, xp: 0 });
      }
      return finish(d, stepId, { feeling, cause, open });
    }
    case "record": {
      const rec: DailyRecord = { ...draft.rec };
      if (!Object.values(rec).some((v) => typeof v === "number")) return toast("Tap at least one rating. Or skip this step.");
      if (draft.note.trim()) rec.note = draft.note.trim().slice(0, 200);
      return finish({ ...d, record: rec }, stepId);
    }
    case "where":
      savePlan(draft.office ? officePlan(draft.arrive || O.defaultArrive, Number(draft.travel)) : { office: false, leaveBy: undefined, wakeTime: undefined });
      return finish(d, stepId);
    case "quests": {
      const chosen = [draft.main, ...draft.must].map((id) => S.data.quests.find((q) => q.id === id)).filter((q): q is Quest => !!q);
      if (pool().length && !draft.main) return toast("Pick a main quest. Or skip this step.");
      const bare = chosen.find((q) => !nextStepOf(q) && !(draft.next[q.id] || "").trim());
      if (bare) return toast(`Set a next step for "${bare.title}".`);
      for (const q of chosen) if (!nextStepOf(q)) put("quests", { ...q, nextStep: draft.next[q.id].trim().slice(0, 200) });
      savePlan({ mainQuestId: draft.main || undefined, mustDoIds: draft.must.length ? [...draft.must] : undefined });
      return finish(d, stepId);
    }
    case "prep":
      savePlan({ breakfast: draft.breakfast.trim().slice(0, 80) || undefined });
      return finish(d, stepId, { prep: { ...draft.prep } });
    default:
      return finish(d, stepId);
  }
}

export function debriefAct(a: string, b: HTMLElement): void {
  ensureDraft();
  const d = day();
  const step = currentDebriefStep(d);
  const v = b.dataset.v || "";
  switch (a) {
    case "done":
      if (step) done(step.id);
      break;
    case "skip":
      if (step) put("rhythm", skipDebriefStep(d, step.id, Date.now()));
      break;
    case "add": {
      const text = draft.extra.trim().slice(0, 120);
      if (!text) break;
      put("rhythm", withRun(d, { extra: [...(d.debrief?.extra || []), text] }));
      draft.extra = "";
      break;
    }
    case "feel":
      draft.feeling = draft.feeling === v ? "" : v;
      if (draft.feeling) draft.other = "";
      break;
    case "rate": {
      const k = b.dataset.k as keyof DailyRecord;
      (draft.rec as Record<string, number | null>)[k] = draft.rec[k] === +v ? null : +v;
      break;
    }
    case "where":
      draft.office = v === "office";
      break;
    case "main":
      draft.mainTouched = true;
      draft.main = draft.main === v ? "" : v;
      draft.must = draft.must.filter((id) => id !== draft.main);
      break;
    case "must":
      if (draft.must.includes(v)) draft.must = draft.must.filter((id) => id !== v);
      else if (draft.must.length >= D.mustDoCount) toast(`${D.mustDoCount} must-dos is the limit. Tap one to swap it out.`);
      else draft.must.push(v);
      break;
    case "prep":
      draft.prep[v] = !draft.prep[v];
      break;
  }
  render();
}

/** Typing lands in the draft without redrawing; a committed change to a live field redraws. */
export function debriefInput(el: HTMLInputElement, committed: boolean): void {
  if (el.dataset.next) draft.next[el.dataset.next] = el.value;
  else if (el.dataset.d) {
    draft[el.dataset.d as TextKey] = el.value;
    if (el.dataset.d === "other" && el.value.trim()) draft.feeling = "";
  }
  if (committed && el.hasAttribute("data-live")) render();
}

/* ---------- screens ---------- */

const field = (key: TextKey, label: string, ph: string, extra = "") =>
  `<label class="fx-fld"><span>${label}</span><input class="in" data-d="${key}" value="${esc(draft[key])}" placeholder="${esc(ph)}" maxlength="200" autocomplete="off"${extra}></label>`;

const pressed = (on: boolean) => ` aria-pressed="${on}"`;

function todayScreen(d: RhythmDay): string {
  const items = [...doneOn(S.data, d.date), ...(d.debrief?.extra || [])];
  return (
    (items.length ? `<ul class="fx-list">${items.map((t) => `<li>${ICON.check}<span>${esc(t)}</span></li>`).join("")}</ul>` : `<p class="fx-hint">Nothing logged yet. Add what you did.</p>`) +
    `<div class="fx-add">${field("extra", "Anything missing?", "e.g. Called the plumber")}<button class="btn" type="button" data-r="add">Add</button></div>`
  );
}

function feelingScreen(): string {
  return (
    `<div class="fx-chips">${D.feelings.map((f) => `<button type="button" class="fx-chip" data-r="feel" data-v="${esc(f)}"${pressed(draft.feeling === f)}>${esc(f)}</button>`).join("")}</div>` +
    field("other", "Or in your own word", "") +
    field("cause", "What caused it?", "") +
    field("open", "Is anything still open?", "Leave blank if not")
  );
}

function recordScreen(): string {
  const row = (k: string, label: string, opts: number[], suffix = "") =>
    `<div class="fx-rate"><span>${label}</span><div>${opts.map((n) => `<button type="button" data-r="rate" data-k="${k}" data-v="${n}"${pressed((draft.rec as Record<string, unknown>)[k] === n)}>${n}${suffix}</button>`).join("")}</div></div>`;
  return (
    row("sleepHours", "Sleep last night (hours)", D.sleepHourOptions) +
    D.ratings.map((r) => row(r.id, r.label, [1, 2, 3, 4, 5])).join("") +
    `<p class="fx-scale">1 = low · 5 = high</p>` +
    field("note", "Note (optional)", "One line")
  );
}

function whereScreen(): string {
  let office = "";
  if (draft.office) {
    const p = officePlan(draft.arrive || O.defaultArrive, Number(draft.travel));
    office =
      `<div class="fx-two"><label class="fx-fld"><span>Be there at</span><input class="in" type="time" data-d="arrive" data-live value="${esc(draft.arrive)}"></label>` +
      `<label class="fx-fld"><span>Travel (min)</span><input class="in" type="number" inputmode="numeric" min="0" max="300" data-d="travel" data-live value="${esc(draft.travel)}"></label></div>` +
      `<div class="fx-card"><small>Tomorrow</small><b>Leave by ${p.leaveBy}</b><span>${p.wakeTime ? `Wake at ${p.wakeTime}, for this day only` : `Wake at ${RHYTHM.wakeTime}, as usual`}</span></div>`;
  }
  return (
    `<div class="fx-two"><button type="button" class="fx-big" data-r="where" data-v="home"${pressed(!draft.office)}>Home</button>` +
    `<button type="button" class="fx-big" data-r="where" data-v="office"${pressed(draft.office)}>Office</button></div>${office}`
  );
}

function questsScreen(): string {
  const all = pool();
  // Default to the first main quest, so the common case is a single tap on Done.
  if (!draft.mainTouched && !all.some((q) => q.id === draft.main)) draft.main = all.find((q) => q.main)?.id || "";
  draft.must = draft.must.filter((id) => id !== draft.main && all.some((q) => q.id === id));
  if (!all.length) return `<p class="fx-hint">No open quests on the board. Tomorrow's Briefing will simply say so.</p>`;
  const opt = (q: Quest, kind: "main" | "must", on: boolean) => {
    const next = nextStepOf(q);
    return (
      `<button type="button" class="fx-opt" data-r="${kind}" data-v="${esc(q.id)}" style="--cc:${cvar(q.cat)}"${pressed(on)}><b>${esc(q.title)}</b><span>${esc(next ? "Next: " + next : catName(S.data.prefs, q.cat))}</span></button>` +
      (on && !next ? `<input class="in fx-next" data-next="${esc(q.id)}" value="${esc(draft.next[q.id] || "")}" placeholder="Next step for this quest" maxlength="200" autocomplete="off">` : "")
    );
  };
  return (
    `<p class="fx-pick-h">Main quest</p><div class="fx-pick">${all.map((q) => opt(q, "main", draft.main === q.id)).join("")}</div>` +
    `<p class="fx-pick-h">Must-dos · ${draft.must.length} of ${D.mustDoCount}</p><div class="fx-pick">${all.filter((q) => q.id !== draft.main).map((q) => opt(q, "must", draft.must.includes(q.id))).join("")}</div>`
  );
}

function prepScreen(): string {
  const office = !!tomorrow().plan?.office;
  return (
    `<div class="fx-pick">` +
    D.prep
      .map((p) => {
        const row = `<button type="button" class="fx-check" data-r="prep" data-v="${p.id}"${pressed(!!draft.prep[p.id])}><i>${ICON.check}</i><span>${esc(office && p.office ? p.office : p.label)}</span></button>`;
        return p.id === "breakfast" ? row + field("breakfast", "Breakfast", "Same as yesterday") : row;
      })
      .join("") +
    `</div>`
  );
}

function tomorrowCard(): string {
  const plan = tomorrow().plan;
  const when = parseD(nextDate(debriefDate())).toLocaleDateString("en-ZA", { weekday: "long" });
  return (
    `<div class="fx-card"><small>${when}</small><b>Wake at ${wakeTimeFor(plan)}</b><span>${plan?.office ? `Office day${plan.leaveBy ? ` · leave by ${plan.leaveBy}` : ""}` : "Home day"}</span></div>` +
    `<div class="fx-card"><small>Tonight</small><b>Screens down by ${screensDownBy(plan)}</b></div>`
  );
}

export function renderDebrief(): string {
  ensureDraft();
  const d = day();
  const step = currentDebriefStep(d);
  const r = d.debrief;
  const pips = D.steps.map((s) => (r?.steps[s.id] ? "on" : s === step ? "cur" : "") as "on" | "cur" | "");
  const head = { kicker: longDate(parseD(d.date)), title: D.title, pips };
  if (!step) {
    return shell({
      ...head,
      inner:
        `<div class="fx-body fx-end"><span class="fx-badge night">${ICON.moon}</span><h2 id="fx-title">${debriefDone(d) ? "Day closed" : "Debrief ended"}</h2>` +
        (r?.xp ? `<p class="fx-xp">+${r.xp} XP</p>` : "") +
        `${tomorrowCard()}</div><div class="fx-acts"><button class="btn primary fx-go" type="button" data-r="close">Good night</button></div>`,
    });
  }
  const body = ({ today: () => todayScreen(d), feeling: feelingScreen, record: recordScreen, where: whereScreen, quests: questsScreen, prep: prepScreen, close: tomorrowCard } as Record<string, () => string>)[step.id]();
  const i = D.steps.indexOf(step);
  return shell({
    ...head,
    inner:
      `<div class="fx-body top"><p class="fx-n">Step ${i + 1} of ${D.steps.length}</p><h2 id="fx-title" class="sm">${esc(step.title)}</h2><p class="fx-hint">${esc(step.hint)}</p>${body}</div>` +
      `<div class="fx-acts"><button class="btn primary fx-go" type="button" data-r="done">${step.id === "close" ? "Close the day" : "Done"} <small>+${debriefStepXp(step)} XP</small></button>` +
      (step.id === "close" ? "" : `<button class="linkbtn" type="button" data-r="skip">Skip this step</button>`) +
      `</div>`,
  });
}

/** The card on the Missions tab that opens the debrief. It stands out once the debrief time has passed. */
export function renderDebriefCard(): void {
  const el = $("d-nudge");
  el.hidden = !rhythmOn();
  $("w-link").hidden = el.hidden;
  if (el.hidden) return;
  const d = day();
  const now = new Date();
  const due = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` >= RHYTHM.debriefTime || debriefDate() !== d.date;
  const closedDay = debriefDone(d);
  el.classList.toggle("done", closedDay || !due);
  $("d-nudge-t").textContent = closedDay ? "Day closed" : D.title;
  const step = currentDebriefStep(d);
  const started = !!d.debrief && step;
  $("d-nudge-s").textContent = closedDay
    ? `Wake at ${wakeTimeFor(tomorrow().plan)} · screens down by ${screensDownBy(tomorrow().plan)}`
    : started
      ? `Step ${D.steps.indexOf(step) + 1} of ${D.steps.length}: ${step.title}`
      : `${D.targetMins} minutes · sets up tomorrow morning · from ${RHYTHM.debriefTime}`;
}
