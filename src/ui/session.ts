/* Focus Sessions: three work slots, each followed by a break worth half the work actually done.
   The screen is redrawn only when the stage changes; the clock is repainted from timestamps. */
import { SESSION } from "../lib/leveling/config";
import { dkey, parseD } from "../lib/leveling/dates";
import {
  cleanLabel, computeBreak, dailyTotals, dueAlerts, endRun, finishSlot, fmtClock, fmtDur, isPaused, leaveBreak, markAlerted, pastSessions, pause,
  phaseOf, resume, setLabel, startRun, summarize, weeklyTotals, type PhaseView, type Step,
} from "../lib/leveling/session";
import type { EarlyBreak, FocusRun } from "../lib/leveling/types";
import { $, ICON, esc, radio, radioVal } from "./dom";
import { toast } from "./fx";
import { S, after, award, newId, put, render, save, setTab } from "./state";

const CIRC = 283;
const MIN = 60_000;

let view: "main" | "history" = "main";
let histMode: "daily" | "weekly" = "daily";
let sig = "";
let ticker: ReturnType<typeof setInterval> | undefined;
let endArmed = false;
let endTimer: ReturnType<typeof setTimeout> | undefined;
/** Setup screen choices, kept while the screen is open. */
let draft: { labels: string[]; workMin: number; earlyBreak: EarlyBreak } | null = null;

const run = (): FocusRun | null => S.data.focusRun;
const isOpen = () => !$("fsession").hidden;
const setText = (id: string, t: string) => {
  const el = document.getElementById(id);
  if (el && el.textContent !== t) el.textContent = t;
};

/* ---------- alerts ---------- */

let ac: AudioContext | null = null;

/** Make the audio context inside a tap, so later alerts are allowed to play. */
function unlockAudio(): void {
  try {
    ac ??= new AudioContext();
    if (ac.state === "suspended") void ac.resume();
  } catch {
    /* sound is optional */
  }
}

function chime(kind: "work" | "break"): void {
  unlockAudio();
  if (ac) {
    const notes = kind === "work" ? [660, 880, 660, 880] : [523, 659, 784];
    notes.forEach((f, i) => {
      const t = ac!.currentTime + i * 0.22;
      const o = ac!.createOscillator();
      const g = ac!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(ac!.destination);
      o.start(t);
      o.stop(t + 0.32);
    });
  }
  navigator.vibrate?.(kind === "work" ? [250, 120, 250, 120, 400] : [200, 100, 200]);
}

/* ---------- saving ---------- */

function applyStep(step: Step): void {
  S.data.focusRun = step.run;
  if (step.slot) put("focusSlots", step.slot);
  if (step.breakFor) {
    const s = S.data.focusSlots.find((x) => x.id === step.breakFor!.id);
    if (s) put("focusSlots", { ...s, breakTakenMs: step.breakFor.takenMs, breakSkipped: step.breakFor.skipped });
  }
  save();
  if (step.slot && (step.xp || step.bonus)) {
    const label = step.slot.label;
    if (step.xp) award({ delta: step.xp, title: `Focus: ${label}`, cat: SESSION.cat, quiet: true });
    if (step.bonus) award({ delta: step.bonus, title: "Focus session bonus", cat: SESSION.cat, quiet: true });
    toast(`+${step.xp + step.bonus} XP · ${label}${step.bonus ? " + session bonus" : ""}`, "xp");
    after();
  }
}

const mine = (r: FocusRun) => S.data.focusSlots.filter((s) => s.run === r.id);

/* ---------- actions ---------- */

function startSession(): void {
  const d = draft ?? { ...S.data.focusPrefs, labels: [...S.data.focusPrefs.labels] };
  const labels = d.labels.map((l, i) => cleanLabel(l, SESSION.defaultLabels[i] ?? "Focus"));
  S.data.focusPrefs = { workMin: d.workMin, earlyBreak: d.earlyBreak, labels };
  S.data.focusRun = startRun(newId(), labels, d, Date.now());
  save();
  draft = null;
  view = "main";
  unlockAudio();
  navigator.vibrate?.(15);
  ensureTicker();
  renderSession();
}

