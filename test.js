import assert from 'node:assert/strict';
import { matchups, pct, csv, isoDate, daysUntil } from './public/logic.js';

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
console.log('ok');
