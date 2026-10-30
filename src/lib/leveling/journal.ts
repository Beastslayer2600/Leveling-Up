import { dayOfYear, dkey } from "./dates.js";
import type { JournalEntry } from "./types.js";

/** The question the debrief asks. "How was your day?" leads; the rest rotate daily. */
export const PROMPTS = [
  "How was your day?",
  "What went well today, and why?",
  "What drained you today?",
  "Where did you see God at work today?",
  "What's one thing you'd do differently?",
  "Who did you connect with today, and how did it go?",
  "What are you grateful for tonight?",
  "What's weighing on you for tomorrow?",
  "What did you learn today?",
  "When did you feel most like yourself today?",
  "What did you avoid today, and what's behind it?",
  "What would make tomorrow a win?",
];

export function todayPrompt(now: Date = new Date(), swap = 0): string {
  if (swap === 0) return PROMPTS[0];
  return PROMPTS[1 + ((dayOfYear(now) + swap - 1) % (PROMPTS.length - 1))];
}

export const MOODS = [
  { v: 1, label: "Rough", emoji: "⛈" },
  { v: 2, label: "Low", emoji: "🌧" },
  { v: 3, label: "Okay", emoji: "⛅" },
  { v: 4, label: "Good", emoji: "🌤" },
  { v: 5, label: "Great", emoji: "☀" },
] as const;

export const JOURNAL_XP = 15;

/** The first entry of a day pays; later entries that day are free writing. */
export function journalXp(entries: JournalEntry[], date: string, excludeId?: string): number {
  return entries.some((e) => e.date === date && e.id !== excludeId && e.xp > 0) ? 0 : JOURNAL_XP;
}

export const journaledOn = (entries: JournalEntry[], date: string = dkey()) => entries.some((e) => e.date === date);

/** Consecutive days with an entry, ending today or yesterday. */
export function journalStreak(entries: JournalEntry[], now: Date = new Date()): number {
  const days = new Set(entries.map((e) => e.date));
  const d = new Date(now);
  if (!days.has(dkey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dkey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
