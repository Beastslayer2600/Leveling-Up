import { IN_CATS, OUT_CATS, SOC } from "../lib/leveling/data";
import { dkey } from "../lib/leveling/dates";
import { findNewPbs, fmtSets, parseSets, workoutXp } from "../lib/leveling/training";
import { PLAN_Q, RB_STEPS } from "../lib/leveling/virtues";
import { CATS, DIFF, type DiffId } from "../lib/leveling/xp";
import type { Meal, Money, Quest, Social, SocialKind, Workout } from "../lib/leveling/types";
import { $, esc, fmtN, radio, radioVal, setVal, val } from "./dom";
import { toast } from "./fx";
import { S, after, award, drop, newId, put, render, save } from "./state";

const FORMS = ["mission", "workout", "meal", "targets", "social", "money", "entry", "reach", "plan", "profile"] as const;
export type SheetName = (typeof FORMS)[number];

type Item = { id: string } | null;
const FILL: Record<SheetName, (it: never) => void> = {
  mission: fillMission,
  workout: fillWorkout,
  meal: fillMeal,
  targets: fillTargets,
  social: fillSocial,
  money: fillMoney,
  entry: fillEntry,
  reach: fillReach,
  plan: fillPlan,
  profile: fillProfile,
};

let lastFocus: HTMLElement | null = null;

export function openSheet(name: SheetName, item: Item = null): void {
  S.sheetName = name;
  S.editId = item ? item.id : null;
  FORMS.forEach((n) => ($("f-" + n).hidden = n !== name));
  const del = $("f-" + name).querySelector<HTMLButtonElement>("[data-del]");
  if (del) {
    del.hidden = !item;
    del.classList.remove("arm");
    del.textContent = "Delete";
  }
  (FILL[name] as (it: Item) => void)(item);
  lastFocus = document.activeElement as HTMLElement | null;
  $("scrim").hidden = false;
  document.body.classList.add("sheet-open");
  requestAnimationFrame(() => $("f-" + name).querySelector<HTMLElement>("input:not([type=radio]):not([hidden]),select,textarea")?.focus({ preventScroll: true }));
}

export function closeSheet(): void {
  $("scrim").hidden = true;
  document.body.classList.remove("sheet-open");
  S.sheetName = null;
  S.editId = null;
  lastFocus?.focus?.({ preventScroll: true });
}

const XPCAT: Record<string, string> = { workouts: "training", social: "social", money: "money", meals: "training" };

export function initSheets(): void {
  document.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", closeSheet));
  $("scrim").addEventListener("click", (e) => { if (e.target === $("scrim")) closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("scrim").hidden) closeSheet(); });

  document.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      if (!b.classList.contains("arm")) {
        b.classList.add("arm");
        b.textContent = "Tap again to delete";
        return;
      }
      if (S.sheetName === "entry") {
        const k = ENTRY[S.entryType].key;
        S.data.sheet = { ...S.data.sheet, [k]: (S.data.sheet[k] as { id: string }[]).filter((x) => x.id !== S.editId) };
        save();
        closeSheet();
        render();
        toast("Removed");
        return;
      }
      const coll = ({ mission: "quests", workout: "workouts", social: "social", money: "money", meal: "meals" } as const)[
        S.sheetName as "mission" | "workout" | "social" | "money" | "meal"
      ];
      const it = (S.data[coll] as { id: string; xp?: number; what?: string; title?: string }[]).find((x) => x.id === S.editId);
      if (it && coll !== "quests" && it.xp) award({ delta: -it.xp, title: it.what || it.title || "Entry", cat: XPCAT[coll], quiet: true });
      drop(coll, S.editId!);
      closeSheet();
      render();
      toast("Deleted");
    }),
  );

  initMission();
  initWorkout();
  initMeal();
  initTargets();
  initSocial();
  initMoney();
  initEntry();
  initRelease();
  initProfile();
}

/* ---------- mission ---------- */

function syncQ() {
  const k = val("q-kind");
  $("q-ctr").hidden = k !== "counter";
  $("q-dueF").hidden = k === "daily";
  $("q-diffL").textContent = k === "counter" ? "XP per step" : "Difficulty";
}