function act(name: string): void {
  const r = run();
  const now = Date.now();
  switch (name) {
    case "pause":
      if (r) { S.data.focusRun = pause(r, now); save(); }
      break;
    case "resume":
      if (r) { S.data.focusRun = resume(r, now); save(); unlockAudio(); }
      break;
    case "finish": {
      const s = r && finishSlot(r, now, mine(r), newId());
      if (s) applyStep(s);
      break;
    }
    case "next":
    case "skip": {
      const s = r && leaveBreak(r, now);
      if (s) { applyStep(s); unlockAudio(); }
      break;
    }
    case "end": {
      if (!r || r.stage === "summary") break;
      if (!endArmed) {
        endArmed = true;
        clearTimeout(endTimer);
        endTimer = setTimeout(() => { endArmed = false; if (isOpen()) paintLive(); }, 4000);
        paintLive();
        return;
      }
      endArmed = false;
      const s = endRun(r, now, mine(r), newId());
      if (s) applyStep(s);
      break;
    }
    case "new":
      S.data.focusRun = null;
      draft = null;
      save();
      view = "main";
      break;
    case "done":
      S.data.focusRun = null;
      save();
      closeSession();
      return;
    case "history":
      view = view === "history" ? "main" : "history";
      break;
    case "back":
      view = "main";
      break;
    case "daily":
    case "weekly":
      histMode = name;
      break;
    case "wm-":
    case "wm+": {
      const d = ensureDraft();
      const [lo, hi] = SESSION.workMinRange;
      d.workMin = Math.min(hi, Math.max(lo, d.workMin + (name === "wm+" ? 5 : -5)));
      break;
    }
    case "start":
      startSession();
      return;
    case "close":
      closeSession();
      return;
  }
  render();
}

function ensureDraft() {
  draft ??= { workMin: S.data.focusPrefs.workMin, earlyBreak: S.data.focusPrefs.earlyBreak, labels: [...S.data.focusPrefs.labels] };
  return draft;
}

/* ---------- the ticker ---------- */

function ensureTicker(): void {
  const r = run();
  const live = !!r && r.stage !== "summary";
  if (live && !ticker) ticker = setInterval(tick, 500);
  if (!live && ticker) {
    clearInterval(ticker);
    ticker = undefined;
    document.title = "Leveling Up";
  }
}

/** Runs on a timer, on return from the background, and on open. Reads the clock; never counts ticks. */
function tick(): void {
  let r = run();
  if (!r || r.stage === "summary") return ensureTicker();
  const now = Date.now();
  for (const a of dueAlerts(r, now)) {
    r = markAlerted(r, a.key);
    S.data.focusRun = r;
    save();
    const live = now - a.at <= SESSION.alertLiveMs;
    const what = a.kind === "work" ? "Work block" : "Break";
    if (live) {
      chime(a.kind);
      toast(a.kind === "work" ? "Work block done. Keep going, or tap Finish." : "Break over. Ready for the next block?");
    } else {
      // The boundary passed while the app was asleep: say so quietly instead of playing a stale alarm.
      toast(`${what} ended ${fmtDur(now - a.at)} ago.`);
    }
  }
  renderSession();
}

/* ---------- the card on Missions ---------- */

const phaseText = (p: PhaseView): string => {
  const clock = p.phase === "work" || p.phase === "break" ? `${fmtClock(p.remainingMs, "ceil")} left` : p.phase === "overtime" ? `+${fmtClock(p.overMs)}` : "";
  return `${p.label}${clock ? ` · ${clock}` : ""}${p.paused ? " · paused" : ""}`;
};

