# Working in this repo under Base44

## Run it

```bash
docker compose -f docker-compose.base44.yml up -d --build
```

One service, `web`: the repo's own Vite dev server (`npm run dev`) on container
port 5173, published as host port 3000. Source is bind mounted, so edits hot
reload; `node_modules` lives in a named volume and is reinstalled from
`package-lock.json` on every container start (`npm ci`).

## How the backend works in preview

- There is no separate API process. `/api/*` is served inside the Vite dev server
  by `vite.config.ts`'s `devApi()` plugin, which loads `server/dev.ts`.
- `server/dev.ts` runs an **in-memory Postgres (PGlite)** and applies `SCHEMA`
  from `server/db.ts`. **Every container restart wipes all accounts, logs, and
  voice notes.** That is expected here; production uses Neon over HTTP via
  `DATABASE_URL` and never this path.
- Because `@neondatabase/serverless` speaks Neon's HTTP protocol, a normal
  Postgres container will not work as `DATABASE_URL`. Do not add one.

## Secrets

- `AUTH_SECRET` — signs the session cookie. Delivered from Base44 secrets to
  `/run/base44/app.env`. Without it, `server/dev.ts` invents a random secret per
  boot, which signs everyone out on restart.
- `ANTHROPIC_API_KEY` — optional, switches on the coach (`/api/coach`). Unset
  means `coachEnabled()` is false and the coach stays hidden.

## Preview-proxy overrides (all gated on `BASE44_PREVIEW_MODE === "1"`)

1. **Vite host allowlist** (`vite.config.ts`): the sandbox proxy reaches the dev
   server as `<port>-<sandbox id>.<BASE44_SANDBOX_HOST_DOMAIN>`. When the flag is
   `"1"`, `server.allowedHosts` is extended with `.${BASE44_SANDBOX_HOST_DOMAIN}`.
2. **Origin check** (`server/auth.ts`, `previewOrigin()`): the browser sends
   `Origin: https://3000-<BASE44_PUBLIC_HOST_SUFFIX>` while the process sees the
   sandbox hostname as `Host`, so they can never match and every state-changing
   call would 403. In preview mode only, the app's own `3000-<suffix>` origin is
   accepted. Any other origin is still rejected — `server.test.ts`'s
   "blocks cross-site posts" test covers it.

With the flag unset, both files keep Vite's default allowlist and the original
`Origin === Host` rule.

## Checks

Run them inside the container (the sandbox host has no Node):

```bash
docker compose -f docker-compose.base44.yml exec -T web npm test
docker compose -f docker-compose.base44.yml exec -T web npm run typecheck
```

## Verifying by hand

Load `/`: a fresh database shows the sign-up sheet. Create an account (10+
characters), finish "Set up your character", then tick a daily mission — the mode
chip in the sidebar footer should read "Synced to your account" and `PUT
/api/state` should return 200. `GET /api/auth` confirms the signed-in user.
