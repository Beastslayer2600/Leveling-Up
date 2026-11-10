/* Morning Sequence: a full-screen, one-step-at-a-time screen built for a phone in bed.
   The next step is always already decided, one tap completes it, and nothing here scolds. */
import { RHYTHM } from "../lib/leveling/config";
import { dkey } from "../lib/leveling/dates";
import { catName } from "../lib/leveling/prefs";
import {
  briefing,
  clearLowDay,
  completeStep,
  currentStep,
  dayFor,
  fmtCountdown,
  morningStatus,
  morningSteps,
  morningStreak,
  pickMainQuest,
  setLowDay,
  startTimer,
  stepXp,
  timerEndsAt,
} from "../lib/leveling/rhythm";
import { awardTotal } from "../lib/leveling/xp";
import type { Quest, RhythmDay } from "../lib/leveling/types";
import { $, ICON, cvar, esc } from "./dom";
import { toast } from "./fx";
import { FOCUS_HASH, S, after, award, focusFromHash, put, render, type Focus } from "./state";

const M = RHYTHM.morning;
const today = (): RhythmDay => dayFor(S.data.rhythm, dkey());
export const rhythmOn = () => S.data.prefs.modules.rhythm;

export function openFocus(f: Focus): void {
  if (!rhythmOn()) return;
  S.focus = f;
  if (focusFromHash() !== f) history.pushState(null, "", "#" + FOCUS_HASH[f]);
  render();
  window.scrollTo({ top: 0 });
}

export function closeFocus(): void {
  if (!S.focus) return;
  S.focus = null;
  history.replaceState(null, "", "#" + S.tab);
  render();
}

/* ---------- actions ---------- */

function finishStep(stepId: string, at = Date.now()): void {
  const r = completeStep(today(), stepId, at);
  if (!r) return;
  put("rhythm", r.day);
  r.awards.forEach((a) => award({ ...a, quiet: true }));
  const [step, ...bonuses] = r.awards;
  toast(`+${awardTotal(step)} XP · ${step.title.split(": ")[1]}`, "xp");
  bonuses.forEach((b, i) => setTimeout(() => toast(`+${b.delta} XP · ${b.title.split(": ")[1]}`, "xp"), 1100 * (i + 1)));
  after();
}

/** A countdown that ended while the phone was locked or the screen was closed still counts. */
export function settleTimer(): void {
  if (!rhythmOn()) return;
  const day = today();
  const end = timerEndsAt(day);
  const step = currentStep(day);
  if (!end || !step || Date.now() < end) return;
  finishStep(step.id, end);
  navigator.vibrate?.([200, 100, 200]);
}

function act(a: string, id?: string): void {
  const day = today();
  const step = currentStep(day);
  switch (a) {
    case "close":
      return closeFocus();
    case "done":
      if (step) finishStep(step.id);
      break;
    case "start":
      put("rhythm", startTimer(day, Date.now()));
      break;
    case "low":
      put("rhythm", setLowDay(day, Date.now()));
      break;
    case "full":
      put("rhythm", clearLowDay(day));
      break;
    case "pick":
      if (step && id) {
        put("rhythm", pickMainQuest(day, id));
        finishStep(step.id);
      }
      break;
  }
  render();
}

export function initRhythm(): void {
  $("focus").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
    if (b) act(b.dataset.r!, b.dataset.id);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.focus && $("scrim").hidden) closeFocus();
  });
}

/* ---------- render ---------- */

const streakText = (now = new Date()) => {
  const s = morningStreak(S.data.rhythm, now);
  if (!s.count) return "";
  return `${s.count}-day streak${s.paused ? " · paused" : ""}`;
};

function streakChip(): string {
  const s = morningStreak(S.data.rhythm);
  if (!s.count) return "";
  return `<span class="fx-streak${s.paused ? " paused" : ""}" title="${s.paused ? "Paused. It picks up again with the next morning you keep." : "Mornings kept"}">${s.paused ? ICON.pause : ICON.flame}<b>${s.count}</b>${s.paused ? "<small>paused</small>" : ""}</span>`;
}

const questCard = (q: Quest, label: string) =>
  `<div class="fx-card" style="--cc:${cvar(q.cat)}"><small>${label}</small><b>${esc(q.title)}</b>${q.nextStep ? `<span>Next: ${esc(q.nextStep)}</span>` : ""}</div>`;

function stepExtra(day: RhythmDay, id: string): { html: string; acts?: string } {
  if (id === "food") {
    const b = day.plan?.breakfast?.trim();
    return { html: `<div class="fx-card"><small>Breakfast</small><b>${esc(b || M.breakfastFallback)}</b></div>` };
  }
  if (id !== "briefing") return { html: "" };
  const b = briefing(day, S.data.quests);
  const where = `<span class="fx-where">${b.office ? "Office day" : "Home day"}${day.plan?.leaveBy ? ` · leave by ${esc(day.plan.leaveBy)}` : ""}</span>`;
  if (b.main) {
    const must = b.mustDos.length
      ? `<div class="fx-card"><small>Must-dos</small><ol>${b.mustDos.map((q) => `<li>${esc(q.title)}${q.nextStep ? `<span>Next: ${esc(q.nextStep)}</span>` : ""}</li>`).join("")}</ol></div>`
      : "";
    return { html: where + questCard(b.main, "Main quest") + must };
  }
  if (!b.pick.length) return { html: where + `<p class="fx-hint">No open quests yet. You can add one from Missions later.</p>` };
  const xp = stepXp(M.steps.find((s) => s.id === id)!);
  return {
    html:
      where +
      `<p class="fx-pick-h">Pick one main quest for today · ${M.fallbackPickMins} min</p><div class="fx-pick">` +
      b.pick
        .map(
          (q) =>
            `<button type="button" class="fx-opt" data-r="pick" data-id="${esc(q.id)}" style="--cc:${cvar(q.cat)}"><b>${esc(q.title)}</b><span>${esc(q.nextStep ? "Next: " + q.nextStep : catName(S.data.prefs, q.cat))}</span></button>`,
        )
        .join("") +
      "</div>",
    acts: `<button class="btn fx-low" type="button" data-r="done">Decide later <small>+${xp} XP</small></button>`,
  };
}

