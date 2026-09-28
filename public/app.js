import { matchups, pct, csv, isoDate, daysUntil } from './logic.js';

const main = document.getElementById('main');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
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
const notConnected = (e) => `<p class="muted">Not connected yet: ${esc(e.message)}</p>`;

// ---- state that survives re-renders
let deckFilter = '';
let workoutDay = todayName();

// ---- views
const views = {};

views.today = async () => {
  const [dl, meals, plan, cal, gar, road, matches, mail] = await Promise.all([
    list('deadline'), list('meal'), list('workout'),
    live('calendar').catch((e) => e), live('garmin').catch((e) => e),
    roadmapItems(), list('match'), live('mail').catch((e) => e),
  ]);
  const day = todayName();
  const due = dl.filter((d) => !d.done).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5);
  const todaysEvents = cal instanceof Error ? null : cal.filter((e) => isoDate(new Date(e.start)) === isoDate());
  const t = (e) => (e.allDay ? 'All day' : new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  const week = dl.filter((d) => !d.done && daysUntil(d.due) <= 7).length;
  const overdue = dl.filter((d) => !d.done && daysUntil(d.due) < 0).length;
  const core = road.filter((i) => !i.phase.includes('coming soon')); // Phase 3 is pick-one, so it would inflate the total
  const rDone = core.reduce((n, i) => n + i.done, 0), rAll = core.reduce((n, i) => n + i.days, 0);
  const wins = matches.filter((m) => m.result === 'W').length;
  const mu = matchups(matches).filter((r) => r.w + r.l >= 2);
  const best = mu.sort((a, b) => pct(b.w, b.l) - pct(a.w, a.l))[0], worst = mu.at(-1);
  const cur = road.find((i) => i.done < i.days);
  const eaten = MEALS.map((m) => [m, meals.find((x) => x.day === day && x.meal === m)?.text]).filter(([, x]) => x);
  return `<header class="hero"><div><p>${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p><h1>${day}</h1></div>
    <div class="week">${DAYS.map((d) => `<span class="${d === day ? 'now' : ''}">${d.slice(0, 2)}</span>`).join('')}</div></header>
  <div class="tiles">
    <a class="tile" href="#deadlines"><b class="${overdue ? 'bad' : ''}">${week}</b><span>due in 7 days${overdue ? `, ${overdue} overdue` : ''}</span></a>
    <a class="tile" href="#garmin"><b>${gar instanceof Error ? '—' : gar.steps ?? '—'}</b><span>steps today</span></a>
    <a class="tile" href="#roadmap"><b>${Math.round((100 * rDone) / rAll)}%</b><span>MyFirstHack · ${rDone}/${rAll} days</span></a>
    <a class="tile" href="#optcg"><b>${matches.length ? pct(wins, matches.length - wins) + '%' : '—'}</b><span>One Piece win rate · ${matches.length} games</span></a>
  </div>
  <div class="today-grid">
    <div>
      <h3>Due soon</h3>
      <ul class="list">${due.map((d) => `<li><b>${esc(d.title)}</b> <span class="muted">${esc(d.course)}</span>${dueBadge(d)}</li>`).join('') || '<p class="muted">Nothing due. Add deadlines in the Deadlines tab.</p>'}</ul>
      <h3>On your calendar today</h3>
      ${cal instanceof Error ? notConnected(cal) : todaysEvents.map((e) => `<p><span class="time">${t(e)}</span> ${esc(e.title)}</p>`).join('') || '<p class="muted">Nothing scheduled.</p>'}
      <h3>Important email</h3>
      ${mail instanceof Error ? notConnected(mail) : mail.slice(0, 4).map((m) => `<p><b>${esc(m.from)}</b> <a href="${esc(m.link)}" target="_blank" rel="noopener">${esc(m.subject)}</a></p>`).join('') || '<p class="muted">Nothing important.</p>'}
    </div>
    <div>
      <h3>Body</h3>
      ${gar instanceof Error ? notConnected(gar) : `<p class="stat"><b>${gar.steps ?? '—'}</b><span>steps</span></p><p class="stat"><b>${gar.sleepHours ?? '—'}h</b><span>sleep · resting HR ${gar.restingHr ?? '—'}</span></p>`}
      <h3>Workout</h3>
      ${plan.filter((w) => w.day === day).map((w) => `<p>${esc(w.exercise)} <span class="muted">${esc(w.sets)}×${esc(w.reps)} at ${esc(w.weight)}kg</span></p>`).join('') || '<p class="muted">Rest day.</p>'}
      <h3>Food</h3>
      ${eaten.map(([m, x]) => `<p><span class="muted">${m}</span> ${esc(x)}</p>`).join('') || '<p class="muted">No meals entered for today.</p>'}
      <h3>Up next in MyFirstHack</h3>
      ${cur ? `<p><b>${esc(cur.title)}</b> <span class="muted">${cur.done}/${cur.days}</span></p>` : '<p class="muted">Roadmap complete.</p>'}
      <h3>One Piece</h3>
      ${best ? `<p><span class="good">Best</span> vs ${esc(best.opp)} <span class="muted">${pct(best.w, best.l)}% over ${best.w + best.l}</span></p><p><span class="bad">Toughest</span> vs ${esc(worst.opp)} <span class="muted">${pct(worst.w, worst.l)}% over ${worst.w + worst.l}</span></p>` : '<p class="muted">Log a few matches to see your best and toughest match-ups.</p>'}
    </div>
  </div>`;
};

