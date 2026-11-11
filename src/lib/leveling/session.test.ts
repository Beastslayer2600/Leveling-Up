import { describe, expect, it } from "vitest";
import { SESSION } from "./config";
import { blankData, normalize } from "./data";
import {
  cleanLabel, computeBreak, dailyTotals, dueAlerts, elapsedMs, endRun, finishSlot, fmtClock, fmtDur, leaveBreak, markAlerted,
  normalizeFocusPrefs, normalizeRun, pastSessions, pause, phaseOf, resume, roundTo, setLabel, slotXp, startRun, summarize, weeklyTotals,
} from "./session";
import { mergeData } from "./sync";
import type { FocusRun, FocusSlot } from "./types";

const MIN = 60_000;
const T0 = new Date(2026, 10, 10, 9, 0, 0).getTime(); // Tue 10 Nov 2026, 09:00
const at = (mins: number) => T0 + mins * MIN;
const fresh = (earlyBreak: "shorten" | "minimum" = "shorten") => startRun("r1", ["Admin", "Content", "Outreach"], { workMin: 20, earlyBreak }, T0);

/** Drive a session through a list of "work for N min then leave the break after M min" steps. */
function play(run: FocusRun, plan: { work: number; breakMin?: number }[]) {
  const slots: FocusSlot[] = [];
  let now = T0;
  let r = run;
  const xp: number[] = [];
  plan.forEach((p, i) => {
    now += p.work * MIN;
    const f = finishSlot(r, now, slots, `s${i}`)!;
    slots.push(f.slot!);
    xp.push(f.xp + f.bonus);
    r = f.run;
    if (r.stage === "break") {
      now += (p.breakMin ?? r.breakMs / MIN) * MIN;
      const l = leaveBreak(r, now)!;
      if (l.breakFor) Object.assign(slots.find((s) => s.id === l.breakFor!.id)!, { breakTakenMs: l.breakFor.takenMs, breakSkipped: l.breakFor.skipped });
      r = l.run;
    }
  });
  return { run: r, slots, xp, now };
}

describe("break rule", () => {
  it("is half the actual work: 20 min -> 10 min, 30 min -> 15 min", () => {
    expect(computeBreak(20 * MIN, 20 * MIN, "shorten")).toBe(10 * MIN);
    expect(computeBreak(30 * MIN, 20 * MIN, "shorten")).toBe(15 * MIN);
    expect(computeBreak(30 * MIN, 20 * MIN, "minimum")).toBe(15 * MIN);
  });
  it("rounds to the nearest 30 seconds", () => {
    expect(roundTo(14_000)).toBe(0);
    expect(roundTo(16_000)).toBe(30_000);
    expect(computeBreak(25 * MIN + 10_000, 20 * MIN, "shorten")).toBe(12 * MIN + 30_000); // 12:35 -> 12:30
    expect(computeBreak(21 * MIN + 20_000, 20 * MIN, "shorten")).toBe(10 * MIN + 30_000); // 10:40 -> 10:30
    expect(computeBreak(21 * MIN + 40_000, 20 * MIN, "shorten")).toBe(11 * MIN); // 10:50 -> 11:00
  });
  it("shortens the break in proportion on an early finish", () => {
    expect(computeBreak(12 * MIN, 20 * MIN, "shorten")).toBe(6 * MIN);
    expect(computeBreak(5 * MIN, 20 * MIN, "shorten")).toBe(2 * MIN + 30_000);
    expect(computeBreak(10_000, 20 * MIN, "shorten")).toBe(0);
  });
  it("keeps the planned break as a minimum when the setting says so", () => {
    expect(computeBreak(12 * MIN, 20 * MIN, "minimum")).toBe(10 * MIN);
    expect(computeBreak(1 * MIN, 20 * MIN, "minimum")).toBe(10 * MIN);
  });
  it("scales with a different planned length", () => {
    expect(computeBreak(30 * MIN, 30 * MIN, "shorten")).toBe(15 * MIN);
    expect(computeBreak(25 * MIN, 30 * MIN, "minimum")).toBe(15 * MIN);
  });
});

