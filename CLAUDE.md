# Grand Line — Personal Dashboard

Local-first personal dashboard (school deadlines, Garmin, calendars, One Piece TCG decks/match-ups, MyFirstHack roadmap, diet/workout, CV, Liverpool). Details: `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/CONFIGURATION.md`.

## Commands
- `npm start` — server on http://localhost:3000 (`node server.js`, needs Node >= 22.5 for `node:sqlite`)
- `npm test` — `node test.js`, plain `node:assert` tests of `public/logic.js`. No framework.
- Restart after any server/`lib/` change: kill the process on :3000, then `npm start`. It also runs under a launchd agent at login (see `docs/CONFIGURATION.md`).

## Layout
- `server.js` — Express 5 app, ESM. One SQLite file `data/dashboard.db`.
- `lib/` — integrations: `garmin.js`, `calendar.js` (iCloud CalDAV + ICS feeds), `cards.js` (optcgapi card sync), `cvImport.js`, `football.js`.
- `public/` — hand-rolled frontend, no build step: `index.html`, `app.js`, `style.css`, `logic.js` (pure functions, the only tested code).
- `data/` (db, Garmin tokens) and `.env` are gitignored. Never commit them or print their contents.

## Conventions
- Hand-entered data uses one generic table `docs(id, kind, data json)`. To add a new kind, add it to `KINDS` in `server.js`; routes are `/api/docs/:kind`.
- External integrations go through `live(name, fn)` in `server.js` (10 min cache, `?refresh=1` bypasses, errors -> 502 `{error}`). A missing config must show "Not connected yet", never break other tabs.
- Put testable logic in `public/logic.js` and add asserts to `test.js`.
- No login: server binds 127.0.0.1 (plus optional `HOST`, use a Tailscale IP only, never 0.0.0.0).
- Keep it dependency-light; prefer stdlib/native over new packages.

## Config
`.env` keys are documented in `.env.example`: `GARMIN_EMAIL/PASSWORD`, `ICLOUD_EMAIL/APP_PASSWORD`, `ICS_FEEDS`, `PORT`, `HOST`, `FOOTBALL_DATA_TOKEN`.
