/* Sync with the server when it's configured; otherwise the app stays device-only.
   The device copy (localStorage) is always written first, so the app works offline. */
import { blankData, normalize } from "../lib/leveling/data";
import { applyServerEvents, mergeData, pruneTombs } from "../lib/leveling/sync";
import { $, esc } from "./dom";
import { toast } from "./fx";
import { S, after, grant, onSave, persistLocal, render } from "./state";
import { clearAudio, getAudio, putAudio } from "./voice";

const VER_KEY = "leveling-up.syncver";
const VOICEQ_KEY = "leveling-up.voiceq";
/** Email of the account whose log is on this device ("" = a device-only log). */
const ACCOUNT_KEY = "leveling-up.account";

export const sync = {
  mode: "local" as "local" | "server",
  email: "",
  version: 0,
  dirty: false,
  pushing: false,
  again: false,
  status: "" as "" | "saving" | "synced" | "offline",
};

let timer: ReturnType<typeof setTimeout> | undefined;

const readVer = () => {
  try { return Number(localStorage.getItem(VER_KEY)) || 0; } catch { return 0; }
};
const writeVer = (v: number) => {
  sync.version = v;
  try { localStorage.setItem(VER_KEY, String(v)); } catch { /* optional */ }
};

function setStatus(s: typeof sync.status) {
  sync.status = s;
  const el = document.getElementById("mode");
  if (!el) return;
  if (sync.mode === "local") return;
  const label = s === "saving" ? "Saving…" : s === "offline" ? "Offline. Changes sync when you're back." : "Synced to your account";
  el.innerHTML = `<span class="dot-live ${s === "offline" ? "warn" : s === "saving" ? "busy" : ""}"></span>${esc(label)}${sync.email ? `<br><small>${esc(sync.email)}</small>` : ""}`;
}

async function api(path: string, init: RequestInit = {}) {
  return fetch(path, { credentials: "same-origin", ...init, headers: { ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...(init.headers || {}) } });
}

/** Repaint the sync line in the rail (render() calls this). */
export function renderMode(): void {
  setStatus(sync.status || "synced");
}

/* ---------- push / pull ---------- */

export function schedulePush(delay = 1200): void {
  if (sync.mode !== "server") return;
  sync.dirty = true;
  setStatus("saving");
  clearTimeout(timer);
  timer = setTimeout(() => void push(), delay);
}

async function push(): Promise<void> {
  if (sync.mode !== "server") return;
  if (sync.pushing) { sync.again = true; return; }
  sync.pushing = true;
  try {
    S.data.tomb = pruneTombs(S.data.tomb);
    const r = await api("/api/state", { method: "PUT", body: JSON.stringify({ baseVersion: sync.version, doc: S.data }) });
    if (r.status === 401) return showAuth("signin");
    if (r.status === 409) {
      const cur = await r.json();
      S.data = mergeData(cur.doc, S.data);
      writeVer(cur.version);
      persistLocal();
      render();
      sync.again = true;
      return;
    }
    if (!r.ok) throw new Error(String(r.status));
    writeVer((await r.json()).version);
    sync.dirty = false;
    setStatus("synced");
    void flushVoice();
  } catch {
    setStatus("offline");
    clearTimeout(timer);
    timer = setTimeout(() => void push(), 30_000);
  } finally {
    sync.pushing = false;
    if (sync.again) { sync.again = false; schedulePush(300); }
  }
}

/** Fetch the server copy. On a device's first sync (or with unsent changes) merge instead of replacing. */
async function pull(): Promise<void> {
  if (sync.mode !== "server" || sync.pushing) return;
  try {
    const r = await api("/api/state");
    if (r.status === 401) return showAuth("signin");
    if (!r.ok) throw new Error(String(r.status));
    const { doc, version } = await r.json();
    if (!doc) {
      writeVer(0);
      schedulePush(0);
      return;
    }
    if (version === sync.version && !sync.dirty) { setStatus("synced"); return; }
    // An untouched device log (never saved) has nothing worth merging: take the account's copy as is.
    const merge = (sync.dirty || readVer() === 0) && S.data.savedAt > 0;
    S.data = merge ? mergeData(doc, S.data) : normalize(doc);
    writeVer(version);
    persistLocal();
    if (merge) schedulePush(0);
    else setStatus("synced");
    render();
  } catch {
    setStatus("offline");
  }
}