describe("clock from timestamps", () => {
  it("counts down, then up into overtime", () => {
    const r = fresh();
    expect(phaseOf(r, at(0))).toMatchObject({ phase: "work", label: "Work", remainingMs: 20 * MIN, overMs: 0 });
    expect(phaseOf(r, at(7))).toMatchObject({ phase: "work", remainingMs: 13 * MIN });
    expect(phaseOf(r, at(20))).toMatchObject({ phase: "overtime", label: "Overtime", remainingMs: 0, overMs: 0 });
    expect(phaseOf(r, at(23) + 15_000)).toMatchObject({ phase: "overtime", overMs: 3 * MIN + 15_000 });
  });
  it("stays right when nothing ticked for a long time (background or locked screen)", () => {
    const r = fresh();
    // No tick between minute 1 and minute 47: the next read still gets the exact answer.
    expect(elapsedMs(r, at(47))).toBe(47 * MIN);
    expect(phaseOf(r, at(47)).overMs).toBe(27 * MIN);
  });
  it("freezes while paused and resumes without losing or gaining time", () => {
    let r = pause(fresh(), at(5));
    expect(elapsedMs(r, at(5))).toBe(5 * MIN);
    expect(elapsedMs(r, at(65))).toBe(5 * MIN);
    expect(phaseOf(r, at(65))).toMatchObject({ paused: true, phase: "work" });
    r = resume(r, at(65));
    expect(r.pausedAt).toBeUndefined();
    expect(elapsedMs(r, at(65))).toBe(5 * MIN);
    expect(elapsedMs(r, at(80))).toBe(20 * MIN);
    expect(phaseOf(r, at(81)).phase).toBe("overtime");
  });
  it("handles several pauses", () => {
    let r = fresh();
    r = pause(r, at(2));
    r = resume(r, at(10));
    r = pause(r, at(12));
    r = resume(r, at(20));
    expect(r.pausedMs).toBe(16 * MIN);
    expect(elapsedMs(r, at(30))).toBe(14 * MIN);
  });
  it("ignores pause and resume when they don't apply", () => {
    const r = fresh();
    expect(resume(r, at(1))).toBe(r);
    expect(pause(pause(r, at(1)), at(2)).pausedAt).toBe(at(1));
  });
  it("never reads negative if the clock steps back", () => {
    expect(elapsedMs(fresh(), T0 - 5000)).toBe(0);
    expect(resume(pause(fresh(), at(5)), at(4)).pausedMs).toBe(0);
  });
  it("formats clocks and durations", () => {
    expect(fmtClock(20 * MIN)).toBe("20:00");
    expect(fmtClock(61_000)).toBe("1:01");
    expect(fmtClock(3_725_000)).toBe("1:02:05");
    expect(fmtClock(1_001, "ceil")).toBe("0:02");
    expect(fmtDur(45_000)).toBe("45s");
    expect(fmtDur(42 * MIN)).toBe("42 min");
    expect(fmtDur(80 * MIN)).toBe("1h 20m");
    expect(fmtDur(120 * MIN)).toBe("2h");
  });
});

