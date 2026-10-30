import { EVENT_TYPES } from "../src/lib/leveling/events.js";
import { clearCookie, hashPassword, readSession, sameOrigin, sameToken, sessionCookie, signSession, verifyPassword } from "./auth.js";
import type { Sql } from "./db.js";

export interface Env {
  AUTH_SECRET?: string;
  /** The only email allowed to create the account. */
  OWNER_EMAIL?: string;
  /** Bearer token other apps (Judges Companion…) use to send events. */
  EVENT_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
}

export interface Deps {
  sql: Sql;
  env: Env;
  /** Calls the model with the coach prompt and returns its text. */
  coach?: (prompt: string) => Promise<string>;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const err = (status: number, error: string) => json({ error }, status);

const MAX_DOC = 3_000_000;
const MAX_AUDIO_B64 = 4_000_000;
export const COACH_PER_DAY = 5;

async function body<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/** Count recent hits in a bucket; true when over the limit. Records this hit. */
async function limited(sql: Sql, bucket: string, max: number, windowMins: number): Promise<boolean> {
  const rows = await sql.query<{ n: number }>(
    `select count(*)::int as n from lu_hits where bucket = $1 and at > now() - ($2 || ' minutes')::interval`,
    [bucket, String(windowMins)],
  );
  if ((rows[0]?.n ?? 0) >= max) return true;
  await sql.query(`insert into lu_hits (bucket) values ($1)`, [bucket]);
  return false;
}

async function userId(req: Request, d: Deps): Promise<string | null> {
  if (!d.env.AUTH_SECRET) return null;
  const id = await readSession(req, d.env.AUTH_SECRET);
  if (!id) return null;
  const rows = await d.sql.query(`select 1 from lu_users where id = $1`, [id]);
  return rows.length ? id : null;
}

const ip = (req: Request) => (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
const ownerIdFor = (email: string) => "u_" + email.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);

/* ---------- /api/auth ---------- */

export async function authRoute(req: Request, d: Deps): Promise<Response> {
  const configured = !!(d.env.AUTH_SECRET && d.env.OWNER_EMAIL);
  if (req.method === "GET") {
    if (!configured) return json({ configured: false });
    const users = await d.sql.query<{ n: number }>(`select count(*)::int as n from lu_users`);
    const id = await userId(req, d);
    const me = id ? (await d.sql.query<{ email: string }>(`select email from lu_users where id = $1`, [id]))[0] : null;
    return json({ configured: true, needsSetup: users[0].n === 0, user: me ? { email: me.email } : null });
  }
  if (req.method !== "POST") return err(405, "Method not allowed");
  if (!configured) return err(503, "Sign-in isn't configured on the server yet.");
  if (!sameOrigin(req)) return err(403, "Cross-site request blocked");
  const b = await body<{ action?: string; email?: string; password?: string }>(req);
  if (!b) return err(400, "Bad request");

  if (b.action === "logout") return json({ ok: true }, 200, { "set-cookie": clearCookie() });

  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");
  if (await limited(d.sql, "login:" + ip(req), 10, 15)) return err(429, "Too many attempts. Wait 15 minutes.");

  if (b.action === "setup") {
    const owner = d.env.OWNER_EMAIL!.trim().toLowerCase();
    if (email !== owner) return err(403, "That email doesn't match the owner email for this app. Check it for typos.");
    if (password.length < 10) return err(400, "Use at least 10 characters.");
    const existing = await d.sql.query(`select 1 from lu_users where email = $1`, [email]);
    if (existing.length) return err(409, "Account already exists. Sign in instead.");
    const id = ownerIdFor(email);
    await d.sql.query(`insert into lu_users (id, email, pass_hash) values ($1, $2, $3)`, [id, email, await hashPassword(password)]);
    return json({ ok: true, user: { email } }, 200, { "set-cookie": sessionCookie(await signSession(id, d.env.AUTH_SECRET!)) });
  }

  if (b.action === "login") {
    const rows = await d.sql.query<{ id: string; pass_hash: string }>(`select id, pass_hash from lu_users where email = $1`, [email]);
    const ok = rows[0] ? await verifyPassword(password, rows[0].pass_hash) : (await hashPassword(password), false);
    if (!ok) return err(401, "Email or password is wrong.");
    return json({ ok: true, user: { email } }, 200, { "set-cookie": sessionCookie(await signSession(rows[0].id, d.env.AUTH_SECRET!)) });
  }
  return err(400, "Unknown action");
}

/* ---------- /api/state ---------- */

export async function stateRoute(req: Request, d: Deps): Promise<Response> {
  const uid = await userId(req, d);
  if (!uid) return err(401, "Unauthorized");
  if (req.method === "GET") {
    const rows = await d.sql.query<{ doc: unknown; version: number }>(`select doc, version from lu_state where user_id = $1`, [uid]);
    return json(rows[0] ? { doc: rows[0].doc, version: rows[0].version } : { doc: null, version: 0 });
  }
  if (req.method !== "PUT") return err(405, "Method not allowed");
  if (!sameOrigin(req)) return err(403, "Cross-site request blocked");
  const raw = await req.text();
  if (raw.length > MAX_DOC) return err(413, "Log too large");
  let b: { baseVersion?: number; doc?: unknown };
  try {
    b = JSON.parse(raw);
  } catch {
    return err(400, "Bad request");
  }
  if (!b.doc || typeof b.doc !== "object") return err(400, "Missing doc");
  const base = Number(b.baseVersion) || 0;
  const docJson = JSON.stringify(b.doc);
  const rows =
    base === 0
      ? await d.sql.query<{ version: number }>(
          `insert into lu_state (user_id, doc, version) values ($1, $2::jsonb, 1) on conflict (user_id) do nothing returning version`,
          [uid, docJson],
        )
      : await d.sql.query<{ version: number }>(
          `update lu_state set doc = $2::jsonb, version = version + 1, updated_at = now() where user_id = $1 and version = $3 returning version`,
          [uid, docJson, base],
        );
  if (!rows.length) {
    const cur = await d.sql.query<{ doc: unknown; version: number }>(`select doc, version from lu_state where user_id = $1`, [uid]);
    return json({ conflict: true, doc: cur[0]?.doc ?? null, version: cur[0]?.version ?? 0 }, 409);
  }
  return json({ ok: true, version: rows[0].version });
}

/* ---------- /api/voice?id= ---------- */

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export async function voiceRoute(req: Request, d: Deps): Promise<Response> {
  const uid = await userId(req, d);
  if (!uid) return err(401, "Unauthorized");
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!ID_RE.test(id)) return err(400, "Bad id");
  if (req.method === "GET") {
    const rows = await d.sql.query<{ mime: string; data: string }>(`select mime, data from lu_voice where user_id = $1 and id = $2`, [uid, id]);
    if (!rows[0]) return err(404, "Not found");
    return new Response(Buffer.from(rows[0].data, "base64"), { headers: { "content-type": rows[0].mime, "cache-control": "private, max-age=31536000, immutable" } });
  }
  if (!sameOrigin(req)) return err(403, "Cross-site request blocked");
  if (req.method === "DELETE") {
    await d.sql.query(`delete from lu_voice where user_id = $1 and id = $2`, [uid, id]);
    return json({ ok: true });
  }
  if (req.method !== "PUT") return err(405, "Method not allowed");
  const mime = (req.headers.get("content-type") || "audio/webm").split(";")[0].slice(0, 60);
  if (!mime.startsWith("audio/")) return err(415, "Audio only");
  const b64 = Buffer.from(await req.arrayBuffer()).toString("base64");
  if (!b64.length || b64.length > MAX_AUDIO_B64) return err(413, "Voice note too large");
  await d.sql.query(
    `insert into lu_voice (user_id, id, mime, data) values ($1, $2, $3, $4) on conflict (user_id, id) do update set mime = excluded.mime, data = excluded.data`,
    [uid, id, mime, b64],
  );
  return json({ ok: true });
}

