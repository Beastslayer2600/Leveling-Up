import { ACH } from "../lib/leveling/achievements";
import { ATTRS, SOC, VERD } from "../lib/leveling/data";
import { daysAgoKey, daysSince, dkey, parseD, weekStart, yday, zpad } from "../lib/leveling/dates";
import { closed, eff, isDone, kindLabel } from "../lib/leveling/missions";
import { e1rm, exSummary, pbMap } from "../lib/leveling/training";
import { RR_DAYS, VIRTUES, rrState, todayVirtue } from "../lib/leveling/virtues";
import { CAT, CATEGORY_BASE, CATS, PLAYER_BASE, levelOf, liveStreak, rankOf } from "../lib/leveling/xp";
import type { Quest } from "../lib/leveling/types";
import { journaledOn } from "../lib/leveling/journal";
import { renderJournal } from "./journal";
import { renderMode, sync } from "./sync";
import { $, ICON, cvar, dayBox, esc, fmtN, pct, rands, rands2, shortD, sumBy } from "./dom";
import { S, VIEWS, type Tab } from "./state";

export const TAB_META: Record<Tab, { label: string; sub: string; fab: string }> = {
  missions: { label: "Missions", sub: "Ops, quests, virtue", fab: "New mission" },
  journal: { label: "Journal", sub: "Debrief and voice notes", fab: "Record" },
  body: { label: "Body", sub: "Training, fuel, steps", fab: "Log training" },
  social: { label: "Social", sub: "Posts and people", fab: "Log social" },
  money: { label: "Money", sub: "Ledger and calls", fab: "Log money" },
  character: { label: "Character", sub: "Sheet and trophies", fab: "Add skill" },
};

export const coachEnabled = () => sync.mode === "server";

export function renderNav(): void {
  $("rail-nav").innerHTML = VIEWS.map(
    (v) =>
      `<button class="navi" type="button" role="tab" data-tab="${v}" aria-selected="${S.tab === v}">${ICON[v]}<span><b>${TAB_META[v].label}</b><small>${TAB_META[v].sub}</small></span></button>`,
  ).join("");
  $("tabbar").innerHTML = VIEWS.map(
    (v) => `<button class="tab" type="button" role="tab" data-tab="${v}" aria-selected="${S.tab === v}">${ICON[v]}<span>${TAB_META[v].label}</span></button>`,
  ).join("");
}

export function render(): void {
  const st = S.data.stats;
  const L = levelOf(st.xp, PLAYER_BASE);
  const t = dkey();
  const name = S.data.sheet.name.trim();
  $("pname").textContent = name || "Player";
  $("hud-kicker").textContent = name ? "Player one" : "Set your name in Character";
  $("lv").textContent = String(L.level);
  $("rank").textContent = rankOf(L.level);
  $("xpin").textContent = fmtN(L.into);
  $("xpneed").textContent = fmtN(L.need);
  $("xpbar").style.width = pct(L.into, L.need) + "%";
  $("xptotal").textContent = `${fmtN(st.xp)} XP total`;
  const ring = $("ring") as unknown as SVGCircleElement;
  const circ = 2 * Math.PI * 45;
  ring.style.strokeDasharray = `${circ}`;
  ring.style.strokeDashoffset = `${circ * (1 - L.into / L.need)}`;
  $("streak").textContent = liveStreak(st) + "d";
  $("today").textContent = "+" + (st.dayKey === t ? st.dayXp : 0);
  $("achn").textContent = `${Object.keys(st.ach).filter((k) => ACH.some((a) => a.id === k)).length}/${ACH.length}`;

  document.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)));
  VIEWS.forEach((v) => ($("v-" + v).hidden = S.tab !== v));
  $("fabLbl").textContent = TAB_META[S.tab].fab;
  if (sync.mode === "server") renderMode();
  else $("mode").innerHTML = `<span class="dot-live local"></span>Saved on this device only. Sign in from Character to sync.`;
  $("p-signin").hidden = sync.mode === "server";

  renderHudSide();
  ({ missions: renderMissions, journal: renderJournal, body: renderBody, social: renderSocial, money: renderMoney, character: renderCharacter })[S.tab]();
}

