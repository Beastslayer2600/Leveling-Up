/* Full-screen, one-thing-at-a-time screens (Morning Sequence, Evening Debrief, weekly review). */
import { ICON } from "./dom";
import { FOCUS_HASH, S, focusFromHash, render, type Focus } from "./state";

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

export const longDate = (d: Date = new Date()) => d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });

/** The frame every focus screen shares: header with close button, optional progress pips, then the screen. */
export function shell(o: { kicker: string; title: string; right?: string; pips?: ("on" | "cur" | "")[]; inner: string }): string {
  return (
    `<div class="fx"><header class="fx-top"><div><p class="kicker">${o.kicker}</p><b>${o.title}</b></div>` +
    `${o.right || ""}<button class="fx-x" type="button" data-r="close" aria-label="Close">${ICON.x}</button></header>` +
    (o.pips ? `<div class="fx-pips" style="--n:${o.pips.length}">${o.pips.map((c) => `<i class="${c}"></i>`).join("")}</div>` : "") +
    o.inner +
    `</div>`
  );
}
