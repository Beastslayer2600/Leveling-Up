import { describe, expect, it } from "vitest";
import { RHYTHM, hmToMins, minsToHm } from "./config.js";
import { blankData, normalize } from "./data.js";
import { dkey } from "./dates.js";
import { blankDay, briefing, clearLowDay, completeStep, currentStep, fmtCountdown, morningStatus, morningSteps, morningStreak, pickMainQuest, setLowDay, startTimer, timerEndsAt } from "./rhythm.js";
import { mergeData } from "./sync.js";
import { applyAward, awardTotal, blankStats } from "./xp.js";
import type { Quest, RhythmDay } from "./types.js";

const DATE = "2026-10-13";
/** A time on 13 Oct 2026, local. */
const t = (h: number, m = 0) => new Date(2026, 9, 13, h, m, 0).getTime();
const ids = RHYTHM.morning.steps.map((s) => s.id);

/** Run the given steps, `gap` minutes apart, starting at `start`. */
function run(day: RhythmDay, steps: string[], start: number, gap = 3) {
  const awards = [];
  let finished = false;
  let at = start;
  for (const id of steps) {
    const r = completeStep(day, id, at)!;
    day = r.day;
    awards.push(...r.awards);
    finished = r.finished;
    at += gap * 60000;
  }
  return { day, awards, finished };
}
const total = (awards: { delta: number; also?: { delta: number }[] }[]) => awards.reduce((s, a) => s + awardTotal(a as never), 0);
const keptDay = (date: string, low = false): RhythmDay => {
  const d = blankDay(date);
  d.morning.low = low;
  for (const s of morningSteps(d)) d.morning.steps[s.id] = 1;
  return d;
};

describe("config", () => {
  it("holds the brief's starting values", () => {
    expect(RHYTHM.wakeTime).toBe("08:00");
    expect(RHYTHM.debriefTime).toBe("21:30");
    expect(RHYTHM.habitAddCooldownDays).toBe(14);
    expect(ids).toEqual(["drink", "bed", "room", "food", "briefing"]);
    expect(RHYTHM.morning.steps.map((s) => s.mins)).toEqual([1, 2, 10, 10, 2]);
  });
  it("converts clock times", () => {
    expect(hmToMins("08:00")).toBe(480);
    expect(minsToHm(hmToMins(RHYTHM.wakeTime) - RHYTHM.screensDownBeforeWakeMins)).toBe("23:30");
  });
});

describe("morning sequence", () => {
  it("shows one step at a time, in fixed order", () => {
    let day = blankDay(DATE);
    expect(currentStep(day)!.id).toBe("drink");
    expect(completeStep(day, "bed", t(8))).toBeNull();
    day = completeStep(day, "drink", t(8))!.day;
    expect(currentStep(day)!.id).toBe("bed");
    expect(completeStep(day, "drink", t(8, 1))).toBeNull();
  });

  it("pays 10 XP a step: 8 Vitality + 2 Discipline, and 10 Discipline for the Briefing", () => {
    const first = completeStep(blankDay(DATE), "drink", t(12))!;
    expect(first.awards).toHaveLength(1);
    expect(first.awards[0]).toMatchObject({ delta: 8, cat: "vitality", also: [{ cat: "discipline", delta: 2 }] });
    const all = run(blankDay(DATE), ids, t(12), 20);
    expect(all.awards[4]).toMatchObject({ delta: 10, cat: "discipline", also: [] });
    expect(total(all.awards)).toBe(50);
    expect(all.day.morning.xp).toBe(50);
  });

  it("adds the wake-anchor bonus when step 1 lands within 20 minutes of the wake time", () => {
    expect(completeStep(blankDay(DATE), "drink", t(8, 20))!.awards[1]).toMatchObject({ delta: 15, cat: "discipline" });
    expect(completeStep(blankDay(DATE), "drink", t(7, 30))!.awards).toHaveLength(2);
    expect(completeStep(blankDay(DATE), "drink", t(8, 21))!.awards).toHaveLength(1);
    expect(completeStep(blankDay(DATE), "drink", t(0, 30))!.awards).toHaveLength(1);
  });

  it("uses the debrief's one-day wake time for the anchor", () => {
    const day = { ...blankDay(DATE), plan: { wakeTime: "06:30" } };
    expect(completeStep(day, "drink", t(6, 45))!.day.morning.anchor).toBe(true);
    expect(completeStep(day, "drink", t(7, 30))!.day.morning.anchor).toBeUndefined();
  });

  it("adds the combo bonus when all five are done within 45 minutes of the first tap", () => {
    const fast = run(blankDay(DATE), ids, t(12), 11);
    expect(fast.day.morning.combo).toBe(true);
    expect(fast.awards.at(-1)).toMatchObject({ delta: 25, cat: "discipline" });
    expect(fast.finished).toBe(true);
    expect(fast.day.morning.doneAt).toBe(t(12, 44));
    const slow = run(blankDay(DATE), ids, t(12), 12);
    expect(slow.day.morning.combo).toBeUndefined();
    expect(total(slow.awards)).toBe(50);
  });

  it("a perfect morning earns 50 + 15 + 25", () => {
    const r = run(blankDay(DATE), ids, t(8, 5));
    expect(total(r.awards)).toBe(90);
    expect(morningStatus(r.day)).toBe("full");
  });

  it("never produces a negative award", () => {
    const r = run(blankDay(DATE), ids, t(15), 30);
    expect(r.awards.every((a) => a.delta > 0 && (a.also || []).every((x) => x.delta > 0))).toBe(true);
  });
});

