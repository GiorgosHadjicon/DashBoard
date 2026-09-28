import { ImapFlow } from 'imapflow';

// Gmail over IMAP with an app password. GMAIL_QUERY is any Gmail search string.
export async function importantMail() {
  if (!process.env.GMAIL_EMAIL) throw new Error('GMAIL_EMAIL / GMAIL_APP_PASSWORD not set in .env');
  const c = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: process.env.GMAIL_EMAIL, pass: process.env.GMAIL_APP_PASSWORD } });
  await c.connect();
  try {
    const lock = await c.getMailboxLock('[Gmail]/All Mail');
    try {
      const uids = await c.search({ gmraw: process.env.GMAIL_QUERY || 'is:important is:unread newer_than:14d' }, { uid: true });
      const out = [];
      for await (const m of c.fetch(uids.slice(-30), { envelope: true, threadId: true }, { uid: true })) {
        out.push({ from: m.envelope.from?.[0]?.name || m.envelope.from?.[0]?.address, subject: m.envelope.subject, date: m.envelope.date,
          link: `https://mail.google.com/mail/u/0/#all/${m.threadId}` });
      }
      return out.reverse();
    } finally { lock.release(); }
  } finally { await c.logout(); }
}
