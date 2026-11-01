import "@fontsource/rajdhani/latin-500.css";
import "@fontsource/rajdhani/latin-600.css";
import "@fontsource/rajdhani/latin-700.css";
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "./styles.css";

import { buildPrompt, parseSuggestions } from "./lib/leveling/coach";
import { activeCats } from "./lib/leveling/prefs";
import { normalize } from "./lib/leveling/data";
import { dkey } from "./lib/leveling/dates";
import { closed, stepCounter, toggleQuest } from "./lib/leveling/missions";
import { completeVirtue, rrState, todayVirtue, VIRTUE_XP } from "./lib/leveling/virtues";
import type { Quest } from "./lib/leveling/types";
import { $, ICON } from "./ui/dom";
import { toast } from "./ui/fx";
import { initJournal } from "./ui/journal";
import { askCoach, initSync } from "./ui/sync";
import { closeSheet, initSheets, openCommitMission, openEntry, openSheet } from "./ui/sheets";
import { S, after, award, drop, grant, initialTab, newId, onRender, put, replaceData, save, setTab, type Tab } from "./ui/state";
import { coachEnabled, render, renderNav } from "./ui/views";

onRender(render);

// Static icons in the markup.
document.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
  el.innerHTML = ICON[el.dataset.icon as keyof typeof ICON] || "";
  el.classList.add("ico");
});

S.tab = initialTab();
renderNav();
initSheets();
initJournal();

/* ---------- missions ---------- */

function toggle(id: string) {
  const q = S.data.quests.find((x) => x.id === id);
  if (!q) return;
  const r = toggleQuest(q, S.data.quests);
  put("quests", r.quest);
  award(r.award);
  after();
}

function step(id: string, d: number) {
  const q = S.data.quests.find((x) => x.id === id);
  if (!q) return;
  const r = stepCounter(q, d);
  if (!r) return;
  put("quests", r.quest);
  award(r.award);
  if (r.hit) setTimeout(() => toast("Quest complete: " + q.title, "xp"), 900);
  after();
}

$("v-done").addEventListener("click", () => {
  if (S.data.stats.virtue.last === dkey()) return;
  const vt = todayVirtue(new Date(), S.vSwap);
  const sunday = new Date().getDay() === 0;
  award({ delta: VIRTUE_XP, title: "Virtue: " + vt.n, cat: "faith", events: sunday ? ["sabbath"] : [], mut: (st) => completeVirtue(st, vt) });
  render();
  after();
});
$("v-swap").addEventListener("click", () => {
  S.vSwap = (S.vSwap + 1) % 25;
  render();
});

function rrComplete() {
  const r = rrState(S.data.release);
  if (!r.open) return;
  S.data.release = { ...S.data.release, days: { ...r.days, [r.cur]: dkey() } };
  save();
  award({ delta: 30, title: "Release Reset · Day " + r.cur, cat: "faith" });
  if (r.cur === 7) setTimeout(() => toast("Release Reset complete. You opened your hand.", "xp"), 900);
  render();
  after();
}

$("clearDone").addEventListener("click", () => {
  if (!S.armClear) {
    S.armClear = true;
    render();
    setTimeout(() => { S.armClear = false; render(); }, 4000);
    return;
  }
  S.armClear = false;
  const ids = S.data.quests.filter((q) => closed(q)).map((q) => q.id);
  ids.forEach((id) => drop("quests", id));
  render();
  toast(`Cleared ${ids.length} missions`);
});

/* ---------- coach (server route; shown once you're signed in) ---------- */

let coachBusy = false;

$("c-go").addEventListener("click", async () => {
  if (!coachEnabled() || coachBusy) return;
  const status = $("c-status");
  status.hidden = false;
  const focus = ($("c-focus") as HTMLInputElement).value.trim();
  coachBusy = true;
  ($("c-go") as HTMLButtonElement).disabled = true;
  status.textContent = "Coach is reading your logs…";
  try {
    const r = await askCoach(buildPrompt(S.data, focus));
    if (r.status === 503) { status.textContent = "The coach isn't switched on yet. Add your Anthropic API key in Vercel."; return; }
    if (!r.text) { status.textContent = r.error || "Couldn't reach the coach. Tap Unlock to try again."; return; }
    const items = parseSuggestions(r.text, activeCats(S.data.prefs).map((c) => c.id));
    if (!items.length) { status.textContent = "The coach came back empty. Try again with a focus."; return; }
    S.data.coach = { items, at: Date.now(), focus };
    save();
    status.hidden = true;
    render();
  } catch {
    status.textContent = "Couldn't reach the coach. Check your connection.";
  } finally {
    coachBusy = false;
    ($("c-go") as HTMLButtonElement).disabled = false;
  }
});

