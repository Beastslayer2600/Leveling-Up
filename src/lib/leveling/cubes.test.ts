import { describe, expect, it } from "vitest";
import { CUBE_EVENTS, bestMean3, cubeStandard, mean3, scrambleFor, scrambleNxN } from "./cubes.js";
import { normalizePursuit } from "./practice.js";

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe("cube events", () => {
  it("has the WCA events with ladders, easiest first", () => {
    expect(CUBE_EVENTS.map((e) => e.id)).toEqual(expect.arrayContaining(["222", "333", "444", "555", "666", "777", "pyram", "minx", "skewb", "sq1", "clock", "333oh", "333bf"]));
    for (const e of CUBE_EVENTS) {
      const s = cubeStandard(e.id);
      expect(s.name).toBe("WCA " + e.name);
      for (let i = 1; i < s.tiers.length; i++) expect(s.tiers[i].value).toBeLessThan(s.tiers[i - 1].value);
    }
    expect(cubeStandard("333").tiers.at(-1)?.name).toBe("SA record (4.82)");
    expect(cubeStandard("777").tiers[0].name).toBe("Sub-15:00");
  });
  it("scrambles each puzzle in its own notation", () => {
    const n4 = scrambleNxN(4, rand).split(" ");
    expect(n4).toHaveLength(40);
    for (const m of n4) expect(m).toMatch(/^[UDRLFB]w?['2]?$/);
    const n7 = scrambleNxN(7, rand).split(" ");
    expect(n7).toHaveLength(100);
    for (const m of n7) expect(m).toMatch(/^3?[UDRLFB]w?['2]?$/);
    expect(n7.some((m) => m.startsWith("3"))).toBe(true);
    for (const m of scrambleNxN(2, rand).split(" ")) expect(m).toMatch(/^[URF]['2]?$/);
    expect(scrambleFor("minx", rand).split("\n")).toHaveLength(7);
    expect(scrambleFor("clock", rand)).toContain("y2");
    expect(scrambleFor("pyram", rand)).toMatch(/^[ULRB]/);
    expect(scrambleFor("sq1", rand)).toBe("");
  });
  it("mean of 3: any DNF is a DNF", () => {
    expect(mean3([60, 66, 72])).toBe(66);
    expect(mean3([60, null, 72])).toBeNull();
    expect(mean3([60])).toBeUndefined();
    expect(bestMean3([90, 60, 60, 60, null])).toBe(60);
  });
  it("cube skills keep their event", () => {
    expect(normalizePursuit({ id: "a", name: "7x7", cube: true, event: "777", metric: { name: "Best single", kind: "time", unit: "" } }).event).toBe("777");
    expect(normalizePursuit({ id: "b", name: "Chess", metric: { name: "Rating", kind: "higher", unit: "" } }).event).toBeUndefined();
  });
});
