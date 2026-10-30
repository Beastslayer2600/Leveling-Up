import Anthropic from "@anthropic-ai/sdk";
import type { Deps } from "./app.js";
import { getSql } from "./db.js";

let client: Anthropic | null = null;

/** Single-turn coach call on Claude Opus 5.5, falling back automatically if a request is declined. */
export async function coachCall(prompt: string): Promise<string> {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 55_000, maxRetries: 1 });
  const res = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") throw new Error("refused");
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

export async function deps(): Promise<Deps> {
  const env = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    OWNER_EMAIL: process.env.OWNER_EMAIL,
    EVENT_TOKEN: process.env.EVENT_TOKEN,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };
  return { sql: await getSql(), env, coach: env.ANTHROPIC_API_KEY ? coachCall : undefined };
}

/** Wrap a route: no database configured -> a clear 503 instead of a crash. */
export function route(fn: (req: Request, d: Deps) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (!process.env.DATABASE_URL?.trim()) {
      return new Response(JSON.stringify({ configured: false, error: "Database not connected yet." }), {
        status: req.method === "GET" && new URL(req.url).pathname.endsWith("/auth") ? 200 : 503,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
    try {
      return await fn(req, await deps());
    } catch (e) {
      console.error("[leveling-up]", e);
      return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: { "content-type": "application/json" } });
    }
  };
}
