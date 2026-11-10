import { describe, expect, it } from "vitest";
import { RHYTHM } from "./config.js";
import { blankData } from "./data.js";
import { completeDebriefStep, currentDebriefStep, debriefDate, debriefDone, debriefStepXp, doneOn, nextDate, officePlan, screensDownBy, skipDebriefStep } from "./debrief.js";
import { addsHabit, habitSlot, parkHabit, unparkHabit, useSlot } from "./habits.js";
import { completeQuestStep, locked, nextStepOf, seedMissions, toggleQuest, workable } from "./missions.js";
import { countMarks, debriefCount, firstTaps, morningMarks, patternFlag, recordCsv, trends } from "./review.js";
import { blankDay, briefing, completeStep, fullSteps, morningStatus, morningSteps } from "./rhythm.js";
import { awardTotal } from "./xp.js";
import type { DailyRecord, Quest, RhythmDay } from "./types.js";

const NOW = new Date(2026, 9, 13, 21, 30);
const key = (n: number) => {
  const d = new Date(2026, 9, 13 - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const q = (p: Partial<Quest>): Quest => ({ id: "q", title: "Q", cat: "side", kind: "quest", xp: 25, created: 0, ...p });
const ids = RHYTHM.debrief.steps.map((s) => s.id);

describe("evening debrief", () => {
  it("has one screen per step and pays 40 XP in total, plus a flat 5 for the record", () => {
    expect(ids).toEqual(["today", "feeling", "record", "where", "quests", "prep", "close"]);
    const main = RHYTHM.debrief.steps.filter((s) => s.id !== "record");
    expect(main.reduce((s, x) => s + debriefStepXp(x), 0)).toBe(40);
    const by = (cat: string) => main.reduce((s, x) => s + ((x.xp as Record<string, number>)[cat] || 0), 0);
    expect([by("discipline"), by("emotional")]).toEqual([20, 20]);
    expect(debriefStepXp(RHYTHM.debrief.steps.find((s) => s.id === "record")!)).toBe(5);
  });

  it("walks the steps in order and closes the day", () => {
    let day = blankDay("2026-10-13");
    let xp = 0;
    expect(completeDebriefStep(day, "close", 1)).toBeNull();
    for (const id of ids) {
      expect(currentDebriefStep(day)!.id).toBe(id);
      const r = completeDebriefStep(day, id, 5)!;
      xp += awardTotal(r.award);
      day = r.day;
    }
    expect(xp).toBe(45);
    expect(day.debrief!.xp).toBe(45);
    expect(debriefDone(day)).toBe(true);
    expect(currentDebriefStep(day)).toBeNull();
  });

  it("earns only the completed steps, with no penalty for the rest", () => {
    let day = completeDebriefStep(blankDay("2026-10-13"), "today", 1)!.day;
    day = skipDebriefStep(day, "feeling", 2);
    expect(currentDebriefStep(day)!.id).toBe("record");
    expect(day.debrief!.xp).toBe(5);
    expect(debriefDone(day)).toBe(false);
  });

  it("stores what a step captured", () => {
    const r = completeDebriefStep(skipDebriefStep(blankDay("2026-10-13"), "today", 1), "feeling", 2, { feeling: "Calm", cause: "A walk" })!;
    expect(r.day.debrief).toMatchObject({ feeling: "Calm", cause: "A walk" });
    expect(r.award).toMatchObject({ cat: "emotional", delta: 15 });
  });

  it("treats a debrief just after midnight as closing the day before", () => {
    expect(debriefDate(new Date(2026, 9, 13, 21, 30))).toBe("2026-10-13");
    expect(debriefDate(new Date(2026, 9, 14, 0, 40))).toBe("2026-10-13");
    expect(debriefDate(new Date(2026, 9, 14, 4, 0))).toBe("2026-10-14");
    expect(nextDate("2026-10-31")).toBe("2026-11-01");
  });

  it("computes Leave by, and an earlier wake time only when needed", () => {
    expect(officePlan("10:00", 30)).toEqual({ office: true, leaveBy: "09:30" });
    expect(officePlan("08:30", 45)).toEqual({ office: true, leaveBy: "07:45", wakeTime: "06:45" });
  });

  it("shows Screens down by as the wake time minus 8h 30m", () => {
    expect(screensDownBy()).toBe("23:30");
    expect(screensDownBy({ wakeTime: "06:45" })).toBe("22:15");
  });

  it("lists what was done today, never what wasn't", () => {
    const d = blankData();
    d.quests = [q({ id: "a", title: "Inbox", kind: "daily", doneOn: "2026-10-13" }), q({ id: "b", title: "Report", done: true, doneAt: new Date(2026, 9, 13, 15).getTime() }), q({ id: "c", title: "Not done" })];
    expect(doneOn(d, "2026-10-13")).toEqual(["Inbox", "Report"]);
  });
});

describe("office-day morning", () => {
  const office: RhythmDay = { ...blankDay("2026-10-13"), plan: { office: true, leaveBy: "07:45", wakeTime: "06:45" } };
  it("shortens the room reset and adds Leave by after the Briefing", () => {
    const steps = fullSteps(office);
    expect(steps.map((s) => s.id)).toEqual(["drink", "bed", "room", "food", "briefing", "leave"]);
    expect(steps.find((s) => s.id === "room")!.mins).toBe(5);
    expect(steps.at(-1)!.title).toBe("Leave by 07:45");
    expect(fullSteps(blankDay("2026-10-13")).find((s) => s.id === "room")!.mins).toBe(10);
  });
  it("needs all six for a full day and the combo", () => {
    let day = office;
    let at = new Date(2026, 9, 13, 6, 50).getTime();
    for (const s of fullSteps(office).slice(0, 5)) day = completeStep(day, s.id, (at += 60000))!.day;
    expect(morningStatus(day)).toBe("open");
    expect(day.morning.combo).toBeUndefined();
    const r = completeStep(day, "leave", (at += 60000))!;
    expect(morningStatus(r.day)).toBe("full");
    expect(r.day.morning.combo).toBe(true);
    expect(r.day.morning.anchor).toBe(true);
  });
  it("keeps the low day at Drink + Make bed", () => {
    expect(morningSteps({ ...office, morning: { steps: {}, xp: 0, low: true } }).map((s) => s.id)).toEqual(["drink", "bed"]);
  });
});

describe("build cap", () => {
  const day = 864e5;
  it("opens a slot every 14 days", () => {
    expect(habitSlot({ lastAddAt: 0, later: [] }, NOW).open).toBe(true);
    const h = useSlot({ lastAddAt: 0, later: [] }, NOW.getTime());
    expect(habitSlot(h, new Date(NOW.getTime() + 13 * day))).toEqual({ open: false, opensOn: "2026-10-27" });
    expect(habitSlot(h, new Date(NOW.getTime() + 14 * day)).open).toBe(true);
  });
  it("only counts a new recurring habit, never an edit", () => {
    expect(addsHabit({ kind: "daily" })).toBe(true);
    expect(addsHabit({ kind: "daily" }, { kind: "quest" })).toBe(true);
    expect(addsHabit({ kind: "daily" }, { kind: "daily" })).toBe(false);
    expect(addsHabit({ kind: "quest" })).toBe(false);
  });
  it("parks an idea in Later and takes it out again", () => {
    const h = parkHabit({ lastAddAt: 1, later: [] }, q({ id: "h1", kind: "daily" }), 5);
    expect(h.later.map((x) => x.id)).toEqual(["h1"]);
    expect(unparkHabit(h, "h1").later).toEqual([]);
  });
});

describe("weekly review", () => {
  const kept = (date: string, hour: number, low = false): RhythmDay => {
    const d = blankDay(date);
    d.morning.low = low;
    const t = new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8), hour, 10).getTime();
    for (const s of morningSteps(d)) d.morning.steps[s.id] = t;
    return d;
  };
  const days = [kept(key(5), 8), kept(key(4), 9, true), kept(key(2), 8)];
  it("counts full, low-day and missed mornings", () => {
    const marks = morningMarks(days, NOW);
    expect(marks).toEqual(["none", "full", "low", "missed", "full", "missed", "open"]);
    expect(countMarks(marks)).toEqual({ full: 2, low: 1, missed: 2 });
  });
  it("counts completed debriefs", () => {
    const d = blankDay(key(1));
    d.debrief = { steps: { close: 1 }, xp: 40 };
    expect(debriefCount([d, blankDay(key(2))], NOW)).toBe(1);
  });
  it("averages the first tap against the wake time", () => {
    const f = firstTaps(days, NOW);
    expect(f.taps).toEqual([null, "08:10", "09:10", null, "08:10", null, null]);
    expect(f.avg).toBe("08:30");
    expect(f.avgOffset).toBe(30);
    expect(f.wake).toBe("08:00");
  });

  const rec = (n: number, r: DailyRecord): RhythmDay => ({ ...blankDay(key(n)), record: r });
  const usual = Array.from({ length: 28 }, (_, i) => rec(i + 7, { sleepHours: 8, mood: 3, energy: 3, irritability: 2, focus: 3 }));
  it("gives seven-day values next to a four-week baseline", () => {
    const t = trends([...usual, rec(0, { sleepHours: 6, mood: 4 })], NOW);
    expect(t.map((x) => x.id)).toEqual(["sleepHours", "mood", "energy", "irritability", "focus"]);
    expect(t[0].baseline).toBe(8);
    expect(t[0].values).toEqual([null, null, null, null, null, null, 6]);
    expect(trends([rec(0, { mood: 3 })], NOW)[1].baseline).toBeNull();
  });
  it("notes short sleep with raised energy, or a run of low mood, and nothing else", () => {
    const week = (r: DailyRecord, n: number) => Array.from({ length: n }, (_, i) => rec(i, r));
    expect(patternFlag([...usual, ...week({ sleepHours: 8, mood: 3, energy: 3 }, 7)], NOW)).toBe(false);
    expect(patternFlag([...usual, ...week({ sleepHours: 5, mood: 3, energy: 5 }, 3)], NOW)).toBe(true);
    expect(patternFlag([...usual, ...week({ sleepHours: 5, mood: 3, energy: 3 }, 3)], NOW)).toBe(false);
    expect(patternFlag([...usual, ...week({ sleepHours: 5, mood: 3, energy: 5 }, 2)], NOW)).toBe(false);
    expect(patternFlag([...usual, ...week({ sleepHours: 8, mood: 2, energy: 3 }, 5)], NOW)).toBe(true);
    expect(patternFlag([...usual, ...week({ sleepHours: 8, mood: 2, energy: 3 }, 4)], NOW)).toBe(false);
    expect(patternFlag(week({ sleepHours: 4, mood: 5, energy: 5 }, 7), NOW)).toBe(false);
  });
  it("exports the record as CSV", () => {
    const d = { ...kept("2026-10-12", 8), record: { sleepHours: 7, sleepQuality: 4, mood: 3, energy: 3, irritability: 2, focus: 4, note: 'Said "fine", then slept' } };
    expect(recordCsv([d])).toBe(
      'date,sleep_hours,sleep_quality,mood,energy,irritability,focus,note,morning,first_tap,debrief\n2026-10-12,7,4,3,3,2,4,"Said ""fine"", then slept",full,08:10,\n',
    );
  });
});