function logRows(): string {
  const t = dkey();
  return S.data.stats.log
    .slice(0, 8)
    .map((e) => {
      const d = new Date(e.t);
      const when = dkey(d) === t ? `${zpad(d.getHours())}:${zpad(d.getMinutes())}` : d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
      return `<div><time>${when}</time><span style="--cc:${CAT[e.cat] ? cvar(e.cat) : "var(--gold)"}">${esc(e.title)}</span><b>+${e.xp}</b></div>`;
    })
    .join("");
}

function renderHudSide(): void {
  const st = S.data.stats;
  $("hud-cats").innerHTML = CATS.map((c) => {
    const L = levelOf(st.cat[c.id] || 0, CATEGORY_BASE);
    return `<div class="cl" style="--cc:var(${c.v})"><span class="cl-n"><i></i>${c.name}</span><span class="cl-lv">LV${L.level}</span><div class="meter thin"><i style="width:${pct(L.into, L.need)}%"></i></div></div>`;
  }).join("");
  const rows = logRows();
  $("hud-log").innerHTML = rows || `<p class="empty-s">Earn XP and it shows up here.</p>`;
}

/* ---------- missions ---------- */

function card(q: Quest): string {
  const done = isDone(q);
  const c = CAT[q.cat] || CAT.side;
  const id = esc(q.id);
  const meta = `<div class="meta"><span class="cat">${esc(c.name)}</span><span>${kindLabel(q)}</span>${dueBit(q)}${q.starter ? '<span class="tag">Starter</span>' : ""}${q.coach ? '<span class="tag">Coach</span>' : ""}</div>`;
  const body = `<button class="q-body" type="button" data-act="edit-q" data-id="${id}"><div class="q-title">${esc(q.title)}</div>${q.note ? `<div class="q-note">${esc(q.note)}</div>` : ""}${meta}</button>`;
  let left: string;
  let extra = "";
  if (q.kind === "counter") {
    const p = eff(q);
    const t = q.target || 1;
    left = `<span class="tick ctr-ring" aria-hidden="true" style="--p:${pct(p, t)}"><i></i></span>`;
    extra = `<div class="ctr"><button class="step" type="button" data-act="minus" data-id="${id}" aria-label="Remove one">−</button><div class="meter"><i style="width:${pct(p, t)}%"></i></div><span class="ctr-n">${p}<em> / ${t}</em></span><button class="step plus" type="button" data-act="plus" data-id="${id}" aria-label="Add one">+1</button></div>`;
  } else {
    left = `<button class="tick" type="button" data-act="toggle" data-id="${id}" aria-pressed="${done}" aria-label="${done ? "Mark not done" : "Complete"}"><i></i></button>`;
  }
  return `<div class="q${done ? " done" : ""}" style="--cc:${cvar(q.cat)}">${left}${body}<span class="xp">+${q.xp}${q.kind === "counter" ? "<small>/step</small>" : "<small>XP</small>"}</span>${extra}</div>`;
}

function dueBit(q: Quest): string {
  if (!q.due || isDone(q)) return "";
  const days = -daysSince(q.due);
  if (days < 0) return `<span class="over">Overdue ${-days}d</span>`;
  if (days === 0) return '<span class="soon">Due today</span>';
  if (days === 1) return '<span class="soon">Due tomorrow</span>';
  return `<span>Due ${parseD(q.due).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })}</span>`;
}

