import { describe, expect, it } from "vitest";
import { ACH, checkAchievements, freshAchievements } from "./achievements";
import { buildPrompt, digest, parseSuggestions } from "./coach";
import { blankData, normalize } from "./data";
import { curKey, dkey, weekStart } from "./dates";
import { applyEvent, EVENT_TYPES, type LevelEvent } from "./events";
import { closed, eff, isDone, stepCounter, toggleQuest } from "./missions";
import { e1rm, findNewPbs, parseSets, pbMap, workoutXp } from "./training";
import { completeVirtue, rrState, todayVirtue, VIRTUES } from "./virtues";
import { journalStreak, journalXp, todayPrompt } from "./journal";
import { applyAward, blankStats, levelOf, liveStreak, rankOf } from "./xp";
import type { Data, JournalEntry, Quest, Workout } from "./types";

// Tuesday 13 Oct 2026, 10:00 local.
const NOW = new Date(2026, 9, 13, 10, 0, 0);
const at = (d: number, h = 10) => new Date(2026, 9, d, h, 0, 0);

const quest = (p: Partial<Quest>): Quest => ({
  id: "q" + Math.random(),
  title: "Mission",
  cat: "side",
  kind: "quest",
  xp: 25,
  created: 0,
  ...p,
});

describe("levels", () => {
  it("player levels cost 100 × L", () => {
    expect(levelOf(0, 100)).toEqual({ level: 1, into: 0, need: 100 });
    expect(levelOf(99, 100).level).toBe(1);
    expect(levelOf(100, 100)).toEqual({ level: 2, into: 0, need: 200 });
    expect(levelOf(300, 100)).toEqual({ level: 3, into: 0, need: 300 });
    expect(levelOf(-50, 100).level).toBe(1);
  });
  it("category levels cost 50 × L", () => {
    expect(levelOf(50, 50).level).toBe(2);
    expect(levelOf(150, 50).level).toBe(3);
  });
  it("ranks by level", () => {
    expect(rankOf(1)).toBe("Recruit");
    expect(rankOf(4)).toBe("Rookie");
    expect(rankOf(5)).toBe("Field Agent");
    expect(rankOf(40)).toBe("Legend");
  });
});

describe("applyAward", () => {
  it("adds XP to total, category and today, and logs it", () => {
    const r = applyAward(blankStats(), { delta: 25, title: "Gym", cat: "training" }, NOW);
    expect(r.stats.xp).toBe(25);
    expect(r.stats.cat.training).toBe(25);
    expect(r.stats.dayXp).toBe(25);
    expect(r.stats.log[0]).toMatchObject({ title: "Gym", xp: 25 });
  });
  it("starts, extends and resets the streak", () => {
    let st = applyAward(blankStats(), { delta: 10, title: "a", cat: "admin" }, at(11)).stats;
    expect(st.streak).toBe(1);
    st = applyAward(st, { delta: 10, title: "b", cat: "admin" }, at(12)).stats;
    expect(st.streak).toBe(2);
    st = applyAward(st, { delta: 10, title: "c", cat: "admin" }, at(12, 15)).stats;
    expect(st.streak).toBe(2);
    st = applyAward(st, { delta: 10, title: "d", cat: "admin" }, at(15)).stats;
    expect(st.streak).toBe(1);
    expect(liveStreak(st, at(16))).toBe(1);
    expect(liveStreak(st, at(18))).toBe(0);
  });
  it("never goes below zero and does not log negatives", () => {
    const r = applyAward(blankStats(), { delta: -40, title: "undo", cat: "admin" }, NOW);
    expect(r.stats.xp).toBe(0);
    expect(r.stats.log).toHaveLength(0);
  });
  it("reports level-ups", () => {
    const r = applyAward({ ...blankStats(), xp: 90 }, { delta: 20, title: "x", cat: "admin" }, NOW);
    expect([r.levelBefore, r.levelAfter]).toEqual([1, 2]);
  });
  it("collects time-of-day and tally events", () => {
    expect(applyAward(blankStats(), { delta: 5, title: "x", cat: "admin" }, at(13, 2)).events).toContain("nightowl");
    expect(applyAward(blankStats(), { delta: 5, title: "x", cat: "admin" }, at(13, 5)).events).toContain("earlybird");
    expect(applyAward(blankStats(), { delta: 100, title: "x", cat: "admin" }, NOW).events).toContain("deadeye");
    let st = blankStats();
    const cats = ["clients", "admin", "training", "social", "money", "faith"];
    let last: string[] = [];
    for (const c of cats) {
      const r = applyAward(st, { delta: 1, title: c, cat: c }, NOW);
      st = r.stats;
      last = r.events;
    }
    expect(last).toContain("renaissance");
  });
  it("resets today's tally on a new day", () => {
    const st = applyAward(blankStats(), { delta: 30, title: "x", cat: "admin" }, at(12)).stats;
    expect(applyAward(st, { delta: 5, title: "y", cat: "admin" }, at(13)).stats.dayXp).toBe(5);
  });
});