function renderCard(): void {
  const r = run();
  const card = $("fs-card");
  const today = dailyTotals(S.data.focusSlots, new Date(), 1)[0];
  let title = "Focus Session";
  let sub = `${SESSION.slots} blocks of ${S.data.focusPrefs.workMin} min · breaks earned`;
  let key = today.focusedMs ? `${fmtDur(today.focusedMs)} today` : "";
  let phase = "";
  if (r && r.stage !== "summary") {
    const p = phaseOf(r, Date.now());
    phase = p.phase;
    title = `Slot ${r.slot + 1} of ${SESSION.slots} · ${r.labels[r.slot]}`;
    sub = p.phase === "breakover" ? `Break over · ${r.slot + 1 < SESSION.slots ? `start slot ${r.slot + 2}` : "see summary"}` : phaseText(p);
    key = "";
    document.title = `${fmtClock(p.phase === "overtime" ? p.overMs : p.remainingMs, p.phase === "overtime" ? "floor" : "ceil")} ${p.label} · Leveling Up`;
  } else if (r) {
    const sum = summarize(mine(r), r.bonusXp);
    title = "Session complete";
    sub = `${fmtDur(sum.focusedMs)} focused · +${sum.xp} XP`;
    key = "";
  }
  card.classList.toggle("is-live", !!phase);
  if (phase) card.dataset.phase = phase;
  else delete card.dataset.phase;
  setText("fs-card-t", title);
  setText("fs-card-s", sub);
  setText("fs-card-k", key);
}

/* ---------- the overlay ---------- */

function signature(): string {
  const r = run();
  if (view === "history") return `h|${histMode}|${S.data.focusSlots.length}|${S.data.focusSlots.reduce((n, s) => n + s.actualMs, 0)}`;
  if (!r) return `s|${ensureDraft().workMin}|${draft!.earlyBreak}`;
  if (r.stage === "summary") return `d|${r.id}|${mine(r).length}`;
  const p = phaseOf(r, Date.now());
  return `l|${r.id}|${r.stage}|${r.slot}|${p.phase}|${p.paused}|${r.slotIds.join()}|${r.breakMs}|${endArmed}`;
}

export function renderSession(): void {
  renderCard();
  ensureTicker();
  if (!isOpen()) return;
  const s = signature();
  if (s !== sig) {
    sig = s;
    build();
  }
  paintLive();
}

function suggestions(): string[] {
  const seen = new Map<string, string>();
  const add = (l: string) => { const k = l.toLowerCase(); if (l && !seen.has(k)) seen.set(k, l); };
  [...S.data.focusSlots].sort((a, b) => b.endedAt - a.endedAt).forEach((s) => add(s.label));
  S.data.focusPrefs.labels.forEach(add);
  SESSION.defaultLabels.forEach(add);
  return [...seen.values()].slice(0, 12);
}

function build(): void {
  const r = run();
  $("fs-history").innerHTML = view === "history" ? "Back" : `${ICON.chart}History`;
  $("fs-history").dataset.fs = view === "history" ? "back" : "history";
  $("fs-labels").innerHTML = suggestions().map((l) => `<option value="${esc(l)}">`).join("");
  let html: string;
  if (view === "history") {
    $("fs-kicker").textContent = "Focus history";
    $("fs-pips").innerHTML = "";
    html = historyHtml();
  } else if (!r) {
    $("fs-kicker").textContent = "Focus Session";
    $("fs-pips").innerHTML = "";
    html = setupHtml();
  } else if (r.stage === "summary") {
    $("fs-kicker").textContent = "Focus Session · done";
    $("fs-pips").innerHTML = pips(r);
    html = summaryHtml(r);
  } else {
    $("fs-kicker").textContent = "Focus Session";
    $("fs-pips").innerHTML = pips(r);
    html = liveHtml(r);
  }
  $("fs-body").innerHTML = html;
  if (!r && view === "main") radio("fsearly", ensureDraft().earlyBreak);
}

