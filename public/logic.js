// Pure helpers, kept separate so test.js can run them under node.

// match = { opp, oppCardId?, first: 'first'|'second', result: 'W'|'L' } → one row per opponent leader
// Grouped by oppCardId when a real card was picked, else by the typed name (case/space-insensitive).
export function matchups(matches) {
  const rows = new Map();
  for (const m of matches) {
    const key = m.oppCardId || m.opp.trim().toLowerCase();
    const r = rows.get(key) ?? { opp: m.opp.trim(), oppCardId: m.oppCardId, w: 0, l: 0, fw: 0, fl: 0, sw: 0, sl: 0 };
    const win = m.result === 'W';
    const side = m.first === 'first' ? 'f' : 's';
    r[win ? 'w' : 'l']++;
    r[side + (win ? 'w' : 'l')]++;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => b.w + b.l - (a.w + a.l));
}

export const pct = (w, l) => (w + l ? Math.round((100 * w) / (w + l)) : null);

export function csv(rows) {
  const p = (w, l) => pct(w, l) ?? '';
  const out = [['Opponent leader', 'Games', 'W', 'L', 'Win %', 'Going 1st W-L', 'Going 1st %', 'Going 2nd W-L', 'Going 2nd %']];
  for (const r of rows) out.push([r.opp, r.w + r.l, r.w, r.l, p(r.w, r.l), `${r.fw}-${r.fl}`, p(r.fw, r.fl), `${r.sw}-${r.sl}`, p(r.sw, r.sl)]);
  // quote every cell so a leader name with a comma can't shift columns
  return out.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

// Local-date helpers (toISOString would give UTC and flip the day around midnight)
export const isoDate = (d = new Date()) => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const daysUntil = (iso) => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso + 'T00:00') - t) / 864e5);
};
