/* Skill analytics: practice time for every skill, solve history for cubes,
   and game records with reviews for chess. Also the chess game sheet. */
import { CONTROLS, chessAnalytics, cubeAnalytics, expectedScore, gameXp, normalizeGame, rollingAverage, solveHistory, weeklyMinutes, type Record3, type Window } from "../lib/leveling/analytics";
import { PRACTICE } from "../lib/leveling/config";
import { CUBE_EVENT } from "../lib/leveling/cubes";
import { dkey, parseD } from "../lib/leveling/dates";
import { fmtMins, fmtTime, fmtValue, gamePoints, isPb, skillSummary, standardStatus } from "../lib/leveling/practice";
import type { ChessGame, GameResult, PracticeLog, Pursuit } from "../lib/leveling/types";
import { $, ICON, dayBox, esc, radio, radioVal, setVal, shortD, val } from "./dom";
import { toast } from "./fx";
import { S, after, award, drop, newId, put, render } from "./state";

const empty = (msg: string) => `<div class="empty">${esc(msg)}</div>`;
const tm = (v: number | null | undefined) => (v == null ? "—" : fmtTime(v).replace(/s$/, ""));
const byId = (id: string | null | undefined) => S.data.pursuits.find((p) => p.id === id) || null;

/* ---------- charts ---------- */

interface Series {
  pts: { x: number; y: number | null | undefined }[];
  cls: string;
  /** Draw dots instead of a line. */
  dots?: boolean;
  /** Draw as a staircase (best so far). */
  step?: boolean;
  /** Per-point class for dots. */
  dotCls?: (i: number) => string;
}

/**
 * A small SVG line chart. x is a number (solve index or day), y is a value; nulls break lines.
 * `invert` puts low values at the top (used nowhere by default: lower solve times sit lower, like cubing apps).
 */
function lineChart(o: { series: Series[]; fmtY: (v: number) => string; xLabels?: [string, string]; goal?: { y: number; label: string } | null; H?: number; aria: string }): string {
  const W = 360, H = o.H || 190, pl = 46, pr = 10, pt = 14, pb = 22;
  const all = o.series.flatMap((s) => s.pts.filter((p) => p.y != null).map((p) => p.y as number));
  const xs = o.series.flatMap((s) => s.pts.map((p) => p.x));
  if (all.length < 2) return `<p class="hint">Not enough data for a chart yet.</p>`;
  let lo = Math.min(...all, o.goal?.y ?? Infinity);
  let hi = Math.max(...all, o.goal?.y ?? -Infinity);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = (x: number) => pl + ((x - x0) / Math.max(1e-9, x1 - x0)) * (W - pl - pr);
  const Y = (y: number) => pt + ((hi - y) / (hi - lo)) * (H - pt - pb);
  let svg = `<svg class="chart ana-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria)}">`;
  for (let k = 0; k <= 3; k++) {
    const v = lo + pad + ((hi - lo - 2 * pad) * k) / 3;
    svg += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="grid"/><text x="${pl - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${esc(o.fmtY(v))}</text>`;
  }
  if (o.goal) svg += `<line x1="${pl}" x2="${W - pr}" y1="${Y(o.goal.y).toFixed(1)}" y2="${Y(o.goal.y).toFixed(1)}" class="goal"/><text x="${W - pr}" y="${(Y(o.goal.y) - 5).toFixed(1)}" text-anchor="end" class="goal-t">${esc(o.goal.label)}</text>`;
  for (const s of o.series) {
    if (s.dots) {
      s.pts.forEach((p, i) => {
        if (p.y != null) svg += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.4" class="${s.cls} ${s.dotCls?.(i) || ""}"/>`;
      });
      continue;
    }
    let d = "";
    let pen = false;
    let prevY: number | null = null;
    for (const p of s.pts) {
      if (p.y == null) { pen = false; continue; }
      const x = X(p.x).toFixed(1), y = Y(p.y).toFixed(1);
      if (!pen) d += `M${x},${y}`;
      else d += s.step && prevY != null ? `H${x}V${y}` : `L${x},${y}`;
      pen = true;
      prevY = p.y;
    }
    if (d) svg += `<path d="${d}" class="${s.cls}"/>`;
  }
  if (o.xLabels) svg += `<text x="${pl}" y="${H - 5}">${esc(o.xLabels[0])}</text><text x="${W - pr}" y="${H - 5}" text-anchor="end">${esc(o.xLabels[1])}</text>`;
  return svg + "</svg>";
}

