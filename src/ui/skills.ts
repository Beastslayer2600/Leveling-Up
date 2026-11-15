/* Skills tab: the player's own skills to level up, each with a tracker. */
import { PRACTICE } from "../lib/leveling/config";
import { dkey, parseD } from "../lib/leveling/dates";
import {
  METRIC_KINDS,
  SKILL_PRESETS,
  fmtMins,
  fmtValue,
  isPb,
  normalizePursuit,
  parseValue,
  practiceXp,
  skillSummary,
  type SkillSummary,
} from "../lib/leveling/practice";
import { activeCats, catName } from "../lib/leveling/prefs";
import { CAT } from "../lib/leveling/xp";
import type { MetricKind, PracticeLog, Pursuit, SkillMetric } from "../lib/leveling/types";
import { $, ICON, cvar, dayBox, esc, pct, setVal, shortD, val } from "./dom";
import { toast } from "./fx";
import { S, after, award, drop, newId, put, render } from "./state";

const empty = (msg: string, extra = "") => `<div class="empty"${extra}>${esc(msg)}</div>`;
const byId = (id: string | null | undefined) => S.data.pursuits.find((p) => p.id === id) || null;
const logsOf = (id: string) => S.data.practice.filter((l) => l.skill === id);

/** Card and detail state: which skill is expanded. */
let openId: string | null = null;
/** Skill to preselect when the practice sheet opens. */
let logFor: string | null = null;

/* ---------- render ---------- */

export function renderSkills(): void {
  const { pursuits, practice } = S.data;
  const sums = new Map(pursuits.map((p) => [p.id, skillSummary(p, practice)]));
  const all = [...sums.values()];
  $("sk-week").textContent = fmtMins(all.reduce((s, x) => s + x.weekMins, 0));
  $("sk-total").textContent = fmtMins(all.reduce((s, x) => s + x.totalMins, 0));
  const top = [...pursuits].sort((a, b) => sums.get(b.id)!.xp - sums.get(a.id)!.xp)[0];
  $("sk-top").innerHTML = top ? `${esc(top.icon || "")} LV${sums.get(top.id)!.level}` : "—";
  $("sk-stats").hidden = !pursuits.length;

  if (!pursuits.length) {
    $("sk-list").innerHTML =
      `<div class="sk-empty"><p>Pick anything you want to get better at. Each skill gets its own level from practice time, and you can track a result too: solve time, rating, words per minute.</p>` +
      `<div class="presets">${SKILL_PRESETS.map((x, i) => `<button class="chip" type="button" data-act="sk-preset" data-i="${i}"><span>${x.icon}</span>${esc(x.name)}</button>`).join("")}` +
      `<button class="chip" type="button" data-act="sk-new"><span>+</span>Something else</button></div></div>`;
  } else {
    const order = [...pursuits].sort((a, b) => (sums.get(b.id)!.latest?.created || b.created) - (sums.get(a.id)!.latest?.created || a.created));
    $("sk-list").innerHTML = order.map((p) => skillCard(p, sums.get(p.id)!)).join("");
  }

  const recent = [...practice].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created).slice(0, 12);
  $("sk-recentSec").hidden = !recent.length;
  $("sk-recent").innerHTML = recent.map((l) => logRow(l, true)).join("");
}