describe("missions", () => {
  it("daily ops are done for today only", () => {
    const q = quest({ kind: "daily", doneOn: dkey(at(12)) });
    expect(isDone(q, at(12))).toBe(true);
    expect(isDone(q, at(13))).toBe(false);
  });
  it("toggle pays and refunds, and bumps counters", () => {
    const q = quest({ xp: 50, cat: "adjudication" });
    const on = toggleQuest(q, [q], NOW);
    expect(on.quest.done).toBe(true);
    expect(on.award.delta).toBe(50);
    const st = applyAward(blankStats(), on.award, NOW).stats;
    expect(st.n.missions).toBe(1);
    expect(st.n.c_adjudication).toBe(1);
    const off = toggleQuest(on.quest, [on.quest], NOW);
    expect(off.award.delta).toBe(-50);
    const st2 = applyAward(st, off.award, NOW).stats;
    expect(st2.n.missions).toBe(0);
    expect(st2.xp).toBe(0);
  });
  it("third daily op in a day is a Hat Trick", () => {
    const t = dkey(NOW);
    const a = quest({ kind: "daily", doneOn: t });
    const b = quest({ kind: "daily", doneOn: t });
    const c = quest({ kind: "daily" });
    expect(toggleQuest(c, [a, b, c], NOW).award.events).toContain("hattrick");
  });
  it("three hard missions in a day applies pressure", () => {
    let st = blankStats();
    let ev: string[] = [];
    for (let i = 0; i < 3; i++) {
      const q = quest({ xp: 50 });
      const r = applyAward(st, toggleQuest(q, [q], NOW).award, NOW);
      st = r.stats;
      ev = r.events;
    }
    expect(ev).toContain("pressure");
  });
  it("counters step, pay a 2× bonus at target and count closers", () => {
    const q = quest({ kind: "counter", target: 2, period: "none", xp: 50, cat: "clients", progress: 0 });
    const s1 = stepCounter(q, 1, NOW)!;
    expect(s1.award.delta).toBe(50);
    const s2 = stepCounter(s1.quest, 1, NOW)!;
    expect(s2.hit).toBe(true);
    expect(s2.award.delta).toBe(150);
    const st = applyAward(blankStats(), s2.award, NOW).stats;
    expect(st.n.closer).toBe(1);
    expect(closed(s2.quest, NOW)).toBe(true);
    expect(stepCounter(s2.quest, 1, NOW)).toBeNull();
    const back = stepCounter(s2.quest, -1, NOW)!;
    expect(back.award.delta).toBe(-150);
  });
  it("weekly counters reset when the week rolls over", () => {
    const q = quest({ kind: "counter", target: 4, period: "week", progress: 3, periodKey: curKey("week", at(13)) });
    expect(eff(q, at(13))).toBe(3);
    expect(eff(q, at(19))).toBe(0);
    expect(weekStart(at(13))).toBe("2026-10-12");
  });
});

describe("training", () => {
  it("parses weighted, unit and bodyweight sets", () => {
    expect(parseSets("80x8, 85kg×6; 12, junk")).toEqual([
      { kg: 80, reps: 8 },
      { kg: 85, reps: 6 },
      { kg: 0, reps: 12 },
    ]);
  });
  it("estimates 1RM with Epley", () => {
    expect(e1rm({ kg: 100, reps: 5 })).toBe(117);
    expect(e1rm({ kg: 130, reps: 1 })).toBe(134);
  });
  const w = (id: string, sets: string, date = "2026-10-01"): Workout => ({
    id, type: "gym", date, created: 0, note: "", ex: [{ name: "Squat", sets: parseSets(sets) }], pbs: 0, xp: 30,
  });
  it("tracks the best set per lift", () => {
    expect(pbMap([w("a", "100x5"), w("b", "110x3")]).squat.best).toEqual({ kg: 110, reps: 3 });
  });
  it("detects a heavier set as a PB, but not a first-ever lift", () => {
    const hist = [w("a", "100x5")];
    expect(findNewPbs([{ name: "Squat", sets: parseSets("105x3") }], hist)).toEqual(["Squat 105kg × 3"]);
    expect(findNewPbs([{ name: "squat ", sets: parseSets("100x6") }], hist)).toHaveLength(1);
    expect(findNewPbs([{ name: "Squat", sets: parseSets("95x10") }], hist)).toHaveLength(0);
    expect(findNewPbs([{ name: "Bench", sets: parseSets("80x5") }], hist)).toHaveLength(0);
  });
  it("pays bonus XP per PB, and for cardio minutes", () => {
    expect(workoutXp("gym", 0)).toBe(30);
    expect(workoutXp("gym", 2)).toBe(110);
    expect(workoutXp("cardio", 0, 30)).toBe(25);
    expect(workoutXp("cardio", 0, 200)).toBe(45);
  });
});