function renderMissions(): void {
  const { stats: st, quests } = S.data;
  const vs = st.virtue;
  const doneV = vs.last === dkey();
  const v = todayVirtue(new Date(), S.vSwap);
  const shown = doneV && vs.name ? VIRTUES.find((x) => x.n === vs.name) || v : v;
  $("v-name").textContent = shown.n;
  $("v-ref").textContent = shown.r + (shown.fruit ? " · Fruit of the Spirit" : "");
  $("v-principle").textContent = shown.p;
  $("v-task").textContent = shown.t;
  const vb = $<HTMLButtonElement>("v-done");
  vb.disabled = doneV;
  vb.textContent = doneV ? "Completed today" : "Done · +20 XP";
  $("v-swap").hidden = doneV;
  $("v-streak").textContent =
    `${vs.count || 0} done` + ((vs.last === dkey() || vs.last === yday()) && (vs.streak || 0) > 1 ? ` · ${vs.streak}d run` : "");
  renderRelease();
  $("j-nudge").hidden = journaledOn(S.data.journal);

  const counts: Record<string, number> = {};
  quests.forEach((q) => { if (!isDone(q)) counts[q.cat] = (counts[q.cat] || 0) + 1; });
  let ch = `<button class="chip" type="button" data-act="filter" data-cat="all" aria-pressed="${S.filter === "all"}"><span class="dot"></span>All</button>`;
  for (const c of CATS) {
    const lv = levelOf(st.cat[c.id] || 0, CATEGORY_BASE).level;
    ch += `<button class="chip" type="button" data-act="filter" data-cat="${c.id}" style="--cc:var(${c.v})" aria-pressed="${S.filter === c.id}"><span class="dot"></span>${c.name}<span class="lv">LV${lv}${counts[c.id] ? " · " + counts[c.id] : ""}</span></button>`;
  }
  $("chips").innerHTML = ch;

  $("coach").hidden = !coachEnabled();
  $("c-list").innerHTML = S.data.coach.items
    .map(
      (s, i) =>
        `<div class="sug" style="--cc:${cvar(s.cat)}"><div class="sug-b"><div class="q-title">${esc(s.title)}</div>${s.why ? `<div class="q-note">${esc(s.why)}</div>` : ""}<div class="meta"><span class="cat">${esc((CAT[s.cat] || CAT.mind).name)}</span><span>${s.kind === "daily" ? "Daily" : s.kind === "counter" ? `${s.target}× ${s.period === "week" ? "weekly" : s.period === "month" ? "monthly" : "total"}` : "Quest"}</span><span class="gold">+${s.xp} XP</span></div></div><div class="sug-acts"><button class="mini go" type="button" data-act="c-accept" data-i="${i}">Accept</button><button class="mini" type="button" data-act="c-skip" data-i="${i}">Skip</button></div></div>`,
    )
    .join("");

  const fq = quests.filter((q) => S.filter === "all" || q.cat === S.filter);
  const n = (b: boolean) => (b ? 1 : 0);
  const daily = fq.filter((q) => q.kind === "daily").sort((a, b) => n(isDone(a)) - n(isDone(b)) || a.created - b.created);
  const active = fq
    .filter((q) => q.kind !== "daily" && !closed(q))
    .sort((a, b) => n(isDone(a)) - n(isDone(b)) || (a.due || "9999").localeCompare(b.due || "9999") || a.created - b.created);
  const done = fq.filter((q) => closed(q)).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const none = !quests.length;

  $("daily").innerHTML = daily.length
    ? daily.map(card).join("")
    : empty(none ? "Your mission log is empty. Add a daily op, like inbox zero or a 10-minute walk." : "No daily ops in this category.");
  const dd = daily.filter((q) => isDone(q)).length;
  $("dailyCount").innerHTML = daily.length ? `<b class="gold">${dd}/${daily.length}</b> · resets at midnight` : "Resets at midnight";
  $("active").innerHTML = active.length
    ? active.map(card).join("")
    : empty(none ? "Quests and tracked targets land here: client meetings, adjudication bookings, side projects." : "No active quests here. Add one with New mission.");
  $("activeCount").textContent = active.length ? `${active.length} open` : "";
  $("doneSec").hidden = !done.length;
  $("done").innerHTML = done.slice(0, 15).map(card).join("");
  const cd = $("clearDone");
  cd.textContent = S.armClear ? `Tap again to clear ${done.length}` : "Clear completed";
  cd.classList.toggle("arm", S.armClear);
  const rows = logRows();
  $("logSec").hidden = !rows;
  $("log").innerHTML = rows;
}

