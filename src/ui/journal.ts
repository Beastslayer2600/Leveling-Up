import { dkey, parseD } from "../lib/leveling/dates";
import { fmtSecs, journaledOn, journalStreak, journalXp, MOODS, todayPrompt } from "../lib/leveling/journal";
import type { JournalEntry } from "../lib/leveling/types";
import { $, ICON, dayBox, esc } from "./dom";
import { toast } from "./fx";
import { S, after, award, drop, newId, put, render } from "./state";
import { deleteVoiceRemote, fetchVoice, queueVoice } from "./sync";
import { canRecord, canTranscribe, delAudio, getAudio, putAudio, Recorder, Transcriber, type Recording } from "./voice";

const BARS = 32;
const TX_KEY = "leveling-up.transcribe";
const LANG_KEY = "leveling-up.txlang";

const draft = {
  mood: null as number | null,
  swap: 0,
  rec: null as Recording | null,
  url: "",
  recorder: null as Recorder | null,
  tx: null as Transcriber | null,
  levels: Array(BARS).fill(0) as number[],
  baseText: "",
};

const pref = (k: string, d: string) => {
  try { return localStorage.getItem(k) ?? d; } catch { return d; }
};
const setPref = (k: string, v: string) => {
  try { localStorage.setItem(k, v); } catch { /* optional */ }
};

const moodOf = (v: number | null) => MOODS.find((m) => m.v === v);

/* ---------- composer ---------- */

function paintWave() {
  $("j-wave").innerHTML = draft.levels.map((l) => `<i style="height:${Math.max(8, Math.round(l * 100))}%"></i>`).join("");
}

function setRecUi(state: "idle" | "rec" | "ready") {
  const box = $("j-rec");
  box.dataset.state = state;
  $("j-mic").setAttribute("aria-label", state === "rec" ? "Stop recording" : "Record a voice note");
  $("j-mic").querySelector(".ico")!.innerHTML = state === "rec" ? ICON.stop : ICON.mic;
  $("j-clip").hidden = state !== "ready";
  if (state === "idle") {
    $("j-time").textContent = "0:00";
    $("j-hint").textContent = canRecord() ? "Tap the mic and talk about your day" : "Voice notes aren't supported in this browser";
    draft.levels.fill(0);
    paintWave();
  }
}

async function startRecording() {
  if (!canRecord()) return toast("Voice notes aren't supported in this browser.");
  discardClip();
  const rec = new Recorder(
    (level, secs) => {
      draft.levels.push(level);
      draft.levels.shift();
      paintWave();
      $("j-time").textContent = fmtSecs(secs);
    },
    () => { toast("That's 5 minutes. Saving the note."); void stopRecording(); },
  );
  try {
    await rec.start();
  } catch {
    return toast("Microphone blocked. Allow it in your browser's site settings.");
  }
  draft.recorder = rec;
  setRecUi("rec");
  $("j-hint").textContent = "Listening… tap again to stop";
  navigator.vibrate?.(15);

  if (($("j-tx") as HTMLInputElement).checked && canTranscribe()) {
    const ta = $("j-text") as HTMLTextAreaElement;
    draft.baseText = ta.value.trim();
    draft.tx = new Transcriber(
      pref(LANG_KEY, "en-ZA"),
      (fin, interim) => {
        const spoken = (fin + (interim ? " " + interim : "")).trim();
        ta.value = draft.baseText + (draft.baseText && spoken ? "\n\n" : "") + spoken;
      },
      (msg) => toast(msg),
    );
    draft.tx.start();
  }
}

async function stopRecording() {
  const rec = draft.recorder;
  if (!rec) return;
  draft.recorder = null;
  draft.tx?.stop();
  draft.tx = null;
  const r = await rec.stop();
  navigator.vibrate?.(10);
  if (!r || r.secs < 0.8) {
    setRecUi("idle");
    if (r) toast("Too short to keep. Hold on a little longer.");
    return;
  }
  draft.rec = r;
  draft.url = URL.createObjectURL(r.blob);
  ($("j-audio") as HTMLAudioElement).src = draft.url;
  setRecUi("ready");
  $("j-time").textContent = fmtSecs(r.secs);
  $("j-hint").textContent = "Voice note ready. Add a few words or save it as is.";
}

