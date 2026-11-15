import { describe, expect, it } from "vitest";
import { bestSoFar, chessAnalytics, cubeAnalytics, expectedScore, gameXp, normalizeGame, rollingAverage, solveHistory, weeklyMinutes } from "./analytics.js";
import type { ChessGame, PracticeLog } from "./types.js";

const NOW = new Date(2026, 10, 15, 12, 0, 0);
let n = 0;
const log = (p: Partial<PracticeLog>): PracticeLog => ({ id: "l" + n++, skill: "c", date: "2026-11-15", created: n, mins: 20, value: null, note: "", pb: false, xp: 10, ...p });
const game = (p: Partial<ChessGame>): ChessGame => normalizeGame({ id: "g" + n++, skill: "h", date: "2026-11-15", created: n, result: "win", ...p });

describe("cube analytics", () => {
  const logs = [
    log({ date: "2026-10-01", solves: [60, 58, 62, 55, 59, 61, 57, 56, 60, 58, 54, 63] }),
    log({ date: "2026-11-10", solves: [40, 42, null, 38, 41, 39] }),
    log({ date: "2026-11-15", value: 35 }),
    log({ date: "2026-11-15", solves: [37, 36, 39, 40, 38, 36] }),
  ];
  it("flattens sessions and manual results into one solve history", () => {
    const h = solveHistory(logs);
    expect(h).toHaveLength(25);
    expect(h[12]).toMatchObject({ t: 40, date: "2026-11-10" });
  });
  it("rolling averages and best-so-far", () => {
    expect(rollingAverage([10, 12, 11, 30, 9], 5)).toEqual([undefined, undefined, undefined, undefined, 11]);
    expect(rollingAverage([60, 66, 72, null], 3, true)).toEqual([undefined, undefined, 66, null]);
    expect(bestSoFar([20, null, 18, 19, 15])).toEqual([20, 20, 18, 18, 15]);
  });
  it("compares where you started with where you are", () => {
    const a = cubeAnalytics(logs, false, NOW);
    expect(a.total).toBe(25);
    expect(a.then.mean).toBeCloseTo(58.58, 1);
    expect(a.now.best).toBe(35);
    expect(a.improvement).toBeGreaterThan(0.3);
    expect(a.monthAgo?.solves).toBe(12);
    expect(a.last7.solves).toBe(13);
    expect(a.prev7.solves).toBe(0);
    expect(a.allTime.dnfRate).toBeCloseTo(1 / 25);
    expect(a.histogram.reduce((s, b) => s + b.n, 0)).toBe(24);
    expect(a.sessions[0].solves).toBe(6);
  });
  it("weekly minutes for the last weeks", () => {
    const w = weeklyMinutes(logs, 4, NOW);
    expect(w).toHaveLength(4);
    expect(w[3].mins).toBe(60);
    expect(w[2].mins).toBe(0);
  });
});

describe("chess analytics", () => {
  it("Elo expectation", () => {
    expect(expectedScore(1500, 1500)).toBe(0.5);
    expect(expectedScore(1500, 1900)).toBeCloseTo(0.09, 2);
  });
  it("pays XP for logging and more for a review, whatever the result", () => {
    expect(gameXp({ keyMoment: "", lesson: "" })).toBe(8);
    expect(gameXp({ keyMoment: "", lesson: "Don't grab pawns" })).toBe(20);
  });
  it("records, performance rating, rating trend and lessons", () => {
    const gs = [
      game({ date: "2026-10-01", result: "loss", colour: "white", oppRating: 1400, myRating: 1180, control: "rapid", opening: "Italian" }),
      game({ date: "2026-11-01", result: "win", colour: "black", oppRating: 1300, myRating: 1210, control: "rapid", opening: "Sicilian", accuracy: 82, blunders: 1, mistakes: 2, inaccuracies: 3, lesson: "Castle early" }),
      game({ date: "2026-11-14", result: "draw", colour: "white", oppRating: 1250, control: "blitz", opening: "Italian", accuracy: 74 }),
      game({ date: "2026-11-15", result: "win", colour: "white", oppRating: 1350, myRating: 1240, control: "rapid", opening: "Italian" }),
    ];
    const a = chessAnalytics(gs, [{ date: "2026-09-01", value: 1200 }], NOW);
    expect(a.all).toMatchObject({ games: 4, win: 2, draw: 1, loss: 1, score: 0.625 });
    expect(a.white.games).toBe(3);
    expect(a.byControl.find((c) => c.id === "rapid")?.rec.games).toBe(3);
    expect(a.performance).toBe(1425);
    expect(a.vsExpected?.games).toBe(4);
    expect(a.current).toBe(1240);
    expect(a.peak).toBe(1240);
    expect(a.change30).toBe(60);
    expect(a.avgAccuracy).toBe(78);
    expect(a.errors).toMatchObject({ games: 1, blunders: 1 });
    expect(a.openings[0]).toMatchObject({ name: "Italian" });
    expect(a.lessons[0].text).toBe("Castle early");
    expect(a.unbeaten).toBe(3);
  });
  it("cleans games", () => {
    const g = normalizeGame({ id: "x", skill: "h", result: "nonsense" as never, accuracy: 140, control: "zzz" as never });
    expect(g.result).toBe("loss");
    expect(g.accuracy).toBe(100);
    expect(g.control).toBe("rapid");
  });
});
