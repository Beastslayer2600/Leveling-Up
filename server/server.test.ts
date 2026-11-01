import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { authRoute, coachRoute, eventsRoute, stateRoute, voiceRoute, type Deps } from "./app.js";
import { SCHEMA, type Sql } from "./db.js";

const BASE = "https://lu.test";
const env = { AUTH_SECRET: "test-secret-0123456789abcdef0123456789", OWNER_EMAIL: "Owner@Example.com", EVENT_TOKEN: "evt-token-abcdefghijklmnop" };

async function freshDeps(over: Partial<Deps> = {}): Promise<Deps> {
  const pg = new PGlite();
  await pg.exec(SCHEMA);
  const sql: Sql = { query: async (t, p = []) => (await pg.query(t, p)).rows as never };
  return { sql, env, ...over };
}

const req = (path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(BASE + path, { ...init, headers });
};
const post = (path: string, b: unknown, cookie?: string) => req(path, { method: "POST", body: JSON.stringify(b), cookie });
const cookieOf = (r: Response) => (r.headers.get("set-cookie") || "").split(";")[0];

async function signedIn(d: Deps, email = "owner@example.com") {
  const r = await authRoute(post("/api/auth", { action: "signup", email, password: "correct horse battery" }), d);
  expect(r.status).toBe(200);
  return cookieOf(r);
}

describe("auth", () => {
  let d: Deps;
  beforeEach(async () => (d = await freshDeps()));

  it("reports setup state", async () => {
    const r = await (await authRoute(req("/api/auth"), d)).json();
    expect(r).toEqual({ configured: true, inviteRequired: false, needsSetup: true, user: null });
  });
  it("lets anyone sign up, once per email", async () => {
    expect((await authRoute(post("/api/auth", { action: "signup", email: "not-an-email", password: "long enough pw" }), d)).status).toBe(400);
    expect((await authRoute(post("/api/auth", { action: "signup", email: "friend@example.com", password: "short" }), d)).status).toBe(400);
    const c = await signedIn(d, "Friend@Example.com");
    expect(c).toMatch(/^lu_session=/);
    expect((await authRoute(post("/api/auth", { action: "signup", email: "friend@example.com", password: "another long pw" }), d)).status).toBe(409);
    const me = await (await authRoute(req("/api/auth", { cookie: c }), d)).json();
    expect(me.user).toEqual({ email: "friend@example.com" });
  });
  it("keeps each account's log separate, even for look-alike emails", async () => {
    const a = await signedIn(d, "a.b@example.com");
    const b = await signedIn(d, "a_b@example.com");
    const put = (cookie: string, doc: unknown) =>
      stateRoute(req("/api/state", { method: "PUT", body: JSON.stringify({ baseVersion: 0, doc }), cookie }), d);
    expect((await put(a, { who: "a" })).status).toBe(200);
    expect((await put(b, { who: "b" })).status).toBe(200);
    expect((await (await stateRoute(req("/api/state", { cookie: a }), d)).json()).doc).toEqual({ who: "a" });
    expect((await (await stateRoute(req("/api/state", { cookie: b }), d)).json()).doc).toEqual({ who: "b" });
  });
  it("asks for the invite code when one is set, except from the owner", async () => {
    const di = await freshDeps({ env: { ...env, INVITE_CODE: "let-me-in" } });
    expect((await (await authRoute(req("/api/auth"), di)).json()).inviteRequired).toBe(true);
    const tryUp = (email: string, invite?: string) =>
      authRoute(post("/api/auth", { action: "signup", email, password: "correct horse battery", invite }), di);
    expect((await tryUp("friend@example.com")).status).toBe(403);
    expect((await tryUp("friend@example.com", "wrong")).status).toBe(403);
    expect((await tryUp("friend@example.com", "let-me-in")).status).toBe(200);
    expect((await tryUp("owner@example.com")).status).toBe(200);
  });
  it("logs in with the right password only", async () => {
    await signedIn(d);
    expect((await authRoute(post("/api/auth", { action: "login", email: "owner@example.com", password: "wrong password!" }), d)).status).toBe(401);
    const ok = await authRoute(post("/api/auth", { action: "login", email: "OWNER@example.com", password: "correct horse battery" }), d);
    expect(ok.status).toBe(200);
    expect(cookieOf(ok)).toMatch(/^lu_session=/);
  });
  it("rate-limits repeated attempts", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await authRoute(post("/api/auth", { action: "login", email: "a@b.c", password: "nope nope nope" }), d)).status;
    expect(last).toBe(429);
  });
  it("blocks cross-site posts", async () => {
    const r = await authRoute(req("/api/auth", { method: "POST", body: JSON.stringify({ action: "login" }), headers: { origin: "https://evil.example" } }), d);
    expect(r.status).toBe(403);
  });
  it("rejects forged session cookies", async () => {
    const r = await stateRoute(req("/api/state", { cookie: "lu_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1X293bmVyIn0.bad" }), d);
    expect(r.status).toBe(401);
  });
});

