import { getDb } from '../db/db.js';
import { getSettings } from './settings.js';
import { localDay, previousDay } from './text.js';

export const LESSON_XP = 10;
export const PERFECT_LESSON_BONUS = 5;
export const REVIEW_XP = 1;

// The app pings every 30 s while it's open and someone used it in the last 2 minutes.
export const PING_SECONDS = 30;
const lastPing = new Map(); // userId -> ms of the last counted ping

export function addActivity(userId, { xp = 0, lessons = 0, reviews = 0, seconds = 0 }, day = localDay()) {
  getDb()
    .prepare(`
      INSERT INTO daily_activity (user_id, day, xp, lessons, reviews, seconds) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, day) DO UPDATE SET
        xp = xp + excluded.xp,
        lessons = lessons + excluded.lessons,
        reviews = reviews + excluded.reviews,
        seconds = seconds + excluded.seconds`)
    .run(userId, day, xp, lessons, reviews, seconds);
}

/**
 * Counts one ping of time in use. Pings closer together than the interval are ignored, so two
 * open tabs or devices don't count the same half minute twice.
 */
export function recordTime(userId, now = Date.now()) {
  if (now - (lastPing.get(userId) ?? 0) < (PING_SECONDS - 5) * 1000) return false;
  lastPing.set(userId, now);
  addActivity(userId, { seconds: PING_SECONDS });
  return true;
}

/** Days in a row with XP, ending today, or yesterday if nothing is done yet today. */
export function currentStreak(userId, today = localDay()) {
  const days = new Set(getDb().prepare('SELECT day FROM daily_activity WHERE user_id = ? AND xp > 0').pluck().all(userId));
  let day = days.has(today) ? today : previousDay(today);
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day = previousDay(day);
  }
  return streak;
}

export function progressSummary(userId) {
  const db = getDb();
  const today = localDay();
  const xpToday = db.prepare('SELECT xp FROM daily_activity WHERE user_id = ? AND day = ?').pluck().get(userId, today) ?? 0;
  const totalXp = db.prepare('SELECT COALESCE(SUM(xp), 0) FROM daily_activity WHERE user_id = ?').pluck().get(userId);
  const { dailyGoal } = getSettings(userId);
  return { streak: currentStreak(userId, today), xpToday, totalXp, dailyGoal, goalMet: xpToday >= dailyGoal };
}
