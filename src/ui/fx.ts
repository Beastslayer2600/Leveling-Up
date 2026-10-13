import { rankOf } from "../lib/leveling/xp";
import { $, ICON, esc } from "./dom";

let timer: ReturnType<typeof setTimeout> | undefined;

function show(el: HTMLElement, ms = 2400) {
  const host = $("toasts");
  host.replaceChildren(el);
  clearTimeout(timer);
  timer = setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 250);
  }, ms);
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
}

export function levelUp(level: number): void {
  const el = document.createElement("div");
  el.className = "lvup";
  el.innerHTML = `<div class="lvup-rays"></div><div class="lvup-card"><small>Level up</small><b>${level}</b><span>${esc(rankOf(level))}</span></div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
