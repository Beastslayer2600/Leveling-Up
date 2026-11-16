import { rankOf } from "../lib/leveling/xp";
import { $, ICON, esc } from "./dom";
import { confetti, reduced } from "./motion";

let timer: ReturnType<typeof setTimeout> | undefined;

function show(el: HTMLElement, ms = 2400) {
  const host = $("toasts");
  // An older toast leaves as the new one arrives; both are CSS transitions, so a rapid
  // second toast retargets smoothly instead of restarting a keyframe.
  for (const old of host.children) if (!old.classList.contains("out")) dismiss(old as HTMLElement);
  host.appendChild(el);
  clearTimeout(timer);
  timer = setTimeout(() => dismiss(el), ms);
}

function dismiss(el: HTMLElement) {
  el.classList.add("out");
  setTimeout(() => el.remove(), 260);
}

export function toast(msg: string, kind: "" | "xp" = ""): void {
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.setAttribute("role", "status");
  el.innerHTML = (kind === "xp" ? `<span class="ti">${ICON.bolt}</span>` : "") + `<span>${esc(msg)}</span>`;
  show(el);
}

export function toastAch(name: string): void {
  const el = document.createElement("div");
  el.className = "toast ach";
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="ti">${ICON.trophy}</span><span><small>Achievement unlocked · +50 XP</small>${esc(name)}</span>`;
  show(el, 2800);
  requestAnimationFrame(() => {
    const r = el.getBoundingClientRect();
    confetti({ x: r.left + 24, y: r.top + r.height / 2, count: 24, spread: 0.7 });
  });
}

export function levelUp(level: number): void {
  const el = document.createElement("div");
  el.className = "lvup";
  el.innerHTML = `<div class="lvup-rays"></div><div class="lvup-flash"></div><div class="lvup-card"><small>Level up</small><b>${level}</b><span>${esc(rankOf(level))}</span></div>`;
  document.body.appendChild(el);
  if (!reduced()) {
    setTimeout(() => confetti({ count: 60, spread: 1.4 }), 120);
    setTimeout(() => confetti({ x: innerWidth * 0.2, y: innerHeight * 0.65, count: 24 }), 380);
    setTimeout(() => confetti({ x: innerWidth * 0.8, y: innerHeight * 0.65, count: 24 }), 520);
  }
  setTimeout(() => el.classList.add("out"), 2400);
  setTimeout(() => el.remove(), 2700);
}
