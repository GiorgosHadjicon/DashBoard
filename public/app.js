import { matchups, pct, csv, isoDate, daysUntil, parseDeckText, buildDeckText } from './logic.js';

const NAME = 'George';
const main = document.getElementById('main');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEALS = ['First meal (11–12)', 'Snack', 'Dinner']; // matches the printed plan's rows
const todayName = () => DAYS[(new Date().getDay() + 6) % 7];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- data layer: every doc kind goes through the same 4 calls; cache lets handlers find the doc by id
const cache = {};
const api = (method, kind, id, body) =>
  fetch(`/api/docs/${kind}${id ? '/' + id : ''}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
    .then((r) => (r.status === 204 ? null : r.json()));
const list = async (kind) => {
  const items = await api('GET', kind);
  for (const k of Object.keys(cache)) if (k.startsWith(kind + ':')) delete cache[k]; // drop deleted docs
  for (const i of items) cache[`${kind}:${i.id}`] = i;
  return items;
};
const get = (kind, id) => cache[`${kind}:${id}`];
const live = async (name, refresh) => {
  const r = await fetch(`/api/${name}${refresh ? '?refresh=1' : ''}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
};
const notConnected = (e) => `<p class="muted">Not connected yet. ${esc(e.message)}</p>`;

// ---- state that survives re-renders
let deckFilter = '';
let decksOpen = false;
let deckEditOpen = null;
let workoutDay = todayName();
let dietDay = todayName();
let fitTab = 'workouts';
let cardsReady = null; // null = unknown yet, else the cached card count
let cardsSyncing = false;

// ---- One Piece card data: local cache of cards looked up or picked, so re-renders don't refetch
const cardCache = {};
const cardImg = (c, cls = 'thumb') => (c?.image ? `<img class="${cls}" src="${esc(c.image)}" alt="">` : '');
async function hydrateCards(ids) {
  const need = [...new Set(ids.filter(Boolean))].filter((id) => !cardCache[id]);
  if (!need.length) return;
  for (const c of await fetch(`/api/cards/byId?ids=${need.join(',')}`).then((r) => r.json())) cardCache[c.card_set_id] = c;
}
const ensureCardsMeta = async () => { if (cardsReady === null) cardsReady = (await fetch('/api/cards/meta').then((r) => r.json())).count; return cardsReady; };

let lastSearch = {}; // picker key -> last results, so a click on a result can look itself back up
let searchTimer;
// A type-ahead leader field. mode 'form': fills sibling inputs named `field` (text) and `field+'Id'` (hidden),
// read when the enclosing form submits. mode 'save': picking one immediately PUTs it onto deck `deckId`.
const leaderPicker = (key, { field, placeholder, current, mode = 'form', deckId } = {}) => `
  <div class="picker" data-key="${key}" data-mode="${mode}" ${deckId ? `data-deckid="${deckId}"` : ''}>
    <div class="pickerBox">${current ? cardImg(current) : ''}<input class="grow" ${mode === 'form' ? `name="${field}"` : ''} type="text"
      placeholder="${placeholder}" value="${esc(current?.name ?? '')}" data-input="cardSearch" data-key="${key}" data-type="Leader" autocomplete="off" ${mode === 'form' ? 'required' : ''}></div>
    ${mode === 'form' ? `<input type="hidden" name="${field}Id" value="${current?.card_set_id ?? ''}">` : ''}
    <div class="pickerResults"></div>
  </div>`;
const deckAddPicker = (deckId) => `<div class="picker" data-key="deckadd-${deckId}">
  <input class="grow" type="text" placeholder="Search cards to add to this deck…" data-input="deckCardSearch" data-key="deckadd-${deckId}" data-deckid="${deckId}" autocomplete="off">
  <div class="pickerResults"></div></div>`;

// ---- small shared pieces
const hello = () => { const h = new Date().getHours(); return `${h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}, ${NAME}`; };
const fmtTime = (e) => {
  if (e.allDay) return 'All day';
  const t = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return e.end && new Date(e.end).getTime() !== new Date(e.start).getTime() ? `${t(e.start)}–${t(e.end)}` : t(e.start);
};
const dayLabel = (iso) => { const n = daysUntil(iso); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : new Date(iso + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }); };
const num = (v) => (v === '' || v == null ? 0 : +v);
const empty = (msg) => `<p class="empty">${msg}</p>`;

// A dismissable banner instead of alert() — alert() blocks the whole page (and browser automation) on a click.
let toast = null;
let toastTimer;
const showToast = (text, kind = 'info') => {
  toast = { text, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast = null; render(); }, 5000);
};