describe("low-day mode", () => {
  it("reduces the quest to Drink + Make bed at normal XP", () => {
    const day = setLowDay(blankDay(DATE), t(9));
    expect(morningSteps(day).map((s) => s.id)).toEqual(["drink", "bed"]);
    const r = run(day, ["drink", "bed"], t(9));
    expect(r.finished).toBe(true);
    expect(total(r.awards)).toBe(20);
    expect(morningStatus(r.day)).toBe("low");
    expect(r.day.morning.low).toBe(true);
  });
  it("finishes on the spot when those two are already done", () => {
    const part = run(blankDay(DATE), ["drink", "bed"], t(9)).day;
    expect(morningStatus(part)).toBe("open");
    const low = setLowDay(part, t(9, 30));
    expect(morningStatus(low)).toBe("low");
    expect(low.morning.doneAt).toBe(t(9, 30));
  });
  it("can go back to the full sequence, which then counts as full", () => {
    const low = run(setLowDay(blankDay(DATE), t(9)), ["drink", "bed"], t(9)).day;
    const back = clearLowDay(low);
    expect(currentStep(back)!.id).toBe("room");
    expect(back.morning.doneAt).toBeNull();
    expect(morningStatus(run(back, ["room", "food", "briefing"], t(10)).day)).toBe("full");
  });
});

describe("room-reset timer", () => {
  it("counts down from the step's minutes and survives a reload", () => {
    let day = run(blankDay(DATE), ["drink", "bed"], t(8)).day;
    expect(timerEndsAt(day)).toBeNull();
    day = startTimer(day, t(8, 10));
    expect(timerEndsAt(day)).toBe(t(8, 20));
    expect(startTimer(day, t(8, 15)).morning.timerAt).toBe(t(8, 10));
    const done = completeStep(day, "room", timerEndsAt(day)!)!.day;
    expect(done.morning.steps.room).toBe(t(8, 20));
    expect(done.morning.timerAt).toBeNull();
  });
  it("only starts on a timer step", () => {
    expect(startTimer(blankDay(DATE), t(8)).morning.timerAt).toBeUndefined();
  });
  it("formats the countdown", () => {
    expect(fmtCountdown(600000)).toBe("10:00");
    expect(fmtCountdown(59001)).toBe("1:00");
    expect(fmtCountdown(-5)).toBe("0:00");
  });
});

