import { getDb } from '../db/db.js';
import { httpError } from '../http.js';
import { getSettings, sanitizeSettings, saveSettings } from './settings.js';

const FORMAT = 'bhasha-backup';
const VERSION = 1;

/**
 * One user's progress. Cards and review history refer to words by their Bengali text, not
 * by id, so a backup still loads after a fresh import on another computer.
 */
export function exportUserData(userId) {
  const db = getDb();
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    settings: getSettings(userId),
    cards: db.prepare(`
      SELECT w.bn, c.due, c.state, c.reps, c.lapses, c.stability, c.data
      FROM cards c JOIN words w ON w.id = c.word_id WHERE c.user_id = ? ORDER BY w.bn`).all(userId),
    reviewLog: db.prepare(`
      SELECT w.bn, r.rating, r.state, r.source, r.reviewed_at, r.data
      FROM review_log r JOIN words w ON w.id = r.word_id WHERE r.user_id = ? ORDER BY r.id`).all(userId),
    lessonProgress: db.prepare(`
      SELECT lesson_slug, times_completed, best_accuracy, first_completed_at, last_completed_at
      FROM lesson_progress WHERE user_id = ? ORDER BY lesson_slug`).all(userId),
    dailyActivity: db.prepare('SELECT day, xp, lessons, reviews, seconds FROM daily_activity WHERE user_id = ? ORDER BY day').all(userId),
  };
}

/** Replaces this user's progress with the backup's. Rows for words this course doesn't have are skipped. */
export function importUserData(userId, data) {
  if (!data || data.format !== FORMAT) throw httpError(400, 'This file is not a Bhasha backup.');
  if (data.version > VERSION) throw httpError(400, 'This backup was made by a newer version of the app.');
  for (const key of ['cards', 'reviewLog', 'lessonProgress', 'dailyActivity']) {
    if (!Array.isArray(data[key])) throw httpError(400, `The backup is missing "${key}".`);
  }

  const db = getDb();
  const wordIds = new Map(db.prepare('SELECT bn, id FROM words').raw().all());
  const skipped = { cards: 0, reviewLog: 0 };
  const insertCard = db.prepare(
    'INSERT INTO cards (user_id, word_id, due, state, reps, lapses, stability, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertLog = db.prepare(
    'INSERT INTO review_log (user_id, word_id, rating, state, source, reviewed_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insertProgress = db.prepare(`
    INSERT INTO lesson_progress (user_id, lesson_slug, times_completed, best_accuracy, first_completed_at, last_completed_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const insertDay = db.prepare('INSERT INTO daily_activity (user_id, day, xp, lessons, reviews, seconds) VALUES (?, ?, ?, ?, ?, ?)');

  try {
    db.transaction(() => {
      for (const table of ['cards', 'review_log', 'lesson_progress', 'daily_activity', 'settings']) {
        db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
      }
      for (const c of data.cards) {
        const id = wordIds.get(c.bn);
        if (!id) {
          skipped.cards += 1;
          continue;
        }
        insertCard.run(userId, id, c.due, c.state, c.reps, c.lapses, c.stability, c.data);
      }
      for (const r of data.reviewLog) {
        const id = wordIds.get(r.bn);
        if (!id) {
          skipped.reviewLog += 1;
          continue;
        }
        insertLog.run(userId, id, r.rating, r.state, r.source, r.reviewed_at, r.data);
      }
      for (const p of data.lessonProgress) {
        insertProgress.run(userId, p.lesson_slug, p.times_completed, p.best_accuracy, p.first_completed_at, p.last_completed_at);
      }
      for (const d of data.dailyActivity) insertDay.run(userId, d.day, d.xp, d.lessons, d.reviews, d.seconds ?? 0);
      saveSettings(userId, sanitizeSettings(data.settings));
    })();
  } catch (err) {
    throw httpError(400, `The backup could not be loaded, nothing was changed (${err.message}).`);
  }

  return {
    imported: {
      cards: data.cards.length - skipped.cards,
      reviewLog: data.reviewLog.length - skipped.reviewLog,
      lessonProgress: data.lessonProgress.length,
      dailyActivity: data.dailyActivity.length,
    },
    skipped,
  };
}
