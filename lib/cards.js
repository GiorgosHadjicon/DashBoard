const BASE = 'https://optcgapi.com/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`optcgapi ${path}: HTTP ${r.status}`);
  return r.json();
}

const COLS = ['card_set_id', 'name', 'type', 'color', 'cost', 'power', 'life', 'counter', 'attribute', 'sub_types', 'card_text', 'rarity', 'set_id', 'set_name', 'image'];
const toRow = (c) => [c.card_set_id, c.card_name, c.card_type, c.card_color, c.card_cost, c.card_power, c.life, c.counter_amount, c.attribute, c.sub_types, c.card_text, c.rarity, c.set_id, c.set_name, c.card_image];

export function initCardsSchema(db) {
  db.exec(`create table if not exists cards(${COLS.map((c) => `${c} text`).join(',')}, primary key(card_set_id))`);
  db.exec('create table if not exists meta(key text primary key, value text)');
}

// Pulls every set, starter deck and promo card from optcgapi.com into the local `cards` table.
// ~45 requests to a small free API, so it's paced with a short delay. Only runs when asked (Sync button).
export async function syncCards(db) {
  const [sets, decks] = await Promise.all([getJSON('/allSets/'), getJSON('/allDecks/')]);
  const groups = [...sets.map((s) => ['sets', s.set_id]), ...decks.map((d) => ['decks', d.structure_deck_id])];
  const insert = db.prepare(`insert or replace into cards(${COLS.join(',')}) values (${COLS.map(() => '?').join(',')})`);
  let count = 0;
  for (const [kind, id] of groups) {
    const cards = await getJSON(`/${kind}/${id}/`).catch(() => []);
    db.exec('begin');
    for (const c of cards) { insert.run(...toRow(c)); count++; }
    db.exec('commit');
    await sleep(120);
  }
  const promos = await getJSON('/allPromoCards/').catch(() => []);
  db.exec('begin');
  for (const c of promos) { insert.run(...toRow(c)); count++; }
  db.exec('commit');
  db.prepare('insert or replace into meta(key,value) values (?,?)').run('cards_synced_at', new Date().toISOString());
  return { count, syncedAt: new Date().toISOString() };
}

export function searchCards(db, { q = '', type = '', limit = 30 } = {}) {
  let sql = 'select * from cards where 1=1';
  const args = [];
  if (type) { sql += ' and type = ?'; args.push(type); }
  if (q) { sql += ' and name like ? collate nocase'; args.push(`%${q}%`); }
  sql += ' order by name limit ?'; args.push(Math.min(+limit || 30, 100));
  return db.prepare(sql).all(...args);
}

export function cardsMeta(db) {
  const at = db.prepare('select value from meta where key=?').get('cards_synced_at')?.value ?? null;
  const count = db.prepare('select count(*) c from cards').get().c;
  return { syncedAt: at, count };
}