describe("a slot and its break", () => {
  it("finishing on time saves the slot and starts a 10 minute break", () => {
    const f = finishSlot(fresh(), at(20), [], "s0")!;
    expect(f.slot).toMatchObject({ idx: 0, label: "Admin", plannedMs: 20 * MIN, actualMs: 20 * MIN, overtimeMs: 0, breakPlannedMs: 10 * MIN, xp: 20, date: "2026-11-10" });
    expect(f.run).toMatchObject({ stage: "break", slot: 0, breakMs: 10 * MIN, stageStart: at(20), slotIds: ["s0", null, null] });
    expect(phaseOf(f.run, at(25))).toMatchObject({ phase: "break", label: "Break", remainingMs: 5 * MIN });
    expect(phaseOf(f.run, at(30))).toMatchObject({ phase: "breakover", label: "Break over" });
  });
  it("overtime extends the break, and the next slot still plans 20 minutes", () => {
    const f = finishSlot(fresh(), at(30), [], "s0")!;
    expect(f.slot).toMatchObject({ actualMs: 30 * MIN, overtimeMs: 10 * MIN, breakPlannedMs: 15 * MIN, xp: 20 });
    expect(f.run.breakMs).toBe(15 * MIN);
    const l = leaveBreak(f.run, at(45))!;
    expect(l.run).toMatchObject({ stage: "work", slot: 1, stageStart: at(45) });
    expect(phaseOf(l.run, at(45))).toMatchObject({ phase: "work", remainingMs: 20 * MIN });
  });
  it("an early finish shortens the break, or keeps the minimum, by setting", () => {
    expect(finishSlot(fresh("shorten"), at(12), [], "s0")!.run.breakMs).toBe(6 * MIN);
    expect(finishSlot(fresh("minimum"), at(12), [], "s0")!.run.breakMs).toBe(10 * MIN);
  });
  it("pays in proportion for early work and nothing extra for overtime", () => {
    expect(slotXp(10 * MIN, 20 * MIN)).toBe(10);
    expect(slotXp(20 * MIN, 20 * MIN)).toBe(20);
    expect(slotXp(45 * MIN, 20 * MIN)).toBe(20);
  });
  it("measures work after pauses, using only running time", () => {
    const paused = resume(pause(fresh(), at(5)), at(35));
    const f = finishSlot(paused, at(50), [], "s0")!;
    expect(f.slot!.actualMs).toBe(20 * MIN);
    expect(f.slot!.startedAt).toBe(T0);
    expect(f.slot!.endedAt).toBe(at(50));
  });
  it("skipping a break records how much was taken", () => {
    const f = finishSlot(fresh(), at(20), [], "s0")!;
    const l = leaveBreak(f.run, at(24))!;
    expect(l.breakFor).toEqual({ id: "s0", takenMs: 4 * MIN, skipped: true });
    expect(l.run).toMatchObject({ stage: "work", slot: 1 });
  });
  it("taking the whole break records it in full, even if you come back late", () => {
    const f = finishSlot(fresh(), at(20), [], "s0")!;
    expect(leaveBreak(f.run, at(55))!.breakFor).toEqual({ id: "s0", takenMs: 10 * MIN, skipped: false });
  });
  it("a break that rounds to zero is skipped outright", () => {
    const f = finishSlot(fresh(), T0 + 10_000, [], "s0")!;
    expect(f.run).toMatchObject({ stage: "work", slot: 1 });
    expect(f.slot!.breakPlannedMs).toBe(0);
  });
  it("rejects controls in the wrong stage", () => {
    const r = fresh();
    expect(leaveBreak(r, at(1))).toBeNull();
    const f = finishSlot(r, at(20), [], "s0")!;
    expect(finishSlot(f.run, at(21), [], "x")).toBeNull();
  });
  it("lets a label change mid-session and saves the new one", () => {
    const r = setLabel(fresh(), 0, "  Deep   work  ");
    expect(r.labels[0]).toBe("Deep work");
    expect(finishSlot(r, at(20), [], "s0")!.slot!.label).toBe("Deep work");
    expect(setLabel(fresh(), 1, "   ").labels[1]).toBe("Content");
    expect(cleanLabel("x".repeat(50), "d")).toHaveLength(SESSION.maxLabel);
  });
});

describe("a whole session", () => {
  it("three full slots: 90 minutes, XP per slot plus the bonus", () => {
    const { run, slots, xp, now } = play(fresh(), [{ work: 20 }, { work: 20 }, { work: 20 }]);
    expect(now - T0).toBe(90 * MIN);
    expect(run.stage).toBe("summary");
    expect(xp).toEqual([20, 20, 20 + SESSION.bonusXp]);
    expect(run.bonusXp).toBe(SESSION.bonusXp);
    expect(slots.map((s) => s.breakTakenMs)).toEqual([10 * MIN, 10 * MIN, 10 * MIN]);
  });
  it("gives no bonus if a slot is under half its planned time", () => {
    const { run, xp } = play(fresh(), [{ work: 20 }, { work: 9 }, { work: 20 }]);
    expect(run.bonusXp).toBe(0);
    expect(xp[2]).toBe(20);
  });
  it("overtime is tracked per slot and in the summary", () => {
    const { slots, run } = play(fresh(), [{ work: 25 }, { work: 20 }, { work: 32 }]);
    const sum = summarize(slots, run.bonusXp);
    expect(sum.overtimeMs).toBe(17 * MIN);
    expect(sum.focusedMs).toBe(77 * MIN);
    expect(sum.plannedMs).toBe(60 * MIN);
  });
  it("totals per task, merging labels that differ only by case", () => {
    const base = fresh();
    const r = setLabel(setLabel(base, 1, "admin"), 2, "Content");
    const { slots } = play(r, [{ work: 20 }, { work: 15 }, { work: 20 }]);
    const sum = summarize(slots);
    expect(sum.byTask).toEqual([
      { label: "Admin", focusedMs: 35 * MIN, slots: 2, overtimeMs: 0 },
      { label: "Content", focusedMs: 20 * MIN, slots: 1, overtimeMs: 0 },
    ]);
    expect(sum.xp).toBe(20 + 15 + 20);
  });
  it("saves each slot with its label, planned and actual time, and break", () => {
    const { slots } = play(fresh(), [{ work: 22, breakMin: 3 }, { work: 20 }]);
    expect(slots[0]).toMatchObject({ label: "Admin", plannedMs: 20 * MIN, actualMs: 22 * MIN, overtimeMs: 2 * MIN, breakPlannedMs: 11 * MIN, breakTakenMs: 3 * MIN, breakSkipped: true });
    expect(slots[1]).toMatchObject({ label: "Content", breakPlannedMs: 10 * MIN, breakTakenMs: 10 * MIN, breakSkipped: false });
  });
});