describe("virtues", () => {
  it("has 25 virtues, nine of them fruit of the Spirit", () => {
    expect(VIRTUES).toHaveLength(25);
    expect(VIRTUES.filter((v) => v.fruit)).toHaveLength(9);
  });
  it("rotates by day of year and can be swapped", () => {
    expect(todayVirtue(at(13))).not.toBe(todayVirtue(at(14)));
    expect(todayVirtue(at(13), 1)).toBe(todayVirtue(at(14)));
  });
  it("counts completions, streaks and fruits", () => {
    const st = blankStats();
    const fruit = VIRTUES.find((v) => v.fruit)!;
    completeVirtue(st, fruit, at(12));
    completeVirtue(st, fruit, at(13));
    expect(st.virtue).toMatchObject({ count: 2, streak: 2, fruits: [fruit.n] });
  });
  it("opens one Release Reset day per calendar day", () => {
    expect(rrState({ days: {}, cycles: 0, reach: 0, plan: {} }, NOW)).toMatchObject({ cur: 1, open: true });
    expect(rrState({ days: { 1: dkey(NOW) }, cycles: 0, reach: 0, plan: {} }, NOW)).toMatchObject({ cur: 2, open: false });
    expect(rrState({ days: { 1: "2026-10-12" }, cycles: 0, reach: 0, plan: {} }, NOW)).toMatchObject({ cur: 2, open: true });
  });
});

describe("achievements", () => {
  it("has 38 achievements with unique ids", () => {
    expect(ACH).toHaveLength(38);
    expect(new Set(ACH.map((a) => a.id)).size).toBe(38);
  });
  it("unlocks data achievements once", () => {
    const d = blankData();
    d.workouts.push({ id: "w", type: "gym", date: dkey(NOW), created: 0, note: "", ex: [], pbs: 0, xp: 30 });
    expect(checkAchievements(d, NOW)).toContain("iron");
    d.stats.ach.iron = 1;
    expect(checkAchievements(d, NOW)).not.toContain("iron");
  });
  it("finds a comeback after a month apart", () => {
    const d = blankData();
    const s = (date: string) => ({ id: date, kind: "irl" as const, what: "Coffee", date, note: "", group: "Crew", xp: 25, created: 0 });
    d.social.push(s("2026-08-01"), s("2026-09-15"));
    expect(checkAchievements(d, NOW)).toContain("comeback");
  });
  it("filters fresh ids", () => {
    expect(freshAchievements(["iron", "iron", "nope", "first"], { first: 1 })).toEqual(["iron"]);
  });
});

describe("integration events", () => {
  const ev = (key: string, type: keyof typeof EVENT_TYPES = "adjudication.report_submitted"): LevelEvent => ({
    source: "adjudicator",
    type,
    ...EVENT_TYPES[type],
    idempotencyKey: `adjudicator:${type}:${key}`,
  });

  it("pays once per idempotency key", () => {
    let d: Data = blankData();
    const r1 = applyEvent(d, ev("abc"), NOW);
    expect(r1.applied).toBe(true);
    expect(r1.data.stats.cat.adjudication).toBe(25);
    d = r1.data;
    const r2 = applyEvent(d, ev("abc"), NOW);
    expect(r2.applied).toBe(false);
    expect(r2.data.stats.xp).toBe(25);
  });
  it("counts toward Adjudicator's Eye", () => {
    let d: Data = blankData();
    for (const k of ["1", "2", "3", "4", "5"]) d = applyEvent(d, ev(k), NOW).data;
    expect(checkAchievements(d, NOW)).toContain("adjeye");
  });
  it("progresses a matching counter and ticks a matching quest", () => {
    const d: Data = blankData();
    d.quests = [
      quest({ id: "c", title: "Close cases toward the target", cat: "clients", kind: "counter", target: 24, period: "none", xp: 50, progress: 0 }),
      quest({ id: "b", title: "Confirm upcoming adjudication dates", cat: "adjudication" }),
    ];
    const closedCase: LevelEvent = { source: "advisor", type: "advisor.case_closed", ...EVENT_TYPES["advisor.case_closed"], idempotencyKey: "advisor:case:x" };
    const r = applyEvent(d, closedCase, NOW);
    expect(r.data.quests[0].progress).toBe(1);
    expect(r.data.stats.xp).toBe(100);
    const r2 = applyEvent(r.data, ev("bk", "adjudication.booking_confirmed"), NOW);
    expect(r2.data.quests[1].done).toBe(true);
  });
  it("rejects unknown categories and missing keys", () => {
    const d = blankData();
    expect(applyEvent(d, { ...ev("x"), category: "nope" as never }, NOW).applied).toBe(false);
    expect(applyEvent(d, { ...ev("x"), idempotencyKey: "" }, NOW).applied).toBe(false);
  });
});