function bars(items: { label: string; v: number; hl?: boolean }[], fmt: (v: number) => string): string {
  const mx = Math.max(1, ...items.map((i) => i.v));
  return `<div class="ana-bars">${items
    .map((i) => `<div class="ab${i.hl ? " hl" : ""}" title="${esc(i.label)}: ${esc(fmt(i.v))}"><small>${i.v ? esc(fmt(i.v)) : ""}</small><div class="ab-t"><i style="height:${Math.max(2, Math.round((i.v / mx) * 100))}%"></i></div><small class="ab-l">${esc(i.label)}</small></div>`)
    .join("")}</div>`;
}

/* ---------- page ---------- */

export function renderAnalytics(p: Pursuit): string {
  const logs = S.data.practice.filter((l) => l.skill === p.id);
  const s = skillSummary(p, S.data.practice, undefined, S.data.games);
  const head =
    `<header class="ana-h"><button class="navbtn" type="button" data-act="sk-back" aria-label="Back to skills">${ICON.chevL}</button>` +
    `<div><p class="kicker">Analytics</p><h2>${esc((p.icon ? p.icon + " " : "") + p.name)}</h2></div>` +
    `<span class="ana-lv">LV${s.level}<small>${s.rank}</small></span></header>`;
  const isTime = p.metric?.kind === "time";
  let body = "";
  if (isTime) body += cubeSection(p, logs);
  if (p.games) body += chessSection(p);
  if (!isTime && !p.games && p.metric) body += resultSection(p, s.series);
  body += practiceSection(logs, s.totalMins, s.sessions);
  return head + body;
}

function practiceSection(logs: PracticeLog[], total: number, sessions: number): string {
  const wk = weeklyMinutes(logs, 12);
  const avg = wk.reduce((t, w) => t + w.mins, 0) / wk.length;
  return (
    `<section class="panel"><div class="sec-h"><h2>Practice time</h2><span>${fmtMins(total)} · ${sessions} sessions</span></div>` +
    bars(wk.map((w, i) => ({ label: i === wk.length - 1 ? "Now" : shortD(w.week), v: w.mins, hl: i === wk.length - 1 })), (v) => fmtMins(v)) +
    `<p class="hint">12-week average: ${fmtMins(avg)} a week.</p></section>`
  );
}

function resultSection(p: Pursuit, series: { date: string; value: number }[]): string {
  const t0 = series.length ? parseD(series[0].date).getTime() : 0;
  return (
    `<section class="panel"><div class="sec-h"><h2>${esc(p.metric!.name)} over time</h2></div>` +
    lineChart({
      series: [{ pts: series.map((x) => ({ x: (parseD(x.date).getTime() - t0) / 864e5, y: x.value })), cls: "ln-main" }],
      fmtY: (v) => fmtValue(Math.round(v), p.metric, p.standard),
      xLabels: series.length ? [shortD(series[0].date), shortD(series[series.length - 1].date)] : undefined,
      goal: p.goal != null ? { y: p.goal, label: "goal" } : null,
      aria: p.metric!.name + " trend",
    }) +
    `</section>`
  );
}

/* ---------- cube ---------- */

