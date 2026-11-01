/* Customize: currency, units, which modules show, and mission category names.
   Opens by itself on a brand-new log so each player sets the app up for their own life. */
import { CURRENCIES, MODULES, catName, type ModuleId, type Prefs } from "../lib/leveling/prefs";
import { CATS } from "../lib/leveling/xp";
import type { CatId } from "../lib/leveling/types";
import { $, esc, radio, radioVal, setVal, val } from "./dom";
import { toast } from "./fx";
import { S, render, save } from "./state";

const OTHER = "__other";
const MODULE_CAT: Partial<Record<ModuleId, CatId>> = { faith: "faith", money: "money", social: "social", body: "training" };

export function fillSetup(): void {
  const p = S.data.prefs;
  const first = !p.setup;
  $("u-h").textContent = first ? "Set up your character" : "Customize";
  $("u-sub").textContent = first
    ? "Make Leveling Up fit your life. Pick what you track and name your mission categories. You can change all of it later from Character."
    : "Currency, units, what you track and your mission categories.";
  $("u-save").textContent = first ? "Start playing" : "Save";
  $("u-cancel").textContent = first ? "Skip for now" : "Cancel";
  setVal("u-name", S.data.sheet.name);

  const opts = CURRENCIES.includes(p.currency) ? CURRENCIES : [p.currency, ...CURRENCIES];
  $("u-cur").innerHTML = opts.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("") + `<option value="${OTHER}">Other…</option>`;
  setVal("u-cur", p.currency);
  setVal("u-curx", "");
  $("u-curF").hidden = true;
  radio("uunit", p.unit);

  $("u-mods").innerHTML = MODULES.map(
    (m) => `<label><input type="checkbox" name="umod" value="${m.id}"${p.modules[m.id] ? " checked" : ""}><span><b>${esc(m.name)}</b><small>${esc(m.d)}</small></span></label>`,
  ).join("");
  $("u-cats").innerHTML = CATS.map(
    (c) =>
      `<div class="cat-row" style="--cc:var(${c.v})"><input type="checkbox" name="ucat" value="${c.id}" aria-label="Use ${esc(catName(p, c.id))}"${p.catOff.includes(c.id) ? "" : " checked"}><input class="in" data-cat="${c.id}" maxlength="24" value="${esc(catName(p, c.id))}" placeholder="${esc(c.name)}" aria-label="Name for ${esc(c.name)}"></div>`,
  ).join("");
  setVal("u-in", p.inCats.join("\n"));
  setVal("u-out", p.outCats.join("\n"));
  syncMoneyField();
}

function syncMoneyField() {
  const money = document.querySelector<HTMLInputElement>('input[name="umod"][value="money"]');
  $("u-moneyF").hidden = !money?.checked;
}

const lines = (s: string) => s.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

function readForm(): Prefs {
  const p = S.data.prefs;
  const checked = (name: string) => new Set([...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((i) => i.value));
  const mods = checked("umod");
  const cats = checked("ucat");
  const names: Partial<Record<CatId, string>> = {};
  document.querySelectorAll<HTMLInputElement>("#u-cats input[data-cat]").forEach((i) => {
    const id = i.dataset.cat as CatId;
    const v = i.value.trim().slice(0, 24);
    if (v && v !== CATS.find((c) => c.id === id)?.name) names[id] = v;
  });
  const curSel = val("u-cur");
  const currency = (curSel === OTHER ? val("u-curx").trim() : curSel).slice(0, 4) || p.currency;
  const inCats = lines(val("u-in"));
  const outCats = lines(val("u-out"));
  return {
    currency,
    unit: radioVal("uunit") === "lb" ? "lb" : "kg",
    modules: Object.fromEntries(MODULES.map((m) => [m.id, mods.has(m.id)])) as Record<ModuleId, boolean>,
    catNames: names,
    catOff: CATS.filter((c) => !cats.has(c.id)).map((c) => c.id),
    inCats: inCats.length ? inCats.slice(0, 30) : p.inCats,
    outCats: outCats.length ? outCats.slice(0, 30) : p.outCats,
    setup: true,
  };
}

export function initSetup(open: () => void, close: () => void): void {
  $("p-custom").addEventListener("click", open);
  $("u-cur").addEventListener("change", () => {
    $("u-curF").hidden = val("u-cur") !== OTHER;
    if (!$("u-curF").hidden) $("u-curx").focus();
  });
  $("u-mods").addEventListener("change", (e) => {
    syncMoneyField();
    // Switching a module off usually means its mission category goes too (it can be ticked back).
    const m = e.target as HTMLInputElement;
    const cat = MODULE_CAT[m.value as ModuleId];
    const box = cat && document.querySelector<HTMLInputElement>(`input[name="ucat"][value="${cat}"]`);
    if (box) box.checked = m.checked;
  });
  // Skipping first-run setup still counts as setup, so it doesn't pop up again.
  $("u-cancel").addEventListener("click", () => {
    if (S.data.prefs.setup) return;
    S.data.prefs = { ...S.data.prefs, setup: true };
    save();
  });
  $("f-setup").addEventListener("submit", (e) => {
    e.preventDefault();
    const prefs = readForm();
    if (prefs.catOff.length === CATS.length) return toast("Keep at least one mission category.");
    const first = !S.data.prefs.setup;
    S.data.prefs = prefs;
    const name = val("u-name").trim().slice(0, 40);
    if (name !== S.data.sheet.name) S.data.sheet = { ...S.data.sheet, name };
    // Starter missions in a category you just switched off would only get in the way.
    const gone = S.data.quests.filter((q) => q.starter && prefs.catOff.includes(q.cat)).map((q) => q.id);
    if (gone.length) {
      S.data.quests = S.data.quests.filter((q) => !gone.includes(q.id));
      S.data.tomb = { ...S.data.tomb, ...Object.fromEntries(gone.map((id) => [id, Date.now()])) };
    }
    if (S.filter !== "all" && prefs.catOff.includes(S.filter as CatId)) S.filter = "all";
    save();
    close();
    render();
    toast(first ? "You're set up. Go earn some XP." : "Settings saved", "xp");
  });
}