function pips(r: FocusRun): string {
  return Array.from({ length: SESSION.slots }, (_, i) => {
    const done = !!r.slotIds[i];
    const cur = r.stage !== "summary" && i === r.slot && !done;
    return `<i class="${done ? "on" : cur ? "cur" : ""}"></i>`;
  }).join("");
}

/* ----- setup ----- */

function setupHtml(): string {
  const d = ensureDraft();
  const brk = fmtClock(computeBreak(d.workMin * MIN, d.workMin * MIN, "shorten"));
  const total = Math.round(SESSION.slots * d.workMin * (1 + SESSION.breakRatio));
  const rows = Array.from({ length: SESSION.slots }, (_, i) =>
    `<label class="fs-lab"><span class="fs-n">${i + 1}</span><input class="in" data-fs-label="${i}" list="fs-labels" maxlength="${SESSION.maxLabel}" autocomplete="off" value="${esc(d.labels[i] ?? "")}" placeholder="${esc(SESSION.defaultLabels[i] ?? "Task")}" aria-label="Task for block ${i + 1}"></label>`,
  ).join("");
  return `<div class="fs-setup">
    <h2 class="fs-t">Focus<br>Session</h2>
    <p class="fs-note">${SESSION.slots} blocks of ${d.workMin} min work. Each one earns a break worth half the time you actually worked.</p>
    <div class="fs-labs"><span class="eyebrow">What are you working on?</span>${rows}</div>
    <div class="fs-opts">
      <div class="fld"><label>Work block</label>
        <div class="fs-stepper"><button type="button" data-fs="wm-" aria-label="Shorter">−</button><b>${d.workMin}</b><span>min</span><button type="button" data-fs="wm+" aria-label="Longer">+</button></div>
        <p class="hint">${brk} break after a full block · about ${total} min in all</p></div>
      <fieldset class="fld"><legend>If I finish a block early</legend>
        <div class="seg">
          <input type="radio" name="fsearly" id="fse-shorten" value="shorten"><label for="fse-shorten">Shorten the break</label>
          <input type="radio" name="fsearly" id="fse-minimum" value="minimum"><label for="fse-minimum">Keep the ${brk} minimum</label>
        </div></fieldset>
    </div>
    <div class="fs-acts"><button class="btn primary fs-go" type="button" data-fs="start">${ICON.play}Start session</button></div>
  </div>`;
}

/* ----- live ----- */

function liveHtml(r: FocusRun): string {
  const p = phaseOf(r, Date.now());
  const last = r.slot === SESSION.slots - 1;
  const rows = Array.from({ length: SESSION.slots }, (_, i) => {
    const rec = S.data.focusSlots.find((s) => s.id === r.slotIds[i]);
    const cur = i === r.slot && r.stage !== "summary";
    let right = `<b>${fmtClock(r.workMs)}</b><small>planned</small>`;
    if (rec) right = `<b>${fmtClock(rec.actualMs)}${rec.overtimeMs ? ` <em>+${fmtClock(rec.overtimeMs)}</em>` : ""}</b><small>${rec.breakPlannedMs ? (i === r.slot && p.phase === "break" ? "on break" : rec.breakSkipped ? "break skipped" : `break ${fmtClock(rec.breakTakenMs)}`) : "no break"}</small>`;
    else if (cur) right = `<b id="fs-cur-st"></b><small>now</small>`;
    return `<li class="fs-slot${rec ? " done" : cur ? " cur" : ""}">
      <span class="fs-dot">${rec ? ICON.check : i + 1}</span>
      <input class="in" data-fs-label="${i}" list="fs-labels" maxlength="${SESSION.maxLabel}" autocomplete="off" value="${esc(r.labels[i])}" aria-label="Task for block ${i + 1}">
      <span class="fs-st">${right}</span></li>`;
  }).join("");

  let ctl: string;
  const pr = p.paused
    ? `<button class="btn" type="button" data-fs="resume">${ICON.play}Resume</button>`
    : `<button class="btn" type="button" data-fs="pause">${ICON.pause}Pause</button>`;
  if (p.phase === "work") ctl = `${pr}<button class="btn primary" type="button" data-fs="finish">${ICON.check}Finish early</button>`;
  else if (p.phase === "overtime") ctl = `${pr}<button class="btn primary" type="button" data-fs="finish">${ICON.check}Finish</button>`;
  else if (p.phase === "break") ctl = `${pr}<button class="btn primary" type="button" data-fs="skip">${ICON.skip}Skip break</button>`;
  else ctl = `<button class="btn primary solo" type="button" data-fs="next">${ICON.play}${last ? "See summary" : `Start slot ${r.slot + 2}`}</button>`;

  return `<div class="fs-phase"><span class="fs-badge" id="fs-badge">${esc(p.label)}</span><span class="fs-paused" id="fs-paused" hidden>Paused</span></div>
    <p class="fs-slotline">Slot ${r.slot + 1} of ${SESSION.slots} · <b>${esc(r.labels[r.slot])}</b></p>
    <div class="fs-timer" role="timer" aria-live="off">
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="fs-ring-bg" cx="50" cy="50" r="45"/><circle class="fs-ring-fg" id="fs-ring" cx="50" cy="50" r="45"/></svg>
      <div class="fs-clockw"><b class="fs-clock" id="fs-clock"></b><small id="fs-clock-sub"></small></div>
    </div>
    <p class="fs-sub" id="fs-sub"></p>
    <div class="fs-ctl">${ctl}</div>
    <ul class="fs-slots">${rows}</ul>
    <button class="linkbtn fs-end${endArmed ? " arm" : ""}" type="button" data-fs="end">${endArmed ? "Tap again to end the session" : "End session"}</button>`;
}