function cubeSection(p: Pursuit, logs: PracticeLog[]): string {
  const ev = p.cube ? CUBE_EVENT[p.event || "333"] : null;
  const mo3 = ev?.format === "mo3";
  const avgName = mo3 ? "mo3" : "ao5";
  const a = cubeAnalytics(logs, mo3);
  if (!a.total) return `<section class="panel"><div class="sec-h"><h2>Solves</h2></div>${empty("Do a timer session (or log a result) and your solve analytics show up here.")}</section>`;
  const pts = solveHistory(logs).slice(-400);
  const times = pts.map((x) => x.t);
  const roll = rollingAverage(times, mo3 ? 3 : 5, mo3);
  const roll12 = rollingAverage(times, 12);
  const best = (() => {
    let b: number | null = null;
    return times.map((t) => (t != null && (b == null || t < b) ? (b = t) : b));
  })();
  const rank = standardStatus(p, a.allTime.best);

  const delta = (then: number | null, now: number | null) => {
    if (then == null || now == null) return "";
    const d = now - then;
    if (Math.abs(d) < 0.005) return `<em class="same">±0</em>`;
    return `<em class="${d < 0 ? "up" : "down"}">${d < 0 ? "−" : "+"}${tm(Math.abs(d))}</em>`;
  };
  const row = (label: string, k: keyof Window) => {
    const f = (w: Window | null) => (w ? (w[k] as number | null) : null);
    return `<tr><th>${label}</th><td>${tm(f(a.then))}</td>${a.monthAgo ? `<td>${tm(f(a.monthAgo))}</td>` : ""}<td class="now">${tm(f(a.now))} ${delta(f(a.monthAgo) ?? f(a.then), f(a.now))}</td></tr>`;
  };
  const headline =
    a.improvement != null
      ? a.improvement > 0
        ? `<b class="pos">${Math.round(a.improvement * 100)}% faster</b> on average than your first 12 solves.`
        : `<b>${Math.round(-a.improvement * 100)}% slower</b> on average than your first 12 solves. Off days happen.`
      : `Do ${Math.max(0, 13 - a.total)} more solve${13 - a.total === 1 ? "" : "s"} to compare then with now.`;

  const wk = (w: Window) => `<div><span>Solves</span><b>${w.solves}</b></div><div><span>Best</span><b>${tm(w.best)}</b></div><div><span>Best ${avgName}</span><b>${tm(w.avg)}</b></div><div><span>Mean</span><b>${tm(w.mean)}</b></div>`;

  return (
    `<section class="panel ana-hero"><div class="ana-kpis">` +
    `<div><span>PB single</span><b>${tm(a.allTime.best)}</b></div>` +
    `<div><span>PB ${avgName}</span><b>${tm(a.allTime.avg)}</b></div>` +
    `<div><span>PB ao12</span><b>${tm(a.allTime.ao12)}</b></div>` +
    `<div><span>Solves</span><b>${a.total}</b></div></div>` +
    (rank.current || rank.next ? `<p class="ana-rank">${esc(p.standard?.name || "")}: <b>${esc(rank.current?.name || "Unranked")}</b>${rank.next ? ` · next ${esc(rank.next.name)}` : ""}</p>` : "") +
    `</section>` +
    `<section class="panel"><div class="sec-h"><h2>Then vs now</h2><span>12-solve windows</span></div><p class="ana-head">${headline}</p>` +
    `<table class="ana-tbl"><thead><tr><th></th><th>First 12</th>${a.monthAgo ? "<th>30 days ago</th>" : ""}<th>Latest 12</th></tr></thead><tbody>` +
    row("Best", "best") + row(`Best ${avgName}`, "avg") + row("Mean", "mean") +
    `</tbody></table></section>` +
    `<section class="panel"><div class="sec-h"><h2>Solve trend</h2><span>Last ${pts.length} solves</span></div>` +
    lineChart({
      series: [
        { pts: pts.map((x, i) => ({ x: i, y: x.t })), cls: "dot-solve", dots: true },
        { pts: roll12.map((y, i) => ({ x: i, y })), cls: "ln-ao12" },
        { pts: roll.map((y, i) => ({ x: i, y })), cls: "ln-ao5" },
        { pts: best.map((y, i) => ({ x: i, y })), cls: "ln-best", step: true },
      ],
      fmtY: (v) => tm(v),
      xLabels: [shortD(pts[0].date), shortD(pts[pts.length - 1].date)],
      goal: p.goal != null ? { y: p.goal, label: "goal " + tm(p.goal) } : null,
      H: 220,
      aria: "Solve times with rolling averages",
    }) +
    `<div class="ana-legend"><span class="lg-solve">Solves</span><span class="lg-ao5">${avgName}</span><span class="lg-ao12">ao12</span><span class="lg-best">Best so far</span></div></section>` +
    `<div class="duo">` +
    `<section class="panel"><div class="sec-h"><h2>This week vs last</h2></div><div class="ana-cmp"><div class="ana-col"><h4>Last 7 days</h4>${wk(a.last7)}</div><div class="ana-col dim"><h4>The 7 before</h4>${wk(a.prev7)}</div></div></section>` +
    `<section class="panel"><div class="sec-h"><h2>Spread</h2><span>Latest 100</span></div>` +
    (a.histogram.length ? bars(a.histogram.map((b) => ({ label: tm(b.from), v: b.n })), (v) => String(v)) : `<p class="hint">Needs a few more solves.</p>`) +
    `<p class="hint">DNF rate ${Math.round(a.allTime.dnfRate * 100)}%. A tighter spread means more consistent solves.</p></section></div>` +
    `<section class="panel"><div class="sec-h"><h2>Sessions</h2><span>Newest first</span></div><table class="ana-tbl sess"><thead><tr><th>Date</th><th>Solves</th><th>Best</th><th>${avgName}</th><th>Mean</th></tr></thead><tbody>` +
    a.sessions.slice(0, 15).map((x) => `<tr><td>${shortD(x.date)}</td><td>${x.solves}</td><td>${tm(x.best)}</td><td>${tm(x.avg)}</td><td>${tm(x.mean)}</td></tr>`).join("") +
    `</tbody></table></section>`
  );
}