const empty = (msg: string, extra = "") => `<div class="empty"${extra}>${esc(msg)}</div>`;

function renderRelease(): void {
  const rel = S.data.release;
  const r = rrState(rel);
  $("rr-count").textContent = `${r.count}/7` + (rel.cycles > 0 ? ` · run ${rel.cycles + 1}` : "");
  $("rr-pips").innerHTML = RR_DAYS.map((_, i) => `<i class="${r.days[i + 1] ? "on" : i + 1 === r.cur ? "cur" : ""}"></i>`).join("");
  if (r.cur > 7) {
    $("rr-day").innerHTML =
      '<b>All seven days complete</b><p>You can care deeply and still open your hand. Keep the reach-back tool and your release plan close, and run the reset again whenever you need it.</p><div><button class="btn ghost" type="button" data-act="rr-restart">Start again</button></div>';
    return;
  }
  const d = RR_DAYS[r.cur - 1];
  $("rr-day").innerHTML =
    `<div class="rr-dh"><span class="rr-n">Day ${r.cur}</span><b>${esc(d.t)}</b></div><span class="ref">${esc(d.r)}</span><p>${esc(d.p)}</p>` +
    `<div class="rr-acts">${r.open ? `<button class="btn faith" type="button" data-act="rr-done">Complete day ${r.cur} · +30 XP</button>` : `<span class="hint">Day ${r.cur} opens tomorrow. Rest with yesterday's step today.</span>`}${d.commit ? '<button class="btn ghost" type="button" data-act="rr-commit">Add as 30-day mission</button>' : ""}</div>`;
}

/* ---------- body ---------- */

const dayDoc = (k: string) => S.data.days.find((d) => d.id === k) || null;

