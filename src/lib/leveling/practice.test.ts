import { describe, expect, it } from "vitest";
import { checkAchievements } from "./achievements.js";
import { blankData, normalize } from "./data.js";
import { SKILL_PRESETS, bestAverage, ladderText, parseLadder, scramble333, standardStatus, wcaAverage, bestOf, fmtTime, fmtValue, goalMet, isPb, normalizePursuit, parseValue, practiceStreak, practiceXp, skillRank, skillSummary } from "./practice.js";
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


describe("competitive standards", () => {
  const cubeP = normalizePursuit({ id: "c", ...SKILL_PRESETS[0] }, 0);
  const chessP = normalizePursuit({ id: "h", ...SKILL_PRESETS[1] }, 0);
  const guitarP = normalizePursuit({ id: "g", ...SKILL_PRESETS[2] }, 0);

  it("every preset with a result has a standard, and presets keep it", () => {
    for (const p of SKILL_PRESETS) if (p.metric) expect(p.standard?.tiers.length).toBeGreaterThan(2);
    expect(cubeP.standard?.name).toBe("WCA 3x3x3");
    expect(cubeP.cube).toBe(true);
    expect(chessP.cube).toBe(false);
  });
  it("places a result on the ladder", () => {
    expect(standardStatus(cubeP, 45).current?.name).toBe("Sub-1:00");
    expect(standardStatus(cubeP, 45).next?.name).toBe("Sub-40");
    expect(standardStatus(cubeP, 150).current).toBeNull();
    expect(standardStatus(cubeP, null).next?.name).toBe("Sub-2:00");
    expect(standardStatus(chessP, 1650).current?.name).toBe("Strong club player");
    expect(standardStatus(chessP, 2600).next).toBeNull();
  });
  it("shows levels by grade name", () => {
    expect(fmtValue(3, guitarP.metric, guitarP.standard)).toBe("Grade 2");
    expect(isPb(4, [log({ value: 3 })], guitarP.metric)).toBe(true);
  });
  it("reads and writes custom ladders", () => {
    const t = parseLadder("Sub-1:00 = 1:00\nSub-2:00 = 2:00\nnonsense", "time");
    expect(t).toEqual([{ name: "Sub-2:00", value: 120 }, { name: "Sub-1:00", value: 60 }]);
    expect(ladderText({ name: "x", note: "", tiers: t }, "time")).toBe("Sub-2:00 = 2:00\nSub-1:00 = 1:00");
    expect(parseLadder("White belt\nYellow belt", "level")).toEqual([{ name: "White belt", value: 1 }, { name: "Yellow belt", value: 2 }]);
    expect(parseLadder("Club = 1200\nNew = 800", "higher").map((x) => x.value)).toEqual([800, 1200]);
  });
});

describe("cube timer maths", () => {
  it("WCA average of 5 drops best and worst; one DNF is the worst, two is a DNF", () => {
    expect(wcaAverage([10, 12, 11, 30, 9])).toBe(11);
    expect(wcaAverage([10, 12, 11, null, 9])).toBe(11);
    expect(wcaAverage([10, null, 11, null, 9])).toBeNull();
    expect(wcaAverage([10, 12])).toBeUndefined();
    expect(bestAverage([20, 20, 20, 20, 20, 10, 10, 10])).toBe(13.33);
  });
  it("scrambles never repeat a face or stack three moves on one axis", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 50; k++) {
      const m = scramble333(rand).split(" ");
      expect(m).toHaveLength(20);
      const axis = (f: string) => "UDRLFB".indexOf(f[0]) >> 1;
      for (let i = 1; i < m.length; i++) expect(m[i][0]).not.toBe(m[i - 1][0]);
      for (let i = 2; i < m.length; i++) expect(axis(m[i]) === axis(m[i - 1]) && axis(m[i]) === axis(m[i - 2])).toBe(false);
    }
  });
});
