# Grand Line — Personal Dashboard

A local-first personal dashboard: school deadlines, Garmin, calendars (iCloud + any subscribed feed,
like a university timetable), an important-things-first "Today" view, a One Piece TCG deck & match-up
tracker with real card data, a course roadmap, and a weekly diet + workout log with progress tracking.

No account, no cloud, no build step. It's one small Node server plus a hand-rolled frontend, and it
runs on your own machine.

## Quickstart

```bash
npm install
cp .env.example .env   # fill in what you want connected — see docs/CONFIGURATION.md
npm start              # → http://localhost:3000
```

Everything works with `.env` empty except the hand-entered tabs — Garmin and the calendar just show
"Not connected yet" with the reason, instead of breaking anything else.

On this Mac it also starts automatically at login and restarts itself if it crashes, via a `launchd`
agent — see [CONFIGURATION.md § Running at login](docs/CONFIGURATION.md#running-at-login-macos).

```bash
npm test               # runs the logic.js test suite (node:assert, no framework)
```

## What's in it

| Tab | What it shows | Where the data comes from |
|---|---|---|
| **Today** | A daily summary: due-soon deadlines, the next 7 days across every calendar, today's workout and meals, your MyFirstHack progress, and your best/toughest One Piece match-ups | everything below, pulled together |
| **School** | Deadlines grouped as Overdue / This week / Later, module picked from a list instead of typed; a fixed course's project milestones grouped in their own section | typed in |
| **To-Do** | A plain checklist for anything that isn't school — no due date, just text and done; group items under a free-text heading (e.g. "Apply to" → company names) | typed in |
| **Fitness** | Three panels: **Workouts** (weights with +/− steppers and a progress history), **Diet** (a per-day meal plan), **Garmin** (steps, sleep, resting heart rate, recent activities) | typed in (Workouts, Diet) · Garmin Connect (Garmin), auto-refreshed hourly |
| **One Piece** | Deck builder with real leader/card data (search, thumbnails, import/export as text) and a match-up tracker (win % overall, going 1st, going 2nd, per opponent leader) | typed in + [optcgapi.com](https://optcgapi.com)'s card database |
| **MyFirstHack** | A roadmap of the course, seeded from its site, with per-module progress bars | seeded once, then edited by hand |
| **CV** | Edit like a normal document — select text, click Bold/Heading/List, no typed syntax — then print/save-as-PDF; import an existing one (`.txt`, `.md`, `.pdf`, `.docx`) by picking or dragging it in. A `.docx` import is shown with its real fonts/colours/spacing, not our own styling | typed in, or imported |
| **Liverpool** | Next fixture (or the next 5, with a free key), current injuries and recent news | [TheSportsDB](https://www.thesportsdb.com) (next fixture, no signup), [football-data.org](https://www.football-data.org) (next 5 fixtures — optional `FOOTBALL_DATA_TOKEN`), [This Is Anfield](https://www.thisisanfield.com)'s RSS (news), [physioroom.com](https://www.physioroom.com) (injuries — scraped, the one fragile source here) |

The calendar isn't a separate tab — it's folded into Today's "Next 7 days" agenda, merged from every
source you've configured (iCloud calendars + any `ICS_FEEDS`).

## Documentation

- **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)** — every `.env` variable: what it does, how to get
  the credential, and what breaks without it.
- **[docs/API.md](docs/API.md)** — the full HTTP API, including the shape of every stored record.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how the code is organized and why, for anyone
  (including future-you) making changes.

## Security

- Binds to `127.0.0.1` only by default — not reachable from your network as shipped.
- **No authentication.** Anyone who can reach the port can read and write everything.
- `.env` holds real credentials and private feed URLs (treat those URLs like passwords). It's
  gitignored — never commit it, and never paste its contents somewhere public.
- To reach it from another device (e.g. your phone), the app-level answer isn't authentication —
  it's [Tailscale](docs/CONFIGURATION.md#other-devices-tailscale): only your own signed-in devices
  can connect, so there's nothing to log into on the dashboard itself. Don't bind `HOST` to your raw
  LAN IP or `0.0.0.0` instead — that opens it to your whole Wi-Fi network with still no login.
- See [ARCHITECTURE.md § Security posture](docs/ARCHITECTURE.md#security-posture) for the full picture.

## Known gaps

These were left out deliberately, not missed:

- **Email** was pulled — TCD's Microsoft 365 mail needs OAuth or a forwarding rule that TCD may block,
  and it wasn't worth the complexity for one inbox. The old code is still in git history
  (`git log --all --full-history -- lib/mail.js`) if it's worth reviving later.
- **No deck color-legality checking** (a Red leader "legally" holding a Blue card isn't flagged).
- **No DON!! cards** in the deck builder — they don't affect the 50-card deck list.
- Garmin **two-factor login isn't supported** — see [CONFIGURATION.md](docs/CONFIGURATION.md#garmin).