function renderBody(): void {
  const { sheet, meals, workouts, days } = S.data;
  const t = dkey();
  const today = dayDoc(t);
  const goal = sheet.stepGoal || 10000;
  const steps = today?.steps ?? null;
  $("b-steps").innerHTML = `${steps != null ? fmtN(steps) : "—"} <small>/ ${fmtN(goal)}</small>`;
  $("b-stepm").style.width = pct(steps || 0, goal) + "%";
  $("b-stepm").classList.toggle("good", (steps || 0) >= goal);
  const ws = days.filter((d) => d.weight).sort((a, b) => a.date.localeCompare(b.date));
  const lastW = ws[ws.length - 1];
  $("b-weight").innerHTML = lastW
    ? `${(+lastW.weight!).toFixed(1)} <small>kg${lastW.date !== t ? " · " + shortD(lastW.date) : ""}</small>`
    : "— <small>kg</small>";

  const mealsT = meals.filter((m) => m.date === t).sort((a, b) => a.created - b.created);
  const kcal = sumBy(mealsT, (m) => m.kcal);
  const prot = sumBy(mealsT, (m) => m.protein);
  const tgt = +(sheet.kcalTarget || 0);
  $("b-fuel").textContent = (kcal ? `${fmtN(kcal)}${tgt ? " / " + fmtN(tgt) : ""} kcal` : "") + (prot ? ` · ${fmtN(prot)}g protein` : "");
  $("b-kcalbar").hidden = !tgt;
  $("b-kcal").style.width = tgt ? pct(kcal, tgt) + "%" : "0%";
  $("b-meals").innerHTML = mealsT.length
    ? mealsT
        .map(
          (m) =>
            `<button class="row-i" type="button" data-act="edit-f" data-id="${esc(m.id)}"><span class="d tag-d">${esc(m.meal)}</span><span class="t"><div>${esc(m.what)}</div><div>${m.src === "home" ? "Home-made" : "Bought"}${m.protein ? ` · ${m.protein}g protein` : ""}</div></span><span class="v">${m.kcal ? `${fmtN(m.kcal)}<small>kcal</small>` : ""}</span></button>`,
        )
        .join("")
    : empty("No meals logged today. Log what you eat to see your fuel add up.");

  const days7: { k: string; s: number | null }[] = [];
  for (let i = 6; i >= 0; i--) {
    const k = daysAgoKey(i);
    const d = dayDoc(k);
    days7.push({ k, s: d && d.steps != null ? +d.steps : null });
  }
  const mx = Math.max(goal, ...days7.map((d) => d.s || 0));
  const logged = days7.filter((d) => d.s != null);
  $("b-stepavg").textContent = logged.length ? `avg ${fmtN(sumBy(logged, (d) => d.s) / logged.length)}` : "";
  const goalY = 100 - (goal / mx) * 100;
  $("b-stepbars").innerHTML =
    `<span class="goal-line" style="top:${goalY}%"><em>${fmtN(goal)}</em></span>` +
    days7
      .map(
        (d) =>
          `<div class="sb${d.k === t ? " today" : ""}"><small>${d.s != null ? (d.s >= 1000 ? (d.s / 1000).toFixed(1) + "k" : d.s) : ""}</small><div class="sb-track"><i class="${d.s != null && d.s >= goal ? "hit" : ""}${d.s == null ? " none" : ""}" style="height:${d.s ? Math.max(3, Math.round((d.s / mx) * 100)) : 3}%"></i></div><small class="sb-d">${parseD(d.k).toLocaleDateString("en-ZA", { weekday: "short" }).slice(0, 2)}</small></div>`,
      )
      .join("");

  renderWeightChart(ws.map((d) => ({ date: d.date, w: +d.weight! })), sheet.weightGoal);

  const wk = workouts.filter((w) => w.date >= weekStart());
  $("t-gym").textContent = String(wk.filter((w) => w.type === "gym").length);
  $("t-cardio").innerHTML = `${sumBy(wk.filter((w) => w.type === "cardio"), (w) => w.mins)}<small> min</small>`;
  $("t-lv").textContent = "LV" + levelOf(S.data.stats.cat.training || 0, CATEGORY_BASE).level;
  const pbs = Object.values(pbMap(workouts)).sort((a, b) => b.date.localeCompare(a.date));
  $("t-pbcount").textContent = pbs.length ? `${pbs.length} lifts` : "";
  $("t-pbs").innerHTML = pbs.length
    ? pbs
        .map(
          (p) =>
            `<div class="pb"><span>${esc(p.name)}</span><b>${p.best.kg ? `${p.best.kg}<em>kg × ${p.best.reps}</em>` : `${p.best.reps}<em> reps</em>`}</b><small>${p.best.kg ? `est. 1RM ${e1rm(p.best)}kg · ` : ""}${shortD(p.date)}</small></div>`,
        )
        .join("")
    : empty("Log a gym session and your best set for each lift shows up here. Beat it for a PB bonus.", ' style="grid-column:1/-1"');
  const list = [...workouts].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created).slice(0, 30);
  $("t-list").innerHTML = list.length
    ? list
        .map(
          (w) =>
            `<button class="row-i" type="button" data-act="edit-w" data-id="${esc(w.id)}" style="--cc:${w.type === "cardio" ? "var(--c-social)" : "var(--c-training)"}">${dayBox(w.date)}<span class="t"><div>${esc(w.type === "cardio" ? w.activity || "Cardio" : w.title || "Gym session")}</div><div>${esc(exSummary(w) || w.note || "")}</div></span><span class="v"><small class="cc">${w.type === "cardio" ? "Cardio" : "Gym"}</small>${w.pbs ? `<small class="gold">${w.pbs} PB</small>` : ""}</span></button>`,
        )
        .join("")
    : empty("No sessions logged yet. Tap Log training after your next gym or cardio session.");
  $("exlist").innerHTML = [...new Set(workouts.flatMap((w) => (w.ex || []).map((e) => e.name.trim())))]
    .map((n) => `<option value="${esc(n)}">`)
    .join("");
}