/** Pay events other apps sent (Judges Companion, Advisor Assistant). */
async function pullEvents(): Promise<void> {
  if (sync.mode !== "server") return;
  try {
    const r = await api("/api/events");
    if (!r.ok) return;
    const { events } = await r.json();
    const res = applyServerEvents(S.data, events || []);
    if (!res.xp && res.data === S.data) return;
    S.data = res.data;
    S.data.savedAt = Date.now();
    persistLocal();
    schedulePush(0);
    render();
    if (res.xp) toast(`+${res.xp} XP from your other apps`, "xp");
    if (res.events.length) setTimeout(() => grant(res.events), 1300);
    after();
  } catch {
    /* next time */
  }
}

async function refresh() {
  await pull();
  await pullEvents();
}

/* ---------- voice notes ---------- */

const readQ = (): string[] => {
  try { return JSON.parse(localStorage.getItem(VOICEQ_KEY) || "[]"); } catch { return []; }
};
const writeQ = (q: string[]) => {
  try { localStorage.setItem(VOICEQ_KEY, JSON.stringify([...new Set(q)])); } catch { /* optional */ }
};

/** Queue a voice note for upload; uploads happen after a successful push. */
export function queueVoice(id: string): void {
  if (sync.mode !== "server") return;
  writeQ([...readQ(), id]);
  void flushVoice();
}

async function flushVoice(): Promise<void> {
  const q = readQ();
  for (const id of q) {
    const blob = await getAudio(id).catch(() => undefined);
    if (!blob) { writeQ(readQ().filter((x) => x !== id)); continue; }
    try {
      const r = await api(`/api/voice?id=${encodeURIComponent(id)}`, { method: "PUT", body: blob, headers: { "content-type": blob.type || "audio/webm" } });
      if (!r.ok) return;
      writeQ(readQ().filter((x) => x !== id));
    } catch {
      return;
    }
  }
}

/** A voice note recorded on another device: fetch it once and keep it here. */
export async function fetchVoice(id: string): Promise<Blob | undefined> {
  if (sync.mode !== "server") return undefined;
  try {
    const r = await api(`/api/voice?id=${encodeURIComponent(id)}`);
    if (!r.ok) return undefined;
    const blob = await r.blob();
    await putAudio(id, blob).catch(() => undefined);
    return blob;
  } catch {
    return undefined;
  }
}

