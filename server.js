import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
try { process.loadEnvFile('.env'); } catch { /* no .env yet: integrations will say so */ }
const { garminToday } = await import('./lib/garmin.js');
const { upcomingEvents } = await import('./lib/calendar.js');
const { initCardsSchema, syncCards, searchCards, cardsMeta } = await import('./lib/cards.js');
const { extractText } = await import('./lib/cvImport.js');

mkdirSync('data', { recursive: true });
const db = new DatabaseSync('data/dashboard.db');
db.exec('create table if not exists docs(id integer primary key, kind text not null, data text not null)');
initCardsSchema(db);

// One generic JSON-doc store for everything the user types in by hand.
const KINDS = new Set(['deadline', 'deck', 'match', 'roadmap', 'meal', 'workout', 'lift', 'cv']);
const app = express();
app.use(express.json({ limit: '15mb' })); // raised for CV imports: a PDF/DOCX arrives base64-encoded in one request

// The page itself is never cached (some mobile browsers otherwise restore a stale copy from memory
// on tab-switch, skipping the network entirely) and always points at this server-run's own version
// of app.js/style.css — so every restart is guaranteed a fresh copy on next load, no manual hard-refresh needed.
const BUILD = String(Date.now());
const indexHtml = readFileSync('public/index.html', 'utf8').replace(/(app\.js|style\.css)/g, `$1?v=${BUILD}`);
app.get('/', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(indexHtml));
app.use(express.static('public'));

app.param('kind', (req, res, next, k) => (KINDS.has(k) ? next() : res.status(404).json({ error: 'unknown kind' })));
const row = (r) => ({ id: r.id, ...JSON.parse(r.data) });
const isObj = (b) => b && typeof b === 'object' && !Array.isArray(b);

app.get('/api/docs/:kind', (req, res) =>
  res.json(db.prepare('select * from docs where kind=? order by id').all(req.params.kind).map(row)));
app.post('/api/docs/:kind', (req, res) => {
  if (!isObj(req.body)) return res.status(400).json({ error: 'object body required' });
  const { lastInsertRowid: id } = db.prepare('insert into docs(kind,data) values(?,?)').run(req.params.kind, JSON.stringify(req.body));
  res.status(201).json({ id: Number(id), ...req.body });
});
app.put('/api/docs/:kind/:id', (req, res) => {
  if (!isObj(req.body)) return res.status(400).json({ error: 'object body required' });
  const { id: _drop, ...data } = req.body;
  const r = db.prepare('update docs set data=? where id=? and kind=?').run(JSON.stringify(data), req.params.id, req.params.kind);
  r.changes ? res.json({ id: +req.params.id, ...data }) : res.status(404).json({ error: 'not found' });
});
app.delete('/api/docs/:kind/:id', (req, res) => {
  db.prepare('delete from docs where id=? and kind=?').run(req.params.id, req.params.kind);
  res.status(204).end();
});

// One Piece card/leader data, cached locally so the deck builder doesn't hit optcgapi.com on every keystroke.
app.get('/api/cards', (req, res) => res.json(searchCards(db, req.query)));
app.get('/api/cards/meta', (req, res) => res.json(cardsMeta(db)));
app.get('/api/cards/byId', (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean);
  if (!ids.length) return res.json([]);
  res.json(db.prepare(`select * from cards where card_set_id in (${ids.map(() => '?').join(',')})`).all(...ids));
});
app.post('/api/cards/sync', async (req, res) => {
  try { res.json(await syncCards(db)); } catch (e) { res.status(502).json({ error: e.message }); }
});

// CV import: pulls plain text out of an uploaded PDF/DOCX. .txt/.md never hit this — the browser
// reads those itself — this is only for formats that need real parsing.
app.post('/api/cv/extract', async (req, res) => {
  const { filename, base64 } = req.body ?? {};
  if (!filename || !base64) return res.status(400).json({ error: 'filename and base64 required' });
  try { res.json({ text: await extractText(Buffer.from(base64, 'base64'), filename) }); }
  catch (e) { res.status(422).json({ error: e.message }); }
});

// External integrations: cached 10 min so tab-switching doesn't hammer Garmin/iCloud.
const cache = new Map();
const live = (name, fn) => app.get(`/api/${name}`, async (req, res) => {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.t < 6e5 && !req.query.refresh) return res.json(hit.v);
  try {
    const v = await fn();
    cache.set(name, { t: Date.now(), v });
    res.json(v);
  } catch (e) { res.status(502).json({ error: e.message }); }
});
live('garmin', garminToday);
live('calendar', upcomingEvents);

// Keeps the Garmin cache warm even when nobody has the tab open, so it's never more than an hour stale.
if (process.env.GARMIN_EMAIL) {
  const syncGarmin = () => garminToday().then((v) => cache.set('garmin', { t: Date.now(), v })).catch((e) => console.error('Garmin auto-sync failed:', e.message));
  syncGarmin();
  setInterval(syncGarmin, 60 * 60 * 1000);
}

// Always reachable from this Mac at localhost. HOST additionally binds a second listener there —
// e.g. a Tailscale IP, so your other tailnet devices can reach it too — without ever binding to the
// open LAN/Wi-Fi interface. There's still no login: only put a HOST here you trust as much as this Mac.
const port = process.env.PORT || 3000;
app.listen(port, '127.0.0.1', () => console.log(`Dashboard → http://localhost:${port}`));
if (process.env.HOST) app.listen(port, process.env.HOST, () => console.log(`Dashboard → http://${process.env.HOST}:${port}`));