function renderWeightChart(all: { date: string; w: number }[], goalW: number | null): void {
  const pts = all.slice(-30);
  if (pts.length < 2) {
    $("b-wchart").innerHTML = empty(pts.length ? "One weigh-in logged. Log a few more days to see your trend." : "Log your weight to start your trend line.");
    $("b-wdelta").textContent = "";
    return;
  }
  const W = 340, H = 150, pl = 34, pr = 10, pt = 12, pb = 22;
  const vals = pts.map((p) => p.w);
  const gw = goalW ? +goalW : null;
  let lo = Math.min(...vals, gw ?? Infinity);
  let hi = Math.max(...vals, gw ?? -Infinity);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const t0 = parseD(pts[0].date).getTime();
  const span = Math.max(1, parseD(pts[pts.length - 1].date).getTime() - t0);
  const X = (d: string) => pl + ((parseD(d).getTime() - t0) / span) * (W - pl - pr);
  const Y = (v: number) => pt + ((hi - v) / (hi - lo)) * (H - pt - pb);
  const line = pts.map((p) => `${X(p.date).toFixed(1)},${Y(p.w).toFixed(1)}`).join(" ");
  const area = `M${X(pts[0].date).toFixed(1)},${H - pb} L${line.replace(/ /g, " L")} L${X(pts[pts.length - 1].date).toFixed(1)},${H - pb} Z`;
  const last = pts[pts.length - 1];
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight trend"><defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--c-training)" stop-opacity=".35"/><stop offset="1" stop-color="var(--c-training)" stop-opacity="0"/></linearGradient></defs>`;
  for (const v of [lo + pad, (lo + hi) / 2, hi - pad])
    svg += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="grid"/><text x="${pl - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${v.toFixed(1)}</text>`;
  if (gw)
    svg += `<line x1="${pl}" x2="${W - pr}" y1="${Y(gw).toFixed(1)}" y2="${Y(gw).toFixed(1)}" class="goal"/><text x="${W - pr}" y="${(Y(gw) - 5).toFixed(1)}" text-anchor="end" class="goal-t">goal ${gw}</text>`;
  svg += `<path d="${area}" fill="url(#wg)"/><polyline points="${line}" class="wline"/>`;
  svg += `<circle cx="${X(last.date).toFixed(1)}" cy="${Y(last.w).toFixed(1)}" r="4.5" class="wdot"/>`;
  svg += `<text x="${pl}" y="${H - 5}">${shortD(pts[0].date)}</text><text x="${W - pr}" y="${H - 5}" text-anchor="end">${shortD(last.date)}</text></svg>`;
  $("b-wchart").innerHTML = svg;
  const dl = last.w - pts[0].w;
  $("b-wdelta").textContent = `${dl >= 0 ? "+" : "−"}${Math.abs(dl).toFixed(1)} kg since ${shortD(pts[0].date)}`;
}

/* ---------- social ---------- */