describe("ending a session", () => {
  it("saves the slot in progress as finished, with no break", () => {
    const e = endRun(fresh(), at(14), [], "s0")!;
    expect(e.slot).toMatchObject({ actualMs: 14 * MIN, breakTakenMs: 0, breakSkipped: true });
    expect(e.run.stage).toBe("summary");
    expect(e.breakFor).toBeUndefined();
    expect(e.xp).toBe(14);
    expect(e.bonus).toBe(0);
  });
  it("discards a slot that was only just started", () => {
    const e = endRun(fresh(), T0 + 5000, [], "s0")!;
    expect(e.slot).toBeUndefined();
    expect(e.run.stage).toBe("summary");
  });
  it("during a break, records the break taken so far", () => {
    const f = finishSlot(fresh(), at(20), [], "s0")!;
    const e = endRun(f.run, at(23), [f.slot!], "x")!;
    expect(e.slot).toBeUndefined();
    expect(e.breakFor).toEqual({ id: "s0", takenMs: 3 * MIN, skipped: true });
    expect(e.run.stage).toBe("summary");
  });
  it("ending on the last slot after real work still earns the bonus", () => {
    const { run, slots, now } = play(fresh(), [{ work: 20 }, { work: 20 }]);
    expect(run).toMatchObject({ stage: "work", slot: 2 });
    const e = endRun(run, now + 18 * MIN, slots, "s2")!;
    expect(e.slot).toMatchObject({ idx: 2, actualMs: 18 * MIN });
    expect(e.bonus).toBe(SESSION.bonusXp);
  });
  it("does nothing on a finished session", () => {
    const { run } = play(fresh(), [{ work: 20 }, { work: 20 }, { work: 20 }]);
    expect(endRun(run, T0, [], "x")).toBeNull();
  });
});

describe("alerts", () => {
  it("fires once when the work block ends and once when the break ends", () => {
    let r = fresh();
    expect(dueAlerts(r, at(19))).toEqual([]);
    const due = dueAlerts(r, at(20) + 1000);
    expect(due).toEqual([{ key: "w0", kind: "work", at: at(20) }]);
    r = markAlerted(r, "w0");
    expect(dueAlerts(r, at(25))).toEqual([]);
    const f = finishSlot(r, at(25), [], "s0")!; // 25 min of work earns a 12:30 break
    expect(dueAlerts(f.run, at(37))).toEqual([]);
    expect(dueAlerts(f.run, at(38))).toEqual([{ key: "b0", kind: "break", at: at(25) + 12.5 * MIN }]);
  });
  it("dates the boundary correctly after pauses, even when found late", () => {
    const r = resume(pause(fresh(), at(5)), at(15)); // 10 min paused
    expect(dueAlerts(r, at(40))).toEqual([{ key: "w0", kind: "work", at: at(30) }]);
  });
  it("doesn't fire while paused before the boundary", () => {
    expect(dueAlerts(pause(fresh(), at(10)), at(90))).toEqual([]);
  });
});