function fillMission(q: Quest | null) {
  $("q-h").textContent = q ? "Edit mission" : "New mission";
  $("q-save").textContent = q ? "Save" : "Add mission";
  setVal("q-title", q?.title);
  setVal("q-note", q?.note);
  setVal("q-cat", q ? q.cat : S.filter !== "all" ? S.filter : "clients");
  setVal("q-kind", q ? q.kind : "quest");
  setVal("q-target", q?.target || 5);
  setVal("q-period", q?.period || "none");
  setVal("q-due", q?.due);
  $<HTMLInputElement>("q-title").placeholder = "e.g. Annual review with a client";
  radio("qdiff", (Object.keys(DIFF) as DiffId[]).find((k) => DIFF[k].xp === (q ? q.xp : 25)) || "std");
  syncQ();
}

/** Open the mission sheet pre-filled for the Release Reset 30-day commitment. */
export function openCommitMission(): void {
  openSheet("mission");
  setVal("q-cat", "faith");
  setVal("q-kind", "quest");
  const d = new Date();
  d.setDate(d.getDate() + 30);
  setVal("q-due", dkey(d));
  $<HTMLInputElement>("q-title").placeholder = "My 30-day commitment";
  syncQ();
}

function initMission() {
  $("q-cat").innerHTML = CATS.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  $("q-diff").innerHTML = (Object.entries(DIFF) as [DiffId, (typeof DIFF)[DiffId]][])
    .map(([k, v]) => `<input type="radio" name="qdiff" id="qd-${k}" value="${k}"><label for="qd-${k}">${v.label}<small>${v.xp}</small></label>`)
    .join("");
  $("q-kind").addEventListener("change", syncQ);
  $("f-mission").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = val("q-title").trim();
    if (!title) return;
    const kind = val("q-kind") as Quest["kind"];
    const prev = S.editId ? S.data.quests.find((x) => x.id === S.editId) : undefined;
    const q: Quest = {
      ...(prev || { id: newId(), created: Date.now() }),
      title,
      note: val("q-note").trim(),
      cat: val("q-cat") as Quest["cat"],
      kind,
      xp: DIFF[(radioVal("qdiff") as DiffId) || "std"].xp,
    } as Quest;
    delete q.starter;
    if (kind === "counter") {
      q.target = Math.max(1, Math.min(999, parseInt(val("q-target"), 10) || 1));
      q.period = val("q-period") as Quest["period"];
      if (q.progress == null) q.progress = 0;
    } else {
      delete q.target; delete q.period; delete q.progress; delete q.periodKey;
    }
    if (kind === "daily") delete q.due;
    else {
      const d = val("q-due");
      if (d) q.due = d; else delete q.due;
    }
    if (kind !== "quest") delete q.done;
    put("quests", q);
    closeSheet();
    render();
    toast(prev ? "Mission updated" : "Mission added");
  });
}

/* ---------- workout ---------- */

let exN = 0;
function exRow(name = "", sets = "") {
  const i = exN++;
  const el = document.createElement("div");
  el.className = "exrow";
  el.innerHTML =
    `<input class="in ex-name" id="ex-n-${i}" list="exlist" maxlength="40" placeholder="Bench press" aria-label="Exercise">` +
    `<input class="in ex-sets" id="ex-s-${i}" maxlength="120" placeholder="80x8, 80x8, 85x6" aria-label="Sets">` +
    `<button class="x" type="button" aria-label="Remove exercise">×</button>`;
  el.querySelector<HTMLInputElement>(".ex-name")!.value = name;
  el.querySelector<HTMLInputElement>(".ex-sets")!.value = sets;
  el.querySelector(".x")!.addEventListener("click", () => {
    el.remove();
    if (!$("w-ex").children.length) $("w-ex").appendChild(exRow());
  });
  return el;
}

function syncW() {
  const c = radioVal("wtype") === "cardio";
  $("w-exF").hidden = c;
  $("w-titleF").hidden = c;
  $("w-actF").hidden = !c;
  $("w-cardioF").hidden = !c;
}

