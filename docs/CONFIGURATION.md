# Configuration

Every setting lives in `.env` (copied from `.env.example`, gitignored — never commit it). A tab with
nothing configured just shows "Not connected yet" instead of breaking the rest of the app.

| Variable | Powers | Required for |
|---|---|---|
| `GARMIN_EMAIL`, `GARMIN_PASSWORD` | Fitness → Garmin | steps, sleep, resting heart rate, recent activities |
| `ICLOUD_EMAIL`, `ICLOUD_APP_PASSWORD` | Today / calendar agenda | your iCloud calendars |
| `ICS_FEEDS` | Today / calendar agenda | any calendar you only *subscribe* to (course timetable, a Google Calendar) |
| `PORT` | — | which port the server listens on (default `3000`) |

## Garmin

```
GARMIN_EMAIL=you@example.com
GARMIN_PASSWORD=your-garmin-password
```

Uses the unofficial [`garmin-connect`](https://www.npmjs.com/package/garmin-connect) package — there's
no official public API for personal accounts. This means:

- It can break if Garmin changes their internal login flow. If Garmin stops working, that's the first
  place to look (`npm outdated garmin-connect`, then check the package's own issue tracker).
- Two-factor login on the Garmin account isn't handled. If your login has 2FA, this won't authenticate.
- A successful login is cached to `data/garmin-tokens` (gitignored) so the server doesn't re-log-in on
  every request — only when the cached session stops working.

## iCloud Calendar (CalDAV)

```
ICLOUD_EMAIL=you@icloud.com
ICLOUD_APP_PASSWORD=abcd-efgh-ijkl-mnop
```

This is **not** your Apple ID password. Generate a dedicated one:

1. Sign in at [appleid.apple.com](https://appleid.apple.com).
2. **Sign-In and Security** → **App-Specific Passwords** → **+**.
3. Name it (e.g. "Dashboard") and copy the code — it's shown once, in the `xxxx-xxxx-xxxx-xxxx` format.

`lib/calendar.js` fetches **every** calendar your account owns over CalDAV — there's no allow-list, so
a calendar you create in Apple Calendar shows up automatically next time the server restarts (results
are cached in memory for 10 minutes; add `?refresh=1` to `/api/calendar` to bypass that, or use the
Refresh button on the Garmin panel's pattern if one is added for calendar later).

**What CalDAV can't see:** a calendar you only *subscribed* to (File → New Calendar Subscription in
Apple Calendar, or a `webcal://` link someone sent you) never appears here. It's not a calendar your
iCloud account owns — each device just polls that URL on its own. Use `ICS_FEEDS` for those instead.

## Subscribed calendars — `ICS_FEEDS`

For any calendar that's really just a URL feed: a university timetable, a Google Calendar, an Apple
calendar subscription. Format is `Name=URL`, and you can list more than one either on separate lines
(quoting the whole value) or separated by `" | "` on one line — the second avoids `.env`'s multi-line
quoting entirely:

```
ICS_FEEDS=SCSS Timetable=https://example.edu/timetable.ics | Personal=https://calendar.google.com/calendar/ical/you%40gmail.com/private-xxxx/basic.ics
```

**These URLs are as sensitive as a password** — anyone with the link can read that calendar. Never
share them or paste them anywhere public.

### Getting a feed URL

**Google Calendar:**
1. [calendar.google.com](https://calendar.google.com) → gear icon → **Settings**.
2. Under "Settings for my calendars," pick the calendar (usually your name).
3. Scroll to **Integrate calendar** → copy **Secret address in iCal format** (ends in `basic.ics`).
   Don't use "Public URL to this calendar" — that only works if the calendar is public.

**Apple Calendar subscription:**
- **Mac:** right-click the calendar in the sidebar → **Get Info** → if it's a subscription, its URL
  is shown there.
- **iPhone:** Settings → Calendar → Accounts → Subscribed Calendars.

**Blackboard / university timetable:** usually under a "Calendar" or "Export" section of the student
portal, offered as an `.ics` link tied to a private token in the URL.

`webcal://` links work as-is — the code rewrites that scheme to `https://` before fetching.

### Timetable-style cleanup

Titles and locations from `ICS_FEEDS` get tidied up automatically (your own iCloud calendars are left
exactly as you wrote them):

| Raw (from the feed) | Shown as |
|---|---|
| `STU22004 - ST2004 APPLIED PROBABILITY I` | **Applied Probability I** |
| `03.008 - E3LF DIGITAL MEDIA LAB 03.008 (D) [E3 Learning Foundry]` | **E3 Learning Foundry** |
| `Event Type:LECTURE` (in the description) | a **Lecture** badge |

Only titles that actually look like `CODE - NAME` get rewritten (a course code, all caps) — anything
else, like an assignment deadline title, is left untouched rather than guessed at. See
`lib/calendar.js` (`tidyTitle`, `tidyWhere`, `tidyKind`) if a different feed's format needs different
handling.

## Data on disk

Everything the server persists lives under `data/` (gitignored, created automatically):

| File | Contents |
|---|---|
| `dashboard.db` | SQLite: every hand-entered record (deadlines, decks, matches, meals, workouts, lifts, roadmap) plus the cached One Piece card database |
| `garmin-tokens` | Cached Garmin login session |

Deleting `data/` resets the dashboard to empty — there's no other copy of your typed-in data, so back
it up (or `git`-track it privately elsewhere) if that matters to you. It's gitignored deliberately,
since it can contain personal schedule/health data.

## Running at login (macOS)

The server is registered as a per-user `launchd` agent, so it starts automatically when you log in and
restarts itself if it ever crashes:

```
~/Library/LaunchAgents/com.georgehadji.dashboard.plist
```

It runs `node server.js` with `/Users/georgehadji/Documents/GitHub/DashBoard` as its working directory
(so it reads that folder's `.env` and `data/`), and logs to:

```
~/Library/Logs/dashboard.log      # stdout — just the "Dashboard → http://localhost:3000" line
~/Library/Logs/dashboard.err.log  # stderr — look here first if it's not responding
```

Useful commands (all with your own user id — `id -u`, normally `501` for the first account on a Mac):

```bash
launchctl print gui/501/com.georgehadji.dashboard   # is it running? what's its pid?
launchctl kickstart -k gui/501/com.georgehadji.dashboard   # restart it now (e.g. after editing .env)
launchctl bootout gui/501/com.georgehadji.dashboard   # stop it and don't restart at next login
launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.georgehadji.dashboard.plist   # start it again
```

**After changing `.env` or the code**, restart it with `kickstart -k` (or bootout + bootstrap) — it
won't pick up changes on its own, same as any other running server.

**To remove autostart entirely:** `launchctl bootout gui/501/com.georgehadji.dashboard`, then delete
the plist file above.
