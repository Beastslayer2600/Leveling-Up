/* Motion layer: floating XP, confetti bursts and the sliding tab indicator.
   Everything animates transform and opacity only, and backs off under reduced motion. */

const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
export const reduced = (): boolean => !!mq?.matches;

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";

/* Remember where the last tap landed, so rewards rise from the thing that earned them. */
let last = { x: 0, y: 0, t: 0 };
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (e) => (last = { x: e.clientX, y: e.clientY, t: Date.now() }),
    { capture: true, passive: true },
  );
}

function origin(): { x: number; y: number } {
  if (Date.now() - last.t < 4000 && last.x) return { x: last.x, y: last.y };
  const hud = document.querySelector(".xpbar")?.getBoundingClientRect();
  if (hud && hud.width) return { x: hud.left + hud.width / 2, y: hud.top };
  return { x: innerWidth / 2, y: innerHeight / 3 };
}

function layer(): HTMLElement {
  let el = document.getElementById("fxl");
  if (!el) {
    el = document.createElement("div");
    el.id = "fxl";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
  }
  return el;
}

/* ---------- floating +XP ---------- */
let pending = 0;
let flushT: ReturnType<typeof setTimeout> | undefined;

/** Float "+N XP" up from the last tap. Rapid gains within 120ms merge into one number. */
export function floatXp(n: number): void {
  if (!n || typeof document === "undefined") return;
  pending += n;
  clearTimeout(flushT);
  flushT = setTimeout(() => {
    const v = pending;
    pending = 0;
    const { x, y } = origin();
    const el = document.createElement("div");
    el.className = "xpf" + (v < 0 ? " neg" : "");
    el.textContent = `${v > 0 ? "+" : ""}${v} XP`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    layer().appendChild(el);
    const a = reduced()
      ? el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: 900, easing: "linear" })
      : el.animate(
          [
            { opacity: 0, transform: "translate(-50%, -30%) scale(0.95)" },
            { opacity: 1, transform: "translate(-50%, -110%) scale(1)", offset: 0.25 },
            { opacity: 0, transform: "translate(-50%, -260%) scale(1)" },
          ],
          { duration: 900, easing: EASE_OUT },
        );
    a.onfinish = () => el.remove();
    if (v > 0 && !reduced()) ring(x, y);
    bumpHud();
  }, 120);
}

/** A thin gold ring expanding from the tap point: the "it registered" beat. */
function ring(x: number, y: number): void {
  const el = document.createElement("i");
  el.className = "fxring";
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  layer().appendChild(el);
  el.animate(
    [
      { opacity: 0.9, transform: "translate(-50%, -50%) scale(0.95)" },
      { opacity: 0, transform: "translate(-50%, -50%) scale(2.4)" },
    ],
    { duration: 420, easing: EASE_OUT },
  ).onfinish = () => el.remove();
}

/** Give the XP bar a short glow so the eye follows the reward to where it landed. */
function bumpHud(): void {
  const bar = document.querySelector<HTMLElement>(".xpbar");
  if (!bar) return;
  bar.classList.remove("bump");
  void bar.offsetWidth;
  bar.classList.add("bump");
}

/* ---------- confetti ---------- */
const COLORS = ["#ffd47a", "#f5b942", "#fff3d4", "#5f8cf2", "#b897f5", "#4fd1a5"];

/**
 * A burst of shards from (x, y). Reserved for rare moments: level-up, achievements,
 * finishing a focus session. Skipped entirely under reduced motion.
 */
export function confetti(opts: { x?: number; y?: number; count?: number; spread?: number } = {}): void {
  if (typeof document === "undefined" || reduced()) return;
  const x = opts.x ?? innerWidth / 2;
  const y = opts.y ?? innerHeight / 2;
  const count = Math.min(opts.count ?? 36, 60);
  const spread = opts.spread ?? 1;
  const host = layer();
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    p.className = "shard";
    const c = COLORS[i % COLORS.length];
    p.style.background = c;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    if (i % 3 === 0) p.style.borderRadius = "50%";
    host.appendChild(p);
    const ang = Math.random() * Math.PI * 2;
    const dist = (80 + Math.random() * 180) * spread;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist - 60 * spread;
    const rot = (Math.random() - 0.5) * 720;
    const dur = 900 + Math.random() * 600;
    p.animate(
      [
        { transform: "translate(-50%, -50%) scale(0.95) rotate(0deg)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 140}px)) scale(0.95) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: dur, easing: EASE_OUT, delay: Math.random() * 60 },
    ).onfinish = () => p.remove();
  }
}

/** Confetti from wherever the user last tapped (or the screen centre). */
export function confettiHere(count = 28): void {
  const { x, y } = origin();
  confetti({ x, y, count, spread: 0.8 });
}

/* ---------- sliding tab indicator ---------- */
const placed = new WeakSet<HTMLElement>();

/** Move each nav's indicator under its selected tab. Sets transform on the indicator itself. */
export function moveIndicators(): void {
  if (typeof document === "undefined") return;
  for (const nav of document.querySelectorAll<HTMLElement>("#tabbar, #rail-nav")) {
    const ind = nav.querySelector<HTMLElement>(".tab-ind");
    const sel = nav.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!ind) continue;
    if (!sel || !sel.offsetWidth) {
      ind.style.opacity = "0";
      continue;
    }
    const first = !placed.has(ind);
    if (first) ind.style.transition = "none";
    ind.style.width = `${sel.offsetWidth}px`;
    ind.style.height = `${sel.offsetHeight}px`;
    ind.style.transform = `translate(${sel.offsetLeft}px, ${sel.offsetTop}px)`;
    ind.style.opacity = "1";
    if (first) {
      void ind.offsetWidth;
      ind.style.transition = "";
      placed.add(ind);
    }
  }
}

if (typeof window !== "undefined") {
  let raf = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(moveIndicators);
  });
}

export { EASE_OUT, EASE_IN_OUT };