function fillWorkout(w: Workout | null) {
  $("w-h").textContent = w ? "Edit training" : "Log training";
  $("w-save").textContent = w ? "Save" : "Log it";
  radio("wtype", w ? w.type : "gym");
  setVal("w-date", w ? w.date : dkey());
  setVal("w-title", w?.title);
  setVal("w-act", w?.activity || "Run");
  setVal("w-mins", w?.mins || "");
  setVal("w-km", w?.km || "");
  setVal("w-note", w?.note);
  $("w-ex").innerHTML = "";
  const ex = w?.ex?.length ? w.ex : [{ name: "", sets: [] }, { name: "", sets: [] }];
  ex.forEach((x) => $("w-ex").appendChild(exRow(x.name, fmtSets(x.sets))));
  syncW();
}

function initWorkout() {
  $("w-add").addEventListener("click", () => {
    const r = exRow();
    $("w-ex").appendChild(r);
    r.querySelector("input")!.focus();
  });
  document.querySelectorAll("input[name=wtype]").forEach((r) => r.addEventListener("change", syncW));
  $("f-workout").addEventListener("submit", (e) => {
    e.preventDefault();
    const type = (radioVal("wtype") || "gym") as Workout["type"];
    const prev = S.editId ? S.data.workouts.find((x) => x.id === S.editId) : undefined;
    const w: Workout = { ...(prev || { id: newId(), created: Date.now(), pbs: 0, xp: 0 }), type, date: val("w-date") || dkey(), note: val("w-note").trim() } as Workout;
    if (type === "gym") {
      w.title = val("w-title").trim() || "Gym session";
      w.ex = [...$("w-ex").querySelectorAll(".exrow")]
        .map((r) => ({ name: r.querySelector<HTMLInputElement>(".ex-name")!.value.trim(), sets: parseSets(r.querySelector<HTMLInputElement>(".ex-sets")!.value) }))
        .filter((x) => x.name && x.sets.length);
      if (!w.ex.length) return toast("Add at least one exercise with sets, like 80x8");
      delete w.activity; delete w.mins; delete w.km;
    } else {
      w.activity = val("w-act");
      w.mins = Math.max(0, parseInt(val("w-mins"), 10) || 0);
      w.km = val("w-km") ? Math.max(0, +val("w-km")) : null;
      if (!w.mins) return toast("Add how many minutes you did");
      delete w.ex; delete w.title;
    }
    const newPbs = type === "gym" ? findNewPbs(w.ex!, S.data.workouts, w.id) : [];
    w.pbs = newPbs.length;
    const xp = workoutXp(type, newPbs.length, w.mins);
    const diff = xp - (prev?.xp || 0);
    w.xp = xp;
    put("workouts", w);
    const label = type === "gym" ? w.title! : `${w.activity} ${w.mins} min`;
    if (diff) award({ delta: diff, title: label, cat: "training", quiet: !!prev && diff < 0 });
    else if (prev) toast("Session updated");
    if (newPbs.length && !(prev && prev.pbs >= newPbs.length)) setTimeout(() => toast("New PB: " + newPbs.join(", "), "xp"), 900);
    closeSheet();
    render();
    after();
  });
}

/* ---------- meals ---------- */

function fillMeal(m: Meal | null) {
  $("f-h").textContent = m ? "Edit meal" : "Log meal";
  $("f-save").textContent = m ? "Save" : "Log it";
  const h = new Date().getHours();
  radio("mtype", m ? m.meal : h < 10 ? "Breakfast" : h < 15 ? "Lunch" : h < 20 ? "Dinner" : "Snack");
  radio("msrc", m ? m.src : "home");
  setVal("f-what", m?.what);
  setVal("f-kcal", m?.kcal ?? "");
  setVal("f-protein", m?.protein ?? "");
  setVal("f-date", m ? m.date : dkey());
}

function initMeal() {
  $("b-addmeal").addEventListener("click", () => openSheet("meal"));
  $("f-meal").addEventListener("submit", (e) => {
    e.preventDefault();
    const what = val("f-what").trim();
    if (!what) return;
    const prev = S.editId ? S.data.meals.find((x) => x.id === S.editId) : undefined;
    const m: Meal = {
      ...(prev || { id: newId(), created: Date.now(), xp: 0 }),
      meal: radioVal("mtype") || "Snack",
      what,
      src: (radioVal("msrc") || "home") as Meal["src"],
      date: val("f-date") || dkey(),
      kcal: val("f-kcal") ? Math.max(0, +val("f-kcal")) : null,
      protein: val("f-protein") ? Math.max(0, +val("f-protein")) : null,
    } as Meal;
    const xp = m.src === "home" ? 8 : 3;
    const diff = xp - (prev?.xp || 0);
    m.xp = xp;
    put("meals", m);
    if (diff) award({ delta: diff, title: `${m.meal}: ${what}`, cat: "training", quiet: !!prev });
    closeSheet();
    render();
    after();
  });
}