describe("morning streak", () => {
  const now = new Date(2026, 9, 13, 10);
  const d = (n: number) => dkey(new Date(2026, 9, 13 - n));
  it("counts kept days, including today once it's kept", () => {
    expect(morningStreak([], now)).toEqual({ count: 0, paused: false, keptToday: false });
    expect(morningStreak([keptDay(d(2)), keptDay(d(1))], now)).toEqual({ count: 2, paused: false, keptToday: false });
    expect(morningStreak([keptDay(d(2)), keptDay(d(1)), keptDay(d(0))], now)).toEqual({ count: 3, paused: false, keptToday: true });
  });
  it("counts low-day completions as kept", () => {
    expect(morningStreak([keptDay(d(2)), keptDay(d(1), true), keptDay(d(0))], now).count).toBe(3);
  });
  it("freezes after one missed day", () => {
    expect(morningStreak([keptDay(d(3)), keptDay(d(2))], now)).toEqual({ count: 2, paused: true, keptToday: false });
  });
  it("carries on after a single miss", () => {
    expect(morningStreak([keptDay(d(3)), keptDay(d(2)), keptDay(d(0))], now)).toEqual({ count: 3, paused: false, keptToday: true });
  });
  it("resets after two missed days in a row", () => {
    expect(morningStreak([keptDay(d(4)), keptDay(d(3))], now).count).toBe(0);
    expect(morningStreak([keptDay(d(4)), keptDay(d(3)), keptDay(d(0))], now)).toEqual({ count: 1, paused: false, keptToday: true });
  });
  it("ignores days that were started but not kept", () => {
    const part = blankDay(d(1));
    part.morning.steps.drink = 1;
    expect(morningStreak([keptDay(d(2)), part], now)).toEqual({ count: 1, paused: true, keptToday: false });
  });
});

describe("briefing", () => {
  const q = (p: Partial<Quest>): Quest => ({ id: "q", title: "Q", cat: "side", kind: "quest", xp: 25, created: 0, ...p });
  const quests = [q({ id: "a", created: 1 }), q({ id: "b", main: true, nextStep: "Do the thing", created: 2 }), q({ id: "c", done: true }), q({ id: "d", kind: "daily" })];
  const now = new Date(2026, 9, 13, 8);
  it("falls back to a pick list, Home by default, when the debrief was skipped", () => {
    const b = briefing(blankDay(DATE), quests, now);
    expect(b.office).toBe(false);
    expect(b.main).toBeNull();
    expect(b.pick.map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("shows the planned main quest and must-dos", () => {
    const day = { ...blankDay(DATE), plan: { office: true, mainQuestId: "b", mustDoIds: ["a", "c", "zz"] } };
    const b = briefing(day, quests, now);
    expect(b.main!.id).toBe("b");
    expect(b.mustDos.map((x) => x.id)).toEqual(["a"]);
    expect(b.office).toBe(true);
    expect(b.pick).toEqual([]);
  });
  it("records the morning pick", () => {
    expect(briefing(pickMainQuest(blankDay(DATE), "a"), quests, now).main!.id).toBe("a");
  });
});

describe("XP engine and data layer", () => {
  it("pays secondary shares to their own categories under one log entry", () => {
    const r = applyAward(blankStats(), { delta: 8, title: "Drink", cat: "vitality", also: [{ cat: "discipline", delta: 2 }] }, new Date(2026, 9, 13, 10));
    expect(r.stats.xp).toBe(10);
    expect(r.stats.cat).toEqual({ vitality: 8, discipline: 2 });
    expect(r.stats.dayXp).toBe(10);
    expect(r.stats.log).toHaveLength(1);
    expect(r.stats.log[0].xp).toBe(10);
    expect(r.stats.dayCats.sort()).toEqual(["discipline", "vitality"]);
  });
  it("loads older saves without a rhythm log, and merges days across devices", () => {
    const old = { ...blankData(), savedAt: 5 } as Record<string, unknown>;
    delete old.rhythm;
    expect(normalize(old).rhythm).toEqual([]);
    const a = { ...blankData(), savedAt: 1, rhythm: [{ ...keptDay("2026-10-12"), u: 1 }] };
    const b = { ...blankData(), savedAt: 2, rhythm: [{ ...keptDay("2026-10-13"), u: 2 }] };
    expect(mergeData(a, b).rhythm.map((x) => x.date).sort()).toEqual(["2026-10-12", "2026-10-13"]);
  });
});