function skillCard(p: Pursuit, s: SkillSummary): string {
  const id = esc(p.id);
  const open = openId === p.id;
  const weekBit = p.weeklyMins
    ? `<div class="sk-kv"><span>This week</span><b>${fmtMins(s.weekMins)}</b><small>of ${fmtMins(p.weeklyMins)}</small><div class="meter thin"><i class="${s.weekMins >= p.weeklyMins ? "good" : ""}" style="width:${pct(s.weekMins, p.weeklyMins)}%"></i></div></div>`
    : `<div class="sk-kv"><span>This week</span><b>${fmtMins(s.weekMins)}</b></div>`;
  const bestBit = p.metric
    ? `<div class="sk-kv"><span>${esc(p.metric.name)}</span><b class="${s.goalReached ? "pos" : ""}">${s.best ? fmtValue(s.best.value, p.metric) : "—"}</b>${p.goal ? `<small>Goal ${fmtValue(p.goal, p.metric)}${s.goalReached ? " ✓" : ""}</small>` : ""}</div>`
    : `<div class="sk-kv"><span>Sessions</span><b>${s.sessions}</b></div>`;
  const streakBit = `<div class="sk-kv"><span>Streak</span><b>${s.streak}<em>d</em></b></div>`;

  let detail = "";
  if (open) {
    const toNext = s.nextHours ? fmtMins(s.nextHours * 60 - s.totalMins) : "";
    const logs = logsOf(p.id).sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
    detail =
      `<div class="sk-detail">` +
      (p.note ? `<p class="sk-note">${esc(p.note)}</p>` : "") +
      (p.metric ? `<div class="sk-chart">${resultChart(p, s)}</div>` : "") +
      `<div class="sk-miles">${PRACTICE.milestones.slice(0, Math.max(4, PRACTICE.milestones.findIndex((h) => h === s.nextHours) + 2)).map((h) => `<i class="${s.totalMins >= h * 60 ? "on" : h === s.nextHours ? "cur" : ""}">${h}h</i>`).join("")}</div>` +
      (s.nextHours ? `<p class="hint">${toNext} of practice to the ${s.nextHours}-hour mark.</p>` : "") +
      `<div class="list">${logs.length ? logs.slice(0, 10).map((l) => logRow(l, false)).join("") : empty("No practice logged yet.")}</div>` +
      `<div class="acts"><button class="btn ghost" type="button" data-act="sk-edit" data-id="${id}">Edit skill</button><span class="grow"></span><button class="btn primary" type="button" data-act="sk-log" data-id="${id}"><span class="ico">${ICON.plus}</span>Log practice</button></div>` +
      `</div>`;
  }

  return (
    `<article class="sk${open ? " open" : ""}" style="--cc:${cvar(p.cat)}">` +
    `<button class="sk-main" type="button" data-act="sk-open" data-id="${id}" aria-expanded="${open}">` +
    `<span class="sk-ic" aria-hidden="true">${esc(p.icon || p.name.slice(0, 1).toUpperCase())}</span>` +
    `<span class="sk-t"><b>${esc(p.name)}</b><small>${s.rank} · ${fmtMins(s.totalMins)} practised</small></span>` +
    `<span class="sk-lv"><small>LV</small><b>${s.level}</b></span></button>` +
    `<div class="sk-xp"><div class="meter thin"><i style="width:${pct(s.into, s.need)}%"></i></div><small>${s.into} / ${s.need} XP</small></div>` +
    `<div class="sk-row">${weekBit}${bestBit}${streakBit}</div>` +
    (open ? "" : `<button class="sk-quick" type="button" data-act="sk-log" data-id="${id}" aria-label="Log practice for ${esc(p.name)}">+ Log</button>`) +
    detail +
    `</article>`
  );
}

function logRow(l: PracticeLog, withName: boolean): string {
  const p = byId(l.skill);
  const res = p?.metric && l.value != null ? fmtValue(l.value, p.metric) : "";
  const sub = [withName && p ? `${p.icon ? p.icon + " " : ""}${p.name}` : "", res, l.note].filter(Boolean).join(" · ");
  return `<button class="row-i" type="button" data-act="edit-p" data-id="${esc(l.id)}" style="--cc:${cvar(p?.cat || "mind")}">${dayBox(l.date)}<span class="t"><div>${fmtMins(l.mins)} practice</div><div>${esc(sub)}</div></span><span class="v">+${l.xp}<small class="cc">XP</small>${l.pb ? '<small class="gold">PB</small>' : ""}</span></button>`;
}

