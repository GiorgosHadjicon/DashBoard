const AUTH_BASE = 'https://www.strava.com/oauth';
const API_BASE = 'https://www.strava.com/api/v3';

// Tokens live in the shared `meta` table (same one lib/cards.js uses for its sync timestamp) —
// one row, not .env, since the access token rotates on every refresh while the server is running.
const getTokens = (db) => { const row = db.prepare('select value from meta where key = ?').get('strava_tokens'); return row ? JSON.parse(row.value) : null; };
const saveTokens = (db, tokens) => db.prepare('insert or replace into meta(key,value) values (?,?)').run('strava_tokens', JSON.stringify(tokens));

export const isConnected = (db) => !!getTokens(db);

export function authUrl(redirectUri) {
  if (!process.env.STRAVA_CLIENT_ID) throw new Error('STRAVA_CLIENT_ID not set in .env');
  const p = new URLSearchParams({ client_id: process.env.STRAVA_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', approval_prompt: 'auto', scope: 'activity:read_all' });
  return `${AUTH_BASE}/authorize?${p}`;
}

async function tokenRequest(body) {
  const r = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, ...body }),
  });
  if (!r.ok) throw new Error(`Strava token request failed: HTTP ${r.status}`);
  return r.json();
}

// One-time: the OAuth callback hands us a `code`, we trade it for tokens and remember them.
export async function exchangeCode(db, code) {
  const t = await tokenRequest({ code, grant_type: 'authorization_code' });
  saveTokens(db, { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at, athlete: t.athlete?.firstname });
}

// Access tokens last 6 hours; refresh_token doesn't expire (until revoked). Refresh a little early.
async function freshAccessToken(db) {
  const tokens = getTokens(db);
  if (!tokens) throw new Error('Strava not connected — visit /auth/strava/start to connect it');
  if (tokens.expires_at > Date.now() / 1000 + 60) return tokens.access_token;
  const t = await tokenRequest({ refresh_token: tokens.refresh_token, grant_type: 'refresh_token' });
  saveTokens(db, { ...tokens, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at });
  return t.access_token;
}

export async function stravaActivities(db, count = 8) {
  const token = await freshAccessToken(db);
  const r = await fetch(`${API_BASE}/athlete/activities?per_page=${count}`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Strava activities request failed: HTTP ${r.status}`);
  const acts = await r.json();
  return acts.map((a) => ({ name: a.name, type: a.type, start: a.start_date_local, km: +(a.distance / 1000).toFixed(2), min: Math.round(a.moving_time / 60), source: 'Strava' }));
}
