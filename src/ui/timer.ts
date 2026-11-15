/* Solve timer for time-based skills. In speedcubing mode it works like a WCA
   competition: a scramble, 15 seconds of inspection (calls at 8 and 12, +2 past 15,
   DNF past 17), hold to arm, release to start, any touch or key to stop. */
import { dkey } from "../lib/leveling/dates";
import { bestAverage, fmtTime, wcaAverage } from "../lib/leveling/practice";
import { CUBE_EVENT, bestMean3, mean3, scrambleFor } from "../lib/leveling/cubes";
import type { Pursuit } from "../lib/leveling/types";
import { $, ICON, esc } from "./dom";
import { toast } from "./fx";
import { S, render } from "./state";
import { commitPractice } from "./skills";

type Pen = 0 | 2 | "dnf";
interface Solve {
  /** Raw time in seconds, before penalties. */
  t: number;
  pen: Pen;
  scramble: string;
  at: number;
}
interface Session {
  skill: string;
  startedAt: number;
  solves: Solve[];
  scramble: string;
  inspect: boolean;
}

const KEY = "leveling-up.timer";
const HOLD_MS = 300;

let sess: Session | null = null;
let phase: "idle" | "inspect" | "armed" | "ready" | "running" = "idle";
let holdTimer = 0;
let inspectFrom = 0;
let runFrom = 0;
let raf = 0;
let calls: string[] = [];
let inspectPen: Pen = 0;
let armClose = false;
/** The hold started during inspection, so letting go early goes back to inspecting. */
let armedFromInspect = false;

/** The average this skill is ranked by: mean of 3 for big cubes and blindfolded. */
const fmtOf = (p: Pursuit | null) => (p?.cube ? CUBE_EVENT[p.event || "333"]?.format || "ao5" : "ao5");
const skill = () => S.data.pursuits.find((p) => p.id === sess?.skill) || null;
const result = (s: Solve): number | null => (s.pen === "dnf" ? null : Math.round((s.t + s.pen) * 100) / 100);
const fmt = (v: number | null | undefined) => (v === undefined ? "—" : v === null ? "DNF" : fmtTime(v).replace(/s$/, ""));

function persist() {
  try {
    if (sess) localStorage.setItem(KEY, JSON.stringify(sess));
    else localStorage.removeItem(KEY);
  } catch {
    /* optional */
  }
}

function restore(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/** Open the timer for a skill. An unsaved session for the same skill picks up where it left off. */
export function openTimer(p: Pursuit): void {
  const old = restore();
  sess = old && old.skill === p.id ? old : { skill: p.id, startedAt: 0, solves: [], scramble: p.cube ? scrambleFor(p.event) : "", inspect: !!p.cube && (CUBE_EVENT[p.event || "333"]?.inspection ?? true) };
  phase = "idle";
  armClose = false;
  $("tm").hidden = false;
  document.body.classList.add("timer-open");
  draw();
}

function close() {
  stopLoop();
  $("tm").hidden = true;
  document.body.classList.remove("timer-open");
  phase = "idle";
  render();
}

/* ---------- input ---------- */

function down() {
  if (!sess) return;
  if (phase === "running") return stop();
  if (phase === "idle" && sess.inspect) return; // inspection starts on release
  if (phase === "idle" || phase === "inspect") {
    const wasInspect = phase === "inspect";
    phase = "armed";
    armedFromInspect = wasInspect;
    clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => {
      if (phase === "armed") {
        phase = "ready";
        draw();
      }
    }, HOLD_MS);
    draw();
  }
}
function up() {
  if (!sess) return;
  if (phase === "idle" && sess.inspect) return startInspection();
  if (phase === "armed") {
    clearTimeout(holdTimer);
    phase = armedFromInspect ? "inspect" : "idle";
    draw();
    return;
  }
  if (phase === "ready") start();
}

function startInspection() {
  phase = "inspect";
  inspectFrom = performance.now();
  calls = [];
  inspectPen = 0;
  loop();
  draw();
}

function start() {
  if (!sess) return;
  if (armedFromInspect) {
    const t = (performance.now() - inspectFrom) / 1000;
    inspectPen = t > 17 ? "dnf" : t > 15 ? 2 : 0;
  } else inspectPen = 0;
  if (!sess.startedAt) sess.startedAt = Date.now();
  phase = "running";
  runFrom = performance.now();
  loop();
  draw();
}

function stop() {
  if (!sess) return;
  const t = Math.round((performance.now() - runFrom) / 10) / 100;
  stopLoop();
  sess.solves.push({ t, pen: inspectPen, scramble: sess.scramble, at: Date.now() });
  const p = skill();
  if (p?.cube) sess.scramble = scrambleFor(p.event);
  phase = "idle";
  persist();
  buzz(30);
  draw();
  const all = sess.solves.map(result);
  const last = all[all.length - 1];
  const prevBest = Math.min(...(all.slice(0, -1).filter((x) => x != null) as number[]));
  if (last != null && all.length > 1 && last < prevBest) toast(`Session best: ${fmt(last)}`, "xp");
}

