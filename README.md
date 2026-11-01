# Leveling Up

A game-style life tracker with a dark "night ops" HUD. Missions earn XP and levels, and the app also tracks a daily Bible virtue, body and gym, social life, a money ledger with good and bad calls, a character sheet and 36 achievements.

It's an installable web app (PWA) that works offline. It runs on a laptop and on a phone.

## Tabs

- **Missions:** daily ops, one-off quests and tracked targets with weekly or monthly resets, plus the daily virtue (25 virtues, rotating by day of year) and the 7-day Release Reset questline.
- **Body:** gym sessions with automatic PB detection and an estimated 1RM (Epley), cardio, steps, weight trend and meals.
- **Social:** posts, catch-ups and events, plus how long since you last saw each group of friends.
- **Money:** a monthly ledger, the share of good calls and spending by category.
- **Character:** attributes that grow from XP, your current chapter, skills, abilities, achievements and backup/restore.

## Rules

- Player levels cost 100 × L XP to go from level L to L+1. Category levels cost 50 × L.
- Ticking a mission pays its XP, and unticking it takes the XP back. Hitting a tracked target pays a 2× bonus.
- A gym session pays 30 XP, plus 40 for each PB.
- Each achievement pays 50 XP.

All of the game logic is pure and tested, in [`src/lib/leveling/`](src/lib/leveling).

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # logic tests
npm run build    # static site in dist/
```

## Install as an app

- **Windows (Chrome or Edge):** open the site, then choose **Install app** in the address bar.
- **iPhone (Safari):** tap **Share**, then **Add to Home Screen**.

## Sync and sign-in

When the server has a database, the app asks you to sign in. Your log, journal and voice notes then sync between your devices.

- **Vercel environment variables:**
  - `DATABASE_URL`: Postgres. Neon, connected through Vercel's Storage tab, sets this for you.
  - `AUTH_SECRET`: a long random string that signs the session cookie.
  - `OWNER_EMAIL`: the only email allowed to create the account.
  - `EVENT_TOKEN`: the bearer token other apps use to send XP events.
  - `ANTHROPIC_API_KEY`: optional, and switches on the coach.
- **Without `DATABASE_URL`:** the app keeps working on each device on its own.
- **Testing locally:** `npm run dev` serves the same API from an in-memory Postgres.

## On a Windows PC

Open the site in Edge or Chrome and choose **Install app**. Or create a shortcut that runs `msedge.exe --app=<your site URL>`, which gives the app its own window and icon.

## Your data

- Every change is saved on the device first, then synced to the server when you're signed in.
- No personal data, keys or seed files belong in this repo, and `.gitignore` blocks backups, `.env` files and `*.local.*` files.
- **Character → Profile & data → Back up** saves a JSON file. Keep it outside this folder.
- **Restore** loads a backup on another device. It replaces that device's log.

## Coach (optional)

The coach shows on the Missions tab once you're signed in. It runs on the server (`/api/coach`) and needs `ANTHROPIC_API_KEY` in Vercel. The key stays on the server, never in the app.

The app builds its prompt from your own profile and recent logs (`src/lib/leveling/coach.ts`). It never sends your release plan. The server allows 5 coach calls a day.

## Integrations

[`events.ts`](src/lib/leveling/events.ts) is the single entry point for activity from other apps, such as an adjudication report or a closed case.

- Only an event type, a category, a count and a date cross over. Names, IDs and notes never do.
- Every event carries an idempotency key, so the same event never pays twice.