/** Repaint the numbers from the clock. Cheap; runs every tick. */
function paintLive(): void {
  const r = run();
  if (!isOpen() || view !== "main" || !r || r.stage === "summary") return;
  const now = Date.now();
  const p = phaseOf(r, now);
  const ov = $("fsession");
  ov.dataset.phase = p.phase;
  const paused = isPaused(r);
  const pausedEl = document.getElementById("fs-paused");
  if (pausedEl) pausedEl.hidden = !paused;

  const counting = p.phase === "work" || p.phase === "break";
  const clock = counting ? fmtClock(p.remainingMs, "ceil") : p.phase === "overtime" ? `+${fmtClock(p.overMs)}` : "0:00";
  setText("fs-clock", clock);
  setText("fs-clock-sub", p.phase === "work" ? "left" : p.phase === "overtime" ? "over" : p.phase === "break" ? "break left" : "break done");
  const frac = counting && p.targetMs ? p.remainingMs / p.targetMs : p.phase === "overtime" || p.phase === "breakover" ? 1 : 0;
  document.getElementById("fs-ring")?.style.setProperty("stroke-dashoffset", String(CIRC * (1 - frac)));

  let sub = "";
  if (p.phase === "work" || p.phase === "overtime") {
    const earned = computeBreak(p.elapsedMs, r.workMs, r.earlyBreak);
    sub = `Break earned so far: ${fmtClock(earned)}${p.phase === "overtime" ? ` (${fmtClock(earned - computeBreak(r.workMs, r.workMs, r.earlyBreak))} extra)`.replace(/\(0:00 extra\)/, "") : ""}`;
  } else if (p.phase === "break") sub = r.slot + 1 < SESSION.slots ? `Next: slot ${r.slot + 2} · ${r.labels[r.slot + 1]}` : "That was the last block.";
  else sub = r.slot + 1 < SESSION.slots ? `Take your time. Slot ${r.slot + 2} · ${r.labels[r.slot + 1]} is next.` : "That was the last block.";
  setText("fs-sub", sub);
  setText("fs-cur-st", p.phase === "break" || p.phase === "breakover" ? "break" : fmtClock(p.elapsedMs));

  // Labels edited elsewhere (another device) show up, but never over something being typed.
  document.querySelectorAll<HTMLInputElement>("#fs-body input[data-fs-label]").forEach((el) => {
    if (document.activeElement === el) return;
    const v = r.labels[+el.dataset.fsLabel!];
    if (v !== undefined && el.value !== v) el.value = v;
  });
}

