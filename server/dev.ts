/* Dev only: serve /api/* from the Vite dev server with an in-memory Postgres (PGlite).
   Data resets when the dev server restarts. Never imported by the production build. */
import { randomBytes } from "node:crypto";
import { authRoute, coachRoute, eventsRoute, stateRoute, voiceRoute, type Deps } from "./app.js";
import { SCHEMA, type Sql } from "./db.js";

const ROUTES: Record<string, (req: Request, d: Deps) => Promise<Response>> = {
  auth: authRoute,
  state: stateRoute,
  voice: voiceRoute,
  events: eventsRoute,
  coach: coachRoute,
};

let depsP: Promise<Deps> | null = null;

function devDeps(): Promise<Deps> {
  depsP ??= (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite();
    await pg.exec(SCHEMA);
    const sql: Sql = { query: async (t, p = []) => (await pg.query(t, p)).rows as never };
    const env = {
      AUTH_SECRET: process.env.AUTH_SECRET || randomBytes(32).toString("hex"),
      OWNER_EMAIL: process.env.OWNER_EMAIL || "dev@leveling.local",
      EVENT_TOKEN: process.env.EVENT_TOKEN || "dev-event-token-123456",
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    };
    let coach: Deps["coach"];
    if (env.ANTHROPIC_API_KEY) coach = (await import("./deps.js")).coachCall;
    else if (process.env.LU_FAKE_COACH)
      coach = async () =>
        JSON.stringify([
          { title: "Cook dinner at home", why: "Sample suggestion from the dev coach.", cat: "money", kind: "counter", target: 3, period: "week", difficulty: "std" },
          { title: "Text one quiet friend group", why: "Sample suggestion from the dev coach.", cat: "social", kind: "quest", difficulty: "easy" },
        ]);
    return { sql, env, coach };
  })();
  return depsP;
}

export async function handleDev(name: string, req: Request): Promise<Response> {
  const fn = ROUTES[name];
  if (!fn) return new Response("Not found", { status: 404 });
  return fn(req, await devDeps());
}
