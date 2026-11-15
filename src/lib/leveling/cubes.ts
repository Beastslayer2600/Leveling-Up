/* WCA puzzle events: each one is tracked as its own skill, with its own scrambles,
   averaging format and sub-X ladder. */
import { fmtTime, scramble333 } from "./practice.js";
import type { Standard } from "./types.js";

export type CubeEventId = "222" | "333" | "444" | "555" | "666" | "777" | "333oh" | "333bf" | "pyram" | "minx" | "skewb" | "sq1" | "clock";

export interface CubeEvent {
  id: CubeEventId;
  name: string;
  /** The average the WCA ranks this event by: average of 5, or mean of 3. */
  format: "ao5" | "mo3";
  /** WCA blindfolded events have no inspection: memorising is part of the time. */
  inspection: boolean;
  /** Sub-X thresholds in seconds, easiest first. */
  tiers: number[];
}

export const CUBE_EVENTS: CubeEvent[] = [
  { id: "333", name: "3x3x3 Cube", format: "ao5", inspection: true, tiers: [120, 60, 40, 30, 20, 15, 10] },
  { id: "222", name: "2x2x2 Cube", format: "ao5", inspection: true, tiers: [30, 20, 10, 7, 5, 3, 2] },
  { id: "444", name: "4x4x4 Cube", format: "ao5", inspection: true, tiers: [300, 180, 120, 90, 60, 45, 35] },
  { id: "555", name: "5x5x5 Cube", format: "ao5", inspection: true, tiers: [480, 300, 180, 120, 90, 70, 60] },
  { id: "666", name: "6x6x6 Cube", format: "mo3", inspection: true, tiers: [720, 480, 300, 240, 180, 150, 120] },
  { id: "777", name: "7x7x7 Cube", format: "mo3", inspection: true, tiers: [900, 600, 420, 300, 240, 200, 170] },
  { id: "333oh", name: "3x3x3 One-Handed", format: "ao5", inspection: true, tiers: [120, 60, 40, 30, 20, 15, 12] },
  { id: "333bf", name: "3x3x3 Blindfolded", format: "mo3", inspection: false, tiers: [900, 600, 300, 180, 120, 60, 30] },
  { id: "pyram", name: "Pyraminx", format: "ao5", inspection: true, tiers: [30, 20, 10, 7, 5, 3] },
  { id: "skewb", name: "Skewb", format: "ao5", inspection: true, tiers: [30, 20, 10, 7, 5, 3] },
  { id: "minx", name: "Megaminx", format: "ao5", inspection: true, tiers: [300, 180, 120, 90, 60, 45] },
  { id: "sq1", name: "Square-1", format: "ao5", inspection: true, tiers: [120, 60, 40, 30, 20, 15] },
  { id: "clock", name: "Clock", format: "ao5", inspection: true, tiers: [60, 30, 20, 15, 10, 7] },
];

export const CUBE_EVENT: Record<string, CubeEvent> = Object.fromEntries(CUBE_EVENTS.map((e) => [e.id, e]));

/** "Sub-1:00", "Sub-20". */
const sub = (s: number) => "Sub-" + fmtTime(s).replace(/s$/, "");

/** The WCA ladder for an event. 3x3 tops out at the South African record. */
export function cubeStandard(id: string): Standard {
  const e = CUBE_EVENT[id] || CUBE_EVENT["333"];
  const tiers = e.tiers.map((v) => ({ name: sub(v), value: v }));
  if (e.id === "333") tiers.push({ name: "SA record (4.82)", value: 4.82 });
  return {
    name: "WCA " + e.name,
    note:
      `World Cube Association rules, as used at CubingZA competitions in South Africa. Cubers rank themselves by sub-X singles; the WCA ranks this event by ${e.format === "mo3" ? "the mean of 3" : "the average of 5"}.` +
      (e.inspection ? "" : " Blindfolded has no inspection: memorising counts towards the time."),
    tiers,
  };
}

/* ---------- scrambles (random-move, the usual practice approximation) ---------- */

type Rand = () => number;
const pick = <T>(a: T[], r: Rand) => a[Math.floor(r() * a.length)];

/**
 * NxN scramble in WCA notation. 4x4 and 5x5 add wide moves (Rw); 6x6 and 7x7 add 3-layer
 * wide moves (3Rw). Never the same face and depth twice in a row, and never three moves on one axis.
 */