/* ---------- /api/events ---------- */

/**
 * POST (Bearer EVENT_TOKEN): another app reports an activity. Only the event type,
 * a date and an opaque key are accepted; XP comes from the server's own table.
 * GET (signed in): the client fetches recent events and applies the unpaid ones.
 */
export async function eventsRoute(req: Request, d: Deps): Promise<Response> {
  if (req.method === "GET") {
    const uid = await userId(req, d);
    if (!uid) return err(401, "Unauthorized");
    const rows = await d.sql.query<{ key: string; type: string; occurred_on: string }>(
      `select key, type, occurred_on::text as occurred_on from lu_events where user_id = $1 and created_at > now() - interval '120 days' order by created_at`,
      [uid],
    );
    return json({ events: rows });
  }
  if (req.method !== "POST") return err(405, "Method not allowed");
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!d.env.EVENT_TOKEN || !sameToken(token, d.env.EVENT_TOKEN)) return err(401, "Unauthorized");
  if (await limited(d.sql, "events", 300, 60)) return err(429, "Slow down");

  const b = await body<{ type?: string; key?: string; date?: string }>(req);
  const type = String(b?.type || "");
  const key = String(b?.key || "");
  if (!(type in EVENT_TYPES)) return err(400, "Unknown event type");
  if (!/^[a-zA-Z0-9:._-]{8,160}$/.test(key)) return err(400, "Bad idempotency key");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.date)) ? String(b!.date) : new Date().toISOString().slice(0, 10);

  const owner = d.env.OWNER_EMAIL ? ownerIdFor(d.env.OWNER_EMAIL) : "";
  const users = await d.sql.query(`select 1 from lu_users where id = $1`, [owner]);
  if (!users.length) return err(409, "No account yet. Sign in to Leveling Up first.");
  const rows = await d.sql.query(
    `insert into lu_events (user_id, key, type, occurred_on) values ($1, $2, $3, $4::date) on conflict (user_id, key) do nothing returning key`,
    [owner, key, type, date],
  );
  return json({ ok: true, accepted: rows.length > 0 });
}

/* ---------- /api/coach ---------- */

export async function coachRoute(req: Request, d: Deps): Promise<Response> {
  if (req.method !== "POST") return err(405, "Method not allowed");
  const uid = await userId(req, d);
  if (!uid) return err(401, "Unauthorized");
  if (!sameOrigin(req)) return err(403, "Cross-site request blocked");
  if (!d.coach) return err(503, "The coach isn't set up on the server yet.");
  const b = await body<{ prompt?: string }>(req);
  const prompt = String(b?.prompt || "");
  if (!prompt || prompt.length > 20_000) return err(400, "Bad prompt");
  if (await limited(d.sql, "coach:" + uid, COACH_PER_DAY, 24 * 60)) return err(429, `That's ${COACH_PER_DAY} coach calls today. Try again tomorrow.`);
  try {
    return json({ text: await d.coach(prompt) });
  } catch {
    return err(502, "Couldn't reach the coach.");
  }
}
