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

// Deck import/export as plain text, so a decklist can be copy-pasted in or out.
// Format: "Leader: OP01-001 Name" then one "4x OP01-016 Name" line per card. The name is a comment —
// only the card id and quantity are read back — so most community decklist formats parse too.
const CARD_ID = /\b([A-Za-z]{2,5}\d{1,3}-\d{1,4})\b/;
const QTY = /(\d+)\s*x\b|\bx\s*(\d+)|^(\d+)\b|\((\d+)\)/i;

export function parseDeckText(text) {
  let leaderId = null;
  const counts = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$|\/\/.*$/, '').trim();
    if (!line) continue;
    const id = line.match(CARD_ID)?.[1]?.toUpperCase();
    if (!id) continue;
    if (/^leader\b/i.test(line)) { leaderId = id; continue; }
    const m = line.match(QTY);
    const qty = Math.max(1, +(m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4] ?? 1));
    counts.set(id, (counts.get(id) ?? 0) + qty);
  }
  return { leaderId, cards: [...counts].map(([id, qty]) => ({ id, qty: Math.min(qty, 4) })) };
}

// lookup(id) => card row or undefined, for the optional name comment.
export function buildDeckText(deck, lookup) {
  const lines = [];
  if (deck.leaderCardId) lines.push(`Leader: ${deck.leaderCardId} ${lookup(deck.leaderCardId)?.name ?? ''}`.trimEnd());
  else if (deck.leader) lines.push(`Leader: ${deck.leader}`);
  for (const { id, qty } of deck.cards ?? []) lines.push(`${qty}x ${id} ${lookup(id)?.name ?? ''}`.trimEnd());
  return lines.join('\n');
}

// CV markdown -> HTML. Deliberately not a general markdown engine — just enough for a one-page CV:
// "# " name, "## " section headings, "- " bullets, "**bold**", blank-line-separated paragraphs.
// Escapes everything itself, so this is the only place CV text ever becomes HTML.
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function cvHtml(md) {
  const bold = (s) => escHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
  for (const raw of (md ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    if (line.startsWith('# ')) { closeList(); out.push(`<h1>${bold(line.slice(2))}</h1>`); }
    else if (line.startsWith('## ')) { closeList(); out.push(`<h2>${bold(line.slice(3))}</h2>`); }
    else if (line.startsWith('- ')) { (list ??= []).push(`<li>${bold(line.slice(2))}</li>`); }
    else { closeList(); out.push(`<p>${bold(line)}</p>`); }
  }
  closeList();
  return out.join('');
}

// Best-effort formatting of raw extracted text (a pasted/imported CV) into the "#"/"##"/"-" syntax
// cvHtml() reads. Heuristics, not a real parser — there's no reliable signal in plain text for what
// should be bold, so that's left alone. Any line that's already "#"/"##"/"-"-prefixed (e.g. real
// headings/bullets a smarter DOCX conversion already recovered) is kept exactly as-is, never
// re-wrapped — but a document being partly formatted doesn't stop the rest from still being read.
const CV_SECTIONS = new Set([
  'education', 'experience', 'work experience', 'employment', 'employment history', 'professional experience',
  'skills', 'technical skills', 'key skills', 'core skills',
  'projects', 'personal projects', 'certifications', 'certificates', 'awards', 'achievements',
  'languages', 'volunteering', 'volunteer experience', 'publications', 'references',
  'profile', 'summary', 'objective', 'about', 'about me', 'interests', 'hobbies', 'activities',
  'extracurricular', 'extracurricular activities', 'leadership', 'training', 'courses',
]);
const ALLCAPS_HEADING = /^[A-Z][A-Z &/-]{1,38}$/; // e.g. "WORK EXPERIENCE" — but not an address/phone line
const ALREADY_FORMATTED = /^(#{1,2}\s|-\s)/;
const BULLET = /^[-*•●▪‣∙◦]\s*/;
const toTitleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export function autoFormatCv(raw) {
  const lines = (raw ?? '').split(/\r?\n/).map((l) => l.trim());
  let sawName = lines.some((l) => l.startsWith('# ')); // a real "# " heading already exists — don't also invent one

  const out = [];
  let blank = true; // starts true so leading blank lines are dropped, not just collapsed
  for (const line of lines) {
    if (!line) { if (!blank) out.push(''); blank = true; continue; }
    blank = false;
    if (ALREADY_FORMATTED.test(line)) { out.push(line); sawName ||= line.startsWith('# '); continue; }
    if (!sawName && line.length < 60 && !line.includes('@')) { out.push(`# ${line}`); sawName = true; continue; }
    const key = line.replace(/:$/, '');
    if (CV_SECTIONS.has(key.toLowerCase()) || ALLCAPS_HEADING.test(key)) { out.push(`## ${toTitleCase(key)}`); continue; }
    if (BULLET.test(line)) { out.push(`- ${line.replace(BULLET, '')}`); continue; }
    out.push(line);
  }
  return out.join('\n').trim();
}

// Local-date helpers (toISOString would give UTC and flip the day around midnight)
export const isoDate = (d = new Date()) => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const daysUntil = (iso) => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso + 'T00:00') - t) / 864e5);
};