/** Results over time. For time and lower-is-better, the chart is flipped so up always means better. */
function resultChart(p: Pursuit, s: SkillSummary): string {
  const pts = s.series.slice(-40);
  if (pts.length < 2)
    return `<p class="hint">${pts.length ? "One result logged. Log a few more to see your trend." : `Add your ${esc(p.metric!.name.toLowerCase())} when you log practice to see your trend here.`}</p>`;
  const up = p.metric!.kind === "higher";
  const W = 340, H = 140, pl = 52, pr = 10, pt = 12, pb = 22;
  const vals = pts.map((x) => x.value);
  let lo = Math.min(...vals, p.goal ?? Infinity);
  let hi = Math.max(...vals, p.goal ?? -Infinity);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const t0 = parseD(pts[0].date).getTime();
  const span = Math.max(1, parseD(pts[pts.length - 1].date).getTime() - t0);
  // Several results on the same day spread out a little so they don't stack.
  const X = (i: number) => {
    const t = (parseD(pts[i].date).getTime() - t0) / span;
    return pl + (span === 1 ? i / (pts.length - 1) : t) * (W - pl - pr);
  };
  const Y = (v: number) => pt + (up ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo)) * (H - pt - pb);
  const line = pts.map((x, i) => `${X(i).toFixed(1)},${Y(x.value).toFixed(1)}`).join(" ");
  const fmt = (v: number) => esc(fmtValue(v, { ...p.metric!, unit: "" } as SkillMetric));
  let svg = `<svg class="chart sk-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(p.metric!.name)} trend">`;
  for (const v of [lo + pad, (lo + hi) / 2, hi - pad])
    svg += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="grid"/><text x="${pl - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`;
  if (p.goal != null)
    svg += `<line x1="${pl}" x2="${W - pr}" y1="${Y(p.goal).toFixed(1)}" y2="${Y(p.goal).toFixed(1)}" class="goal"/><text x="${W - pr}" y="${(Y(p.goal) - 5).toFixed(1)}" text-anchor="end" class="goal-t">goal ${fmt(p.goal)}</text>`;
  svg += `<polyline points="${line}" class="sk-line"/>`;
  pts.forEach((x, i) => {
    const best = s.best && x.value === s.best.value;
    svg += `<circle cx="${X(i).toFixed(1)}" cy="${Y(x.value).toFixed(1)}" r="${best ? 4.5 : 2.5}" class="${best ? "sk-best" : "sk-dot"}"/>`;
  });
  svg += `<text x="${pl}" y="${H - 5}">${shortD(pts[0].date)}</text><text x="${W - pr}" y="${H - 5}" text-anchor="end">${shortD(pts[pts.length - 1].date)}</text></svg>`;
  return svg;
}

/* ---------- skill sheet ---------- */


function syncSkillForm() {
  const on = $<HTMLInputElement>("k-track").checked;
  $("k-metricF").hidden = !on;
  const kind = val("k-kind") as MetricKind;
  $("k-unitF").hidden = kind === "time";
  $<HTMLInputElement>("k-goal").placeholder = kind === "time" ? "e.g. 1:00" : "e.g. 1500";
}

function applyPreset(i: number) {
  const x = SKILL_PRESETS[i];
  if (!x) return;
  setVal("k-name", x.name);
  setVal("k-icon", x.icon);
  setVal("k-cat", activeCats(S.data.prefs).some((c) => c.id === x.cat) ? x.cat : activeCats(S.data.prefs)[0].id);
  $<HTMLInputElement>("k-track").checked = !!x.metric;
  setVal("k-mname", x.metric?.name || "");
  setVal("k-kind", x.metric?.kind || "higher");
  setVal("k-unit", x.metric?.unit || "");
  setVal("k-goal", "");
  document.querySelectorAll<HTMLElement>("#k-presets .chip").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.i! === i)));
  syncSkillForm();
}

export function fillSkill(p: Pursuit | null): void {
  $("k-h").textContent = p ? "Edit skill" : "New skill";
  $("k-save").textContent = p ? "Save" : "Add skill";
  $("k-presetF").hidden = !!p;
  const cats = activeCats(S.data.prefs);
  $("k-cat").innerHTML = cats.map((c) => `<option value="${c.id}">${esc(catName(S.data.prefs, c.id))}</option>`).join("");
  $("k-kind").innerHTML = METRIC_KINDS.map((k) => `<option value="${k.id}">${k.label}</option>`).join("");
  $("k-presets").innerHTML = SKILL_PRESETS.map((x, i) => `<button class="chip" type="button" data-i="${i}" aria-pressed="false"><span>${x.icon}</span>${esc(x.name)}</button>`).join("");
  setVal("k-name", p?.name || "");
  setVal("k-icon", p?.icon || "");
  const cat = p?.cat && cats.some((c) => c.id === p.cat) ? p.cat : cats.some((c) => c.id === PRACTICE.cat) ? PRACTICE.cat : cats[0].id;
  setVal("k-cat", cat);
  setVal("k-week", p?.weeklyMins ?? "");
  $<HTMLInputElement>("k-track").checked = !!p?.metric;
  setVal("k-mname", p?.metric?.name || "");
  setVal("k-kind", p?.metric?.kind || "time");
  setVal("k-unit", p?.metric?.unit || "");
  setVal("k-goal", p?.goal != null && p.metric ? (p.metric.kind === "time" ? fmtValue(p.goal, p.metric).replace(/s$/, "") : String(p.goal)) : "");
  setVal("k-note", p?.note || "");
  syncSkillForm();
}

