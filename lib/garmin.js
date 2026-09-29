import { GarminConnect } from 'garmin-connect';
import { existsSync } from 'node:fs';

const TOKENS = 'data/garmin-tokens';

// Logs in once, then reuses saved tokens so we don't hit Garmin's login every refresh.
async function client() {
  const gc = new GarminConnect({ username: process.env.GARMIN_EMAIL, password: process.env.GARMIN_PASSWORD });
  if (existsSync(TOKENS)) {
    try { gc.loadTokenByFile(TOKENS); await gc.getUserProfile(); return gc; } catch { /* stale tokens: fall through to login */ }
  }
  await gc.login();
  gc.exportTokenToFile(TOKENS);
  return gc;
}

export async function garminToday() {
  if (!process.env.GARMIN_EMAIL) throw new Error('GARMIN_EMAIL / GARMIN_PASSWORD not set in .env');
  const gc = await client();
  const today = new Date();
  // each metric is optional: a missing one (e.g. no sleep synced yet) shouldn't blank the tab
  const [steps, sleep, hr, acts] = await Promise.allSettled([
    gc.getSteps(today), gc.getSleepData(today), gc.getHeartRate(today), gc.getActivities(0, 8),
  ]);
  const v = (r) => (r.status === 'fulfilled' ? r.value : null);
  return {
    steps: v(steps),
    sleepHours: v(sleep)?.dailySleepDTO?.sleepTimeSeconds ? +(v(sleep).dailySleepDTO.sleepTimeSeconds / 3600).toFixed(1) : null,
    restingHr: v(hr)?.restingHeartRate ?? null,
    weekAvgRestingHr: v(hr)?.lastSevenDaysAvgRestingHeartRate ?? null,
    activities: (v(acts) ?? []).map((a) => ({
      name: a.activityName, type: a.activityType?.typeKey, start: a.startTimeLocal,
      km: +(a.distance / 1000).toFixed(2), min: Math.round(a.duration / 60), source: 'Garmin',
    })),
  };
}