function renderSocial(): void {
  const { social, stats } = S.data;
  const wk = social.filter((s) => s.date >= weekStart());
  $("s-ig").textContent = String(wk.filter((s) => s.kind === "ig").length);
  $("s-li").textContent = String(wk.filter((s) => s.kind === "li").length);
  $("s-irl").textContent = String(wk.filter((s) => s.kind === "irl" || s.kind === "event").length);
  const irl30 = social.filter((s) => (s.kind === "irl" || s.kind === "event") && s.date >= daysAgoKey(30)).length;
  $("s-standing").textContent =
    irl30 >= 8 ? "Social butterfly" : irl30 >= 5 ? "Well connected" : irl30 >= 2 ? "Low-key" : irl30 >= 1 ? "Warming up" : "Off the grid";
  $("s-30").textContent = String(irl30);
  $("s-bar").style.width = pct(irl30, 8) + "%";
  $("s-lv").textContent = "Social LV" + levelOf(stats.cat.social || 0, CATEGORY_BASE).level;

  const g: Record<string, { name: string; date: string }> = {};
  for (const s of social) {
    if (!s.group) continue;
    const k = s.group.trim().toLowerCase();
    if (!g[k] || s.date > g[k].date) g[k] = { name: s.group.trim(), date: s.date };
  }
  const groups = Object.values(g).sort((a, b) => a.date.localeCompare(b.date));
  $("s-groups").innerHTML = groups.length
    ? groups
        .map((x) => {
          const d = daysSince(x.date);
          const cls = d <= 10 ? "hot" : d <= 30 ? "cool" : "cold";
          const lbl = d === 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`;
          return `<div class="grp"><span class="av ${cls}">${esc(x.name.slice(0, 1).toUpperCase())}</span><b>${esc(x.name)}</b><span class="warm ${cls}">${lbl}</span></div>`;
        })
        .join("")
    : empty("Log a catch-up with a friend or group and they appear here, so you can see who you haven't seen in a while.", ' style="border:0"');
  $("grouplist").innerHTML = groups.map((x) => `<option value="${esc(x.name)}">`).join("");
  const list = [...social].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created).slice(0, 30);
  $("s-list").innerHTML = list.length
    ? list
        .map(
          (s) =>
            `<button class="row-i" type="button" data-act="edit-s" data-id="${esc(s.id)}" style="--cc:var(--c-social)">${dayBox(s.date)}<span class="t"><div>${esc(s.what)}</div><div>${esc([s.group, s.eng != null ? `${s.eng} engagement` : "", s.note].filter(Boolean).join(" · "))}</div></span><span class="v"><small class="cc">${SOC[s.kind].label}</small></span></button>`,
        )
        .join("")
    : empty("Nothing logged yet. Log posts, coffees, braais and networking events to grow your social level.");
}

/* ---------- money ---------- */

function renderMoney(): void {
  const mk = S.month;
  $("m-month").textContent = parseD(mk + "-01").toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  $<HTMLButtonElement>("m-next").disabled = mk >= dkey().slice(0, 7);
  const rows = S.data.money.filter((m) => (m.date || "").startsWith(mk));
  const tin = sumBy(rows.filter((m) => m.dir === "in"), (m) => m.amount);
  const outs = rows.filter((m) => m.dir === "out");
  const tout = sumBy(outs, (m) => m.amount);
  const net = tin - tout;
  $("m-in").textContent = rands(tin);
  $("m-out").textContent = rands(tout);
  $("m-net").textContent = (net < 0 ? "−" : "") + rands(net);
  $("m-net").className = net > 0 ? "pos" : net < 0 ? "neg" : "";
  const by = { good: 0, neutral: 0, bad: 0 };
  outs.forEach((m) => (by[m.verdict || "neutral"] += +m.amount || 0));
  const judged = by.good + by.bad;
  $("m-score").innerHTML = judged ? `<b class="pos">${Math.round((by.good / judged) * 100)}%</b> good calls` : "";
  const col = (k: string) => `var(--${k === "neutral" ? "meh" : k})`;
  $("m-split").innerHTML = tout
    ? (["good", "neutral", "bad"] as const).map((k) => `<i style="width:${(by[k] / tout) * 100}%;background:${col(k)}"></i>`).join("")
    : "";
  $("m-legend").innerHTML = (["good", "neutral", "bad"] as const)
    .map((k) => `<span><i style="background:${col(k)}"></i>${VERD[k]} <b>${rands(by[k])}</b></span>`)
    .join("");
  const cats: Record<string, number> = {};
  outs.forEach((m) => (cats[m.cat || "Other"] = (cats[m.cat || "Other"] || 0) + (+m.amount || 0)));
  const ce = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const max = ce.length ? ce[0][1] : 1;
  $("m-cats").innerHTML = ce.length
    ? ce.map(([k, v]) => `<div class="hbar"><span>${esc(k)}</span><div class="meter money"><i style="width:${(v / max) * 100}%"></i></div><b>${rands(v)}</b></div>`).join("")
    : empty("Spending by category shows here.");
  const list = [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
  $("m-list").innerHTML = list.length
    ? list
        .map(
          (m) =>
            `<button class="row-i" type="button" data-act="edit-m" data-id="${esc(m.id)}" style="--cc:${m.dir === "in" ? "var(--good)" : col(m.verdict || "neutral")}">${dayBox(m.date)}<span class="t"><div>${esc(m.what)}</div><div>${esc(m.cat || "")}${m.dir === "out" ? ` <span class="pill ${esc(m.verdict || "neutral")}">${VERD[m.verdict || "neutral"]}</span>` : ""}</div></span><span class="v ${m.dir === "in" ? "pos" : ""}">${m.dir === "in" ? "+" : "−"}${rands2(+m.amount || 0)}</span></button>`,
        )
        .join("")
    : empty("No money logged for this month. Log what comes in and what goes out, and mark each spend as a good or bad call.");
}

/* ---------- character ---------- */

function renderCharacter(): void {
  const { stats: st, sheet: sh } = S.data;
  $("ch-attrs").innerHTML = ATTRS.map((a) => {
    const L = levelOf(sumBy(a.cats, (c) => st.cat[c]), CATEGORY_BASE);
    return `<div class="attr" style="--cc:var(${a.v})"><span>${a.name}</span><div class="meter"><i style="width:${pct(L.into, L.need)}%"></i></div><b>LV${L.level}</b></div>`;
  }).join("");
  $("ch-chapter").innerHTML = sh.chapter.length
    ? sh.chapter.map((c) => `<button class="kv" type="button" data-act="edit-e" data-type="chapter" data-id="${esc(c.id)}"><span>${esc(c.label)}</span><b>${esc(c.value)}</b></button>`).join("")
    : empty("Where you are in life right now: role, base, season, main quest. Tap + Add.");
  const skills = [...sh.skills].sort((a, b) => (b.level || 0) - (a.level || 0));
  $("ch-skills").innerHTML = skills.length
    ? skills
        .map(
          (s) =>
            `<button class="skill" type="button" data-act="edit-e" data-type="skill" data-id="${esc(s.id)}"><b>${esc(s.name)}</b><span class="pips" aria-label="Level ${s.level} of 10">${Array.from({ length: 10 }, (_, i) => `<i class="${i < s.level ? "on" : ""}"></i>`).join("")}<span class="lvn">${s.level}</span></span>${s.note ? `<small>${esc(s.note)}</small>` : ""}</button>`,
        )
        .join("")
    : empty("Add the skills you have, from public speaking to Excel, and rate them 1 to 10.", ' style="grid-column:1/-1"');
  $("ch-feats").innerHTML = sh.feats.length
    ? sh.feats
        .map((f) => `<button class="feat" type="button" data-act="edit-e" data-type="feat" data-id="${esc(f.id)}"><span class="gem" aria-hidden="true"></span><span class="feat-t"><b>${esc(f.title)}</b>${f.detail ? `<small>${esc(f.detail)}</small>` : ""}</span></button>`)
        .join("")
    : empty("Rare feats and niche abilities that make you, you.", ' style="grid-column:1/-1"');
  const got = st.ach;
  const n = ACH.filter((a) => got[a.id]).length;
  $("ch-achn").innerHTML = `<b class="gold">${n}</b> / ${ACH.length} unlocked`;
  const ord = [...ACH].sort((a, b) => (got[b.id] ? 1 : 0) - (got[a.id] ? 1 : 0) || (a.hidden ? 1 : 0) - (b.hidden ? 1 : 0));
  $("ch-achs").innerHTML = ord
    .map((a) =>
      got[a.id]
        ? `<div class="ach on"><span class="ach-i">${ICON.trophy}</span><b>${esc(a.name)}</b><small>${esc(a.d)}</small><em>${new Date(got[a.id]).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}${a.hidden ? " · secret" : ""}</em></div>`
        : a.hidden
          ? `<div class="ach off secret"><span class="ach-i">?</span><b>???</b><small>Hidden achievement. Keep playing.</small></div>`
          : `<div class="ach off"><span class="ach-i">${ICON.trophy}</span><b>${esc(a.name)}</b><small>${esc(a.d)}</small></div>`,
    )
    .join("");
}