/* ---------- clock ---------- */

/** Running clock: "12.34", then "1:02.34". */
const live = (t: number) => (t < 60 ? t.toFixed(2) : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`);

function loop() {
  cancelAnimationFrame(raf);
  const tick = () => {
    if (phase === "running") {
      $("tm-clock").textContent = live((performance.now() - runFrom) / 1000);
    } else if (phase === "inspect" || (phase === "armed" && armedFromInspect) || (phase === "ready" && armedFromInspect)) {
      const t = (performance.now() - inspectFrom) / 1000;
      const left = Math.ceil(15 - t);
      $("tm-clock").textContent = t >= 17 ? "DNF" : left > 0 ? String(left) : "+2";
      for (const [at, label] of [[8, "8 seconds"], [12, "12 seconds"]] as const)
        if (t >= at && !calls.includes(label)) {
          calls.push(label);
          $("tm-call").textContent = label;
          buzz(60);
          beep();
        }
      if (t >= 17 && phase === "inspect") return inspectDnf();
    } else return;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/** Inspection ran past 17 seconds without a start: the attempt is a DNF. */
function inspectDnf() {
  if (!sess) return;
  if (!sess.startedAt) sess.startedAt = Date.now();
  sess.solves.push({ t: 0, pen: "dnf", scramble: sess.scramble, at: Date.now() });
  if (skill()?.cube) sess.scramble = scrambleFor(skill()?.event);
  phase = "idle";
  persist();
  toast("Inspection ran past 17 seconds: DNF");
  draw();
}

function stopLoop() {
  cancelAnimationFrame(raf);
  clearTimeout(holdTimer);
}

function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* optional */
  }
}

let actx: AudioContext | null = null;
function beep() {
  try {
    actx ??= new AudioContext();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.connect(g).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + 0.12);
  } catch {
    /* optional */
  }
}

/* ---------- draw ---------- */

function draw() {
  if (!sess) return;
  const p = skill();
  const times = sess.solves.map(result);
  const ok = times.filter((x) => x != null) as number[];
  $("tm-name").textContent = p ? `${p.icon ? p.icon + " " : ""}${p.name}` : "Timer";
  const mo3 = fmtOf(p) === "mo3";
  const ev = p?.cube ? CUBE_EVENT[p.event || "333"] : null;
  $("tm-scr").textContent = sess.scramble || (ev ? `Scramble your ${ev.name} with an official scrambler` : "");
  $("tm-scrRow").hidden = !p?.cube;
  $("tm-next").hidden = !sess.scramble;
  $("tm-scrRow").classList.toggle("long", sess.scramble.length > 160);
  $<HTMLInputElement>("tm-insp").checked = sess.inspect;
  const root = $("tm");
  root.dataset.phase = phase === "armed" && armedFromInspect ? "inspect-armed" : phase === "ready" ? "ready" : phase;
  if (phase === "idle") {
    const last = sess.solves[sess.solves.length - 1];
    $("tm-clock").textContent = last ? fmt(result(last)) + (last.pen === 2 ? "+" : "") : "0.00";
    $("tm-call").textContent = "";
  }
  $("tm-hint").textContent =
    phase === "idle"
      ? sess.inspect
        ? "Tap to start inspection"
        : "Hold until green, release to start"
      : phase === "inspect"
        ? "Hold until green, release to start"
        : phase === "armed"
          ? "Keep holding…"
          : phase === "ready"
            ? "Release to start"
            : "Tap anywhere to stop";
  $("tm-stats").innerHTML = [
    ["Solves", String(sess.solves.length)],
    ["Best", ok.length ? fmt(Math.min(...ok)) : "—"],
    mo3 ? ["mo3", fmt(mean3(times))] : ["ao5", fmt(wcaAverage(times, 5))],
    mo3 ? ["ao5", fmt(wcaAverage(times, 5))] : ["ao12", fmt(wcaAverage(times, 12))],
    mo3 ? ["Best mo3", fmt(bestMean3(times) ?? undefined)] : ["Best ao5", fmt(bestAverage(times, 5) ?? undefined)],
    ["Mean", ok.length ? fmt(ok.reduce((s, x) => s + x, 0) / ok.length) : "—"],
  ]
    .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
    .join("");
  const last = sess.solves[sess.solves.length - 1];
  $("tm-pen").hidden = !last || phase !== "idle";
  if (last) document.querySelectorAll<HTMLElement>("#tm-pen [data-pen]").forEach((b) => b.setAttribute("aria-pressed", String(String(last.pen) === b.dataset.pen)));
  $("tm-list").innerHTML = sess.solves
    .map((s, i) => `<li><em>${i + 1}</em>${s.pen === "dnf" ? `DNF${s.t ? ` <small>(${fmt(s.t)})</small>` : ""}` : esc(fmt(result(s))) + (s.pen ? "<small>+2</small>" : "")}</li>`)
    .reverse()
    .join("");
  $<HTMLButtonElement>("tm-save").disabled = !sess.solves.length || phase !== "idle";
  $("tm-close").textContent = armClose ? "Tap again: discard solves" : "Close";
  $("tm-close").classList.toggle("arm", armClose);
  const busy = phase !== "idle";
  root.classList.toggle("busy", busy);
}

/** Save the session as one practice log: best single as the result, every solve kept. */
function save() {
  const p = skill();
  if (!sess || !p || !sess.solves.length) return;
  const times = sess.solves.map(result);
  const ok = times.filter((x) => x != null) as number[];
  const best = ok.length ? Math.min(...ok) : null;
  const mo3 = fmtOf(p) === "mo3";
  const ao5 = mo3 ? bestMean3(times) : bestAverage(times, 5);
  const ao12 = mo3 ? null : bestAverage(times, 12);
  const end = sess.solves[sess.solves.length - 1].at;
  const mins = Math.max(1, Math.round((end - (sess.startedAt || end)) / 60000));
  const note = [`${sess.solves.length} solves`, ao5 != null ? `best ${mo3 ? "mo3" : "ao5"} ${fmt(ao5)}` : "", ao12 != null ? `ao12 ${fmt(ao12)}` : ""].filter(Boolean).join(" · ");
  commitPractice(p, null, { date: dkey(), mins, value: best, note, solves: times, ao5 });
  sess = null;
  persist();
  close();
  toast("Session saved", "xp");
}

/* ---------- wiring ---------- */

export function initTimer(): void {
  const el = document.createElement("div");
  el.id = "tm";
  el.className = "tm";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Solve timer");
  el.innerHTML = `
    <header class="tm-h"><b id="tm-name">Timer</b><label class="switch tm-sw"><input type="checkbox" id="tm-insp"><span class="sw"></span><span>Inspection</span></label></header>
    <div class="tm-scr" id="tm-scrRow"><span id="tm-scr"></span><button class="mini" type="button" id="tm-next">New scramble</button></div>
    <div class="tm-pad" id="tm-pad">
      <div class="tm-call" id="tm-call" aria-live="assertive"></div>
      <div class="tm-clock" id="tm-clock">0.00</div>
      <div class="tm-hint" id="tm-hint"></div>
    </div>
    <div class="tm-pen" id="tm-pen" hidden>
      <button class="mini" type="button" data-pen="0">OK</button>
      <button class="mini" type="button" data-pen="2">+2</button>
      <button class="mini" type="button" data-pen="dnf">DNF</button>
      <button class="mini" type="button" id="tm-del">Delete</button>
    </div>
    <div class="tm-stats" id="tm-stats"></div>
    <ol class="tm-list" id="tm-list"></ol>
    <div class="tm-acts"><button class="btn" type="button" id="tm-close">Close</button><span class="grow"></span><button class="btn primary" type="button" id="tm-save"><span class="ico">${ICON.check}</span>Save session</button></div>`;
  document.body.appendChild(el);

  const pad = $("tm-pad");
  pad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    down();
  });
  pad.addEventListener("pointerup", (e) => {
    e.preventDefault();
    up();
  });
  pad.addEventListener("pointercancel", () => {
    if (phase === "armed" || phase === "ready") {
      phase = armedFromInspect ? "inspect" : "idle";
      draw();
    }
  });
  // While running, a touch anywhere on the screen stops the clock.
  el.addEventListener("pointerdown", (e) => {
    if (phase === "running" && !pad.contains(e.target as Node)) stop();
  });
  document.addEventListener("keydown", (e) => {
    if ($("tm").hidden) return;
    if (e.key === "Escape" && phase === "idle") return void $("tm-close").click();
    if (phase === "running") {
      e.preventDefault();
      return stop();
    }
    if (e.code === "Space" && !e.repeat) {
      e.preventDefault();
      down();
    }
  });
  document.addEventListener("keyup", (e) => {
    if ($("tm").hidden || e.code !== "Space") return;
    e.preventDefault();
    up();
  });

  $("tm-insp").addEventListener("change", () => {
    if (!sess) return;
    sess.inspect = $<HTMLInputElement>("tm-insp").checked;
    persist();
    draw();
  });
  $("tm-next").addEventListener("click", () => {
    if (!sess || phase !== "idle") return;
    sess.scramble = scrambleFor(skill()?.event);
    persist();
    draw();
  });
  $("tm-pen").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pen]");
    const last = sess?.solves[sess.solves.length - 1];
    if (!b || !last || last.t === 0) return;
    last.pen = b.dataset.pen === "dnf" ? "dnf" : (+b.dataset.pen! as Pen);
    persist();
    draw();
  });
  $("tm-del").addEventListener("click", () => {
    if (!sess?.solves.length) return;
    sess.solves.pop();
    if (!sess.solves.length) sess.startedAt = 0;
    persist();
    draw();
  });
  $("tm-save").addEventListener("click", save);
  $("tm-close").addEventListener("click", () => {
    if (!sess) return close();
    if (sess.solves.length && !armClose) {
      armClose = true;
      draw();
      setTimeout(() => {
        armClose = false;
        if (!$("tm").hidden) draw();
      }, 4000);
      return;
    }
    sess = null;
    persist();
    close();
  });
}
