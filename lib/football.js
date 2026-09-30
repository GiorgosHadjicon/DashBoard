// Liverpool FC: next fixture, news, injuries. Three different free sources, none needing an API key:
// - fixture: TheSportsDB's public "3" test key (no signup — see their docs, this is the documented
//   free-tier key for exactly this kind of use).
// - news: This Is Anfield's own RSS feed — a dedicated LFC news site, robots.txt explicitly allows it.
// - injuries: no free structured API exists for this at all, so it's scraped from physioroom.com's
//   public injury table (robots.txt allows this path) — the one genuinely fragile piece here: it
//   breaks silently if they change their page layout.
const UA = 'Mozilla/5.0 (compatible; PersonalDashboard/1.0; +local use, not a crawler)';
const TEAM_ID = '133602'; // Liverpool FC, TheSportsDB

export async function nextFixture() {
  const r = await fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=${TEAM_ID}`);
  if (!r.ok) throw new Error(`TheSportsDB ${r.status}`);
  const e = (await r.json()).events?.[0];
  if (!e) return null;
  const home = e.idHomeTeam === TEAM_ID;
  return { opponent: home ? e.strAwayTeam : e.strHomeTeam, home, competition: e.strLeague, venue: e.strVenue, kickoff: `${e.strTimestamp}Z` };
}

const stripCdata = (s) => s.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').trim();
const tag = (block, name) => stripCdata(block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '');
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#8211': '–', '#8217': '’', nbsp: ' ' };
const decodeEntities = (s) => s.replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m);

export async function news(limit = 12) {
  const r = await fetch('https://www.thisisanfield.com/feed/', { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`This Is Anfield ${r.status}`);
  const items = [...(await r.text()).matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit);
  return items.map(([, block]) => ({ title: decodeEntities(tag(block, 'title')), link: tag(block, 'link'), pubDate: tag(block, 'pubDate') }));
}

export async function injuries() {
  const r = await fetch('https://www.physioroom.com/advice/premier-league-injury-table/', { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`physioroom ${r.status}`);
  const html = await r.text();
  // the page has several tables (a per-club injury count, this player list, injury types by club,
  // ...) — anchoring on this specific section's own id, rather than any table's header text alone,
  // is what actually pins down the right one (two other tables also happen to say "Injury"+"Team")
  const idx = html.indexOf('id="player-injury-list"');
  if (idx === -1) return [];
  const row = html.slice(idx).match(/<tr>\s*<td>Liverpool<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/);
  if (!row) return [];
  const players = row[1].split(',').map((s) => decodeEntities(s.trim())).filter(Boolean);
  const types = row[2].split(',').map((s) => decodeEntities(s.trim()));
  return players.map((player, i) => ({ player, injury: types[i] || 'Injury' }));
}