function discardClip() {
  if (draft.url) URL.revokeObjectURL(draft.url);
  draft.url = "";
  draft.rec = null;
  ($("j-audio") as HTMLAudioElement).removeAttribute("src");
  setRecUi("idle");
}

async function saveEntry() {
  if (draft.recorder) await stopRecording();
  const text = ($("j-text") as HTMLTextAreaElement).value.trim();
  if (!text && !draft.rec) return toast("Say or write something first.");
  const today = dkey();
  const id = newId();
  if (draft.rec) {
    try {
      await putAudio(id, draft.rec.blob);
    } catch {
      return toast("Couldn't store the voice note on this device. Storage may be full.");
    }
  }
  const xp = journalXp(S.data.journal, today);
  const e: JournalEntry = {
    id,
    date: today,
    created: Date.now(),
    prompt: todayPrompt(new Date(), draft.swap),
    text,
    mood: draft.mood,
    audio: draft.rec ? { mime: draft.rec.mime, secs: draft.rec.secs } : null,
    xp,
  };
  put("journal", e);
  if (draft.rec) queueVoice(id);
  if (xp) award({ delta: xp, title: "Daily debrief", cat: "mind" });
  else toast("Entry saved");
  ($("j-text") as HTMLTextAreaElement).value = "";
  draft.mood = null;
  discardClip();
  render();
  after();
}

export function initJournal(): void {
  $("j-moods").innerHTML = MOODS.map(
    (m) => `<button class="mood" type="button" role="radio" aria-checked="false" data-mood="${m.v}"><span class="me">${m.emoji}</span><span>${m.label}</span></button>`,
  ).join("");
  $("j-moods").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-mood]");
    if (!b) return;
    const v = +b.dataset.mood!;
    draft.mood = draft.mood === v ? null : v;
    paintMoods();
  });
  $("j-swap").addEventListener("click", () => {
    draft.swap = (draft.swap + 1) % 12;
    $("j-prompt").textContent = todayPrompt(new Date(), draft.swap);
  });
  $("j-mic").addEventListener("click", () => (draft.recorder ? stopRecording() : startRecording()));
  $("j-clipdel").addEventListener("click", discardClip);
  $("j-save").addEventListener("click", () => void saveEntry());

  const tx = $("j-tx") as HTMLInputElement;
  $("j-txwrap").hidden = !canTranscribe();
  tx.checked = pref(TX_KEY, "0") === "1";
  tx.addEventListener("change", () => setPref(TX_KEY, tx.checked ? "1" : "0"));
  const lang = $("j-lang") as HTMLSelectElement;
  lang.value = pref(LANG_KEY, "en-ZA");
  lang.addEventListener("change", () => setPref(LANG_KEY, lang.value));

  paintWave();
  setRecUi("idle");

  /* edit sheet */
  $("jf-moods").innerHTML = MOODS.map(
    (m) => `<input type="radio" name="jmood" id="jm-${m.v}" value="${m.v}"><label for="jm-${m.v}">${m.emoji} ${m.label}</label>`,
  ).join("");
}

function paintMoods() {
  document.querySelectorAll<HTMLElement>("#j-moods [data-mood]").forEach((b) => b.setAttribute("aria-checked", String(+b.dataset.mood! === draft.mood)));
}

/* ---------- list ---------- */

const urls = new Map<string, string>();

async function hydrateAudio() {
  for (const el of document.querySelectorAll<HTMLAudioElement>("audio[data-audio]")) {
    const id = el.dataset.audio!;
    if (!urls.has(id)) {
      const blob = (await getAudio(id).catch(() => undefined)) ?? (await fetchVoice(id));
      if (!blob) {
        el.replaceWith(Object.assign(document.createElement("span"), { className: "hint", textContent: "Voice note is on another device." }));
        continue;
      }
      urls.set(id, URL.createObjectURL(blob));
    }
    el.src = urls.get(id)!;
  }
}

