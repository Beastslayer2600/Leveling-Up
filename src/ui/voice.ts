/* Voice notes: record with MediaRecorder, keep the audio in this device's IndexedDB,
   and optionally transcribe live with the browser's speech service. */

const DB = "leveling-up";
const STORE = "voice";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = run(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const putAudio = (id: string, blob: Blob) => tx("readwrite", (s) => s.put(blob, id));
export const getAudio = (id: string) => tx<Blob | undefined>("readonly", (s) => s.get(id));
export const delAudio = (id: string) => tx("readwrite", (s) => s.delete(id)).catch(() => undefined);

export const canRecord = () =>
  typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

function pickMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"])
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  return "";
}

export const MAX_SECS = 300;

export interface Recording {
  blob: Blob;
  mime: string;
  secs: number;
}

/** One recording session. `level` is 0..1 for the live meter. */
export class Recorder {
  private rec?: MediaRecorder;
  private stream?: MediaStream;
  private ctx?: AudioContext;
  private timer?: ReturnType<typeof setInterval>;
  private meter?: () => number;
  private started = 0;
  private chunks: Blob[] = [];
  private done?: (r: Recording | null) => void;

  constructor(private onLevel: (level: number, secs: number) => void, private onLimit: () => void) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = pickMime();
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.onstop = () => {
      const type = this.rec?.mimeType || mime || "audio/webm";
      const secs = Math.round((performance.now() - this.started) / 100) / 10;
      this.cleanup();
      this.done?.(this.chunks.length ? { blob: new Blob(this.chunks, { type }), mime: type, secs } : null);
    };
    this.rec.start(250);
    this.started = performance.now();

    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(this.stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      this.meter = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        return Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
      };
    } catch {
      /* the meter is decoration; recording works without it */
    }
    // A timer, not requestAnimationFrame: it keeps counting when the tab or screen is in the background.
    this.timer = setInterval(() => {
      const secs = (performance.now() - this.started) / 1000;
      this.onLevel(this.meter?.() ?? 0, secs);
      if (secs >= MAX_SECS) this.onLimit();
    }, 70);
  }

  stop(): Promise<Recording | null> {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === "inactive") return resolve(null);
      this.done = resolve;
      this.rec.stop();
    });
  }

  cancel(): void {
    this.done = undefined;
    if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    this.cleanup();
  }

  private cleanup() {
    clearInterval(this.timer);
    this.meter = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.ctx = undefined;
  }
}

/* ---------- live transcription (browser speech service) ---------- */

type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};

const SRCtor = (): (new () => SR) | undefined =>
  (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ||
  (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;

export const canTranscribe = () => typeof window !== "undefined" && !!SRCtor();

/** Streams text while you speak. Restarts itself when the browser ends a session early. */
export class Transcriber {
  private sr?: SR;
  private on = false;
  finalText = "";

  constructor(private lang: string, private onText: (finalText: string, interim: string) => void, private onError: (msg: string) => void) {}

  start(): void {
    const C = SRCtor();
    if (!C) return;
    this.on = true;
    this.finalText = "";
    const sr = new C();
    sr.lang = this.lang;
    sr.continuous = true;
    sr.interimResults = true;
    sr.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText += (this.finalText && !this.finalText.endsWith(" ") ? " " : "") + r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      this.onText(this.finalText, interim);
    };
    sr.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.on = false;
        this.onError("Typing it out isn't allowed in this browser. Your voice note still records.");
      }
    };
    sr.onend = () => {
      if (this.on) {
        try { sr.start(); } catch { /* already restarting */ }
      }
    };
    this.sr = sr;
    sr.start();
  }

  stop(): void {
    this.on = false;
    try { this.sr?.stop(); } catch { /* not running */ }
  }
}