const dueBadge = (d) => {
  const n = daysUntil(d.due);
  const cls = d.done ? '' : n < 0 ? 'bad' : n <= 3 ? 'warn' : '';
  const label = n < 0 ? `${-n}d overdue` : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n}d`;
  return `<span class="pill ${cls}">${esc(d.due)} · ${label}</span>`;
};

views.deadlines = async () => {
  const items = (await list('deadline')).sort((a, b) => a.done - b.done || a.due.localeCompare(b.due));
  return `<h2>School deadlines</h2>
  <form class="row" data-submit="addDeadline"><input name="title" placeholder="What's due" required><input name="course" placeholder="Module"><input type="date" name="due" required><button>Add</button></form>
  <ul class="list">${items.map((d) => `<li class="${d.done ? 'done' : ''}">
    <input type="checkbox" data-change="toggleDeadline" data-id="${d.id}" ${d.done ? 'checked' : ''}>
    <b>${esc(d.title)}</b> <span class="muted">${esc(d.course)}</span>${dueBadge(d)}
    <button class="x" data-click="del" data-kind="deadline" data-id="${d.id}" title="Delete">×</button></li>`).join('') || '<p class="muted">No deadlines yet.</p>'}</ul>`;
};

views.calendar = async () => {
  let body;
  try {
    const evs = await live('calendar');
    const byDay = {};
    for (const e of evs) (byDay[isoDate(new Date(e.start))] ??= []).push(e);
    body = Object.entries(byDay).map(([d, es]) => `<h3>${new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
      <ul class="list">${es.map((e) => `<li><span class="muted">${e.allDay ? 'All day' : new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> <b>${esc(e.title)}</b>
      <span class="muted">${esc(e.where)}</span><span class="pill">${esc(e.cal)}</span></li>`).join('')}</ul>`).join('') || '<p class="muted">Nothing in the next 14 days.</p>';
  } catch (e) { body = notConnected(e); }
  return `<h2>Apple Calendar <button class="ghost" data-click="refresh" data-name="calendar">Refresh</button></h2>${body}`;
};

views.garmin = async () => {
  let body;
  try {
    const g = await live('garmin');
    body = `<div class="tiles">
      <div class="tile"><b>${g.steps ?? '—'}</b><span>steps today</span></div>
      <div class="tile"><b>${g.sleepHours ?? '—'}h</b><span>sleep last night</span></div>
      <div class="tile"><b>${g.restingHr ?? '—'}</b><span>resting HR (7-day avg ${g.weekAvgRestingHr ?? '—'})</span></div></div>
      <h3>Recent activities</h3><ul class="list">${g.activities.map((a) => `<li><b>${esc(a.name)}</b> <span class="muted">${esc(a.type)}</span>
      <span class="pill">${a.km} km · ${a.min} min · ${esc(a.start.slice(0, 10))}</span></li>`).join('') || '<p class="muted">None.</p>'}</ul>`;
  } catch (e) { body = notConnected(e); }
  return `<h2>Garmin <button class="ghost" data-click="refresh" data-name="garmin">Refresh</button></h2>${body}`;
};

views.mail = async () => {
  let body;
  try {
    const ms = await live('mail');
    body = `<ul class="list">${ms.map((m) => `<li><b>${esc(m.from)}</b><a class="grow" href="${esc(m.link)}" target="_blank" rel="noopener">${esc(m.subject)}</a>
      <span class="pill">${new Date(m.date).toLocaleDateString()}</span></li>`).join('') || '<p class="muted">No important mail matches your filter.</p>'}</ul>`;
  } catch (e) { body = notConnected(e); }
  return `<h2>Important email <button class="ghost" data-click="refresh" data-name="mail">Refresh</button></h2>${body}`;
};

views.optcg = async () => {
  const [decks, matches] = await Promise.all([list('deck'), list('match')]);
  const shown = deckFilter ? matches.filter((m) => m.deckId == deckFilter) : matches;
  const rows = matchups(shown);
  const deckName = (id) => decks.find((d) => d.id == id)?.name ?? '(deleted deck)';
  const cell = (w, l) => {
    const p = pct(w, l);
    if (p == null) return '<td class="wr muted">—</td>';
    const c = p >= 55 ? 'var(--good)' : p < 45 ? 'var(--bad)' : 'var(--gold)';
    return `<td class="wr"><b>${p}%</b><small>${w}-${l}</small><i style="--w:${p}%;--c:${c}"></i></td>`;
  };
  const total = shown.filter((m) => m.result === 'W').length;
  return `<h2>One Piece TCG</h2>
  <h3>Decks</h3>
  <form class="row" data-submit="addDeck"><input name="name" placeholder="Deck name" required><input name="leader" placeholder="Leader (e.g. Red Luffy)" required><button>Add deck</button></form>
  <ul class="list">${decks.map((d) => `<li><b>${esc(d.name)}</b> <span class="muted">${esc(d.leader)}</span><button class="x" data-click="del" data-kind="deck" data-id="${d.id}">×</button></li>`).join('') || '<p class="muted">Add a deck to start logging matches.</p>'}</ul>
  ${decks.length ? `<h3>Log a match</h3>
  <form class="row" data-submit="addMatch">
    <select name="deckId" required>${decks.map((d) => `<option value="${d.id}" ${d.id == deckFilter ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
    <input name="opp" list="leaders" placeholder="Opponent leader" required>
    <datalist id="leaders">${[...new Set(matches.map((m) => m.opp.trim()))].map((o) => `<option value="${esc(o)}">`).join('')}</datalist>
    <select name="first"><option value="first">Going 1st</option><option value="second">Going 2nd</option></select>
    <select name="result"><option value="W">Win</option><option value="L">Loss</option></select>
    <input type="date" name="date" value="${isoDate()}"><input name="notes" placeholder="Notes"><button>Log</button>
  </form>
  <h3>Match-ups</h3>
  <div class="row"><select data-change="deckFilter"><option value="">All decks</option>${decks.map((d) => `<option value="${d.id}" ${d.id == deckFilter ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
    <span class="muted">Overall ${pct(total, shown.length - total) ?? '—'}% over ${shown.length} games</span>
    <button class="ghost" data-click="csv">Download CSV</button></div>
  <table><tr><th>Opponent</th><th>Games</th><th>Overall</th><th>Going 1st</th><th>Going 2nd</th></tr>
  ${rows.map((r) => `<tr><td><b>${esc(r.opp)}</b></td><td class="n">${r.w + r.l}</td>${cell(r.w, r.l)}${cell(r.fw, r.fl)}${cell(r.sw, r.sl)}</tr>`).join('') || '<tr><td colspan="5" class="muted">No matches logged.</td></tr>'}</table>
  <h3>Recent matches</h3>
  <ul class="list">${shown.slice(-15).reverse().map((m) => `<li><b class="${m.result === 'W' ? 'good' : 'bad'}">${m.result}</b> vs ${esc(m.opp)} <span class="muted">${esc(deckName(m.deckId))} · ${m.first === 'first' ? '1st' : '2nd'} · ${esc(m.date)} ${esc(m.notes)}</span>
    <button class="x" data-click="del" data-kind="match" data-id="${m.id}">×</button></li>`).join('')}</ul>` : ''}`;
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
  return `<h2>MyFirstHack roadmap</h2>
  ${phases.map((p) => { const its = items.filter((i) => i.phase === p); const done = its.reduce((s, i) => s + i.done, 0); const all = its.reduce((s, i) => s + i.days, 0);
    return `<h3>${esc(p)} · ${done}/${all}</h3><ul class="list">${its.map((i) => `<li>
      <div class="grow"><b>${esc(i.title)}</b><br><span class="muted">${esc(i.sub)}</span></div>
      <button class="ghost" data-click="bump" data-id="${i.id}" data-by="-1">−</button>
      <span class="n">${i.done}/${i.days}</span>
      <button class="ghost" data-click="bump" data-id="${i.id}" data-by="1">+</button>
      <button class="x" data-click="del" data-kind="roadmap" data-id="${i.id}">×</button>
      <div class="bar"><i style="width:${Math.round((100 * i.done) / i.days)}%"></i></div></li>`).join('')}</ul>`; }).join('')}
  <h3>Add your own item</h3>
  <form class="row" data-submit="addRoadmap"><input name="phase" placeholder="Group (e.g. Side projects)" required><input name="title" placeholder="Title" required><input name="sub" placeholder="Description"><input type="number" name="days" min="1" value="1" title="Total steps"><button>Add</button></form>`;
};

views.diet = async () => {
  const cells = await list('meal');
  const t = todayName();
  return `<h2>Weekly diet</h2><div class="meals">
    <div></div>${DAYS.map((d) => `<div class="h ${d === t ? 'today' : ''}">${d}</div>`).join('')}
    ${MEALS.map((m) => `<div class="h">${m}</div>${DAYS.map((d) => { const c = cells.find((x) => x.day === d && x.meal === m);
      return `<textarea data-change="saveMeal" data-day="${d}" data-meal="${m}" data-id="${c?.id ?? ''}" aria-label="${d} ${m}">${esc(c?.text)}</textarea>`; }).join('')}`).join('')}
  </div><p class="muted">Edits save automatically when you click out of a box.</p>`;
};

views.workouts = async () => {
  const [plan, lifts] = await Promise.all([list('workout'), list('lift')]);
  const todays = plan.filter((w) => w.day === workoutDay);
  const history = (ex) => lifts.filter((l) => l.exercise.toLowerCase() === ex.toLowerCase()).slice(-5).map((l) => l.weight).join(' → ');
  return `<h2>Workouts</h2>
  <div class="tabs">${DAYS.map((d) => `<button class="${d === workoutDay ? 'on' : ''}" data-click="workoutDay" data-day="${d}">${d.slice(0, 3)}</button>`).join('')}</div>
  <form class="row" data-submit="addExercise"><input name="exercise" placeholder="Exercise" required><input type="number" name="sets" placeholder="Sets" min="1"><input type="number" name="reps" placeholder="Reps" min="1">
    <input type="number" name="weight" placeholder="kg" step="0.25" min="0"><button>Add to ${workoutDay}</button></form>
  <table><tr><th>Exercise</th><th>Sets × Reps</th><th>Weight (kg)</th><th>Progress</th><th></th></tr>
  ${todays.map((w) => `<tr><td><b>${esc(w.exercise)}</b></td><td class="n">${esc(w.sets)} × ${esc(w.reps)}</td>
    <td><input type="number" step="0.25" min="0" value="${esc(w.weight)}" data-change="setWeight" data-id="${w.id}"></td>
    <td class="muted">${esc(history(w.exercise)) || '—'}</td>
    <td><button class="ghost" data-click="logLift" data-id="${w.id}" title="Log today's session at this weight">Log</button><button class="x" data-click="del" data-kind="workout" data-id="${w.id}">×</button></td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">Rest day — add an exercise above.</td></tr>'}</table>
  <p class="muted">Changing the weight or pressing Log records it in the progress history.</p>`;
};

// ---- actions (wired by data-* attributes via three delegated listeners)
const logLift = async (w) => {
  const date = isoDate();
  const today = (await list('lift')).find((l) => l.exercise.toLowerCase() === w.exercise.toLowerCase() && l.date === date);
  const rec = { exercise: w.exercise, weight: +w.weight, reps: w.reps, date };
  today ? await api('PUT', 'lift', today.id, rec) : await api('POST', 'lift', null, rec);
};
const num = (v) => (v === '' || v == null ? 0 : +v);

const actions = {
  addDeadline: (f) => api('POST', 'deadline', null, { ...f, done: false }),
  toggleDeadline: (el) => { const d = get('deadline', el.dataset.id); return api('PUT', 'deadline', d.id, { ...d, done: el.checked }); },
  del: (el) => api('DELETE', el.dataset.kind, el.dataset.id),
  addDeck: (f) => api('POST', 'deck', null, f),
  addMatch: (f) => api('POST', 'match', null, { ...f, deckId: +f.deckId }),
  deckFilter: (el) => { deckFilter = el.value; },
  csv: () => {
    const all = Object.entries(cache).filter(([k]) => k.startsWith('match:')).map(([, v]) => v);
    const shown = deckFilter ? all.filter((m) => m.deckId == deckFilter) : all;
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv(matchups(shown))], { type: 'text/csv' })), download: 'matchups.csv' });
    a.click(); URL.revokeObjectURL(a.href);
  },
  bump: (el) => { const i = get('roadmap', el.dataset.id); return api('PUT', 'roadmap', i.id, { ...i, done: Math.min(i.days, Math.max(0, i.done + +el.dataset.by)) }); },
  addRoadmap: (f) => api('POST', 'roadmap', null, { ...f, days: Math.max(1, num(f.days)), done: 0 }),
  saveMeal: async (el) => {
    const rec = { day: el.dataset.day, meal: el.dataset.meal, text: el.value };
    if (el.dataset.id) await api('PUT', 'meal', el.dataset.id, rec);
    else el.dataset.id = (await api('POST', 'meal', null, rec)).id; // remember id so the next edit updates instead of duplicating
  },
  workoutDay: (el) => { workoutDay = el.dataset.day; },
  addExercise: (f) => api('POST', 'workout', null, { ...f, day: workoutDay, weight: num(f.weight) }),
  setWeight: async (el) => { const w = get('workout', el.dataset.id); const upd = { ...w, weight: num(el.value) }; await api('PUT', 'workout', w.id, upd); if (upd.weight > 0) await logLift(upd); },
  logLift: (el) => logLift(get('workout', el.dataset.id)),
  refresh: async (el) => { await live(el.dataset.name, true).catch(() => {}); },
};
// meals save without re-rendering so typing focus isn't lost; everything else re-renders
const keepDom = new Set(['saveMeal', 'csv']);

const run = async (name, arg, extra) => {
  try { await actions[name](arg, extra); } catch (e) { alert(e.message); }
  if (!keepDom.has(name)) render();
};
main.addEventListener('click', (e) => { const t = e.target.closest('[data-click]'); if (t) run(t.dataset.click, t); });
main.addEventListener('change', (e) => { const t = e.target.closest('[data-change]'); if (t) run(t.dataset.change, t); });
main.addEventListener('submit', (e) => { e.preventDefault(); run(e.target.dataset.submit, Object.fromEntries(new FormData(e.target))); });

// ---- shell
const TABS = { today: 'Today', deadlines: 'Deadlines', calendar: 'Calendar', garmin: 'Garmin', mail: 'Email', optcg: 'One Piece', roadmap: 'MyFirstHack', diet: 'Diet', workouts: 'Workouts' };
const tab = () => (views[location.hash.slice(1)] ? location.hash.slice(1) : 'today');
async function render() {
  document.getElementById('nav').innerHTML = Object.entries(TABS).map(([k, v]) => `<a href="#${k}" class="${k === tab() ? 'on' : ''}">${v}</a>`).join('');
  try { main.innerHTML = await views[tab()](); } catch (e) { main.innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
}
addEventListener('hashchange', render);
render();