export function renderJournal(): void {
  const entries = [...S.data.journal].sort((a, b) => b.created - a.created);
  const today = journaledOn(S.data.journal);
  $("j-prompt").textContent = todayPrompt(new Date(), draft.swap);
  $("j-status").innerHTML = today ? `<span class="pos">Debriefed today</span>` : `<span class="gold">+15 XP</span> for today's first entry`;
  $("j-save").textContent = today ? "Save entry" : "Save · +15 XP";
  paintMoods();

  $("j-n").textContent = String(entries.length);
  $("j-streak").innerHTML = `${journalStreak(S.data.journal)}<small>d</small>`;
  $("j-voice").textContent = String(entries.filter((e) => e.audio).length);
  $("j-count").textContent = entries.length ? `${entries.length} entries` : "";

  $("j-list").innerHTML = entries.length
    ? entries
        .slice(0, 60)
        .map((e) => {
          const m = moodOf(e.mood);
          return `<article class="jent" style="--mc:${m ? `var(--mood-${m.v})` : "var(--line-2)"}">
            <header>${dayBox(e.date)}<div class="jent-h"><span class="jent-p">${esc(e.prompt)}</span><span class="jent-t">${parseD(e.date).toLocaleDateString("en-ZA", { weekday: "long" })} · ${new Date(e.created).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}${m ? ` · <b class="mchip">${m.emoji} ${m.label}</b>` : ""}</span></div>
            <button class="linkbtn" type="button" data-act="edit-j" data-id="${esc(e.id)}">Edit</button></header>
            ${e.audio ? `<div class="jent-a"><span class="ico">${ICON.mic}</span><audio controls preload="metadata" data-audio="${esc(e.id)}"></audio><span class="jent-d">${fmtSecs(e.audio.secs)}</span></div>` : ""}
            ${e.text ? `<p class="jent-x" data-act="j-more">${esc(e.text)}</p>` : ""}
          </article>`;
        })
        .join("")
    : `<div class="empty">No entries yet. Tap the mic and tell it how your day went, or write a few lines.</div>`;
  void hydrateAudio();
}

/* ---------- edit sheet ---------- */

export function fillJournal(e: JournalEntry | null): void {
  if (!e) return;
  $("jf-prompt").textContent = e.prompt;
  ($("jf-text") as HTMLTextAreaElement).value = e.text;
  document.querySelectorAll<HTMLInputElement>("input[name=jmood]").forEach((r) => (r.checked = +r.value === e.mood));
  $("jf-audio").hidden = !e.audio;
}

export function saveJournalEdit(id: string): void {
  const e = S.data.journal.find((x) => x.id === id);
  if (!e) return;
  const m = document.querySelector<HTMLInputElement>("input[name=jmood]:checked");
  put("journal", { ...e, text: ($("jf-text") as HTMLTextAreaElement).value.trim(), mood: m ? +m.value : null });
}

export function deleteJournal(id: string): void {
  const e = S.data.journal.find((x) => x.id === id);
  if (!e) return;
  if (e.audio) {
    void delAudio(id);
    deleteVoiceRemote(id);
  }
  const u = urls.get(id);
  if (u) { URL.revokeObjectURL(u); urls.delete(id); }
  if (e.xp) {
    // Hand the day's XP to another entry from the same day if there is one, so deleting doesn't game it.
    const sibling = S.data.journal.find((x) => x.date === e.date && x.id !== id);
    if (sibling) put("journal", { ...sibling, xp: e.xp });
    else award({ delta: -e.xp, title: "Daily debrief", cat: "mind", quiet: true });
  }
  drop("journal", id);
}

export const isRecording = () => !!draft.recorder;