/* ---------- targets + quick log ---------- */

function fillTargets() {
  const sh = S.data.sheet;
  setVal("g-steps", sh.stepGoal || 10000);
  setVal("g-kcal", sh.kcalTarget ?? "");
  setVal("g-weight", sh.weightGoal ?? "");
}

function saveDay(field: "steps" | "weight", v: number) {
  const t = dkey();
  const prev = S.data.days.find((d) => d.id === t);
  const d = { ...(prev || { id: t, date: t, xp: 0 }), [field]: v };
  let xp = 0;
  const goal = S.data.sheet.stepGoal || 10000;
  if (field === "steps") {
    if (!prev || prev.steps == null) xp += 5;
    if (v >= goal && !prev?.goalHit) { xp += 15; d.goalHit = true; }
  }
  if (field === "weight" && (!prev || prev.weight == null)) xp += 5;
  d.xp = (prev?.xp || 0) + xp;
  put("days", d);
  if (xp) award({ delta: xp, title: field === "steps" ? `${fmtN(v)} steps` : `Weigh-in ${v} kg`, cat: "training" });
  else toast("Updated");
  if (field === "steps" && v >= goal && xp >= 15) setTimeout(() => toast("Step goal smashed", "xp"), 900);
  render();
  after();
}

function initTargets() {
  $("b-targets").addEventListener("click", () => openSheet("targets"));
  $("f-targets").addEventListener("submit", (e) => {
    e.preventDefault();
    S.data.sheet = {
      ...S.data.sheet,
      stepGoal: Math.max(1000, parseInt(val("g-steps"), 10) || 10000),
      kcalTarget: val("g-kcal") ? +val("g-kcal") : null,
      weightGoal: val("g-weight") ? +val("g-weight") : null,
    };
    save();
    closeSheet();
    render();
    toast("Targets saved");
  });
  $("q-steps-save").addEventListener("click", () => {
    const v = parseInt(val("q-steps"), 10);
    if (!(v >= 0)) return toast("Enter your step count");
    saveDay("steps", v);
    setVal("q-steps", "");
  });
  $("q-weight-save").addEventListener("click", () => {
    const v = Math.round(+val("q-weight") * 10) / 10;
    if (!(v >= 20 && v <= 300)) return toast("Enter your weight in kg");
    saveDay("weight", v);
    setVal("q-weight", "");
  });
  for (const [inp, btn] of [["q-steps", "q-steps-save"], ["q-weight", "q-weight-save"]])
    $(inp).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $(btn).click(); } });
}

/* ---------- social ---------- */

function syncS() {
  const k = radioVal("skind");
  const post = k === "ig" || k === "li";
  $("s-groupF").hidden = post;
  $("s-engF").hidden = !post;
}

function fillSocial(s: Social | null) {
  $("s-h").textContent = s ? "Edit social" : "Log social";
  $("s-save").textContent = s ? "Save" : "Log it";
  radio("skind", s ? s.kind : "irl");
  setVal("s-what", s?.what);
  setVal("s-group", s?.group);
  setVal("s-eng", s?.eng ?? "");
  setVal("s-date", s ? s.date : dkey());
  setVal("s-note", s?.note);
  syncS();
}

function initSocial() {
  document.querySelectorAll("input[name=skind]").forEach((r) => r.addEventListener("change", syncS));
  $("f-social").addEventListener("submit", (e) => {
    e.preventDefault();
    const kind = (radioVal("skind") || "irl") as SocialKind;
    const what = val("s-what").trim();
    if (!what) return;
    const prev = S.editId ? S.data.social.find((x) => x.id === S.editId) : undefined;
    const s: Social = { ...(prev || { id: newId(), created: Date.now(), xp: 0 }), kind, what, date: val("s-date") || dkey(), note: val("s-note").trim() } as Social;
    if (kind === "ig" || kind === "li") {
      s.eng = val("s-eng") === "" ? null : +val("s-eng");
      delete s.group;
    } else {
      s.group = val("s-group").trim();
      delete s.eng;
    }
    const xp = SOC[kind].xp;
    const diff = xp - (prev?.xp || 0);
    s.xp = xp;
    put("social", s);
    if (diff) award({ delta: diff, title: what, cat: "social", quiet: !!prev });
    closeSheet();
    render();
    after();
  });
}

