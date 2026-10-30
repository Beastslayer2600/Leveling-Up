/** The SQL surface the handlers need. Neon in production, PGlite in tests. */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

/** Idempotent schema. Every per-user table is keyed by user_id. */
export const SCHEMA = `
create table if not exists lu_users (
  id text primary key,
  email text not null unique,
  pass_hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists lu_state (
  user_id text primary key references lu_users(id) on delete cascade,
  doc jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists lu_voice (
  user_id text not null references lu_users(id) on delete cascade,
  id text not null,
  mime text not null,
  data text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create table if not exists lu_events (
  user_id text not null references lu_users(id) on delete cascade,
  key text not null,
  type text not null,
  occurred_on date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
create table if not exists lu_hits (
  bucket text not null,
  at timestamptz not null default now()
);
create index if not exists lu_hits_bucket_at on lu_hits (bucket, at);
`;

let cached: Promise<Sql> | null = null;

export function getSql(): Promise<Sql> {
  cached ??= (async () => {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) throw new Error("DATABASE_URL is not set");
    const { neon } = await import("@neondatabase/serverless");
    const run = neon(url);
    const sql: Sql = { query: (text, params = []) => run.query(text, params) as never };
    for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await sql.query(stmt);
    return sql;
  })().catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}
