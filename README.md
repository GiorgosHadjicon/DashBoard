# Personal Dashboard

Local-first dashboard: school deadlines, Garmin, Apple Calendar, important email, One Piece TCG match-up tracker,
MyFirstHack roadmap, weekly diet and workout log. Node ≥ 22.5, SQLite (`data/dashboard.db`, gitignored).

```bash
npm install
cp .env.example .env   # fill in the logins you want; unconfigured tabs just say "not connected"
npm start              # http://localhost:3000
npm test
```

Binds to 127.0.0.1 only and has no auth. Add auth before hosting it anywhere.

| Tab | Source |
|---|---|
| Deadlines, One Piece, MyFirstHack, Diet, Workouts | typed in by hand, stored in SQLite |
| Garmin | `garmin-connect` (unofficial), tokens cached in `data/garmin-tokens` |
| Calendar | iCloud CalDAV + Apple app-specific password |
| Email | IMAP + Gmail search string in `GMAIL_QUERY` |

## TCD email
`hadjicog@tcd.ie` is Microsoft 365 (no app-password IMAP). In Outlook on the web: Settings → Mail → Rules → add a rule
"apply to all messages" → forward to your Gmail. If TCD blocks external forwarding, this tab can't see TCD mail.