export function deleteVoiceRemote(id: string): void {
  writeQ(readQ().filter((x) => x !== id));
  if (sync.mode === "server") void api(`/api/voice?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
}

/* ---------- coach ---------- */

export async function askCoach(prompt: string): Promise<{ text?: string; error?: string; status: number }> {
  const r = await api("/api/coach", { method: "POST", body: JSON.stringify({ prompt }) });
  const b = await r.json().catch(() => ({}));
  return { status: r.status, text: b.text, error: b.error };
}

/* ---------- sign-in ---------- */

type AuthMode = "signin" | "signup";
let authMode: AuthMode = "signin";
let inviteRequired = false;
let onReady = () => {};

const readAccount = () => {
  try { return localStorage.getItem(ACCOUNT_KEY) || ""; } catch { return ""; }
};
const writeAccount = (email: string) => {
  try { localStorage.setItem(ACCOUNT_KEY, email); } catch { /* optional */ }
};

/** Wipe this device's copy (log, sync version, voice notes) so the next account starts clean. */
async function resetDevice(): Promise<void> {
  clearTimeout(timer);
  S.data = blankData();
  persistLocal();
  writeVer(0);
  writeQ([]);
  sync.dirty = false;
  await clearAudio().catch(() => undefined);
}

function setAuthMode(mode: AuthMode) {
  authMode = mode;
  const up = mode === "signup";
  $("auth-h").textContent = up ? "Create your account" : "Sign in";
  $("auth-sub").textContent = up
    ? "Choose an email and a password of 10+ characters. Your log then syncs across your devices."
    : "Sign in to sync your log, journal and voice notes across your devices.";
  $("auth-confirm-f").hidden = !up;
  $("auth-invite-f").hidden = !(up && inviteRequired);
  ($("auth-pass") as HTMLInputElement).autocomplete = up ? "new-password" : "current-password";
  $("auth-go").textContent = up ? "Create account" : "Sign in";
  $("auth-switch").textContent = up ? "Already have an account? Sign in" : "New here? Create an account";
  $("auth-err").textContent = "";
}

function showAuth(mode: AuthMode) {
  sync.mode = "local";
  $("auth").hidden = false;
  document.body.classList.add("sheet-open");
  setAuthMode(mode);
  ($("auth-email") as HTMLInputElement).focus();
}

function hideAuth() {
  $("auth").hidden = true;
  document.body.classList.remove("sheet-open");
}

async function startServer(email: string) {
  const prev = readAccount();
  // Another account's log is on this device: don't mix it into this one.
  if (prev && prev !== email.toLowerCase()) await resetDevice();
  writeAccount(email.toLowerCase());
  sync.mode = "server";
  sync.email = email;
  sync.version = readVer();
  hideAuth();
  setStatus("saving");
  $("p-logout").hidden = false;
  render();
  await refresh();
  onReady();
}

/**
 * Wire up sign-in and start syncing when the server has accounts switched on.
 * `ready` runs once the app knows whose log it's showing (after sign-in, or when staying device-only).
 */
export async function initSync(ready: () => void = () => {}): Promise<void> {
  onReady = ready;
  onSave(() => schedulePush());

  $("auth-switch").addEventListener("click", () => setAuthMode(authMode === "signin" ? "signup" : "signin"));
  $("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const up = authMode === "signup";
    const email = ($("auth-email") as HTMLInputElement).value.trim();
    const password = ($("auth-pass") as HTMLInputElement).value;
    if (up && password !== ($("auth-confirm") as HTMLInputElement).value) {
      $("auth-err").textContent = "The passwords don't match.";
      return;
    }
    const invite = ($("auth-invite") as HTMLInputElement).value.trim();
    const go = $("auth-go") as HTMLButtonElement;
    go.disabled = true;
    try {
      const r = await api("/api/auth", { method: "POST", body: JSON.stringify({ action: up ? "signup" : "login", email, password, invite }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        $("auth-err").textContent = b.error || (up ? "Couldn't create the account." : "Couldn't sign in.");
        return;
      }
      ($("auth-pass") as HTMLInputElement).value = "";
      ($("auth-confirm") as HTMLInputElement).value = "";
      ($("auth-invite") as HTMLInputElement).value = "";
      await startServer(b.user.email);
      toast(up ? "Account created. Your log now syncs." : "Signed in. Syncing your log.", "xp");
    } catch {
      $("auth-err").textContent = "Can't reach the server. Check your connection.";
    } finally {
      go.disabled = false;
    }
  });
  $("auth-skip").addEventListener("click", () => {
    hideAuth();
    try { sessionStorage.setItem("leveling-up.skipauth", "1"); } catch { /* optional */ }
    onReady();
  });
  $("p-signin").addEventListener("click", async () => {
    try { sessionStorage.removeItem("leveling-up.skipauth"); } catch { /* optional */ }
    try {
      const r = await api("/api/auth");
      const b = r.ok ? await r.json() : {};
      if (!b.configured) return toast("Sync isn't switched on for this app yet.");
      inviteRequired = !!b.inviteRequired;
      if (b.user) return void startServer(b.user.email);
      showAuth(b.needsSetup ? "signup" : "signin");
    } catch {
      toast("Can't reach the server. Check your connection.");
    }
  });
  $("p-logout").addEventListener("click", async () => {
    // Send anything unsynced first: signing out clears this device's copy.
    if (sync.dirty) {
      clearTimeout(timer);
      await push();
      if (sync.dirty) return toast("Some changes haven't synced yet. Get online, then sign out.");
    }
    await api("/api/auth", { method: "POST", body: JSON.stringify({ action: "logout" }) }).catch(() => {});
    await resetDevice();
    writeAccount("");
    sync.mode = "local";
    sync.email = "";
    $("p-logout").hidden = true;
    render();
    showAuth("signin");
  });

  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  window.addEventListener("online", () => { if (sync.dirty) schedulePush(0); else void refresh(); });

  let info: { configured?: boolean; inviteRequired?: boolean; needsSetup?: boolean; user?: { email: string } | null } = {};
  try {
    const r = await api("/api/auth");
    if (!r.ok) return onReady();
    info = await r.json();
  } catch {
    return onReady();
  }
  if (!info.configured) return onReady();
  inviteRequired = !!info.inviteRequired;
  if (info.user) return startServer(info.user.email);
  let skipped = false;
  try { skipped = sessionStorage.getItem("leveling-up.skipauth") === "1"; } catch { /* optional */ }
  if (skipped) return onReady();
  showAuth(info.needsSetup ? "signup" : "signin");
}