const dueBadge = (d) => {
  const n = daysUntil(d.due);
  const cls = d.done ? '' : n < 0 ? 'bad' : n <= 3 ? 'warn' : '';
  const label = n < 0 ? `${-n}d overdue` : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `${new Date(d.due + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  return `<span class="pill ${cls}">${label}</span>`;
};
const deadlineRow = (d, withDelete) => `<li class="${d.done ? 'done' : ''}">
  <input type="checkbox" data-change="toggleDeadline" data-id="${d.id}" ${d.done ? 'checked' : ''} aria-label="Done">
  <div class="grow"><b>${esc(d.title)}</b>${d.course ? ` <span class="muted">${esc(d.course)}</span>` : ''}</div>${dueBadge(d)}
  ${withDelete ? `<button class="x" data-click="del" data-kind="deadline" data-id="${d.id}" title="Delete" aria-label="Delete">×</button>` : ''}</li>`;
const addDeadlineForm = `<form class="row" data-submit="addDeadline"><input class="grow" name="title" placeholder="Add a deadline…" required><input name="course" placeholder="Module"><input type="date" name="due" required aria-label="Due date"><button>Add</button></form>`;

const agenda = (cal, days) => {
  if (cal instanceof Error) return notConnected(cal);
  const byDay = {};
  for (const e of cal) { const k = isoDate(new Date(e.start)); if (daysUntil(k) >= 0 && daysUntil(k) < days) (byDay[k] ??= []).push(e); }
  return Object.entries(byDay).map(([k, es]) => `<div class="agenda"><h4>${dayLabel(k)}</h4>${es.map((e) => `<p><span class="time">${fmtTime(e)}</span>${e.kind ? `<span class="pill">${esc(e.kind)}</span>` : ''}${esc(e.title)}${e.where ? ` <span class="muted">${esc(e.where)}</span>` : ''}</p>`).join('')}</div>`).join('') || empty('Nothing scheduled.');
};

// ---- views
const views = {};

views.today = async () => {
  const [dl, meals, plan, cal, gar, road, matches] = await Promise.all([
    list('deadline'), list('meal'), list('workout'),
    live('calendar').catch((e) => e), live('garmin').catch((e) => e),
    roadmapItems(), list('match'),
  ]);
  const day = todayName();
  const open = dl.filter((d) => !d.done).sort((a, b) => a.due.localeCompare(b.due));
  const week = open.filter((d) => daysUntil(d.due) <= 7).length;
  const overdue = open.filter((d) => daysUntil(d.due) < 0).length;
  const core = road.filter((i) => !i.phase.includes('coming soon')); // Phase 3 is pick-one, so it would inflate the total
  const rDone = core.reduce((n, i) => n + i.done, 0), rAll = core.reduce((n, i) => n + i.days, 0);
  const wins = matches.filter((m) => m.result === 'W').length;
  const mu = matchups(matches).filter((r) => r.w + r.l >= 2).sort((a, b) => pct(b.w, b.l) - pct(a.w, a.l));
  const best = mu[0], worst = mu.at(-1);
  const cur = road.find((i) => i.done < i.days);
  const lifts = plan.filter((w) => w.day === day);
  const eaten = MEALS.map((m) => [m, meals.find((x) => x.day === day && x.meal === m)?.text]).filter(([, x]) => x);

  // week strip: Mon–Sun of this week, with a dot on days something is due
  const mon = new Date(); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const strip = DAYS.map((d, i) => {
    const dt = new Date(mon); dt.setDate(mon.getDate() + i);
    const iso = isoDate(dt);
    return `<span class="d ${d === day ? 'now' : ''}"><i>${d.slice(0, 2)}</i>${dt.getDate()}<em class="${open.some((x) => x.due === iso) ? 'dot' : ''}"></em></span>`;
  }).join('');

  return `<header class="hero"><div><h1>${hello()}</h1><p class="muted">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div><div class="week">${strip}</div></header>
  <div class="tiles">
    <a class="tile" href="#school"><b class="${overdue ? 'bad' : ''}">${week}</b><span>due in 7 days${overdue ? ` · ${overdue} overdue` : ''}</span></a>
    <a class="tile" href="#fitness"><b>${gar instanceof Error ? '—' : gar.steps ?? '—'}</b><span>steps today</span></a>
    <a class="tile" href="#roadmap"><b>${Math.round((100 * rDone) / rAll)}%</b><span>MyFirstHack · ${rDone}/${rAll} days</span></a>
    <a class="tile" href="#optcg"><b>${matches.length ? pct(wins, matches.length - wins) + '%' : '—'}</b><span>One Piece win rate · ${matches.length} games</span></a>
  </div>
  <div class="two">
    <div>
      <h3>Due soon</h3>${addDeadlineForm}
      <ul class="list">${open.slice(0, 5).map((d) => deadlineRow(d)).join('') || empty('Nothing due. Enjoy it.')}</ul>
      <h3>Next 7 days</h3>${agenda(cal, 7)}
    </div>
    <div>
      <h3>Workout today</h3>
      ${lifts.map((w) => `<p>${esc(w.exercise)} <span class="muted">${esc(w.sets)}×${esc(w.reps)} · ${esc(w.weight)}kg</span></p>`).join('') || empty('Rest day.')}
      <h3>Food today</h3>
      ${eaten.map(([m, x]) => `<p><span class="muted">${m.split(' (')[0]}</span><br>${esc(x.split('\n').slice(0, 3).join(' · '))}</p>`).join('') || empty('No meals entered for today.')}
      ${gar instanceof Error ? '' : `<h3>Body</h3><p>${gar.sleepHours ?? '—'}h sleep <span class="muted">· resting heart rate ${gar.restingHr ?? '—'}</span></p>`}
      <h3>Next up</h3>
      ${cur ? `<p><b>${esc(cur.title)}</b> <span class="muted">${cur.done}/${cur.days}</span></p>` : '<p class="muted">Roadmap complete.</p>'}
      ${best ? `<h3>One Piece</h3><p><span class="good">Best</span> vs ${esc(best.opp)} <span class="muted">${pct(best.w, best.l)}%</span><br><span class="bad">Toughest</span> vs ${esc(worst.opp)} <span class="muted">${pct(worst.w, worst.l)}%</span></p>` : ''}
    </div>
  </div>`;
};

views.school = async () => {
  const items = await list('deadline');
  const by = (a, b) => a.due.localeCompare(b.due);
  const open = items.filter((d) => !d.done).sort(by);
  const groups = [
    ['Overdue', open.filter((d) => daysUntil(d.due) < 0)],
    ['This week', open.filter((d) => daysUntil(d.due) >= 0 && daysUntil(d.due) <= 7)],
    ['Later', open.filter((d) => daysUntil(d.due) > 7)],
  ];
  const done = items.filter((d) => d.done).sort(by).reverse();
  return `<h2>School</h2>${addDeadlineForm}
  ${groups.map(([t, ds]) => (ds.length ? `<h3>${t}</h3><ul class="list">${ds.map((d) => deadlineRow(d, true)).join('')}</ul>` : '')).join('') || empty('No deadlines yet. Add your first one above.')}
  ${done.length ? `<details class="fold"><summary>Completed (${done.length})</summary><ul class="list">${done.map((d) => deadlineRow(d, true)).join('')}</ul></details>` : ''}`;
};

// ---- Fitness = three switchable panels
const pills = (items, current, action, attr) => `<div class="days">${items.map(([k, label]) => `<button class="${k === current ? 'on' : ''}" data-click="${action}" data-${attr}="${k}">${label}</button>`).join('')}</div>`;

const garminBody = async () => {
  try {
    const g = await live('garmin');
    return `<div class="tiles">
      <div class="tile"><b>${g.steps ?? '—'}</b><span>steps today</span></div>
      <div class="tile"><b>${g.sleepHours ?? '—'}h</b><span>sleep last night</span></div>
      <div class="tile"><b>${g.restingHr ?? '—'}</b><span>resting heart rate · 7-day avg ${g.weekAvgRestingHr ?? '—'}</span></div></div>
      <h3>Recent activities</h3><ul class="list">${g.activities.map((a) => `<li><div class="grow"><b>${esc(a.name)}</b> <span class="muted">${esc(a.start.slice(0, 10))}</span></div>
      <span class="pill">${a.km} km · ${a.min} min</span></li>`).join('') || empty('No activities yet.')}</ul>
      <p><button class="ghost" data-click="refresh" data-name="garmin">Refresh from Garmin</button></p>`;
  } catch (e) { return notConnected(e); }
};

const dietBody = async () => {
  const cells = await list('meal');
  return `${pills(DAYS.map((d) => [d, d.slice(0, 3)]), dietDay, 'dietDay', 'day')}
  ${MEALS.map((m) => { const c = cells.find((x) => x.day === dietDay && x.meal === m);
    return `<section class="meal"><h3>${m}</h3><textarea data-change="saveMeal" data-day="${dietDay}" data-meal="${m}" data-id="${c?.id ?? ''}" placeholder="Nothing planned" aria-label="${dietDay} ${m}">${esc(c?.text)}</textarea></section>`; }).join('')}
  <p class="muted">Edits save when you click out of a box.</p>`;
};

const workoutsBody = async () => {
  const [plan, lifts] = await Promise.all([list('workout'), list('lift')]);
  const todays = plan.filter((w) => w.day === workoutDay);
  const history = (ex) => lifts.filter((l) => l.exercise.toLowerCase() === ex.toLowerCase()).slice(-5).map((l) => l.weight).join(' → ');
  return `${pills(DAYS.map((d) => [d, d.slice(0, 3)]), workoutDay, 'workoutDay', 'day')}
  <ul class="list">${todays.map((w) => `<li>
    <div class="grow"><b>${esc(w.exercise)}</b> <span class="muted">${esc(w.sets)} × ${esc(w.reps)}</span><br><small class="muted">${esc(history(w.exercise)) || 'No history yet'}</small></div>
    <div class="stepper"><button class="ghost" data-click="stepWeight" data-id="${w.id}" data-by="-2.5" aria-label="Lighter">−</button>
      <input type="number" step="0.25" min="0" value="${esc(w.weight)}" data-change="setWeight" data-id="${w.id}" aria-label="Weight in kg"><span class="muted">kg</span>
      <button class="ghost" data-click="stepWeight" data-id="${w.id}" data-by="2.5" aria-label="Heavier">+</button></div>
    <button class="ghost" data-click="logLift" data-id="${w.id}" title="Record today's session at this weight">Log</button>
    <button class="x" data-click="del" data-kind="workout" data-id="${w.id}" aria-label="Delete">×</button></li>`).join('') || empty(`Rest day. Add an exercise for ${workoutDay} below.`)}</ul>
  <details class="fold" ${todays.length ? '' : 'open'}><summary>Add an exercise to ${workoutDay}</summary>
    <form class="row" data-submit="addExercise"><input class="grow" name="exercise" placeholder="Exercise" required><input type="number" name="sets" placeholder="Sets" min="1"><input type="number" name="reps" placeholder="Reps" min="1">
      <input type="number" name="weight" placeholder="kg" step="0.25" min="0"><button>Add</button></form></details>
  <p class="muted">Changing the weight, or pressing Log, saves it to your progress history.</p>`;
};

views.fitness = async () => {
  const body = { workouts: workoutsBody, diet: dietBody, garmin: garminBody }[fitTab];
  return `<h2>Fitness</h2><div class="seg">${[['workouts', 'Workouts'], ['diet', 'Diet'], ['garmin', 'Garmin']].map(([k, l]) => `<button class="${k === fitTab ? 'on' : ''}" data-click="fitTab" data-tab="${k}">${l}</button>`).join('')}</div>${await body()}`;
};

views.optcg = async () => {
  const [decks, matches] = await Promise.all([list('deck'), list('match')]);
  await Promise.all([ensureCardsMeta(), hydrateCards([
    ...decks.map((d) => d.leaderCardId), ...matches.map((m) => m.oppCardId),
    ...decks.flatMap((d) => (d.cards ?? []).map((c) => c.id)),
  ])]);
  const shown = deckFilter ? matches.filter((m) => m.deckId == deckFilter) : matches;
  const rows = matchups(shown);
  const deckName = (id) => decks.find((d) => d.id == id)?.name ?? '(deleted deck)';
  const cell = (w, l) => {
    const p = pct(w, l);
    if (p == null) return '<td class="wr muted">—</td>';
    const c = p >= 55 ? 'var(--good)' : p < 45 ? 'var(--bad)' : 'var(--gold)';
    return `<td class="wr"><b>${p}%</b><small>${w}-${l}</small><i style="--w:${p}%;--c:${c}"></i></td>`;
  };
  const leaderCell = (r) => `<td><div class="leadercell">${cardImg(cardCache[r.oppCardId], 'thumb sm')}<b>${esc(r.opp)}</b></div></td>`;
  const total = shown.filter((m) => m.result === 'W').length;
  const opts = decks.map((d) => `<option value="${d.id}" ${d.id == deckFilter ? 'selected' : ''}>${esc(d.name)}</option>`).join('');

  const banner = cardsSyncing ? `<p class="banner">Syncing card data from optcgapi.com… about 20 seconds.</p>`
    : !cardsReady ? `<p class="banner">No card data yet, so leaders and cards are typed by hand. <button class="ghost" data-click="syncCards">Sync card database</button></p>`
    : `<p class="muted small">${cardsReady} cards cached from optcgapi.com <button class="ghost" data-click="syncCards">Resync</button></p>`;

  const deckEditor = (d) => {
    const cards = d.cards ?? [];
    const filled = cards.reduce((n, c) => n + c.qty, 0);
    return `<details class="fold" data-deckid="${d.id}" ${deckEditOpen === d.id ? 'open' : ''}><summary>Edit deck</summary>
      ${!d.leaderCardId ? `<h4>Link a leader</h4>${leaderPicker(`leader-edit-${d.id}`, { mode: 'save', deckId: d.id, placeholder: 'Search for your leader…' })}` : ''}
      <h4>Cards <span class="muted">${filled}/50</span></h4>
      ${deckAddPicker(d.id)}
      <ul class="list">${cards.map((c) => { const card = cardCache[c.id]; return `<li>${cardImg(card, 'thumb sm')}
        <div class="grow"><b>${esc(card?.name ?? c.id)}</b>${card ? ` <span class="muted">${esc(card.color)} · cost ${esc(card.cost ?? '—')}</span>` : ''}</div>
        <div class="stepper"><button class="ghost" data-click="deckCardStep" data-deckid="${d.id}" data-cardid="${c.id}" data-by="-1" aria-label="Remove one">−</button>
        <span class="count">${c.qty}</span><button class="ghost" data-click="deckCardStep" data-deckid="${d.id}" data-cardid="${c.id}" data-by="1" aria-label="Add one">+</button></div></li>`; }).join('') || empty('No cards added yet.')}</ul>
      <h4>Import / export</h4>
      <textarea class="deckText" data-deckid="${d.id}" spellcheck="false">${esc(buildDeckText(d, (id) => cardCache[id]))}</textarea>
      <div class="row"><button type="button" class="ghost" data-click="copyDeckText" data-deckid="${d.id}">Copy to clipboard</button>
      <button type="button" data-click="importDeckText" data-deckid="${d.id}">Import this text</button></div>
      <p class="muted small">Paste a decklist above (one card per line, e.g. "4x OP01-016") and press Import. Importing replaces this deck's card list.</p>
      </details>`;
  };

  return `<h2>One Piece TCG</h2>${banner}
  ${decks.length ? `<form class="row" data-submit="addMatch">
    <select name="deckId" required aria-label="Your deck">${opts}</select>
    ${leaderPicker('opp-match', { field: 'opp', placeholder: "Opponent's leader" })}
    <select name="first" aria-label="Turn order"><option value="first">Went 1st</option><option value="second">Went 2nd</option></select>
    <select name="result" aria-label="Result"><option value="W">Win</option><option value="L">Loss</option></select>
    <input name="notes" placeholder="Notes"><input type="hidden" name="date" value="${isoDate()}"><button>Log match</button></form>` : empty('Add your first deck below to start logging matches.')}
  ${matches.length ? `<div class="between"><h3>Match-ups</h3>
    <div class="row"><select data-change="deckFilter" aria-label="Filter by deck"><option value="">All decks</option>${opts}</select>
    <span class="muted">${pct(total, shown.length - total) ?? '—'}% over ${shown.length} games</span><button class="ghost" data-click="csv">Download CSV</button></div></div>
  <table><tr><th>Opponent</th><th>Games</th><th>Overall</th><th>Going 1st</th><th>Going 2nd</th></tr>
  ${rows.map((r) => `<tr>${leaderCell(r)}<td class="n">${r.w + r.l}</td>${cell(r.w, r.l)}${cell(r.fw, r.fl)}${cell(r.sw, r.sl)}</tr>`).join('') || '<tr><td colspan="5" class="muted">No matches for this deck yet.</td></tr>'}</table>
  <h3>Recent matches</h3>
  <ul class="list">${shown.slice(-10).reverse().map((m) => `<li><b class="${m.result === 'W' ? 'good' : 'bad'}">${m.result === 'W' ? 'Win' : 'Loss'}</b>
    ${cardImg(cardCache[m.oppCardId], 'thumb sm')}<div class="grow">vs ${esc(m.opp)} <span class="muted">${esc(deckName(m.deckId))} · ${m.first === 'first' ? '1st' : '2nd'} · ${esc(m.date)} ${esc(m.notes)}</span></div>
    <button class="x" data-click="del" data-kind="match" data-id="${m.id}" aria-label="Delete">×</button></li>`).join('')}</ul>` : ''}
  <details class="fold" ${decksOpen || !decks.length ? 'open' : ''}><summary>Your decks (${decks.length})</summary>
    <form class="row" data-submit="addDeck"><input name="name" placeholder="Deck name" required>${leaderPicker('leader-new', { field: 'leader', placeholder: 'Search for your leader…' })}<button>Add deck</button></form>
    <ul class="list">${decks.map((d) => `<li>${cardImg(cardCache[d.leaderCardId], 'thumb sm')}<div class="grow"><b>${esc(d.name)}</b> <span class="muted">${esc(d.leader)}</span></div>
      <button class="x" data-click="del" data-kind="deck" data-id="${d.id}" aria-label="Delete">×</button>${deckEditor(d)}</li>`).join('')}</ul></details>`;
};

// Roadmap seeded from myfirsthack.com/roadmap (as of 2026-09-28); progress is edited by hand.
const ROADMAP_SEED = [
  ['Phase 1 · Foundations', 'The Digital World (days 1–20)', 'How computers, the internet, and data actually work', 20, 11],
  ['Phase 1 · Foundations', 'How Networks Work (days 21–45)', 'IP addresses, DNS, ports, firewalls, Wireshark', 25, 0],
  ['Phase 1 · Foundations', 'Linux & The Command Line (days 46–65)', 'Linux, bash scripting, terminal fluency', 20, 0],
  ['Phase 1 · Foundations', 'Cybersecurity Fundamentals (days 66–90)', 'CIA triad, threats, defenses, encryption basics', 25, 0],
  ['Phase 2 · CompTIA Security+', 'General Security Concepts (days 1–4)', 'Controls, frameworks, cryptography, change management', 4, 0],
  ['Phase 2 · CompTIA Security+', 'Threats, Vulnerabilities, Mitigations (days 5–11)', 'Threat actors, social engineering, malware, attacks', 7, 0],
  ['Phase 2 · CompTIA Security+', 'Security Architecture (days 12–16)', 'Cloud, networks, infrastructure, data protection', 5, 0],
  ['Phase 2 · CompTIA Security+', 'Security Operations (days 17–25)', 'SOC, monitoring, incident response, forensics', 9, 0],
  ['Phase 2 · CompTIA Security+', 'Governance, Risk & Compliance (days 26–29)', 'Risk management, frameworks, audits', 4, 0],
  ['Phase 2 · CompTIA Security+', 'Mock Exam (day 30)', 'Diagnostic exam to test exam-readiness', 1, 0],
  ['Phase 3 · Specialisation (coming soon)', 'SOC Analyst', 'Detection, monitoring, incident response', 30, 0],
  ['Phase 3 · Specialisation (coming soon)', 'GRC Analyst', 'Compliance, risk, audit', 30, 0],
];

const roadmapItems = async () => {
  let items = await list('roadmap');
  if (!items.length) {
    for (const [phase, title, sub, days, done] of ROADMAP_SEED) await api('POST', 'roadmap', null, { phase, title, sub, days, done });
    items = await list('roadmap');
  }
  return items;
};

views.roadmap = async () => {
  const items = await roadmapItems();
  const phases = [...new Set(items.map((i) => i.phase))];
  const now = items.find((i) => i.done < i.days)?.id;
  return `<h2>MyFirstHack roadmap</h2>
  ${phases.map((p) => { const its = items.filter((i) => i.phase === p); const done = its.reduce((s, i) => s + i.done, 0); const all = its.reduce((s, i) => s + i.days, 0);
    return `<h3>${esc(p)} <span class="muted">${done}/${all}</span></h3><ul class="list">${its.map((i) => `<li class="${i.done >= i.days ? 'done' : ''}">
      <div class="grow"><b>${esc(i.title)}</b> ${i.id === now ? '<span class="pill now">You are here</span>' : ''}<br><span class="muted">${esc(i.sub)}</span></div>
      <button class="ghost" data-click="bump" data-id="${i.id}" data-by="-1" aria-label="One day less">−</button>
      <span class="count">${i.done}/${i.days}</span>
      <button class="ghost" data-click="bump" data-id="${i.id}" data-by="1" aria-label="One day more">+</button>
      <div class="bar"><i style="width:${Math.round((100 * i.done) / i.days)}%"></i></div></li>`).join('')}</ul>`; }).join('')}
  <details class="fold"><summary>Add your own item</summary>
    <form class="row" data-submit="addRoadmap"><input name="phase" placeholder="Group (e.g. Side projects)" required><input class="grow" name="title" placeholder="Title" required><input name="sub" placeholder="Description"><input type="number" name="days" min="1" value="1" title="Total steps" aria-label="Total steps"><button>Add</button></form></details>`;
};

// ---- actions (wired by data-* attributes via three delegated listeners)
const logLift = async (w) => {
  const date = isoDate();
  const today = (await list('lift')).find((l) => l.exercise.toLowerCase() === w.exercise.toLowerCase() && l.date === date);
  const rec = { exercise: w.exercise, weight: +w.weight, reps: w.reps, date };
  today ? await api('PUT', 'lift', today.id, rec) : await api('POST', 'lift', null, rec);
};
const setWeight = async (w, weight) => { const upd = { ...w, weight }; await api('PUT', 'workout', w.id, upd); if (weight > 0) await logLift(upd); };

const actions = {
  addDeadline: (f) => api('POST', 'deadline', null, { ...f, done: false }),
  toggleDeadline: (el) => { const d = get('deadline', el.dataset.id); return api('PUT', 'deadline', d.id, { ...d, done: el.checked }); },
  del: (el) => {
    if (el.dataset.kind === 'deck' && !confirm('Delete this deck? Its logged matches stay in the totals.')) return;
    return api('DELETE', el.dataset.kind, el.dataset.id);
  },
  addDeck: async (f) => { decksOpen = true; await api('POST', 'deck', null, { name: f.name, leader: f.leader, leaderCardId: f.leaderId || undefined, cards: [] }); },
  addMatch: (f) => api('POST', 'match', null, { deckId: +f.deckId, opp: f.opp, oppCardId: f.oppId || undefined, first: f.first, result: f.result, notes: f.notes, date: f.date }),
  deckFilter: (el) => { deckFilter = el.value; },
  cardSearch: (el) => {
    clearTimeout(searchTimer);
    const picker = el.closest('.picker');
    const hidden = picker.querySelector('input[type=hidden]');
    if (hidden) hidden.value = ''; // typing invalidates a previously picked card
    const results = picker.querySelector('.pickerResults');
    const q = el.value.trim(), key = el.dataset.key, type = el.dataset.type;
    if (q.length < 2) { results.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      const cards = await fetch(`/api/cards?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}&limit=12`).then((r) => r.json());
      lastSearch[key] = cards;
      results.innerHTML = cards.map((c, i) => `<button type="button" class="pickerRow" data-click="pickCard" data-key="${key}" data-idx="${i}">
        ${cardImg(c, 'thumb sm')}<span>${esc(c.name)}<small class="muted">${esc(c.set_id)} · ${esc(c.color)}</small></span></button>`).join('') || '<p class="pickerEmpty muted">No cards found.</p>';
    }, 220);
  },
  pickCard: async (el) => {
    const card = lastSearch[el.dataset.key]?.[+el.dataset.idx];
    if (!card) return;
    cardCache[card.card_set_id] = card;
    const picker = document.querySelector(`.picker[data-key="${el.dataset.key}"]`);
    if (picker.dataset.mode === 'save') {
      const deck = get('deck', picker.dataset.deckid);
      await api('PUT', 'deck', deck.id, { ...deck, leader: card.name, leaderCardId: card.card_set_id });
      decksOpen = true; deckEditOpen = deck.id;
    } else {
      picker.querySelector('input[data-input=cardSearch]').value = card.name;
      picker.querySelector('input[type=hidden]').value = card.card_set_id;
    }
    picker.querySelector('.pickerResults').innerHTML = '';
    const box = picker.querySelector('.pickerBox');
    box?.querySelector('img')?.remove();
    box?.insertAdjacentHTML('afterbegin', cardImg(card));
    return picker.dataset.mode === 'form' ? 'skip' : undefined; // form mode: don't wipe the rest of the form by re-rendering
  },
  deckCardSearch: (el) => {
    clearTimeout(searchTimer);
    const results = el.closest('.picker').querySelector('.pickerResults');
    const q = el.value.trim(), key = el.dataset.key, deckId = el.dataset.deckid;
    if (q.length < 2) { results.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      const cards = (await fetch(`/api/cards?q=${encodeURIComponent(q)}&limit=15`).then((r) => r.json())).filter((c) => c.type !== 'Leader');
      lastSearch[key] = cards;
      results.innerHTML = cards.map((c, i) => `<button type="button" class="pickerRow" data-click="addDeckCard" data-key="${key}" data-idx="${i}" data-deckid="${deckId}">
        ${cardImg(c, 'thumb sm')}<span>${esc(c.name)}<small class="muted">${esc(c.set_id)} · ${esc(c.color)} · cost ${esc(c.cost ?? '—')}</small></span></button>`).join('') || '<p class="pickerEmpty muted">No cards found.</p>';
    }, 220);
  },
  addDeckCard: async (el) => {
    const card = lastSearch[el.dataset.key]?.[+el.dataset.idx];
    if (!card) return;
    cardCache[card.card_set_id] = card;
    const deck = get('deck', el.dataset.deckid);
    const cards = [...(deck.cards ?? [])];
    const existing = cards.find((c) => c.id === card.card_set_id);
    if (existing) existing.qty = Math.min(4, existing.qty + 1); else cards.push({ id: card.card_set_id, qty: 1 });
    await api('PUT', 'deck', deck.id, { ...deck, cards });
    decksOpen = true; deckEditOpen = deck.id;
  },
  deckCardStep: async (el) => {
    const deck = get('deck', el.dataset.deckid);
    const cards = (deck.cards ?? [])
      .map((c) => (c.id === el.dataset.cardid ? { ...c, qty: c.qty + +el.dataset.by } : c))
      .filter((c) => c.qty > 0);
    await api('PUT', 'deck', deck.id, { ...deck, cards });
    decksOpen = true; deckEditOpen = deck.id;
  },
  copyDeckText: (el) => {
    const ta = document.querySelector(`textarea.deckText[data-deckid="${el.dataset.deckid}"]`);
    ta.select(); ta.setSelectionRange(0, 999999);
    document.execCommand('copy');
  },
  importDeckText: async (el) => {
    const deckId = +el.dataset.deckid;
    const ta = document.querySelector(`textarea.deckText[data-deckid="${deckId}"]`);
    const { leaderId, cards } = parseDeckText(ta.value);
    if (!cards.length && !leaderId) return showToast('Nothing recognised in that text. Expected lines like "4x OP01-016".', 'error');
    await hydrateCards([leaderId, ...cards.map((c) => c.id)]);
    const unresolved = cards.filter((c) => !cardCache[c.id]).length;
    const deck = get('deck', deckId);
    const patch = { ...deck, cards };
    if (leaderId && cardCache[leaderId]) { patch.leaderCardId = leaderId; patch.leader = cardCache[leaderId].name; }
    await api('PUT', 'deck', deckId, patch);
    decksOpen = true; deckEditOpen = deckId;
    showToast(`Imported ${cards.length} card${cards.length === 1 ? '' : 's'}${leaderId && !cardCache[leaderId] ? ' — leader not found in the card database' : ''}${unresolved ? `, ${unresolved} card${unresolved === 1 ? '' : 's'} not found` : ''}.`);
  },
  syncCards: async () => {
    cardsSyncing = true; render();
    try { cardsReady = (await fetch('/api/cards/sync', { method: 'POST' }).then((r) => r.json())).count; }
    catch (e) { showToast('Sync failed: ' + e.message, 'error'); }
    cardsSyncing = false;
  },
  csv: () => {
    const all = Object.entries(cache).filter(([k]) => k.startsWith('match:')).map(([, v]) => v);
    const shown = deckFilter ? all.filter((m) => m.deckId == deckFilter) : all;
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv(matchups(shown))], { type: 'text/csv' })), download: 'matchups.csv' });
    a.click(); URL.revokeObjectURL(a.href);
  },
  bump: (el) => { const i = get('roadmap', el.dataset.id); return api('PUT', 'roadmap', i.id, { ...i, done: Math.min(i.days, Math.max(0, i.done + +el.dataset.by)) }); },
  addRoadmap: (f) => api('POST', 'roadmap', null, { ...f, days: Math.max(1, num(f.days)), done: 0 }),
  fitTab: (el) => { fitTab = el.dataset.tab; },
  dietDay: (el) => { dietDay = el.dataset.day; },
  saveMeal: async (el) => {
    const rec = { day: el.dataset.day, meal: el.dataset.meal, text: el.value };
    if (el.dataset.id) await api('PUT', 'meal', el.dataset.id, rec);
    else el.dataset.id = (await api('POST', 'meal', null, rec)).id; // remember id so the next edit updates instead of duplicating
  },
  workoutDay: (el) => { workoutDay = el.dataset.day; },
  addExercise: (f) => api('POST', 'workout', null, { ...f, day: workoutDay, weight: num(f.weight) }),
  setWeight: (el) => setWeight(get('workout', el.dataset.id), num(el.value)),
  stepWeight: (el) => { const w = get('workout', el.dataset.id); return setWeight(w, Math.max(0, +(num(w.weight) + +el.dataset.by).toFixed(2))); },
  logLift: (el) => logLift(get('workout', el.dataset.id)),
  refresh: async (el) => { await live(el.dataset.name, true).catch(() => {}); },
};
// meals/searches save or update their own bit of DOM without a full re-render, so typing focus and
// half-filled forms survive; everything else re-renders. An action can also return 'skip' itself.
const keepDom = new Set(['saveMeal', 'csv', 'cardSearch', 'deckCardSearch', 'copyDeckText']);

const run = async (name, arg) => {
  let skip;
  try { skip = await actions[name](arg); } catch (e) { showToast(e.message, 'error'); }
  if (!keepDom.has(name) && skip !== 'skip') render();
};
main.addEventListener('click', (e) => { const t = e.target.closest('[data-click]'); if (t) run(t.dataset.click, t); });
main.addEventListener('change', (e) => { const t = e.target.closest('[data-change]'); if (t) run(t.dataset.change, t); });
main.addEventListener('input', (e) => { const t = e.target.closest('[data-input]'); if (t) run(t.dataset.input, t); });
main.addEventListener('submit', (e) => { e.preventDefault(); run(e.target.dataset.submit, Object.fromEntries(new FormData(e.target))); });
// close a picker's dropdown when focus leaves it without a pick
main.addEventListener('focusout', (e) => {
  const picker = e.target.closest('.picker');
  if (!picker) return;
  setTimeout(() => { if (!picker.contains(document.activeElement)) picker.querySelector('.pickerResults').innerHTML = ''; }, 150);
});
// 'toggle' doesn't bubble, but capture-phase delegation still sees it on the way down to <details>
main.addEventListener('toggle', (e) => { const d = e.target.closest('details[data-deckid]'); if (d) deckEditOpen = d.open ? +d.dataset.deckid : null; }, true);

// ---- shell
const ICON = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TABS = {
  today: ['Today', ICON('<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>')],
  school: ['School', ICON('<path d="M4 5a2 2 0 0 1 2-2h14v15H6a2 2 0 0 0-2 2zM4 20a2 2 0 0 0 2 1h14"/>')],
  fitness: ['Fitness', ICON('<path d="M3 12h4l3-7 4 14 3-7h4"/>')],
  optcg: ['One Piece', ICON('<rect x="5" y="3" width="11" height="15" rx="2"/><path d="M9 21h8a3 3 0 0 0 3-3V8"/>')],
  roadmap: ['MyFirstHack', ICON('<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 16V9a3 3 0 0 1 3-3h7"/>')],
};
const tab = () => (views[location.hash.slice(1)] ? location.hash.slice(1) : 'today');
const nav = document.getElementById('nav');
async function render() {
  nav.innerHTML = Object.entries(TABS).map(([k, [label, icon]]) => `<a href="#${k}" class="${k === tab() ? 'on' : ''}">${icon}<span>${label}</span></a>`).join('');
  try { main.innerHTML = await views[tab()](); } catch (e) { main.innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
  if (toast) main.insertAdjacentHTML('afterbegin', `<p class="toast ${toast.kind}">${esc(toast.text)}</p>`);
}
addEventListener('hashchange', render);
// Clicking the tab you're already on doesn't change location.hash, so no 'hashchange' fires and
// the click looks like it did nothing — force a refresh in that one case (e.g. today's data going stale).
nav.addEventListener('click', (e) => { const a = e.target.closest('a'); if (a && a.getAttribute('href').slice(1) === tab()) render(); });
render();