function acceptSug(i: number) {
  const s = S.data.coach.items[i];
  if (!s) return;
  const q: Quest = { id: newId(), created: Date.now(), title: s.title, note: s.why, cat: s.cat, kind: s.kind, xp: s.xp, coach: true };
  if (s.kind === "counter") { q.target = s.target || 3; q.period = s.period || "week"; q.progress = 0; }
  put("quests", q);
  S.data.coach = { ...S.data.coach, items: S.data.coach.items.filter((_, j) => j !== i) };
  save();
  render();
  toast("Mission unlocked: " + s.title, "xp");
  setTimeout(() => grant(["recruited"]), 1300);
}

/* ---------- backup / restore ---------- */

$("d-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ app: "leveling-up", version: 1, exported: new Date().toISOString(), data: S.data }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `leveling-up-backup-${dkey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Backup saved to your downloads");
});

let armRestore = false;
$("d-import").addEventListener("click", () => {
  if (!armRestore) {
    armRestore = true;
    $("d-import").classList.add("arm");
    $("d-import").lastChild!.textContent = "Tap again: replaces this device's log";
    setTimeout(() => { armRestore = false; $("d-import").classList.remove("arm"); $("d-import").lastChild!.textContent = "Restore"; }, 4000);
    return;
  }
  ($("d-file") as HTMLInputElement).click();
});
$("d-file").addEventListener("change", async () => {
  const input = $("d-file") as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    replaceData(normalize(parsed?.data ?? parsed));
    render();
    toast("Log restored");
    after();
  } catch {
    toast("That file isn't a Leveling Up backup.");
  }
});

/* ---------- clicks ---------- */

let pokes: number[] = [];
$("hex").addEventListener("click", () => {
  const now = Date.now();
  pokes = [...pokes.filter((t) => now - t < 4000), now];
  $("hex").classList.remove("poke");
  void $("hex").offsetWidth;
  $("hex").classList.add("poke");
  if (pokes.length >= 7) { pokes = []; grant(["curious"]); }
});

document.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act],[data-tab],[data-fab]");
  if (!b) return;
  if (b.dataset.tab) {
    setTab(b.dataset.tab as Tab);
    render();
    window.scrollTo({ top: 0 });
    return;
  }
  if (b.hasAttribute("data-fab")) {
    if (S.tab === "journal") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      $("j-mic").click();
    } else if (S.tab === "character") openEntry("skill", null);
    else openSheet(({ missions: "mission", body: "workout", social: "social", money: "money" } as const)[S.tab]);
    return;
  }
  const a = b.dataset.act;
  const id = b.dataset.id!;
  const find = <T extends { id: string }>(arr: T[]) => arr.find((x) => x.id === id) || null;
  switch (a) {
    case "toggle": toggle(id); render(); break;
    case "plus": step(id, 1); render(); break;
    case "minus": step(id, -1); render(); break;
    case "edit-q": if (find(S.data.quests)) openSheet("mission", find(S.data.quests)); break;
    case "edit-w": if (find(S.data.workouts)) openSheet("workout", find(S.data.workouts)); break;
    case "edit-f": if (find(S.data.meals)) openSheet("meal", find(S.data.meals)); break;
    case "edit-s": if (find(S.data.social)) openSheet("social", find(S.data.social)); break;
    case "edit-m": if (find(S.data.money)) openSheet("money", find(S.data.money)); break;
    case "edit-j": if (find(S.data.journal)) openSheet("journal", find(S.data.journal)); break;
    case "j-more": b.classList.toggle("open"); break;
    case "edit-e": openEntry(b.dataset.type as "chapter" | "skill" | "feat", id); break;
    case "filter": S.filter = b.dataset.cat!; render(); break;
    case "c-accept": acceptSug(+b.dataset.i!); break;
    case "c-skip":
      S.data.coach = { ...S.data.coach, items: S.data.coach.items.filter((_, j) => j !== +b.dataset.i!) };
      save(); render(); break;
    case "rr-done": rrComplete(); break;
    case "rr-restart":
      S.data.release = { ...S.data.release, days: {}, cycles: (S.data.release.cycles || 0) + 1 };
      save(); render(); break;
    case "rr-commit": openCommitMission(); break;
  }
});

window.addEventListener("hashchange", () => {
  const t = initialTab();
  if (t !== S.tab) { S.tab = t; closeSheet(); render(); }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });

render();
setTab(S.tab);
after();
// First run: once we know whose log this is, offer setup so the app fits this player.
void initSync(() => {
  if (!S.data.prefs.setup && !S.sheetName && $("auth").hidden) openSheet("setup");
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