/* ---------- chess ---------- */

const pctS = (r: Record3) => (r.games ? Math.round(r.score * 100) + "%" : "—");
const recBar = (r: Record3) =>
  r.games
    ? `<div class="rec-bar"><i class="w" style="flex:${r.win}"></i><i class="d" style="flex:${r.draw}"></i><i class="l" style="flex:${r.loss}"></i></div><small>${r.win}W ${r.draw}D ${r.loss}L · ${pctS(r)}</small>`
    : `<small>No games</small>`;
const RES: Record<GameResult, string> = { win: "W", draw: "D", loss: "L" };

function chessSection(p: Pursuit): string {
  const games = S.data.games.filter((g) => g.skill === p.id);
  const ratingLogs = S.data.practice.filter((l) => l.skill === p.id && l.value != null).map((l) => ({ date: l.date, value: l.value! }));
  const a = chessAnalytics(games, ratingLogs);
  const id = esc(p.id);
  const logBtn = `<button class="btn primary" type="button" data-act="g-new" data-id="${id}"><span class="ico">${ICON.plus}</span>Log game</button>`;
  if (!games.length)
    return `<section class="panel"><div class="sec-h"><h2>Games</h2></div>${empty("Log your games with a short review: the key moment and the lesson. Your record, rating trend and what keeps costing you games build up here.")}<div class="acts"><span class="grow"></span>${logBtn}</div></section>`;
  const sorted = [...games].sort((x, y) => y.date.localeCompare(x.date) || y.created - x.created);
  const gameById = new Map(games.map((g) => [g.date + g.myRating, g]));
  const t0 = a.rating.length ? parseD(a.rating[0].date).getTime() : 0;
  const ratingChart =
    a.rating.length >= 2
      ? lineChart({
          series: [
            { pts: a.rating.map((x) => ({ x: (parseD(x.date).getTime() - t0) / 864e5, y: x.value })), cls: "ln-main" },
            {
              pts: a.rating.map((x) => ({ x: (parseD(x.date).getTime() - t0) / 864e5, y: x.value })),
              cls: "dot-game",
              dots: true,
              dotCls: (i) => gameById.get(a.rating[i].date + a.rating[i].value)?.result || "",
            },
          ],
          fmtY: (v) => String(Math.round(v)),
          xLabels: [shortD(a.rating[0].date), shortD(a.rating[a.rating.length - 1].date)],
          goal: p.goal != null ? { y: p.goal, label: "goal " + p.goal } : null,
          H: 200,
          aria: "Rating over time",
        })
      : `<p class="hint">Add "your rating after" when you log games to draw your rating line.</p>`;
  const exp = a.vsExpected;
  const diff = exp ? Math.round((exp.actual - exp.expected) * 10) / 10 : 0;
  return (
    `<section class="panel ana-hero"><div class="ana-kpis">` +
    `<div><span>Rating</span><b>${a.current ?? "—"}</b>${a.change30 != null ? `<em class="${a.change30 >= 0 ? "up" : "down"}">${a.change30 >= 0 ? "+" : "−"}${Math.abs(a.change30)} · 30d</em>` : ""}</div>` +
    `<div><span>Peak</span><b>${a.peak ?? "—"}</b></div>` +
    `<div><span>Performance</span><b>${a.performance ?? "—"}</b></div>` +
    `<div><span>Score</span><b>${pctS(a.all)}</b></div></div>` +
    `<div class="form-row"><span>Last 10</span>${sorted.slice(0, 10).reverse().map((g) => `<i class="fr ${g.result}">${RES[g.result]}</i>`).join("")}${a.unbeaten > 1 ? `<small>${a.unbeaten} unbeaten</small>` : ""}</div>` +
    `<div class="acts"><span class="grow"></span>${logBtn}</div></section>` +
    `<section class="panel"><div class="sec-h"><h2>Rating</h2><span>${a.rating.length} points</span></div>${ratingChart}<div class="ana-legend"><span class="lg-w">Win</span><span class="lg-d">Draw</span><span class="lg-l">Loss</span></div></section>` +
    `<div class="duo">` +
    `<section class="panel"><div class="sec-h"><h2>Record</h2><span>${a.all.games} games</span></div>` +
    `<div class="rec"><b>All</b>${recBar(a.all)}</div><div class="rec"><b>White</b>${recBar(a.white)}</div><div class="rec"><b>Black</b>${recBar(a.black)}</div>` +
    a.byControl.map((c) => `<div class="rec"><b>${esc(c.label)}</b>${recBar(c.rec)}</div>`).join("") +
    (exp ? `<p class="hint">Against Elo expectation (${exp.games} games): you scored ${exp.actual} vs ${exp.expected} expected, <b class="${diff >= 0 ? "pos" : "neg"}">${diff >= 0 ? "+" : ""}${diff}</b>. Performance rating ${a.performance ?? "—"} is avg opponent + 400 × (wins − losses) ÷ games.</p>` : "") +
    `</section>` +
    `<section class="panel"><div class="sec-h"><h2>Game reviews</h2><span>${a.reviewed}/${a.all.games} reviewed</span></div>` +
    (a.accuracy.length >= 2
      ? lineChart({ series: [{ pts: a.accuracy.map((x, i) => ({ x: i, y: x.value })), cls: "ln-acc" }, { pts: a.accuracy.map((x, i) => ({ x: i, y: x.value })), cls: "dot-acc", dots: true }], fmtY: (v) => Math.round(v) + "%", H: 140, aria: "Accuracy per reviewed game" })
      : `<p class="hint">Add the accuracy from your chess.com or Lichess game review to track it here.</p>`) +
    `<div class="ana-kpis sm"><div><span>Avg accuracy</span><b>${a.avgAccuracy != null ? a.avgAccuracy + "%" : "—"}</b></div>` +
    (a.errors ? `<div><span>Blunders/game</span><b class="neg">${a.errors.blunders}</b></div><div><span>Mistakes/game</span><b>${a.errors.mistakes}</b></div><div><span>Inaccur./game</span><b>${a.errors.inaccuracies}</b></div>` : "") +
    `</div></section></div>` +
    (a.lessons.length ? `<section class="panel"><div class="sec-h"><h2>Your lessons</h2><span>From your reviews</span></div><ul class="lessons">${a.lessons.map((l) => `<li><time>${shortD(l.date)}</time>${esc(l.text)}</li>`).join("")}</ul></section>` : "") +
    (a.openings.length ? `<section class="panel"><div class="sec-h"><h2>Openings</h2><span>Most played</span></div>${a.openings.map((o) => `<div class="rec"><b>${esc(o.name)}</b>${recBar(o.rec)}</div>`).join("")}</section>` : "") +
    `<section class="sec"><div class="sec-h"><h2>Games</h2><span>Tap to review</span></div><div class="list">${sorted.slice(0, 30).map(gameRow).join("")}</div></section>`
  );
}

