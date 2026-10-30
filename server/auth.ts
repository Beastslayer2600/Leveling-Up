import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

const scrypt = (pw: string, salt: Buffer, n: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, 64, { N: n, r: 8, p: 1, maxmem: 128 * n * 8 * 2 }, (err, key) => (err ? reject(err) : resolve(key))),
  );

const N = 2 ** 15;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, N);
  return `scrypt$${N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !salt || !hash) return false;
  const key = await scrypt(pw, Buffer.from(salt, "base64"), Number(n));
  const want = Buffer.from(hash, "base64");
  return key.length === want.length && timingSafeEqual(key, want);
}

/** Constant-time comparison for bearer tokens. */
export function sameToken(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length > 0 && b.length > 0;
}

export const COOKIE = "lu_session";
const MAX_AGE = 60 * 60 * 24 * 60;

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signSession(userId: string, secret: string): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(key(secret));
}

export async function readSession(req: Request, secret: string): Promise<string | null> {
  const raw = req.headers.get("cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  try {
    const { payload } = await jwtVerify(m[1], key(secret), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export const sessionCookie = (token: string) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Reject cross-site state changes: the Origin, when sent, must match this host. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || new URL(req.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