function stepScreen(day: RhythmDay): string {
  const steps = morningSteps(day);
  const step = currentStep(day)!;
  const i = steps.indexOf(step);
  const xp = stepXp(step);
  const extra = stepExtra(day, step.id);
  const end = timerEndsAt(day);
  let clock = "";
  let acts: string;
  if (step.timer) {
    clock = `<div class="fx-clock${end ? " run" : ""}" id="fx-clock" role="timer" aria-live="off">${fmtCountdown(end ? end - Date.now() : step.mins * 60000)}</div>`;
    acts = end
      ? `<p class="fx-hint">Stop when it reaches zero. It completes by itself.</p><button class="linkbtn" type="button" data-r="done">Finished early</button>`
      : `<button class="btn primary fx-go" type="button" data-r="start">Start ${step.mins}-minute timer</button>`;
  } else {
    acts = extra.acts || `<button class="btn primary fx-go" type="button" data-r="done">Done <small>+${xp} XP</small></button>`;
  }
  if (!day.morning.low) {
    acts +=
      i === 0
        ? `<button class="btn fx-low" type="button" data-r="low">Low day</button><p class="fx-hint">Just ${M.lowDaySteps.map((id) => M.steps.find((s) => s.id === id)!.title).join(" + ")} today. Your streak stays alive.</p>`
        : `<button class="linkbtn" type="button" data-r="low">Low day</button>`;
  }
  return (
    `<div class="fx-body"><p class="fx-n">Step ${i + 1} of ${steps.length} · ${step.mins} min</p>` +
    `<h2 id="fx-title">${esc(step.title)}</h2><p class="fx-hint">${esc(step.hint)}</p>${clock}${extra.html}</div>` +
    `<div class="fx-acts">${acts}</div>`
  );
}

function doneScreen(day: RhythmDay): string {
  const low = morningStatus(day) === "low";
  const m = day.morning;
  const lines = [
    m.anchor ? `<li>On-time start <b>+${M.wakeAnchor.xp}</b></li>` : "",
    m.combo ? `<li>Combo <b>+${M.combo.xp}</b></li>` : "",
  ].join("");
  const b = briefing(day, S.data.quests);
  const st = streakText();
  return (
    `<div class="fx-body fx-end"><span class="fx-badge">${ICON.sun}</span>` +
    `<h2 id="fx-title">${low ? "Low day done" : "Morning done"}</h2>` +
    `<p class="fx-xp">+${m.xp} XP</p>${lines ? `<ul class="fx-bonus">${lines}</ul>` : ""}` +
    (st ? `<p class="fx-hint">${st}</p>` : "") +
    (b.main ? questCard(b.main, "Today's main quest") : "") +
    `</div><div class="fx-acts"><button class="btn primary fx-go" type="button" data-r="close">Go to Missions</button>` +
    (low ? `<button class="linkbtn" type="button" data-r="full">Continue with the full sequence</button>` : "") +
    `</div>`
  );
}

let tick: ReturnType<typeof setInterval> | undefined;

export function renderFocus(): void {
  clearInterval(tick);
  if (S.focus && !rhythmOn()) S.focus = null;
  const el = $("focus");
  el.hidden = !S.focus;
  document.body.classList.toggle("focus-open", !!S.focus);
  if (!S.focus) return;
  const day = today();
  const steps = morningSteps(day);
  const date = new Date().toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
  el.innerHTML =
    `<div class="fx"><header class="fx-top"><div><p class="kicker">${date}${day.morning.low ? " · Low day" : ""}</p><b>${M.title}</b></div>` +
    `${streakChip()}<button class="fx-x" type="button" data-r="close" aria-label="Close">${ICON.x}</button></header>` +
    `<div class="fx-pips" style="--n:${steps.length}">${steps.map((s) => `<i class="${day.morning.steps[s.id] ? "on" : s === currentStep(day) ? "cur" : ""}"></i>`).join("")}</div>` +
    (currentStep(day) ? stepScreen(day) : doneScreen(day)) +
    `</div>`;
  const end = timerEndsAt(day);
  if (end)
    tick = setInterval(() => {
      const left = end - Date.now();
      if (left <= 0) {
        settleTimer();
        render();
      } else $("fx-clock").textContent = fmtCountdown(left);
    }, 250);
}

/** The card on the Missions tab that opens the sequence. */
export function renderMorningCard(): void {
  const el = $("m-nudge");
  el.hidden = !rhythmOn();
  if (el.hidden) return;
  const day = today();
  const steps = morningSteps(day);
  const step = currentStep(day);
  const st = streakText();
  let sub: string;
  if (step) {
    const i = steps.indexOf(step);
    sub = `${i ? `Step ${i + 1} of ${steps.length}` : "Start"}: ${step.title} · ${step.mins} min`;
  } else sub = `${morningStatus(day) === "low" ? "Low day" : "All steps"} · +${day.morning.xp} XP`;
  el.classList.toggle("done", !step);
  $("m-nudge-t").textContent = step ? M.title : `${M.title} done`;
  $("m-nudge-s").textContent = sub + (st ? ` · ${st}` : "");
}