function gameRow(g: ChessGame): string {
  const sub = [g.colour ? (g.colour === "white" ? "White" : "Black") : "", CONTROLS.find((c) => c.id === g.control)?.label, g.opening, g.oppRating ? `vs ${g.opponent || "?"} (${g.oppRating})` : g.opponent ? `vs ${g.opponent}` : ""].filter(Boolean).join(" · ");
  const rev = g.lesson || g.keyMoment;
  return (
    `<button class="row-i game" type="button" data-act="edit-g" data-id="${esc(g.id)}" style="--cc:var(--${g.result === "win" ? "good" : g.result === "loss" ? "bad" : "meh"})">${dayBox(g.date)}` +
    `<span class="t"><div><i class="fr ${g.result}">${RES[g.result]}</i> ${esc(sub)}</div><div>${rev ? "📝 " + esc(rev) : '<span class="soon">No review yet</span>'}</div></span>` +
    `<span class="v">${g.myRating ?? ""}${g.accuracy != null ? `<small class="cc">${g.accuracy}%</small>` : ""}</span></button>`
  );
}

/* ---------- game sheet ---------- */

let forSkill: string | null = null;
export const gameFor = (id: string) => (forSkill = id);

function lastRating(skill: string): number | null {
  const pts = [...gamePoints(S.data.games, skill), ...S.data.practice.filter((l) => l.skill === skill && l.value != null)].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  return pts.length ? pts[pts.length - 1].value : null;
}