/* ----- summary ----- */

function summaryHtml(r: FocusRun): string {
  const sum = summarize(mine(r), r.bonusXp);
  const all = sum.completed === SESSION.slots;
  const maxT = Math.max(1, ...sum.byTask.map((t) => t.focusedMs));
  const tasks = sum.byTask.length
    ? sum.byTask.map((t) => `<div class="fs-bar"><span class="fs-bar-l">${esc(t.label)}</span><div class="fs-bar-t"><i style="width:${Math.round((t.focusedMs / maxT) * 100)}%"></i></div><span class="fs-bar-v">${fmtDur(t.focusedMs)}${t.overtimeMs ? `<small>+${fmtDur(t.overtimeMs)}</small>` : ""}</span></div>`).join("")
    : `<p class="hint">No finished blocks this time.</p>`;
  const slots = sum.slots.map((s) => `<li><span class="fs-sl-l">${esc(s.label)}</span><span class="fs-sl-v">${fmtClock(s.actualMs)} of ${fmtClock(s.plannedMs)}${s.overtimeMs ? ` <em>+${fmtClock(s.overtimeMs)}</em>` : ""}</span><small>break ${s.breakPlannedMs ? `${fmtClock(s.breakTakenMs)} of ${fmtClock(s.breakPlannedMs)}${s.breakSkipped ? " (skipped)" : ""}` : "none"}</small></li>`).join("");
  return `<div class="fs-done">
    <span class="fs-check">${ICON.check}</span>
    <h2 class="fs-t">${all ? "Session<br>complete" : "Session<br>ended"}</h2>
    <p class="fs-note">${all ? "All three blocks done." : `${sum.completed} of ${SESSION.slots} blocks done. That counts.`}</p>
    <div class="fs-chips"><span class="fs-chip gold">+${sum.xp} XP</span>${sum.bonusXp ? `<span class="fs-chip">Session bonus +${sum.bonusXp}</span>` : ""}</div>
    <div class="stats3 big">
      <div class="stat"><span class="sl">Focused</span><b>${fmtDur(sum.focusedMs)}</b></div>
      <div class="stat"><span class="sl">Overtime</span><b>${sum.overtimeMs ? "+" + fmtDur(sum.overtimeMs) : "none"}</b></div>
      <div class="stat"><span class="sl">Breaks</span><b>${fmtDur(sum.breakTakenMs)}</b></div>
    </div>
    <section class="fs-card2"><span class="eyebrow">By task</span>${tasks}</section>
    ${slots ? `<section class="fs-card2"><span class="eyebrow">Block by block</span><ul class="fs-sl">${slots}</ul></section>` : ""}
    <div class="fs-acts"><button class="btn primary fs-go" type="button" data-fs="new">New session</button><button class="btn" type="button" data-fs="history">${ICON.chart}History</button><button class="linkbtn" type="button" data-fs="done">Done</button></div>
  </div>`;
}

/* ----- history ----- */

function dayLabel(key: string, now: Date): string {
  const d = parseD(key);
  if (key === dkey(now)) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (key === dkey(y)) return "Yesterday";
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
}