function saveSkill() {
  const name = val("k-name").trim();
  if (!name) return;
  const prev = byId(S.editId);
  const track = $<HTMLInputElement>("k-track").checked;
  const kind = val("k-kind") as MetricKind;
  const mname = val("k-mname").trim() || (kind === "time" ? "Best time" : "Result");
  const goalRaw = val("k-goal").trim();
  const goal = track && goalRaw ? parseValue(goalRaw, kind) : null;
  if (track && goalRaw && goal == null) return toast(kind === "time" ? "Couldn't read that goal. Try 1:00 or 45.5." : "The goal needs to be a number.");
  const p = normalizePursuit({
    id: prev?.id || newId(),
    created: prev?.created || Date.now(),
    name,
    icon: val("k-icon"),
    cat: val("k-cat") as Pursuit["cat"],
    metric: track ? { name: mname, kind, unit: val("k-unit") } : null,
    weeklyMins: val("k-week") ? +val("k-week") : null,
    goal,
    note: val("k-note"),
  });
  // Changing how the result is measured re-judges old PBs; the XP already paid stays.
  if (prev && prev.metric?.kind !== p.metric?.kind) {
    for (const l of logsOf(p.id)) if (l.pb) put("practice", { ...l, pb: false });
  }
  put("pursuits", p);
  openId = p.id;
  closeSheetSoon();
  toast(prev ? "Skill saved" : `New skill: ${p.name}. Log your first practice to start levelling.`, prev ? "" : "xp");
}

/** Delete a skill with all its practice, and take back the XP it paid. */
function deleteSkill(id: string) {
  const p = byId(id);
  if (!p) return;
  const logs = logsOf(id);
  const xp = logs.reduce((s, l) => s + (l.xp || 0), 0);
  if (xp) award({ delta: -xp, title: p.name, cat: p.cat, quiet: true });
  logs.forEach((l) => drop("practice", l.id));
  drop("pursuits", id);
  if (openId === id) openId = null;
  toast("Skill deleted");
}

/* ---------- practice sheet ---------- */

function syncPracticeForm() {
  const p = byId(val("r-skill"));
  const m = p?.metric || null;
  $("r-valF").hidden = !m;
  if (m) {
    $("r-valL").textContent = m.name + " (optional)";
    $<HTMLInputElement>("r-val").placeholder = m.kind === "time" ? "1:23.45" : m.unit ? `e.g. 1200 ${m.unit}` : "e.g. 1200";
    $<HTMLInputElement>("r-val").inputMode = m.kind === "time" ? "text" : "decimal";
    const best = p ? skillSummary(p, S.data.practice).best : null;
    $("r-valH").textContent = best ? `Best so far: ${fmtValue(best.value, m)}. Beat it for +${PRACTICE.pbXp} XP.` : "Your first result sets the baseline to beat.";
  }
  const mins = +val("r-mins") || 0;
  $("r-xp").textContent = mins ? `+${practiceXp(mins)} XP${m ? ` (+${PRACTICE.pbXp} more for a PB)` : ""}` : "";
  document.querySelectorAll<HTMLElement>("#r-quick label").forEach((l) => l.classList.toggle("on", +l.dataset.m! === mins));
}

export function fillPractice(l: PracticeLog | null): void {
  const ps = [...S.data.pursuits].sort((a, b) => a.name.localeCompare(b.name));
  $("r-skill").innerHTML = ps.map((p) => `<option value="${esc(p.id)}">${esc((p.icon ? p.icon + " " : "") + p.name)}</option>`).join("");
  $("r-h").textContent = l ? "Edit practice" : "Log practice";
  $("r-save").textContent = l ? "Save" : "Log it";
  setVal("r-skill", l?.skill || logFor || openId || ps[0]?.id || "");
  setVal("r-date", l?.date || dkey());
  setVal("r-mins", l?.mins || "");
  const p = byId(val("r-skill"));
  setVal("r-val", l?.value != null && p?.metric ? (p.metric.kind === "time" ? fmtValue(l.value, p.metric).replace(/s$/, "") : String(l.value)) : "");
  setVal("r-note", l?.note || "");
  logFor = null;
  syncPracticeForm();
}