function syncGame() {
  const g = { keyMoment: val("g-key"), lesson: val("g-lesson") };
  $("g-xp").textContent = `+${gameXp(g)} XP${gameXp(g) === PRACTICE.gameXp ? ` · write the key moment or a lesson for +${PRACTICE.reviewXp} more` : " · reviewed"}`;
  const me = lastRating(forSkill || "");
  const opp = +val("g-oppr");
  $("g-exp").textContent = me && opp ? `Elo expected your score at ${Math.round(expectedScore(me, opp) * 100)}% (you ${me} vs ${opp}).` : "";
}

export function fillGame(g: ChessGame | null): void {
  if (g) forSkill = g.skill;
  $("g-h").textContent = g ? "Edit game" : "Log game";
  $("g-save").textContent = g ? "Save" : "Log it";
  $("g-control").innerHTML = CONTROLS.map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
  $("g-self").innerHTML = [1, 2, 3, 4, 5].map((n) => `<input type="radio" name="gself" id="gs-${n}" value="${n}"><label for="gs-${n}">${n}</label>`).join("");
  const prev = [...S.data.games].filter((x) => x.skill === forSkill).sort((a, b) => b.created - a.created)[0];
  $("g-openings").innerHTML = [...new Set(S.data.games.map((x) => x.opening).filter(Boolean))].map((o) => `<option value="${esc(o)}">`).join("");
  radio("gres", g?.result || "win");
  document.querySelectorAll<HTMLInputElement>('input[name="gcol"]').forEach((i) => (i.checked = false));
  if (g?.colour) radio("gcol", g.colour);
  setVal("g-date", g?.date || dkey());
  setVal("g-control", g?.control || prev?.control || "rapid");
  setVal("g-opening", g?.opening || "");
  setVal("g-opp", g?.opponent || "");
  setVal("g-oppr", g?.oppRating ?? "");
  setVal("g-myr", g?.myRating ?? "");
  $<HTMLInputElement>("g-rated").checked = g ? g.rated : prev ? prev.rated : true;
  setVal("g-acc", g?.accuracy ?? "");
  setVal("g-bl", g?.blunders ?? "");
  setVal("g-mi", g?.mistakes ?? "");
  setVal("g-in", g?.inaccuracies ?? "");
  if (g?.selfRating) radio("gself", String(g.selfRating));
  setVal("g-key", g?.keyMoment || "");
  setVal("g-lesson", g?.lesson || "");
  setVal("g-link", g?.link || "");
  syncGame();
}

