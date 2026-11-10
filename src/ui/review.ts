/* Weekly review of the daily rhythm: counts, times and trends. Information only. */
import { RHYTHM } from "../lib/leveling/config";
import { dkey, parseD } from "../lib/leveling/dates";
import { countMarks, debriefCount, firstTaps, morningMarks, patternFlag, recordCsv, reviewDates, trends, type DayMark, type Trend } from "../lib/leveling/review";
import { esc } from "./dom";
import { toast } from "./fx";
import { shell } from "./focus";
import { S } from "./state";

const R = RHYTHM.review;
const dayLetter = (k: string) => parseD(k).toLocaleDateString("en-ZA", { weekday: "short" }).slice(0, 2);
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

const MARK: Record<DayMark, string> = { full: "Full", low: "Low day", missed: "Missed", open: "Today", none: "" };

function spark(t: Trend): string {
  const W = 168, H = 44, px = 6, py = 7;
  const vals = t.values.filter((v): v is number => v != null);
  const [lo, hi] = t.id === "sleepHours" ? [Math.min(4, ...vals, t.baseline ?? 4), Math.max(10, ...vals, t.baseline ?? 10)] : [1, 5];
  const X = (i: number) => px + (i / (t.values.length - 1)) * (W - 2 * px);
  const Y = (v: number) => py + ((hi - v) / (hi - lo)) * (H - 2 * py);
  let svg = `<svg class="rv-spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t.label)} over the last seven days">`;
  if (t.baseline != null) svg += `<line class="base" x1="${px}" x2="${W - px}" y1="${Y(t.baseline).toFixed(1)}" y2="${Y(t.baseline).toFixed(1)}"/>`;
  // Draw each unbroken run of logged days as its own line, so a gap stays a gap.
  let seg: string[] = [];
  const flush = () => {
    if (seg.length > 1) svg += `<polyline points="${seg.join(" ")}"/>`;
    seg = [];
  };
  t.values.forEach((v, i) => (v == null ? flush() : seg.push(`${X(i).toFixed(1)},${Y(v).toFixed(1)}`)));
  flush();
  t.values.forEach((v, i) => {
    if (v != null) svg += `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.6"/>`;
  });
  return svg + "</svg>";
}

function trendRow(t: Trend): string {
  const vals = t.values.filter((v): v is number => v != null);
  const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  return (
    `<div class="rv-trend"><b>${esc(t.label)}</b>${spark(t)}<span>${avg == null ? "No entries" : `avg ${fmt(+avg.toFixed(1))}${t.unit}`}` +
    `<small>${t.baseline == null ? "No baseline yet" : `usual ${fmt(+t.baseline.toFixed(1))}${t.unit}`}</small></span></div>`
  );
}

export function renderReview(): string {
  const days = S.data.rhythm;
  const dates = reviewDates();
  const marks = morningMarks(days);
  const c = countMarks(marks);
  const taps = firstTaps(days);
  const tr = trends(days);
  const range = `${parseD(dates[0]).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} to ${parseD(dates[dates.length - 1]).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}`;
  const off = taps.avgOffset;
  return shell({
    kicker: range,
    title: "Weekly review",
    inner:
      `<div class="fx-body top rv">` +
      `<section><h3>Morning Sequences</h3><div class="rv-days">${dates.map((k, i) => `<div class="rv-day ${marks[i]}" title="${MARK[marks[i]]}"><i></i><small>${dayLetter(k)}</small></div>`).join("")}</div>` +
      `<p class="rv-line"><b>${c.full}</b> full · <b>${c.low}</b> low-day · <b>${c.missed}</b> missed</p></section>` +
      `<section><h3>Evening Debriefs</h3><p class="rv-line"><b>${debriefCount(days)}</b> of ${R.days} completed</p></section>` +
      `<section><h3>First morning tap</h3><div class="rv-days">${dates.map((k, i) => `<div class="rv-day ${taps.taps[i] ? "tap" : "none"}"><i></i><em>${taps.taps[i] || "–"}</em><small>${dayLetter(k)}</small></div>`).join("")}</div>` +
      `<p class="rv-line">${taps.avg ? `Average <b>${taps.avg}</b> · wake time ${taps.wake}${off == null ? "" : ` · ${Math.abs(off)} min ${off >= 0 ? "after" : "before"}`}` : `No morning taps this week · wake time ${taps.wake}`}</p></section>` +
      `<section><h3>Daily record</h3><p class="rv-key">Line: last seven days · dashed: your previous four-week average</p>${tr.map(trendRow).join("")}` +
      (patternFlag(days) ? `<p class="rv-note">${esc(R.patternNote)}</p>` : "") +
      `</section></div>` +
      `<div class="fx-acts rv-acts"><button class="btn" type="button" data-r="csv">Export record (CSV)</button><button class="btn" type="button" data-r="print">Print this page</button></div>`,
  });
}

export function reviewAct(a: string): void {
  if (a === "print") return window.print();
  if (a !== "csv") return;
  if (!S.data.rhythm.length) return toast("There's nothing in the record yet.");
  const el = document.createElement("a");
  el.href = URL.createObjectURL(new Blob([recordCsv(S.data.rhythm)], { type: "text/csv" }));
  el.download = `daily-record-${dkey()}.csv`;
  el.click();
  setTimeout(() => URL.revokeObjectURL(el.href), 1000);
  toast("Record saved to your downloads");
}