describe("coach", () => {
  it("briefs the model from the player's own sheet, without the release plan", () => {
    const d = blankData();
    d.sheet.name = "Sam";
    d.sheet.about = "Teacher in Durban.";
    d.release.plan = { 0: "very private" };
    const p = buildPrompt(d, "patience", NOW);
    expect(p).toContain("for Sam. About them: Teacher in Durban.");
    expect(p).toContain("Their focus right now: patience");
    expect(p).not.toContain("very private");
    expect(digest(d, NOW)).toContain("Open missions:");
  });
  it("validates model output", () => {
    const out = parseSuggestions(
      'Sure! [{"title":"Walk","cat":"training","kind":"counter","target":500,"period":"week","difficulty":"hard"},' +
        '{"title":"Pray","cat":"nope","kind":"weird"},{"why":"no title"}]',
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: "counter", target: 99, xp: 50 });
    expect(out[1]).toMatchObject({ cat: "mind", kind: "quest", target: null, xp: 25 });
    expect(parseSuggestions("not json")).toEqual([]);
  });
});

describe("data", () => {
  it("normalizes partial saves", () => {
    const d = normalize({ quests: [quest({})], stats: { xp: 40 } });
    expect(d.stats.xp).toBe(40);
    expect(d.stats.events).toEqual({});
    expect(d.sheet.stepGoal).toBe(10000);
    expect(d.workouts).toEqual([]);
  });
});

describe("journal", () => {
  const entry = (date: string, p: Partial<JournalEntry> = {}): JournalEntry => ({
    id: date + Math.random(), date, created: 0, prompt: "How was your day?", text: "x", mood: 4, xp: 0, ...p,
  });
  it("leads with 'How was your day?' and rotates alternatives", () => {
    expect(todayPrompt(NOW)).toBe("How was your day?");
    expect(todayPrompt(NOW, 1)).not.toBe("How was your day?");
    expect(todayPrompt(NOW, 1)).not.toBe(todayPrompt(NOW, 2));
  });
  it("pays the first entry of a day only", () => {
    expect(journalXp([], "2026-10-13")).toBe(15);
    const paid = entry("2026-10-13", { id: "a", xp: 15 });
    expect(journalXp([paid], "2026-10-13")).toBe(0);
    expect(journalXp([paid], "2026-10-14")).toBe(15);
    expect(journalXp([paid], "2026-10-13", "a")).toBe(15);
  });
  it("counts a journaling streak through yesterday", () => {
    const es = ["2026-10-10", "2026-10-11", "2026-10-12"].map((d) => entry(d));
    expect(journalStreak(es, NOW)).toBe(3);
    expect(journalStreak([...es, entry("2026-10-13")], NOW)).toBe(4);
    expect(journalStreak(es, at(15))).toBe(0);
  });
  it("unlocks Field Notes and On the Record", () => {
    const d = blankData();
    for (let i = 1; i <= 7; i++) d.journal.push(entry(`2026-10-0${i}`));
    d.journal[0].audio = { mime: "audio/webm", secs: 12 };
    const got = checkAchievements(d, NOW);
    expect(got).toContain("journal7");
    expect(got).toContain("voice");
  });
  it("keeps the journal out of the coach prompt", () => {
    const d = blankData();
    d.journal.push(entry("2026-10-13", { text: "secret diary line" }));
    expect(buildPrompt(d, "", NOW)).not.toContain("secret diary line");
  });
});