function savePractice() {
  const p = byId(val("r-skill"));
  if (!p) return toast("Add a skill first.");
  const mins = Math.round(+val("r-mins"));
  if (!(mins > 0)) return toast("How many minutes did you practise?");
  const raw = val("r-val").trim();
  const value = p.metric && raw ? parseValue(raw, p.metric.kind) : null;
  if (p.metric && raw && value == null) return toast(p.metric.kind === "time" ? "Couldn't read that time. Try 1:23.45 or 83.4." : "The result needs to be a number.");
  const prev = S.data.practice.find((x) => x.id === S.editId) || null;
  const before = skillSummary(p, S.data.practice);
  const others = logsOf(p.id);
  const pb = isPb(value, others, p.metric, prev?.id);
  const xp = practiceXp(mins, pb);
  const l: PracticeLog = {
    id: prev?.id || newId(),
    skill: p.id,
    date: val("r-date") || dkey(),
    created: prev?.created || Date.now(),
    mins,
    value,
    note: val("r-note").trim(),
    pb,
    xp,
  };
  // Moving a log to a different skill takes its XP back from the old one's category.
  const prevP = prev ? byId(prev.skill) : null;
  if (prev && prevP && prevP.cat !== p.cat && prev.xp) {
    award({ delta: -prev.xp, title: prevP.name, cat: prevP.cat, quiet: true });
    put("practice", l);
    award({ delta: xp, title: `${p.name} practice`, cat: p.cat });
  } else {
    put("practice", l);
    const diff = xp - (prev?.xp || 0);
    if (diff) award({ delta: diff, title: `${p.name} practice`, cat: p.cat });
  }
  const now = skillSummary(p, S.data.practice);
  const msgs: string[] = [];
  if (pb && p.metric) msgs.push(`New PB · ${p.metric.name}: ${fmtValue(value, p.metric)}`);
  if (!before.goalReached && now.goalReached && p.metric) msgs.push(`Goal reached: ${fmtValue(p.goal, p.metric)}. Set a new one in Edit skill.`);
  if (now.level > before.level) msgs.push(`${p.name} is LV${now.level} · ${now.rank}`);
  if (now.lastHours && now.lastHours !== before.lastHours) msgs.push(`${now.lastHours} hour${now.lastHours === 1 ? "" : "s"} of ${p.name}`);
  msgs.forEach((m, i) => setTimeout(() => toast(m, "xp"), 900 + i * 1600));
  openId = p.id;
  closeSheetSoon();
  after();
}

/* ---------- wiring ---------- */

let closeSheetSoon = () => {};

export function openPractice(skillId: string | null, open: (name: "practice" | "skill", it?: PracticeLog | Pursuit | null) => void): void {
  if (!S.data.pursuits.length) return open("skill", null);
  logFor = skillId;
  open("practice", null);
}

/** The sheet's delete button, for the two forms here. */
export function deleteFromSheet(name: "skill" | "practice", id: string): void {
  if (name === "skill") return deleteSkill(id);
  const l = S.data.practice.find((x) => x.id === id);
  if (!l) return;
  const p = byId(l.skill);
  if (l.xp) award({ delta: -l.xp, title: p?.name || "Practice", cat: p?.cat && CAT[p.cat] ? p.cat : PRACTICE.cat, quiet: true });
  drop("practice", id);
  toast("Practice deleted");
}

/** Clicks on the Skills tab. Returns true if handled. */
export function skillAction(act: string, el: HTMLElement, open: (name: "practice" | "skill", it?: PracticeLog | Pursuit | null) => void): boolean {
  const id = el.dataset.id || "";
  switch (act) {
    case "sk-open":
      openId = openId === id ? null : id;
      render();
      return true;
    case "sk-log":
      openPractice(id || null, open);
      return true;
    case "sk-new":
      open("skill", null);
      return true;
    case "sk-preset":
      open("skill", null);
      applyPreset(+el.dataset.i!);
      return true;
    case "sk-edit":
      if (byId(id)) open("skill", byId(id));
      return true;
    case "edit-p": {
      const l = S.data.practice.find((x) => x.id === id);
      if (l) open("practice", l);
      return true;
    }
  }
  return false;
}

export function initSkills(close: () => void): void {
  closeSheetSoon = () => {
    close();
    render();
  };
  $("k-track").addEventListener("change", syncSkillForm);
  $("k-kind").addEventListener("change", syncSkillForm);
  $("k-presets").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".chip");
    if (b) applyPreset(+b.dataset.i!);
  });
  $("f-skill").addEventListener("submit", (e) => {
    e.preventDefault();
    saveSkill();
  });
  $("r-quick").innerHTML = [10, 20, 30, 45, 60].map((m) => `<label data-m="${m}" tabindex="0">${m}</label>`).join("");
  $("r-quick").addEventListener("click", (e) => {
    const l = (e.target as HTMLElement).closest<HTMLElement>("label");
    if (!l) return;
    setVal("r-mins", l.dataset.m);
    syncPracticeForm();
  });
  $("r-mins").addEventListener("input", syncPracticeForm);
  $("r-skill").addEventListener("change", () => {
    setVal("r-val", "");
    syncPracticeForm();
  });
  $("f-practice").addEventListener("submit", (e) => {
    e.preventDefault();
    savePractice();
  });
}
