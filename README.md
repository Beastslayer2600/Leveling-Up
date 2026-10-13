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

## Your data

- Everything is saved in your browser on that device.
- No personal data, keys or seed files belong in this repo, and `.gitignore` blocks backups, `.env` files and `*.local.*` files.
- **Character → Profile & data → Back up** saves a JSON file. Keep it outside this folder.
- **Restore** loads a backup on another device. It replaces that device's log.

Syncing between devices needs a backend. That's a planned next step, using Postgres behind sign-in, with every row scoped to the signed-in user.

## Coach (optional)

The coach is hidden unless `VITE_COACH_URL` points to an endpoint that:

- takes `POST { prompt }`
- returns a JSON array of mission suggestions

The API key belongs on that server, never in this app. The app builds its prompt from your own profile (`src/lib/leveling/coach.ts`). It never sends your release plan, and it limits itself to 5 calls a day.

## Integrations

[`events.ts`](src/lib/leveling/events.ts) is the single entry point for activity from other apps, such as an adjudication report or a closed case.

- Only an event type, a category, a count and a date cross over. Names, IDs and notes never do.
- Every event carries an idempotency key, so the same event never pays twice.
