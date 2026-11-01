import { describe, expect, it } from "vitest";
import { visibleAch } from "./achievements.js";
import { buildPrompt, digest, parseSuggestions } from "./coach.js";
import { blankData, normalize } from "./data.js";
import { activeCats, catName, guessCurrency, normalizePrefs } from "./prefs.js";
import { parseSets } from "./training.js";

const NOW = new Date(2026, 9, 13, 10, 0, 0);

describe("settings", () => {
  it("gives a brand-new log generic labels and first-run setup", () => {
    const d = normalize({});
    expect(d.prefs.setup).toBe(false);
    expect(catName(d.prefs, "clients")).toBe("Work");
    expect(catName(d.prefs, "adjudication")).toBe("Craft");
    expect(d.prefs.inCats).not.toContain("Adjudication fees");
  });
  it("keeps a log saved before settings existed exactly as it was", () => {
    const d = normalize({ savedAt: 123, quests: [] });
    expect(d.prefs.setup).toBe(true);
    expect(d.prefs.currency).toBe("R");
    expect(catName(d.prefs, "clients")).toBe("Clients");
    expect(catName(d.prefs, "adjudication")).toBe("Adjudication");
    expect(d.prefs.inCats).toContain("Adjudication fees");
  });
  it("cleans stored settings", () => {
    const p = normalizePrefs(
      { currency: "  €  ", unit: "stone", catNames: { clients: " Studio ", bogus: "x", mind: "" }, catOff: ["faith", "nope"], inCats: [" A ", "A", ""], setup: true },
      false,
    );
    expect(p.currency).toBe("€");
    expect(p.unit).toBe("kg");
    expect(p.catNames).toEqual({ clients: "Studio" });
    expect(p.catOff).toEqual(["faith"]);
    expect(p.inCats).toEqual(["A"]);
    expect(activeCats(p).map((c) => c.id)).not.toContain("faith");
  });
  it("never leaves zero categories", () => {
    const p = normalizePrefs({ catOff: ["clients", "admin", "training", "adjudication", "social", "money", "faith", "mind", "side"] }, false);
    expect(activeCats(p).length).toBe(9);
  });
  it("guesses a currency from the browser region", () => {
    expect(guessCurrency("en-ZA")).toBe("R");
    expect(guessCurrency("en-GB")).toBe("£");
    expect(guessCurrency("de-DE")).toBe("€");
    expect(guessCurrency("en")).toBe("$");
  });
  it("hides achievements for switched-off modules and categories", () => {
    const p = normalizePrefs({ modules: { faith: false, money: false }, catOff: ["adjudication"] }, false);
    const ids = visibleAch(p).map((a) => a.id);
    expect(ids).not.toContain("grateful");
    expect(ids).not.toContain("black");
    expect(ids).not.toContain("adjeye");
    expect(ids).toContain("first");
  });
  it("reads weights with a lb suffix", () => {
    expect(parseSets("175lb x5, 185lbs×3")).toEqual([{ kg: 175, reps: 5 }, { kg: 185, reps: 3 }]);
  });
});

describe("coach follows settings", () => {
  it("leaves out faith and money when they're off, and uses the player's labels", () => {
    const d = blankData(NOW.getTime());
    d.prefs = normalizePrefs({ currency: "£", unit: "lb", modules: { faith: false, money: false }, catNames: { clients: "Studio" }, catOff: ["adjudication"] }, false);
    d.days = [{ id: "a", date: "2026-10-01", weight: 180, xp: 0 }, { id: "b", date: "2026-10-10", weight: 176, xp: 0 }];
    d.money = [{ id: "m", dir: "out", amount: 50, what: "Takeaway", cat: "Other", date: "2026-10-12", verdict: "bad", xp: 0, created: 0 }];
    const p = buildPrompt(d, "", NOW);
    expect(p).not.toMatch(/Bible/);
    expect(p).not.toContain("Takeaway");
    expect(p).not.toContain('"adjudication"');
    expect(p).toContain("Studio");
    expect(digest(d, NOW)).toContain("176 lb");
  });
  it("uses the player's currency in the money summary", () => {
    const d = blankData(NOW.getTime());
    d.prefs = normalizePrefs({ currency: "€" }, false);
    d.money = [{ id: "m", dir: "in", amount: 900, what: "Pay", cat: "Salary", date: "2026-10-12", xp: 0, created: 0 }];
    expect(digest(d, NOW)).toContain("in €900");
  });
  it("only accepts suggestions in categories the player uses", () => {
    const out = parseSuggestions([{ title: "Pray", cat: "faith" }, { title: "Run", cat: "training" }], ["training", "side"]);
    expect(out.map((s) => s.cat)).toEqual(["training", "training"]);
  });
});
