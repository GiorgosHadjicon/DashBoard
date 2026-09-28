import { createDAVClient } from 'tsdav';
import ical from 'node-ical';

// Parses one ICS document into { title, cal, start, end, allDay, where } rows inside [from, to),
// expanding recurring events (weekly classes etc.) so a single RRULE becomes every occurrence in range.
function eventsFromICS(icsText, calName, from, to) {
  const out = [];
  for (const ev of Object.values(ical.sync.parseICS(icsText))) {
    if (ev.type !== 'VEVENT') continue;
    const hits = ev.rrule
      ? ical.expandRecurringEvent(ev, { from, to }).map((e) => ({ start: e.start, end: e.end }))
      : [{ start: ev.start, end: ev.end }];
    for (const h of hits) if (h.start >= from && h.start <= to) out.push({ title: ev.summary, cal: calName, start: h.start, end: h.end, allDay: ev.datetype === 'date', where: ev.location || '' });
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
    if (text) out.push(...eventsFromICS(text, name, from, to));
  }

  return out.sort((a, b) => a.start - b.start);
}
