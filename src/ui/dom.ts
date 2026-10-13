import { parseD } from "../lib/leveling/dates";
import { CAT } from "../lib/leveling/xp";

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const cvar = (cat: string) => `var(${(CAT[cat] || CAT.side).v})`;

export const fmtN = (n: number) => Math.round(n).toLocaleString("en-ZA").replace(/[, ]/g, " ");
export const rands = (n: number) => "R" + fmtN(Math.abs(n));
export const rands2 = (n: number) =>
  "R" + Math.abs(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const shortD = (s: string) => parseD(s).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
export const dayBox = (s: string) => {
  const d = parseD(s);
  return `<span class="d"><b>${d.getDate()}</b>${d.toLocaleDateString("en-ZA", { month: "short" })}</span>`;
};
export const sumBy = <T>(a: T[], f: (x: T) => unknown) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export const pct = (a: number, b: number) => (b ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0);

export const radio = (name: string, val: string) => {
  const el = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${val}"]`);
  if (el) el.checked = true;
};
export const radioVal = (name: string) =>
  document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;

export const val = (id: string) => $<HTMLInputElement>(id).value;
export const setVal = (id: string, v: unknown) => ($<HTMLInputElement>(id).value = v == null ? "" : String(v));

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const ICON = {
  missions: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  body: svg('<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>'),
  social: svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14c2.4.2 4 1.7 4.5 4.5"/>'),
  money: svg('<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>'),
  character: svg('<path d="M12 2.5l8 4.5v10l-8 4.5-8-4.5V7z"/><circle cx="12" cy="10" r="2.6"/><path d="M7.5 17c.8-2.2 2.4-3.3 4.5-3.3s3.7 1.1 4.5 3.3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  flame: svg('<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2-4.6.3 1.8 1.2 2.8 2.3 3.1C10.6 9 11.2 6 12 3z"/>'),
  bolt: svg('<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>'),
  cross: svg('<path d="M12 3v18M7 8h10"/>'),
  spark: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
  chevL: svg('<path d="M15 6l-6 6 6 6"/>'),
  chevR: svg('<path d="M9 6l6 6-6 6"/>'),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  upload: svg('<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>'),
};
