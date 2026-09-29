# HTTP API

Everything under `/api/` returns JSON. There's no authentication — see [Security](../README.md#security)
in the README. Errors come back as `{ "error": "message" }` with a non-2xx status; the frontend shows
that message directly (in the "Not connected yet…" banners, or as a toast).

## The generic document store — `/api/docs/:kind`

One table (`docs`, columns `id`, `kind`, `data` as a JSON blob) backs every hand-entered record. `:kind`
must be one of:

```
deadline · deck · match · roadmap · meal · workout · lift · cv
```

Any other value → `404 { "error": "unknown kind" }` (enforced in `server.js` via `app.param`).

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/docs/:kind` | — | `[{ id, ...fields }, …]`, ordered by `id` |
| `POST` | `/api/docs/:kind` | `{ ...fields }` (a JSON object) | `201` + the created row, with `id` |
| `PUT` | `/api/docs/:kind/:id` | `{ ...fields }` — full replacement, not a merge | the updated row, or `404` if `:id` doesn't exist |
| `DELETE` | `/api/docs/:kind/:id` | — | `204`, no body |

A `POST`/`PUT` body that isn't a plain object (e.g. an array, or missing entirely) → `400`.

### Record shapes

These aren't enforced server-side — the store is deliberately schema-less — but this is what
`public/app.js` reads and writes for each kind:

**`deadline`**
```jsonc
{ "title": "Assignment 2", "course": "CSU22014", "due": "2026-10-05", "done": false }
```

**`deck`**
```jsonc
{
  "name": "Red Luffy", "leader": "Monkey.D.Luffy (001)", "leaderCardId": "ST01-001", // leaderCardId is optional — absent until a real card is linked
  "cards": [{ "id": "OP01-016", "qty": 4 }, …] // up to 4 copies per card, no total-count enforcement
}
```

**`match`**
```jsonc
{
  "deckId": 37, "opp": "Roronoa Zoro (001)", "oppCardId": "OP01-001", // oppCardId optional, same as above
  "first": "first", // "first" | "second"
  "result": "W", // "W" | "L"
  "notes": "", "date": "2026-09-29"
}
```

**`roadmap`**
```jsonc
{ "phase": "Phase 1 · Foundations", "title": "The Digital World (days 1–20)", "sub": "…", "days": 20, "done": 11 }
```

**`meal`**
```jsonc
{ "day": "Monday", "meal": "First meal (11–12)", "text": "…" }
```

**`workout`**
```jsonc
{ "day": "Monday", "exercise": "Bench press", "sets": "3", "reps": "8", "weight": 60 }
```

**`lift`** — one row per exercise per day, written whenever a workout's weight changes or "Log" is pressed
```jsonc
{ "exercise": "Bench press", "weight": 62.5, "reps": "8", "date": "2026-09-29" }
```

**`cv`** — a single record (the frontend always reads/writes `list('cv')[0]`); `text` is plain
markdown-ish source rendered by `cvHtml()` in `public/logic.js` (`# ` name, `## ` section, `- ` bullet,
`**bold**`) — not a general markdown engine, just enough for a one-page CV. It's never typed by hand:
edit mode renders `cvHtml()` into a `contenteditable` div with a Bold/Title/Heading/List toolbar
(native `document.execCommand`, no editor dependency), and `htmlToCvText()` (`public/app.js`) walks
the edited DOM back into this same `#`/`##`/`-`/`**bold**` syntax on save. `original`, present only
after a PDF/DOCX/TXT/MD import, keeps the actual uploaded file (base64) so "View original" can open
the exact file — fonts, colours and layout the simplified `text` rendering can't keep
```jsonc
{
  "text": "# Jane Doe\nyou@example.com\n\n## Education\n**Trinity College Dublin** — BA…",
  "original": { "name": "Jane Doe CV.docx", "base64": "UEsDBBQABgAI…" }
}
```

### CV import — `POST /api/cv/extract`

Pulls plain text out of an uploaded PDF or Word file (see `lib/cvImport.js`, via `pdf-parse` and
`mammoth`). `.txt`/`.md` never reach this — the browser reads those itself with `FileReader`, no
round trip needed.

```jsonc
// request
{ "filename": "cv.pdf", "base64": "JVBERi0xLjQK…" }  // the whole file, base64-encoded
// response
{ "text": "Jane Doe\nyou@example.com\n…" }  // plain text only — headings/bullets/bold don't survive
```

`400` if `filename`/`base64` is missing, `422` with `{ "error": "Unsupported file type: …" }` for
anything other than `.pdf`/`.docx`. The body limit is raised to 15MB globally in `server.js` to fit
a base64-encoded file in one request.

The returned `text` is auto-formatted into the `#`/`##`/`-` syntax via `autoFormatCv()`
(`public/logic.js`, also used client-side for `.txt`/`.md`) — a heading/bullet/name heuristic for
plain text, plus (for `.docx` only) a first pass that reads Word's real heading styles, bold runs
and list structure via `mammoth.convertToHtml()` rather than the lossy `extractRawText()`.

## Live integrations

Each of these wraps a `lib/*.js` module and caches its result **in memory for 10 minutes** (a
`Map` in `server.js`, not persisted to disk) — pass `?refresh=1` to force a fresh fetch. A failed
fetch (bad/missing credentials, the upstream service down) returns `502 { "error": "…" }`.

| Path | Source | Shape |
|---|---|---|
| `GET /api/garmin` | `lib/garmin.js` | `{ steps, sleepHours, restingHr, weekAvgRestingHr, activities: [{ name, type, start, km, min }] }` — any field can be `null` if that metric hasn't synced. Also auto-refreshed hourly in the background (`server.js`), independent of anyone requesting it |
| `GET /api/calendar` | `lib/calendar.js` | `[{ title, cal, start, end, allDay, where, kind }, …]`, sorted by `start`. `cal` is the source calendar's name; `kind` (Lecture/Tutorial/Lab/Online) is only set for `ICS_FEEDS` events |

## One Piece card database

Backed by a local cache (`cards`/`meta` tables) synced from [optcgapi.com](https://optcgapi.com) —
see `lib/cards.js`. Nothing here requires the sync to have run; an empty cache just means every search
returns `[]` and the deck editor shows a "Sync card database" banner.

| Method | Path | Query / body | Returns |
|---|---|---|---|
| `GET` | `/api/cards` | `q` (name substring, case-insensitive), `type` (exact match, e.g. `Leader`), `limit` (default 30, capped at 100) | matching card rows |
| `GET` | `/api/cards/meta` | — | `{ syncedAt, count }` |
| `GET` | `/api/cards/byId` | `ids` — comma-separated card ids | those cards' full rows (for hydrating a cache client-side; unknown ids are just omitted) |
| `POST` | `/api/cards/sync` | — | `{ count, syncedAt }` after re-downloading every set/deck/promo from optcgapi.com (~45 requests, ~20s; see `lib/cards.js` for pacing) |

A card row:
```jsonc
{
  "card_set_id": "OP01-001", "name": "Roronoa Zoro (001)", "type": "Leader", "color": "Red",
  "cost": null, "power": "5000", "life": "5", "counter": null, "attribute": "Slash",
  "sub_types": "Straw Hat Crew Supernovas", "card_text": "…", "rarity": "L",
  "set_id": "OP-01", "set_name": "Romance Dawn", "image": "https://optcgapi.com/media/…"
}
```
