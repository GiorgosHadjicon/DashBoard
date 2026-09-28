import assert from 'node:assert/strict';
import { matchups, pct, csv, isoDate, daysUntil } from './public/logic.js';

const m = (opp, first, result) => ({ opp, first, result });
const rows = matchups([
  m('Luffy', 'first', 'W'), m('luffy ', 'first', 'L'), m('Luffy', 'second', 'W'), m('Luffy', 'first', 'W'),
  m('Zoro, the Swordsman', 'second', 'L'),
]);
assert.equal(rows.length, 2, 'case/space-insensitive grouping');
assert.deepEqual(rows[0], { opp: 'Luffy', w: 3, l: 1, fw: 2, fl: 1, sw: 1, sl: 0 });
assert.equal(pct(rows[0].fw, rows[0].fl), 67);
assert.equal(pct(0, 0), null);
assert.match(csv(rows), /"Zoro, the Swordsman","1","0","1","0"/);
assert.equal(daysUntil(isoDate()), 0);
assert.equal(daysUntil(isoDate(new Date(Date.now() + 864e5))), 1);
console.log('ok');