function saveGame(close: () => void) {
  const p = byId(forSkill);
  if (!p) return;
  const prev = S.data.games.find((x) => x.id === S.editId) || null;
  const before = skillSummary(p, S.data.practice, undefined, S.data.games);
  const rankBefore = standardStatus(p, before.best?.value);
  const g = normalizeGame({
    id: prev?.id || newId(),
    skill: p.id,
    created: prev?.created || Date.now(),
    date: val("g-date") || dkey(),
    result: (radioVal("gres") as GameResult) || "win",
    colour: (radioVal("gcol") as ChessGame["colour"]) || null,
    control: val("g-control") as ChessGame["control"],
    rated: $<HTMLInputElement>("g-rated").checked,
    opening: val("g-opening"),
    opponent: val("g-opp"),
    oppRating: val("g-oppr") as unknown as number,
    myRating: val("g-myr") as unknown as number,
    accuracy: val("g-acc") as unknown as number,
    blunders: val("g-bl") as unknown as number,
    mistakes: val("g-mi") as unknown as number,
    inaccuracies: val("g-in") as unknown as number,
    selfRating: (radioVal("gself") || null) as unknown as number,
    keyMoment: val("g-key"),
    lesson: val("g-lesson"),
    link: val("g-link"),
  });
  // A new best rating counts as a PB, the same as a logged result.
  const pb = isPb(g.myRating, [...S.data.practice.filter((l) => l.skill === p.id), ...gamePoints(S.data.games, p.id)], p.metric, g.id);
  g.xp = gameXp(g) + (pb ? PRACTICE.pbXp : 0);
  put("games", g);
  const diff = g.xp - (prev?.xp || 0);
  if (diff) award({ delta: diff, title: `${p.name} game`, cat: p.cat });
  const now = skillSummary(p, S.data.practice, undefined, S.data.games);
  const rankNow = standardStatus(p, now.best?.value);
  const msgs: string[] = [];
  if (pb && p.metric) msgs.push(`New peak rating: ${fmtValue(g.myRating, p.metric, p.standard)}`);
  if (rankNow.index > rankBefore.index && rankNow.current) msgs.push(`${p.standard!.name}: you're now ${rankNow.current.name}`);
  if (!prev && g.result === "loss" && (g.lesson || g.keyMoment)) msgs.push("Reviewing a loss is how ratings climb.");
  msgs.forEach((m, i) => setTimeout(() => toast(m, "xp"), 900 + i * 1600));
  close();
  render();
  after();
}

export function deleteGame(id: string): void {
  const g = S.data.games.find((x) => x.id === id);
  if (!g) return;
  const p = byId(g.skill);
  if (g.xp) award({ delta: -g.xp, title: p?.name || "Game", cat: p?.cat || PRACTICE.cat, quiet: true });
  drop("games", id);
  toast("Game deleted");
}

export function initGames(close: () => void): void {
  ["g-key", "g-lesson", "g-oppr"].forEach((id) => $(id).addEventListener("input", syncGame));
  $("f-game").addEventListener("submit", (e) => {
    e.preventDefault();
    saveGame(close);
  });
}