/* ---------- money ---------- */

function syncM() {
  const d = radioVal("mdir") || "out";
  $("m-verdictF").hidden = d !== "out";
  const sel = $<HTMLSelectElement>("m-cat");
  const cur = sel.value;
  sel.innerHTML = (d === "out" ? OUT_CATS : IN_CATS).map((c) => `<option>${esc(c)}</option>`).join("");
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function fillMoney(m: Money | null) {
  $("m-h").textContent = m ? "Edit entry" : "Log money";
  $("m-save").textContent = m ? "Save" : "Log it";
  radio("mdir", m ? m.dir : "out");
  syncM();
  setVal("m-amount", m?.amount);
  setVal("m-what", m?.what);
  setVal("m-date", m ? m.date : S.month === dkey().slice(0, 7) ? dkey() : S.month + "-01");
  if (m?.cat) setVal("m-cat", m.cat);
  radio("mverdict", m?.verdict || "neutral");
}

function initMoney() {
  document.querySelectorAll("input[name=mdir]").forEach((r) => r.addEventListener("change", syncM));
  $("f-money").addEventListener("submit", (e) => {
    e.preventDefault();
    const dir = (radioVal("mdir") || "out") as Money["dir"];
    const amount = Math.round((+val("m-amount") || 0) * 100) / 100;
    const what = val("m-what").trim();
    if (!amount || !what) return;
    const prev = S.editId ? S.data.money.find((x) => x.id === S.editId) : undefined;
    const m: Money = { ...(prev || { id: newId(), created: Date.now(), xp: 0 }), dir, amount, what, cat: val("m-cat"), date: val("m-date") || dkey() } as Money;
    if (dir === "out") m.verdict = (radioVal("mverdict") || "neutral") as Money["verdict"];
    else delete m.verdict;
    const xp = 5 + (dir === "out" && m.verdict === "good" ? 10 : 0);
    const diff = xp - (prev?.xp || 0);
    m.xp = xp;
    put("money", m);
    if (diff) award({ delta: diff, title: what, cat: "money" });
    if (!prev && m.verdict === "bad") setTimeout(() => toast("Logged. Owning a bad call still earns tracking XP."), 900);
    S.month = m.date.slice(0, 7);
    closeSheet();
    render();
    after();
  });
  const shift = (n: number) => {
    const [y, mo] = S.month.split("-").map(Number);
    const d = new Date(y, mo - 1 + n, 1);
    S.month = dkey(d).slice(0, 7);
    render();
  };
  $("m-prev").addEventListener("click", () => shift(-1));
  $("m-next").addEventListener("click", () => shift(1));
}

/* ---------- character entries ---------- */

const ENTRY = {
  chapter: { h: "chapter line", a: "Label", b: "Value", lv: false, key: "chapter", pa: "Season", pb: "Building the practice" },
  skill: { h: "skill", a: "Skill", b: "Note (optional)", lv: true, key: "skills", pa: "Public speaking", pb: "Where it shows up" },
  feat: { h: "ability", a: "Ability or feat", b: "Detail (optional)", lv: false, key: "feats", pa: "Marathon finisher", pb: "Where and when you earned it" },
} as const;

type AnyEntry = { id: string; label?: string; value?: string; name?: string; level?: number; note?: string; title?: string; detail?: string };

function fillEntry(it: AnyEntry | null) {
  const E = ENTRY[S.entryType];
  $("e-h").textContent = (it ? "Edit " : "Add ") + E.h;
  $("e-aL").textContent = E.a;
  $("e-bL").textContent = E.b;
  $("e-lvF").hidden = !E.lv;
  $<HTMLInputElement>("e-a").placeholder = E.pa;
  $<HTMLInputElement>("e-b").placeholder = E.pb;
  setVal("e-a", it ? it.label || it.name || it.title || "" : "");
  setVal("e-b", it ? it.value || it.note || it.detail || "" : "");
  setVal("e-lv", it?.level || 5);
  $("e-lvN").textContent = val("e-lv");
}

export function openEntry(type: "chapter" | "skill" | "feat", id: string | null): void {
  S.entryType = type;
  const it = id ? (S.data.sheet[ENTRY[type].key] as AnyEntry[]).find((x) => x.id === id) || null : null;
  openSheet("entry", it);
}

function initEntry() {
  $("e-lv").addEventListener("input", () => ($("e-lvN").textContent = val("e-lv")));
  document.querySelectorAll<HTMLElement>("[data-add]").forEach((b) =>
    b.addEventListener("click", () => openEntry(b.dataset.add as "chapter" | "skill" | "feat", null)),
  );
  $("f-entry").addEventListener("submit", (e) => {
    e.preventDefault();
    const a = val("e-a").trim();
    const b = val("e-b").trim();
    if (!a) return;
    const type = S.entryType;
    const E = ENTRY[type];
    const arr = [...(S.data.sheet[E.key] as AnyEntry[])];
    const id = S.editId || "e" + Date.now().toString(36);
    const obj: AnyEntry =
      type === "chapter" ? { id, label: a, value: b } : type === "skill" ? { id, name: a, level: +val("e-lv"), note: b } : { id, title: a, detail: b };
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) arr.push(obj); else arr[i] = obj;
    S.data.sheet = { ...S.data.sheet, [E.key]: arr };
    save();
    closeSheet();
    render();
    toast("Saved");
  });
}

