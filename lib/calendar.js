import { createDAVClient } from 'tsdav';
import ical from 'node-ical';

// University timetable feeds (Blackboard etc.) bury the module name behind a course code and cram
// the room into a long "code - description (letter) [building]" string. Pull out just what's useful:
// "STU22004 - ST2004 APPLIED PROBABILITY I" / "03.008 - E3LF DIGITAL MEDIA LAB... [E3 Learning Foundry]"
// → "Applied Probability I" / "E3 Learning Foundry".
const CODE_PREFIX = /^[A-Z]{2,5}\d{2,5}[A-Z0-9]{0,3}\s*-\s*/;
const SMALL_WORDS = new Set(['and', 'of', 'the', 'in', 'on', 'for', 'to', 'a', 'an']);
const ROMAN = /^(i|ii|iii|iv|v)$/i;
const titleCase = (s) => s.toLowerCase().split(' ').map((w, i) => (ROMAN.test(w) ? w.toUpperCase() : i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
function tidyTitle(raw) {
  if (!CODE_PREFIX.test(raw)) return raw; // not a "CODE - NAME" style title (e.g. an assignment due date) — leave as-is
  const t = raw.replace(CODE_PREFIX, '').replace(/^[A-Z]{2,4}\d{2,4}\s+(?=[A-Z])/, '').trim(); // some feeds double up the code
  return titleCase(t);
}
const tidyWhere = (raw) => raw.match(/\[([^\]]+)\]\s*$/)?.[1] ?? raw.split(' - ')[0].trim(); // building name in [brackets], else fall back to the room code
const KIND_LABELS = { LECTURE: 'Lecture', TUTORIAL: 'Tutorial', 'LABORATORY SESSION': 'Lab', 'ONLINE LIVE EVENT': 'Online' };
const tidyKind = (desc) => KIND_LABELS[desc?.match(/Event Type:\s*([^\n\r]+)/i)?.[1]?.trim().toUpperCase()] ?? '';

// Parses one ICS document into { title, cal, start, end, allDay, where, kind } rows inside [from, to),
// expanding recurring events (weekly classes etc.) so a single RRULE becomes every occurrence in range.
function eventsFromICS(icsText, calName, from, to, tidy = false) {
  const out = [];
  for (const ev of Object.values(ical.sync.parseICS(icsText))) {
    if (ev.type !== 'VEVENT') continue;
    const hits = ev.rrule
      ? ical.expandRecurringEvent(ev, { from, to }).map((e) => ({ start: e.start, end: e.end }))
      : [{ start: ev.start, end: ev.end }];
    const title = tidy ? tidyTitle(ev.summary) : ev.summary;
    const where = tidy ? tidyWhere(ev.location || '') : (ev.location || '');
    const kind = tidy ? tidyKind(ev.description) : '';
    for (const h of hits) if (h.start >= from && h.start <= to) out.push({ title, cal: calName, start: h.start, end: h.end, allDay: ev.datetype === 'date', where, kind });
  }
  return out;
}

// ICS_FEEDS in .env: one "Name=URL" per line. For calendars Apple Calendar only *subscribes* to
// (File → New Calendar Subscription, or a webcal:// link) — those never appear over CalDAV, since
// they're not calendars your iCloud account owns, just a feed each device polls on its own.
const parseFeeds = (raw) => (raw || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return i === -1 ? [l, l] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; });

export async function upcomingEvents(days = 14) {
  const feeds = parseFeeds(process.env.ICS_FEEDS);
  if (!process.env.ICLOUD_EMAIL && !feeds.length) throw new Error('ICLOUD_EMAIL / ICLOUD_APP_PASSWORD (or ICS_FEEDS) not set in .env');
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 864e5);
  const out = [];

  if (process.env.ICLOUD_EMAIL) {
    const dav = await createDAVClient({
      serverUrl: 'https://caldav.icloud.com',
      credentials: { username: process.env.ICLOUD_EMAIL, password: process.env.ICLOUD_APP_PASSWORD },
      authMethod: 'Basic', defaultAccountType: 'caldav',
    });
    for (const cal of await dav.fetchCalendars()) {
      const objs = await dav.fetchCalendarObjects({ calendar: cal, timeRange: { start: from.toISOString(), end: to.toISOString() } });
      for (const o of objs) out.push(...eventsFromICS(o.data, cal.displayName, from, to));
    }
  }

  for (const [name, url] of feeds) {
    const text = await fetch(url.replace(/^webcal:/, 'https:')).then((r) => r.text()).catch(() => null);
    if (text) out.push(...eventsFromICS(text, name, from, to, true));
  }

  return out.sort((a, b) => a.start - b.start);
}
