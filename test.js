import assert from 'node:assert/strict';
import { matchups, pct, csv, isoDate, daysUntil, parseDeckText, buildDeckText, cvHtml } from './public/logic.js';

const m = (opp, first, result) => ({ opp, first, result });
const rows = matchups([
  m('Luffy', 'first', 'W'), m('luffy ', 'first', 'L'), m('Luffy', 'second', 'W'), m('Luffy', 'first', 'W'),
  m('Zoro, the Swordsman', 'second', 'L'),
]);
assert.equal(rows.length, 2, 'case/space-insensitive grouping');
assert.deepEqual(rows[0], { opp: 'Luffy', oppCardId: undefined, w: 3, l: 1, fw: 2, fl: 1, sw: 1, sl: 0 });
assert.equal(pct(rows[0].fw, rows[0].fl), 67);
assert.equal(pct(0, 0), null);
assert.match(csv(rows), /"Zoro, the Swordsman","1","0","1","0"/);

// oppCardId groups two differently-typed names as one leader once a real card is picked
const byId = matchups([
  { opp: 'red zoro', oppCardId: 'OP01-001', first: 'first', result: 'W' },
  { opp: 'Roronoa Zoro (001)', oppCardId: 'OP01-001', first: 'second', result: 'L' },
]);
assert.equal(byId.length, 1);
assert.deepEqual(byId[0], { opp: 'red zoro', oppCardId: 'OP01-001', w: 1, l: 1, fw: 1, fl: 0, sw: 0, sl: 1 });
assert.equal(daysUntil(isoDate()), 0);
assert.equal(daysUntil(isoDate(new Date(Date.now() + 864e5))), 1);

// deck import/export: several real-world-ish formats parse the same way, and clamps to 4 copies
const parsed = parseDeckText(`
  Leader: OP01-001 Roronoa Zoro
  4x OP01-016 Nami
  2 OP01-015 Tony Tony.Chopper  # comment
  OP01-015 x3
  5x OP99-999 Too Many Copies
`);
assert.equal(parsed.leaderId, 'OP01-001');
assert.deepEqual(new Map(parsed.cards.map((c) => [c.id, c.qty])), new Map([['OP01-016', 4], ['OP01-015', 4 /* clamped from 2+3 */], ['OP99-999', 4 /* clamped from 5 */]]));
const roundtrip = parseDeckText(buildDeckText({ leaderCardId: 'OP01-001', cards: [{ id: 'OP01-016', qty: 4 }] }, (id) => (id === 'OP01-001' ? { name: 'Zoro' } : undefined)));
assert.equal(roundtrip.leaderId, 'OP01-001');
assert.deepEqual(roundtrip.cards, [{ id: 'OP01-016', qty: 4 }]);

// CV markdown: headings, bullets, bold, blank-line paragraph breaks, and self-escaping
assert.equal(
  cvHtml('# Jane Doe\n\n## Skills\n- **JS** and HTML\n- SQL\n\nOpen to work <script>'),
  '<h1>Jane Doe</h1><h2>Skills</h2><ul><li><b>JS</b> and HTML</li><li>SQL</li></ul><p>Open to work &lt;script&gt;</p>',
);
console.log('ok');
