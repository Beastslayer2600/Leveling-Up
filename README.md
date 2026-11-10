# Leveling Up

A game-style life tracker with a dark "night ops" HUD. Missions earn XP and levels, and the app also tracks a daily Bible virtue, body and gym, social life, a money ledger with good and bad calls, a character sheet and 36 achievements.

Anyone can make it their own: on first run (and any time from **Character → Customize**) each player picks their currency, kg or lb, which modules to show (Faith, Journal, Body, Social, Money), and renames or switches off mission categories. Settings sync with the rest of the log.

It's an installable web app (PWA) that works offline. It runs on a laptop and on a phone.

## Tabs

- **Missions:** daily ops, one-off quests and tracked targets with weekly or monthly resets, plus the daily virtue (25 virtues, rotating by day of year) and the 7-day Release Reset questline.
- **Body:** gym sessions with automatic PB detection and an estimated 1RM (Epley), cardio, steps, weight trend and meals.
- **Social:** posts, catch-ups and events, plus how long since you last saw each group of friends.
- **Money:** a monthly ledger, the share of good calls and spending by category.
- **Character:** attributes that grow from XP, your current chapter, skills, abilities, achievements and backup/restore.

## Daily Rhythm

Two short daily quests, each shown one step at a time on a full-screen page built for a phone. Nothing in them ever takes XP away.

- **Morning Sequence** (`/today/morning`): Drink, Make bed, Room reset, Food + daylight, Briefing. One tap completes a step. Room reset runs a countdown and completes by itself. **Low day** reduces it to Drink + Make bed and still counts as a kept day. One missed day pauses the streak; two in a row reset it.
- **Evening Debrief** (`/today/debrief`): what got done, one feeling (saved to the Journal), a quick daily record, Home or Office tomorrow, tomorrow's main quest and three must-dos, a prep checklist, and the wake and screens-down times. It makes every choice the morning needs. If it's skipped, the morning still works: Home by default, and a short list to pick a main quest from.
- **Office days:** a 5-minute room reset and a sixth step, "Leave by HH:MM". The wake time moves earlier for that one day only when it has to.
- **Weekly review** (`/today/week`): mornings kept, debriefs completed, first-tap times against the wake time, and seven-day lines for the daily record beside the previous four-week average. Information only. The record exports as CSV and the page prints.
- **Build cap:** a new daily op can be added once every 14 days. Sooner than that, the app shows when the next slot opens and offers to park the idea in a Later list. Editing and removing is never blocked.
- **iPhone Shortcuts:** point "when alarm is stopped, open URL" at `https://<your site>/today/morning`, and a 21:30 automation at `/today/debrief`.
- **Tuning:** every time, XP amount and threshold is in [`src/lib/leveling/config.ts`](src/lib/leveling/config.ts).

It can be switched off under **Character → Customize**.

## Rules

- Player levels cost 100 × L XP to go from level L to L+1. Category levels cost 50 × L.
- Ticking a mission pays its XP, and unticking it takes the XP back. Hitting a tracked target pays a 2× bonus.
- A gym session pays 30 XP, plus 40 for each PB.
- Each achievement pays 50 XP.
- A quest with steps shows its first unfinished step as the next step. Finishing the last step completes the quest.
- Each Morning Sequence step pays 10 XP (8 Vitality + 2 Discipline; the Briefing pays 10 Discipline). Starting within 20 minutes of the wake time adds 15, and finishing all five within 45 minutes adds 25.

All of the game logic is pure and tested, in [`src/lib/leveling/`](src/lib/leveling).

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # logic tests
npm run build    # static site in dist/
```

### Local missions

To load a batch of missions into your local copy, copy `src/missions.example.json` to `src/missions.local.json` and edit it. `npm run dev` adds any missions from that file that aren't already in your log, and doesn't bring back ones you've deleted. A mission can carry `"main": true`, a `"nextStep"` or a list of `"steps"`, and `"unlockAfter"` / `"startFrom"` to stay off the board until later.

The same file can be loaded on any device, including the deployed app, with **Character → Profile & data → Import missions**. The file is git-ignored, so client names stay out of the repo, and the production build doesn't include it.

## Install as an app

- **Windows (Chrome or Edge):** open the site, then choose **Install app** in the address bar.
- **iPhone (Safari):** tap **Share**, then **Add to Home Screen**.

## Sync and sign-in

When the server has a database, the app asks you to sign in or create an account. Anyone can sign up, and each account has its own log, journal and voice notes, synced between that person's devices. Signing out clears the log from that device, so people can share a phone or laptop.

- **Vercel environment variables:**
  - `DATABASE_URL`: Postgres. Neon, connected through Vercel's Storage tab, sets this for you.
  - `AUTH_SECRET`: a long random string that signs the session cookie.
  - `OWNER_EMAIL`: optional. Your own account's email: XP events from other apps go to it, and it can always sign up even when an invite code is set.
  - `INVITE_CODE`: optional. When set, new accounts need this code to sign up. Leave it unset to let anyone sign up.
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