/* ---------- release reset ---------- */

function showRb() {
  const s = RB_STEPS[S.rb];
  $("rb-pips").innerHTML = RB_STEPS.map((_, i) => `<i class="${i < S.rb ? "on" : i === S.rb ? "cur" : ""}"></i>`).join("");
  $("rb-step").textContent = `${S.rb + 1} / ${RB_STEPS.length} · ${s.n}`;
  $("rb-text").textContent = s.t;
  $("rb-back").hidden = S.rb === 0;
  $("rb-next").textContent = S.rb === RB_STEPS.length - 1 ? "Finish · +15 XP" : "Next";
}
function fillReach() {
  S.rb = 0;
  showRb();
}
function fillPlan() {
  const p = S.data.release.plan;
  PLAN_Q.forEach((_, i) => setVal("p-" + i, p[i] || ""));
}

function initRelease() {
  $("rb-back").addEventListener("click", () => { if (S.rb > 0) { S.rb--; showRb(); } });
  $("f-reach").addEventListener("submit", (e) => {
    e.preventDefault();
    if (S.rb < RB_STEPS.length - 1) { S.rb++; showRb(); return; }
    S.data.release = { ...S.data.release, reach: (S.data.release.reach || 0) + 1 };
    save();
    closeSheet();
    award({ delta: 15, title: "Reach-back practice", cat: "faith" });
    render();
    after();
  });
  $("plan-fields").innerHTML = PLAN_Q.map(
    (q, i) => `<div class="fld"><label for="p-${i}">${esc(q)}</label><textarea class="in" id="p-${i}" maxlength="1000"></textarea></div>`,
  ).join("");
  $("f-plan").addEventListener("submit", (e) => {
    e.preventDefault();
    const plan: Record<string, string> = {};
    PLAN_Q.forEach((_, i) => (plan[i] = val("p-" + i).trim()));
    S.data.release = { ...S.data.release, plan };
    save();
    closeSheet();
    toast("Release plan saved");
  });
  $("rr-reach").addEventListener("click", () => openSheet("reach"));
  $("rr-plan").addEventListener("click", () => openSheet("plan"));
}

/* ---------- profile ---------- */

function fillProfile() {
  setVal("p-name", S.data.sheet.name);
  setVal("p-about", S.data.sheet.about);
}

function initProfile() {
  $("p-edit").addEventListener("click", () => openSheet("profile"));
  $("f-profile").addEventListener("submit", (e) => {
    e.preventDefault();
    S.data.sheet = { ...S.data.sheet, name: val("p-name").trim(), about: val("p-about").trim() };
    save();
    closeSheet();
    render();
    toast("Profile saved");
  });
}