describe("state sync", () => {
  it("stores a doc and rejects stale writes with the current copy", async () => {
    const d = await freshDeps();
    const c = await signedIn(d);
    expect(await (await stateRoute(req("/api/state", { cookie: c }), d)).json()).toEqual({ doc: null, version: 0 });
    const put = (base: number, doc: unknown) => stateRoute(req("/api/state", { method: "PUT", cookie: c, body: JSON.stringify({ baseVersion: base, doc }) }), d);
    expect(await (await put(0, { a: 1 })).json()).toEqual({ ok: true, version: 1 });
    expect(await (await put(1, { a: 2 })).json()).toEqual({ ok: true, version: 2 });
    const stale = await put(1, { a: 3 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ conflict: true, doc: { a: 2 }, version: 2 });
    expect((await stateRoute(req("/api/state"), d)).status).toBe(401);
  });
});

describe("voice notes", () => {
  it("round-trips audio per user", async () => {
    const d = await freshDeps();
    const c = await signedIn(d);
    const audio = new Uint8Array([1, 2, 3, 250, 0, 7]);
    const put = await voiceRoute(req("/api/voice?id=abc_1", { method: "PUT", cookie: c, body: audio, headers: { "content-type": "audio/webm;codecs=opus" } }), d);
    expect(put.status).toBe(200);
    const got = await voiceRoute(req("/api/voice?id=abc_1", { cookie: c }), d);
    expect(got.headers.get("content-type")).toBe("audio/webm");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(audio);
    expect((await voiceRoute(req("/api/voice?id=../x", { cookie: c }), d)).status).toBe(400);
    expect((await voiceRoute(req("/api/voice?id=abc_1", { method: "PUT", cookie: c, body: "x", headers: { "content-type": "text/plain" } }), d)).status).toBe(415);
    await voiceRoute(req("/api/voice?id=abc_1", { method: "DELETE", cookie: c }), d);
    expect((await voiceRoute(req("/api/voice?id=abc_1", { cookie: c }), d)).status).toBe(404);
  });
});

describe("events", () => {
  const send = (d: Deps, b: unknown, token = env.EVENT_TOKEN) =>
    eventsRoute(req("/api/events", { method: "POST", body: JSON.stringify(b), headers: { authorization: `Bearer ${token}` } }), d);

  it("needs the token, a known type and a sane key", async () => {
    const d = await freshDeps();
    await signedIn(d);
    expect((await send(d, { type: "adjudication.report_submitted", key: "adjudicator:r:12345678" }, "wrong")).status).toBe(401);
    expect((await send(d, { type: "made.up", key: "adjudicator:r:12345678" })).status).toBe(400);
    expect((await send(d, { type: "adjudication.report_submitted", key: "x" })).status).toBe(400);
  });
  it("accepts each key once and serves them to the signed-in client", async () => {
    const d = await freshDeps();
    const c = await signedIn(d);
    const ev = { type: "adjudication.report_submitted", key: "adjudicator:report:9f8e7d6c5b4a", date: "2026-10-14" };
    expect(await (await send(d, ev)).json()).toEqual({ ok: true, accepted: true });
    expect(await (await send(d, ev)).json()).toEqual({ ok: true, accepted: false });
    const list = await (await eventsRoute(req("/api/events", { cookie: c }), d)).json();
    expect(list.events).toEqual([{ key: ev.key, type: ev.type, occurred_on: "2026-10-14" }]);
  });
  it("falls back to today for an impossible date instead of failing", async () => {
    const d = await freshDeps();
    const c = await signedIn(d);
    const r = await send(d, { type: "advisor.meeting_held", key: "advisor:meeting:baddate01", date: "2026-02-30" });
    expect(r.status).toBe(200);
    const list = await (await eventsRoute(req("/api/events", { cookie: c }), d)).json();
    expect(list.events[0].occurred_on).toBe(new Date().toISOString().slice(0, 10));
  });
  it("waits for the account to exist", async () => {
    const d = await freshDeps();
    expect((await send(d, { type: "advisor.meeting_held", key: "advisor:meeting:abcdef123" })).status).toBe(409);
  });
});

describe("coach", () => {
  it("calls the model and caps calls per day", async () => {
    let calls = 0;
    const d = await freshDeps({ coach: async (p) => (calls++, `echo ${p.length}`) });
    const c = await signedIn(d);
    const ask = () => coachRoute(post("/api/coach", { prompt: "hello" }, c), d);
    expect(await (await ask()).json()).toEqual({ text: "echo 5" });
    for (let i = 0; i < 4; i++) await ask();
    expect((await ask()).status).toBe(429);
    expect(calls).toBe(5);
  });
  it("is off without a key", async () => {
    const d = await freshDeps();
    const c = await signedIn(d);
    expect((await coachRoute(post("/api/coach", { prompt: "hi" }, c), d)).status).toBe(503);
  });
});