function historyHtml(): string {
  const now = new Date();
  const slots = S.data.focusSlots;
  const day = dailyTotals(slots, now, 14);
  const week = weeklyTotals(slots, now, 8);
  const buckets = histMode === "daily" ? day : week;
  const max = Math.max(1, ...buckets.map((b) => b.focusedMs));
  const rows = buckets
    .map((b, i) => {
      const label = histMode === "daily" ? dayLabel(b.key, now) : i === 0 ? "This week" : i === 1 ? "Last week" : `Week of ${parseD(b.key).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}`;
      return `<div class="fs-bar${b.focusedMs ? "" : " none"}"><span class="fs-bar-l">${esc(label)}</span><div class="fs-bar-t"><i style="width:${Math.round((b.focusedMs / max) * 100)}%"></i></div><span class="fs-bar-v">${b.focusedMs ? fmtDur(b.focusedMs) : "—"}${b.slots ? `<small>${b.slots} block${b.slots === 1 ? "" : "s"}</small>` : ""}</span></div>`;
    })
    .join("");
  const sessions = pastSessions(slots, 6)
    .map((s) => {
      const when = new Date(s.startedAt);
      const lines = s.summary.slots.map((x) => `<li><span>${esc(x.label)}</span><span>${fmtClock(x.actualMs)}${x.overtimeMs ? ` <em>+${fmtClock(x.overtimeMs)}</em>` : ""}</span><small>${x.breakPlannedMs ? `break ${fmtClock(x.breakTakenMs)}` : "no break"}</small></li>`).join("");
      return `<article class="fs-sess"><header><b>${dayLabel(dkey(when), now)} · ${when.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</b><span>${fmtDur(s.summary.focusedMs)}</span></header><ul class="fs-sl">${lines}</ul></article>`;
    })
    .join("");
  return `<div class="fs-hist">
    <h2 class="fs-t sm">History</h2>
    <div class="stats3 big">
      <div class="stat"><span class="sl">Today</span><b>${fmtDur(day[0].focusedMs)}</b></div>
      <div class="stat"><span class="sl">This week</span><b>${fmtDur(week[0].focusedMs)}</b></div>
      <div class="stat"><span class="sl">All time</span><b>${fmtDur(slots.reduce((n, s) => n + s.actualMs, 0))}</b></div>
    </div>
    <div class="fs-tog" role="group" aria-label="Period">
      <button class="chip" type="button" data-fs="daily" aria-pressed="${histMode === "daily"}">Daily</button>
      <button class="chip" type="button" data-fs="weekly" aria-pressed="${histMode === "weekly"}">Weekly</button>
    </div>
    <div class="fs-bars">${rows}</div>
    <span class="eyebrow">Recent sessions</span>
    ${sessions || `<p class="hint">Nothing yet. Finish a block and it shows up here.</p>`}
  </div>`;
}

/* ---------- open / close ---------- */

export function openSession(): void {
  $("fsession").hidden = false;
  document.body.classList.add("sheet-open");
  if (location.hash !== "#today/focus") history.replaceState(null, "", "#today/focus");
  view = "main";
  sig = "";
  tick();
  renderSession();
}

export function closeSession(): void {
  if (!isOpen()) return;
  $("fsession").hidden = true;
  document.body.classList.remove("sheet-open");
  sig = "";
  setTab(S.tab);
  render();
}

export function initSession(): void {
  const ov = $("fsession");
  ov.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-fs]");
    if (b) act(b.dataset.fs!);
  });

  // Label fields: committed on change, so a half-typed word never overwrites anything.
  ov.addEventListener("change", (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.name === "fsearly") {
      ensureDraft().earlyBreak = radioVal("fsearly") === "minimum" ? "minimum" : "shorten";
      return;
    }
    if (!(t instanceof HTMLInputElement) || t.dataset.fsLabel === undefined) return;
    const i = +t.dataset.fsLabel;
    const r = run();
    if (r && r.stage !== "summary") {
      S.data.focusRun = setLabel(r, i, t.value);
      const rec = S.data.focusSlots.find((s) => s.id === r.slotIds[i]);
      if (rec) put("focusSlots", { ...rec, label: cleanLabel(t.value, SESSION.defaultLabels[i] ?? "Focus") });
      save();
      renderSession();
    } else if (!r) {
      ensureDraft().labels[i] = t.value;
    }
  });
  ov.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") (e.target as HTMLElement).blur();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) closeSession();
  });
  // Back from the background or a locked screen: read the clock again right away.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
  });
  window.addEventListener("pageshow", () => tick());
  ensureTicker();
}
