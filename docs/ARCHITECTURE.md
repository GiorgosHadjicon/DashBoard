# Architecture

A tour of how this is built and why, for whoever (probably future-you) next opens this codebase.

## Stack, and why so little of it

Node ≥ 22.5, Express, SQLite, and a frontend with **no build step, no framework, and one dependency
(none)**. That's deliberate, not an oversight:

- **`node:sqlite`** (built into Node ≥ 22.5) instead of `better-sqlite3` — no native module to compile.
- **`process.loadEnvFile('.env')`** (built in since Node 20.6) instead of the `dotenv` package.
- **Global `fetch`** everywhere instead of `axios`/`node-fetch`.
- **Native ES modules** (`<script type="module">`, top-level `import`) in the browser instead of a
  bundler — there are three frontend files (`app.js`, `logic.js`, `style.css`) and no reason to bundle
  them.

The only real dependencies are things a personal server genuinely can't do without: `express` (routing),
`tsdav` + `node-ical` (CalDAV + iCalendar parsing — writing an RFC 4791 client from scratch isn't a
reasonable Tuesday), and `garmin-connect` (Garmin has no public API for personal accounts).

## File map

```
server.js           Express app: routes + the SQLite connection
lib/
  garmin.js          Garmin Connect → today's steps/sleep/HR/activities
  calendar.js         iCloud CalDAV + ICS_FEEDS → merged, sorted event list
  cards.js             optcgapi.com → local card/leader cache
public/
  index.html           the only HTML file; everything else renders into <main>
  app.js               the whole frontend: routing, rendering, every action handler
  logic.js             pure functions used by app.js AND test.js (no DOM, no fetch)
  style.css            one stylesheet, CSS custom properties for light/dark
test.js               plain node:assert tests for logic.js, run with `npm test`
data/                gitignored: dashboard.db (SQLite) + garmin-tokens
```

## Backend: one generic table, a few typed ones

`server.js` is short on purpose. Most of the app's data (deadlines, decks, matches, meals, workouts,
lifts, the MyFirstHack roadmap) goes through **one table**:

```sql
docs(id integer primary key, kind text not null, data text not null)  -- data is a JSON blob
```

routed generically through `/api/docs/:kind` (see [API.md](API.md)). Adding a new kind of thing to
track (say, a habit tracker) is a `KINDS.add('habit')` in `server.js` plus a new `views.habit` in
`app.js` — no migration, no new table.

Two things get their own real schema, because they need it:
- **`cards`/`meta`** (`lib/cards.js`) — a local mirror of optcgapi.com's card database, queried with
  `LIKE` for the type-ahead search. A JSON blob wouldn't be searchable without loading it all into
  memory every request.
- **Garmin and calendar data aren't stored at all.** They're fetched live and cached in memory for 10
  minutes (a plain `Map` in `server.js`) — there's nothing to migrate or back up, and "live" is the
  point.

## Frontend: a ~500-line render loop, no framework

The whole UI is `public/app.js`. The pattern:

1. **`views`** is a map of tab name → async function that returns an HTML string (built with template
   literals; every user-supplied value goes through `esc()` first — this is hand-rolled HTML, so that
   escape is the only thing standing between a deadline titled `<img onerror=...>` and stored XSS).
2. **`render()`** looks at `location.hash`, calls the matching view, and replaces `main.innerHTML`
   wholesale. There's no virtual DOM and no diffing — for a personal dashboard's data volumes, a full
   re-render is cheap enough that it's not worth the complexity of avoiding it.
3. **Actions are wired declaratively**: any element with `data-click="foo"` calls `actions.foo` on
   click (same pattern for `data-change`, `data-input`, `data-submit`), via delegated listeners on
   `<main>` — so new markup never needs new `addEventListener` calls, it just needs the right
   `data-*` attribute. After an action runs, `render()` fires again automatically, unless:
   - the action's name is in `keepDom` (typing into the meal textarea, or a live card search, would
     lose cursor focus or its dropdown on every keystroke if the whole page redrew), or
   - the action returns the string `'skip'` (used once: picking a card into a half-filled *form*, where
     a full re-render would wipe the other fields the user already typed).

### The type-ahead picker

`leaderPicker()` and `deckAddPicker()` (top of `app.js`) build the same widget in two flavours: a
search input, a results dropdown populated via `/api/cards`, and a click handler that either fills a
sibling form field (`mode: 'form'`) or immediately saves to a deck (`mode: 'save'`). Every instance
gets a `data-key` so `lastSearch[key]` can find its own results again when a result is clicked —
this is what lets multiple pickers (the match-log form, several decks' "link a leader," several
decks' "add a card") coexist on one page without stepping on each other.

### Why `logic.js` is separate

Anything that's pure data transformation — grouping matches into a matchup table, computing win
percentages, building/parsing a deck's plain-text export, date math — lives in `logic.js` and gets
imported by both `app.js` (in the browser) and `test.js` (under plain `node`). No DOM, no `fetch`,
nothing that needs a browser to run. That split is what makes `npm test` possible without a test
runner or a headless browser.

## Testing

`test.js` is one file of `node:assert` calls against `logic.js`, run with `node test.js`
(`npm test`). No framework, no fixtures — the bar for adding a test here is "logic worth getting
wrong," not "every function." See it run in ~50ms with `npm test`.

Nothing in `server.js`, `lib/*.js`, or `app.js`'s DOM wiring is unit-tested; those were checked by
hand against the real APIs during development (real Garmin account, real iCloud calendars, a live
optcgapi.com sync) rather than mocked, since the whole point of each was "does it actually talk to
this external, uncontrollable-by-us API correctly."

## Security posture

- The server binds to `127.0.0.1` only (`server.js`, last line) — not reachable from your network,
  let alone the internet, as shipped.
- There is **no authentication**. Anyone who can reach the port can read and write everything.
- `.env` holds real passwords and feed URLs; it's gitignored and must stay that way.
- If this ever gets deployed somewhere reachable by more than "this one Mac," add auth first — that's
  not a "nice to have," it's a precondition, since `.env` alone won't protect a publicly reachable port.

See [CONFIGURATION.md](CONFIGURATION.md) for what goes in `.env` and why.
