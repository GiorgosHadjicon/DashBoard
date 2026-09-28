import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
try { process.loadEnvFile('.env'); } catch { /* no .env yet: integrations will say so */ }
const { garminToday } = await import('./lib/garmin.js');
const { upcomingEvents } = await import('./lib/calendar.js');
const { importantMail } = await import('./lib/mail.js');

mkdirSync('data', { recursive: true });
const db = new DatabaseSync('data/dashboard.db');
db.exec('create table if not exists docs(id integer primary key, kind text not null, data text not null)');

// One generic JSON-doc store for everything the user types in by hand.
const KINDS = new Set(['deadline', 'deck', 'match', 'roadmap', 'meal', 'workout', 'lift']);
const app = express();
app.use(express.json());
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

// External integrations: cached 10 min so tab-switching doesn't hammer Garmin/iCloud/Gmail.
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
live('mail', importantMail);

// 127.0.0.1 only: no auth, and .env holds your logins. Add auth before hosting it anywhere.
const port = process.env.PORT || 3000;
app.listen(port, '127.0.0.1', () => console.log(`Dashboard → http://localhost:${port}`));
