# Configuration

Every setting lives in `.env` (copied from `.env.example`, gitignored — never commit it). A tab with
nothing configured just shows "Not connected yet" instead of breaking the rest of the app.

| Variable | Powers | Required for |
|---|---|---|
| `GARMIN_EMAIL`, `GARMIN_PASSWORD` | Fitness → Garmin | steps, sleep, resting heart rate, recent activities |
| `ICLOUD_EMAIL`, `ICLOUD_APP_PASSWORD` | Today / calendar agenda | your iCloud calendars |
| `ICS_FEEDS` | Today / calendar agenda | any calendar you only *subscribe* to (course timetable, a Google Calendar) |
| `FOOTBALL_DATA_TOKEN` | Liverpool tab | optional: the next several fixtures instead of just one (see [§ Liverpool FC fixtures](#liverpool-fc-fixtures--football_data_token)) |
| `PORT` | — | which port the server listens on (default `3000`) |
| `HOST` | — | reach the dashboard from your other devices too (see [§ Other devices](#other-devices-tailscale)) |

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
- The server refreshes Garmin data itself **every hour** in the background (`server.js`, guarded by
  `GARMIN_EMAIL` being set) — the Garmin panel is never more than an hour stale even if you haven't
  opened it, no manual refresh needed. The "Refresh Garmin" button still forces an immediate check.

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

## Liverpool FC fixtures — `FOOTBALL_DATA_TOKEN`

```
FOOTBALL_DATA_TOKEN=your-free-api-key
```

Optional. Without it, the Liverpool tab still shows the single next fixture (via TheSportsDB, no
signup needed) — this key upgrades that to a real list of the next several. News and injuries are
unaffected either way; only the fixtures list uses this.

1. Register for a free account at [football-data.org](https://www.football-data.org/client/register)
   (free tier: 10 requests/minute, far more than this app's 10-minute cache needs).
2. Copy the API key it gives you into `.env` as above.

## Other devices (Tailscale)

By default the server only answers on `127.0.0.1` — reachable from this Mac, nothing else, which is
what keeps the lack of a login safe. `HOST` binds a **second** listener alongside that (the Mac itself
can still always use `localhost`), so another device you trust can reach it too.

```
HOST=100.73.58.127
```

**Use a [Tailscale](https://tailscale.com) IP here, not your Wi-Fi/LAN IP or `0.0.0.0`.** Tailscale is
a free, private mesh network: install it on this Mac and your phone, sign in with the same account on
both, and only those specific devices can ever reach each other — not your whole home Wi-Fi, not the
internet. Binding to a raw LAN IP or `0.0.0.0` instead would make it reachable by *anything* on the
same Wi-Fi network (roommates, guests, smart-home devices), with still no login to stop them.

1. Install Tailscale on this Mac and on your phone; sign in with the same account on both.
2. Find this Mac's Tailscale IP: `tailscale status` (menu bar app → that, or
   `/Applications/Tailscale.app/Contents/MacOS/Tailscale status`), or `tailscale ip -4` for just the IP.
3. Set `HOST` to that IP and restart the server (`launchctl kickstart -k
   gui/501/com.georgehadji.dashboard` — see [§ Running at login](#running-at-login-macos) — or
   `npm start` if running it manually).
4. On your phone, with Tailscale connected, open `http://<that IP>:3000`.

If Tailscale ever reassigns this Mac's IP (rare — only really happens if the device is removed and
re-added to your tailnet), check `tailscale ip -4` again and update `HOST` to match.

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
