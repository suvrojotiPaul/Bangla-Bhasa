import { getDb } from '../db/db.js';
import { httpError } from '../http.js';
import { learningPath } from './lessons.js';
import { isPushEndpoint, sendPush } from './push.js';
import { getSettings } from './settings.js';
import { dueCount } from './srs.js';

// Practice reminders: at these local hours a device gets a push if its learner has reminders on
// and hasn't practised in the last GAP_HOURS. A slot is only used during its first hour, so a
// server that was off doesn't send a pile of late reminders when it comes back.
export const SLOT_HOURS = [9, 15, 21];
const GAP_HOURS = 6;
const CHECK_MS = 5 * 60 * 1000;
const MAX_DEVICES = 10;

function validTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return typeof timeZone === 'string';
  } catch {
    return false;
  }
}

/** The local day and hour in a time zone: { day: "2026-10-30", hour: 15 }. */
function localTime(timeZone, now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Saves this device's push subscription for the signed-in learner (a device follows its last account). */
export function subscribe(userId, body) {
  const endpoint = body?.subscription?.endpoint;
  if (typeof endpoint !== 'string' || !isPushEndpoint(endpoint)) throw httpError(400, 'Send this browser\'s push subscription.');
  const timeZone = validTimeZone(body.timeZone) ? body.timeZone : 'UTC';
  // The keys let the server put the message in the push itself (needed on iPhone).
  const key = (k) => (typeof k === 'string' && /^[A-Za-z0-9_-]{16,200}$/.test(k) ? k : null);
  const { p256dh = null, auth = null } = body.subscription.keys ?? {};
  const db = getDb();
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, time_zone, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, time_zone = excluded.time_zone`)
    .run(userId, endpoint, key(p256dh), key(auth), timeZone, new Date().toISOString());
  db.prepare(`
    DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN (
      SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT ?)`).run(userId, userId, MAX_DEVICES);
  return { ok: true };
}

export function unsubscribe(userId, endpoint) {
  getDb().prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, String(endpoint ?? ''));
  return { ok: true };
}

function lastPractice(userId) {
  return getDb().prepare(`
    SELECT MAX(t) FROM (
      SELECT MAX(last_completed_at) AS t FROM lesson_progress WHERE user_id = ?
      UNION ALL SELECT MAX(reviewed_at) FROM review_log WHERE user_id = ?)`).pluck().get(userId, userId);
}

/** What the notification says. The service worker asks for it when a push arrives. */
export function reminderMessage(userId) {
  const due = dueCount(userId);
  if (due > 0) {
    return {
      title: 'Time to practise Bengali',
      body: `${due} ${due === 1 ? 'word' : 'words'} to review. A few minutes keeps them fresh.`,
      url: '/#/review',
    };
  }
  const next = learningPath(userId).flatMap((u) => u.lessons.map((l) => ({ u, l }))).find(({ l }) => l.status === 'current');
  return {
    title: 'Time to practise Bengali',
    body: next ? `Next up: ${next.u.title}, ${next.l.title}.` : 'A quick lesson keeps your Bengali going.',
    url: '/#/home',
  };
}

/**
 * One pass of the scheduler: every device whose local time is in the first hour of a slot it
 * hasn't handled yet. `send` is replaceable for testing. Returns what happened to each device.
 */
export async function checkReminders(now = new Date(), send = sendPush) {
  const db = getDb();
  const devices = db.prepare('SELECT id, user_id, endpoint, p256dh, auth, time_zone, last_slot FROM push_subscriptions').all();
  const handled = db.prepare('UPDATE push_subscriptions SET last_slot = ? WHERE id = ?');
  const sentAt = db.prepare('UPDATE push_subscriptions SET last_sent_at = ? WHERE id = ?');
  const forget = db.prepare('DELETE FROM push_subscriptions WHERE id = ?');
  const outcomes = [];
  for (const device of devices) {
    const { day, hour } = localTime(device.time_zone, now);
    const slot = SLOT_HOURS.findLast((h) => h <= hour);
    if (slot === undefined || hour !== slot) continue;
    const key = `${day} ${slot}`;
    if (device.last_slot === key) continue;
    handled.run(key, device.id);
    let outcome = 'off';
    if (getSettings(device.user_id).reminders) {
      const last = lastPractice(device.user_id);
      outcome = last && now - new Date(last) < GAP_HOURS * 3600_000 ? 'practised' : await send(device, reminderMessage(device.user_id));
    }
    if (outcome === 'gone') forget.run(device.id);
    if (outcome === 'sent') sentAt.run(now.toISOString(), device.id);
    outcomes.push({ id: device.id, userId: device.user_id, slot: key, outcome });
  }
  return outcomes;
}

/** "Send a test" in Settings: a push to every device of this learner, right now. */
export async function sendTest(userId) {
  const db = getDb();
  const devices = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
  if (devices.length === 0) throw httpError(409, 'Reminders aren\'t on for any device yet.');
  let sent = 0;
  for (const device of devices) {
    const outcome = await sendPush(device, reminderMessage(userId));
    if (outcome === 'gone') db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(device.id);
    if (outcome === 'sent') sent += 1;
  }
  return { devices: devices.length, sent };
}

export function startReminders() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (const o of await checkReminders()) if (o.outcome !== 'off') console.log(`[reminders] user ${o.userId}, ${o.slot}: ${o.outcome}`);
    } catch (err) {
      console.error('[reminders]', err);
    } finally {
      running = false;
    }
  };
  setInterval(run, CHECK_MS).unref();
  setTimeout(run, 10_000).unref();
}
