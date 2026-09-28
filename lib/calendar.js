import { createDAVClient } from 'tsdav';
import ical from 'node-ical';

// iCloud CalDAV, read-only. Needs an Apple *app-specific* password (appleid.apple.com).
export async function upcomingEvents(days = 14) {
  if (!process.env.ICLOUD_EMAIL) throw new Error('ICLOUD_EMAIL / ICLOUD_APP_PASSWORD not set in .env');
  const dav = await createDAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: { username: process.env.ICLOUD_EMAIL, password: process.env.ICLOUD_APP_PASSWORD },
    authMethod: 'Basic', defaultAccountType: 'caldav',
  });
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 864e5);
  const out = [];
  for (const cal of await dav.fetchCalendars()) {
    const objs = await dav.fetchCalendarObjects({ calendar: cal, timeRange: { start: from.toISOString(), end: to.toISOString() } });
    for (const o of objs) {
      for (const ev of Object.values(ical.sync.parseICS(o.data))) {
        if (ev.type !== 'VEVENT') continue;
        // expand recurrences (weekly classes etc.) into the window
        const hits = ev.rrule
          ? ical.expandRecurringEvent(ev, { from, to }).map((e) => ({ start: e.start, end: e.end }))
          : [{ start: ev.start, end: ev.end }];
        for (const h of hits) if (h.start >= from && h.start <= to) out.push({ title: ev.summary, cal: cal.displayName, start: h.start, end: h.end, allDay: ev.datetype === 'date', where: ev.location || '' });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