describe("stepped, waiting and later quests", () => {
  const stepped = q({ id: "L1", steps: [{ title: "One" }, { title: "Send it", waitingOn: "Compliance" }, { title: "File the answer" }] });
  it("uses the first unfinished step as the next step", () => {
    expect(nextStepOf(stepped)).toBe("One");
    expect(nextStepOf(q({ nextStep: "Free text" }))).toBe("Free text");
  });
  it("moves to waiting on a hand-off step, and back when the next step is done", () => {
    const a = completeQuestStep(stepped)!.quest;
    expect(a.waitingOn).toBeUndefined();
    const b = completeQuestStep(a)!.quest;
    expect(b.waitingOn).toBe("Compliance");
    expect(nextStepOf(b)).toBe("File the answer");
    expect(workable(b, [b], NOW)).toBe(false);
    const c = completeQuestStep(b)!;
    expect(c.quest.waitingOn).toBeUndefined();
    expect(c.finished).toBe(true);
    expect(completeQuestStep(c.quest)).toBeNull();
  });
  it("keeps later quests off the board until they unlock", () => {
    const dep = q({ id: "L2" });
    const after = q({ id: "L3", unlockAfter: "L2" });
    const dated = q({ id: "L7", startFrom: "2027-01-11" });
    const both = q({ id: "L8", unlockAfter: "L2", startFrom: "2027-01-18" });
    expect(locked(after, [dep, after], NOW)).toBe(true);
    const done = toggleQuest(dep, [dep], NOW).quest;
    expect(locked(after, [done, after], NOW)).toBe(false);
    expect(locked(after, [after], NOW)).toBe(false);
    expect(locked(dated, [dated], NOW)).toBe(true);
    expect(locked(dated, [dated], new Date(2027, 0, 11))).toBe(false);
    expect(locked(both, [done, both], NOW)).toBe(true);
    expect(locked(both, [dep, both], new Date(2027, 1, 1))).toBe(true);
  });
  it("offers only workable quests in the briefing", () => {
    const all = [q({ id: "w", waitingOn: "HR" }), q({ id: "l", startFrom: "2030-01-01" }), q({ id: "ok" })];
    expect(briefing(blankDay("2026-10-13"), all, NOW).pick.map((x) => x.id)).toEqual(["ok"]);
  });
  it("loads steps and unlock rules from a seed file", () => {
    const out = seedMissions([], {}, [{ id: "s", title: "T", cat: "side", kind: "quest", xp: 60, unlockAfter: "x", startFrom: "2027-01-11", steps: [{ title: "A", estMinutes: 10, decision: true }, { title: "B", waitingOn: "Them" }, { nope: 1 }] }], new Set(["side"]));
    expect(out[0]).toMatchObject({ xp: 60, unlockAfter: "x", startFrom: "2027-01-11", steps: [{ title: "A", mins: 10, decision: true }, { title: "B", waitingOn: "Them" }] });
  });
});
