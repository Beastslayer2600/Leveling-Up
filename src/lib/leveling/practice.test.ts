import { describe, expect, it } from "vitest";
import { checkAchievements } from "./achievements.js";
import { blankData, normalize } from "./data.js";
import { bestOf, fmtTime, fmtValue, goalMet, isPb, normalizePursuit, parseValue, practiceStreak, practiceXp, skillRank, skillSummary } from "./practice.js";
import { mergeData } from "./sync.js";
import type { PracticeLog } from "./types.js";

// Tuesday 13 Oct 2026, 10:00 local.
const NOW = new Date(2026, 9, 13, 10, 0, 0);

const cube = normalizePursuit({ id: "cube", name: "Rubik's cube", metric: { name: "Best solve", kind: "time", unit: "" }, goal: 60, weeklyMins: 120 }, 0);
const chess = normalizePursuit({ id: "chess", name: "Chess", metric: { name: "Rating", kind: "higher", unit: "elo" } }, 0);

let n = 0;
const log = (p: Partial<PracticeLog>): PracticeLog => ({ id: "l" + n++, skill: "cube", date: "2026-10-13", created: n, mins: 30, value: null, note: "", pb: false, xp: 15, ...p });

describe("practice XP", () => {
  it("pays half an XP a minute, with a floor, a cap and a PB bonus", () => {
    expect(practiceXp(30)).toBe(15);
    expect(practiceXp(2)).toBe(3);
    expect(practiceXp(0)).toBe(0);
    expect(practiceXp(600)).toBe(60);
    expect(practiceXp(30, true)).toBe(40);
  });
  it("skill levels cost 30 × L and carry rank titles", () => {
    const s = skillSummary(cube, [log({ xp: 30 }), log({ xp: 60 })], NOW);
    expect(s.level).toBe(3);
    expect(s.rank).toBe("Apprentice");
    expect(skillRank(1)).toBe("Novice");
    expect(skillRank(30)).toBe("Grandmaster");
  });
});

describe("results", () => {
  it("reads times in several shapes", () => {
    expect(parseValue("1:23.45", "time")).toBe(83.45);
    expect(parseValue("83.4", "time")).toBe(83.4);
    expect(parseValue("1m 5s", "time")).toBe(65);
    expect(parseValue("1:02:03", "time")).toBe(3723);
    expect(parseValue("45,5", "time")).toBe(45.5);
    expect(parseValue("", "time")).toBeNull();
    expect(parseValue("fast", "time")).toBeNull();
    expect(parseValue("1.5:20", "time")).toBeNull();
    expect(parseValue("1 450", "higher")).toBe(1450);
  });
  it("formats times and numbers", () => {
    expect(fmtTime(83.45)).toBe("1:23.45");
    expect(fmtTime(45.2)).toBe("45.20s");
    expect(fmtTime(65)).toBe("1:05");
    expect(fmtTime(3723)).toBe("1:02:03");
    expect(fmtValue(1450, chess.metric)).toBe("1 450 elo");
    expect(fmtValue(null, chess.metric)).toBe("—");
  });
  it("lower wins for time, higher wins for rating; the first result is a baseline", () => {
    const logs = [log({ value: 90 }), log({ value: 75 })];
    expect(bestOf(logs, cube.metric)?.value).toBe(75);
    expect(isPb(70, logs, cube.metric)).toBe(true);
    expect(isPb(80, logs, cube.metric)).toBe(false);
    expect(isPb(70, [], cube.metric)).toBe(false);
    expect(isPb(1500, [log({ skill: "chess", value: 1400 })], chess.metric)).toBe(true);
    // Editing the best log itself doesn't count against it.
    expect(isPb(74, logs, cube.metric, logs[1].id)).toBe(true);
  });
  it("knows when the goal is met", () => {
    expect(goalMet(59, cube)).toBe(true);
    expect(goalMet(61, cube)).toBe(false);
    expect(goalMet(1500, { ...chess, goal: 1500 })).toBe(true);
  });
});

describe("tracker", () => {
  it("counts the practice streak from today or yesterday", () => {
    expect(practiceStreak([log({ date: "2026-10-13" }), log({ date: "2026-10-12" }), log({ date: "2026-10-10" })], NOW)).toBe(2);
    expect(practiceStreak([log({ date: "2026-10-12" }), log({ date: "2026-10-11" })], NOW)).toBe(2);
    expect(practiceStreak([log({ date: "2026-10-10" })], NOW)).toBe(0);
  });
  it("sums time, this week's time, best result and the next hours milestone", () => {
    const logs = [
      log({ date: "2026-10-05", mins: 40, value: 95 }),
      log({ date: "2026-10-12", mins: 30, value: 80 }),
      log({ date: "2026-10-13", mins: 20, value: 85 }),
      log({ skill: "chess", mins: 500 }),
    ];
    const s = skillSummary(cube, logs, NOW);
    expect(s.totalMins).toBe(90);
    expect(s.weekMins).toBe(50);
    expect(s.sessions).toBe(3);
    expect(s.best?.value).toBe(80);
    expect(s.series.map((x) => x.value)).toEqual([95, 80, 85]);
    expect(s.lastHours).toBe(1);
    expect(s.nextHours).toBe(5);
    expect(s.goalReached).toBe(false);
  });
});

describe("storage", () => {
  it("old logs load with no skills, and skills are cleaned on load", () => {
    const d = normalize({ quests: [] });
    expect(d.pursuits).toEqual([]);
    expect(d.practice).toEqual([]);
    expect(d.prefs.modules.skills).toBe(true);
    const p = normalize({ pursuits: [{ id: "a", name: "  Chess ", cat: "nope", metric: { name: "", kind: "time" }, goal: 5 }] }).pursuits[0];
    expect(p.name).toBe("Chess");
    expect(p.cat).toBe("mind");
    expect(p.metric).toBeNull();
    expect(p.goal).toBeNull();
  });
  it("skills and practice merge record by record across devices", () => {
    const a = { ...blankData(), pursuits: [{ ...cube, u: 1 }], practice: [log({ id: "p1", u: 1 })], savedAt: 1 };
    const b = { ...blankData(), pursuits: [{ ...chess, u: 2 }], practice: [log({ id: "p2", u: 2 })], savedAt: 2 };
    const m = mergeData(a, b);
    expect(m.pursuits.map((p) => p.id).sort()).toEqual(["chess", "cube"]);
    expect(m.practice.map((l) => l.id).sort()).toEqual(["p1", "p2"]);
  });
  it("unlocks the skill achievements", () => {
    const d = blankData();
    d.pursuits = [cube];
    d.practice = [log({ mins: 600 })];
    const got = checkAchievements(d, NOW);
    expect(got).toContain("dojo");
    expect(got).toContain("tenhours");
    expect(got).not.toContain("breakthrough");
  });
});