describe("saved data", () => {
  it("rebuilds a stored run and drops a broken one", () => {
    const r = pause(fresh(), at(3));
    expect(normalizeRun(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(normalizeRun({ id: "x", stage: "work" })).toBeNull();
    expect(normalizeRun({ ...r, slot: 9 })).toBeNull();
    expect(normalizeRun({ ...r, stage: "nope" })).toBeNull();
    expect(normalizeRun(null)).toBeNull();
  });
  it("cleans settings and fills defaults", () => {
    expect(normalizeFocusPrefs(undefined)).toEqual({ workMin: 20, earlyBreak: "shorten", labels: ["Admin", "Content", "Outreach"] });
    expect(normalizeFocusPrefs({ workMin: 500, earlyBreak: "minimum", labels: [" Deep ", 4] })).toEqual({ workMin: 60, earlyBreak: "minimum", labels: ["Deep", "Content", "Outreach"] });
    expect(normalizeFocusPrefs({ workMin: 1 }).workMin).toBe(5);
  });
  it("older saves load with empty focus data", () => {
    const d = normalize({ savedAt: 5, quests: [] });
    expect(d.focusSlots).toEqual([]);
    expect(d.focusRun).toBeNull();
    expect(d.focusPrefs.workMin).toBe(20);
  });
  it("slots sync between devices by id, and a session in progress follows the newer copy", () => {
    const a = blankData();
    const b = blankData();
    const { slots } = play(fresh(), [{ work: 20 }, { work: 20 }]);
    a.focusSlots = [{ ...slots[0], u: 1 }];
    b.focusSlots = [{ ...slots[0], u: 1 }, { ...slots[1], u: 2 }];
    a.savedAt = 10;
    b.savedAt = 20;
    b.focusRun = fresh();
    const m = mergeData(a, b);
    expect(m.focusSlots.map((s) => s.id).sort()).toEqual(["s0", "s1"]);
    expect(m.focusRun?.id).toBe("r1");
  });
});

describe("history", () => {
  const slot = (id: string, run: string, date: string, mins: number, over = 0): FocusSlot => ({
    id, run, idx: 0, date, label: "Admin", plannedMs: 20 * MIN, actualMs: mins * MIN, overtimeMs: over * MIN,
    breakPlannedMs: 0, breakTakenMs: 0, breakSkipped: false, startedAt: new Date(`${date}T09:00:00`).getTime(), endedAt: 0, xp: 0,
  });
  const NOW = new Date(2026, 10, 10, 12, 0, 0); // Tue 10 Nov
  const SLOTS = [
    slot("a", "r1", "2026-11-10", 20),
    slot("b", "r1", "2026-11-10", 25, 5),
    slot("c", "r2", "2026-11-10", 15),
    slot("d", "r3", "2026-11-09", 20), // Monday, same week
    slot("e", "r4", "2026-11-08", 20), // Sunday, last week
    slot("f", "r5", "2026-10-01", 20), // outside the 14 days
  ];

  it("totals each of the last 14 days, today first, with zero days included", () => {
    const d = dailyTotals(SLOTS, NOW);
    expect(d).toHaveLength(14);
    expect(d[0]).toMatchObject({ key: "2026-11-10", focusedMs: 60 * MIN, slots: 3, sessions: 2, overtimeMs: 5 * MIN });
    expect(d[1]).toMatchObject({ key: "2026-11-09", focusedMs: 20 * MIN, slots: 1, sessions: 1 });
    expect(d[2]).toMatchObject({ key: "2026-11-08", focusedMs: 20 * MIN });
    expect(d[3]).toMatchObject({ focusedMs: 0, slots: 0 });
    expect(d.reduce((n, b) => n + b.focusedMs, 0)).toBe(100 * MIN);
  });
  it("totals weeks Monday to Sunday, this week first", () => {
    const w = weeklyTotals(SLOTS, NOW);
    expect(w).toHaveLength(8);
    expect(w[0]).toMatchObject({ key: "2026-11-09", focusedMs: 80 * MIN, slots: 4, sessions: 3 });
    expect(w[1]).toMatchObject({ key: "2026-11-02", focusedMs: 20 * MIN, slots: 1 });
    expect(w[6]).toMatchObject({ key: "2026-09-28", focusedMs: 20 * MIN });
  });
  it("lists past sessions newest first with their summaries", () => {
    const list = pastSessions(SLOTS);
    expect(list.map((s) => s.run).sort()).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(list[0].run).toBe("r1");
    expect(list[0].summary).toMatchObject({ completed: 2, focusedMs: 45 * MIN, overtimeMs: 5 * MIN });
    expect(list[list.length - 1].run).toBe("r5");
    expect(pastSessions(SLOTS, 2)).toHaveLength(2);
  });
});