export function scrambleNxN(n: number, rand: Rand = Math.random): string {
  if (n === 3) return scramble333(rand);
  const len = { 2: 11, 4: 40, 5: 60, 6: 80, 7: 100 }[n] || 20;
  const faces = n === 2 ? ["U", "R", "F"] : ["U", "D", "R", "L", "F", "B"];
  const depths = n >= 6 ? [1, 2, 3] : n >= 4 ? [1, 2] : [1];
  const mods = ["", "'", "2"];
  const axis = (f: string) => "UDRLFB".indexOf(f) >> 1;
  const out: { f: string; d: number; s: string }[] = [];
  while (out.length < len) {
    const f = pick(faces, rand);
    const d = pick(depths, rand);
    const a = out[out.length - 1];
    const b = out[out.length - 2];
    if (a && a.f === f) continue;
    if (a && b && axis(f) === axis(a.f) && axis(a.f) === axis(b.f)) continue;
    const s = (d === 3 ? "3" : "") + f + (d >= 2 ? "w" : "") + pick(mods, rand);
    out.push({ f, d, s });
  }
  return out.map((m) => m.s).join(" ");
}

function scramblePyraminx(rand: Rand): string {
  const out: string[] = [];
  while (out.length < 10) {
    const f = pick(["U", "L", "R", "B"], rand);
    if (out[out.length - 1]?.[0] === f) continue;
    out.push(f + pick(["", "'"], rand));
  }
  for (const t of ["u", "l", "r", "b"]) {
    const k = Math.floor(rand() * 3);
    if (k) out.push(t + (k === 2 ? "'" : ""));
  }
  return out.join(" ");
}

function scrambleSkewb(rand: Rand): string {
  const out: string[] = [];
  while (out.length < 9) {
    const f = pick(["R", "U", "L", "B"], rand);
    if (out[out.length - 1]?.[0] === f) continue;
    out.push(f + pick(["", "'"], rand));
  }
  return out.join(" ");
}

/** Megaminx in Pochmann notation: 7 lines of R±± D±± ×5, each ending in U or U'. */
function scrambleMinx(rand: Rand): string {
  const lines: string[] = [];
  for (let l = 0; l < 7; l++) {
    const m: string[] = [];
    for (let i = 0; i < 5; i++) m.push("R" + pick(["++", "--"], rand), "D" + pick(["++", "--"], rand));
    m.push(pick(["U", "U'"], rand));
    lines.push(m.join(" "));
  }
  return lines.join("\n");
}

/** Clock in WCA notation: front pins then y2 and the back, each dial turn -5..+6. */
function scrambleClock(rand: Rand): string {
  const turn = () => {
    const v = Math.floor(rand() * 12) - 5;
    return `${Math.abs(v)}${v < 0 ? "-" : "+"}`;
  };
  const front = ["UR", "DR", "DL", "UL", "U", "R", "D", "L", "ALL"].map((p) => p + turn());
  const back = ["U", "R", "D", "L", "ALL"].map((p) => p + turn());
  return [...front, "y2", ...back].join(" ");
}

/** A practice scramble for an event, or "" where there isn't a simple generator (Square-1). */
export function scrambleFor(id: string | undefined, rand: Rand = Math.random): string {
  switch (id) {
    case "222": return scrambleNxN(2, rand);
    case "444": return scrambleNxN(4, rand);
    case "555": return scrambleNxN(5, rand);
    case "666": return scrambleNxN(6, rand);
    case "777": return scrambleNxN(7, rand);
    case "pyram": return scramblePyraminx(rand);
    case "skewb": return scrambleSkewb(rand);
    case "minx": return scrambleMinx(rand);
    case "clock": return scrambleClock(rand);
    case "sq1": return "";
    default: return scramble333(rand);
  }
}

/** WCA mean of 3 over the last three solves: any DNF makes it a DNF. */
export function mean3(solves: (number | null)[]): number | null | undefined {
  if (solves.length < 3) return undefined;
  const last = solves.slice(-3);
  if (last.some((x) => x == null)) return null;
  return Math.round(((last as number[]).reduce((s, x) => s + x, 0) / 3) * 100) / 100;
}

export function bestMean3(solves: (number | null)[]): number | null {
  let best: number | null = null;
  for (let i = 3; i <= solves.length; i++) {
    const m = mean3(solves.slice(i - 3, i));
    if (m != null && (best == null || m < best)) best = m;
  }
  return best;
}
