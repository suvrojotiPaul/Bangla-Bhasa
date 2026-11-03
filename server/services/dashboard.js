import { getDb } from '../db/db.js';
import { currentStreak } from './progress.js';
import { localDay, previousDay } from './text.js';
import { publicUser } from './users.js';

export const DASHBOARD_DAYS = 14;

/** Everyone's progress and daily time in the app, for the admin's People dashboard. */
export function peopleDashboard() {
  const db = getDb();
  const today = localDay();
  const days = [today];
  while (days.length < DASHBOARD_DAYS) days.unshift(previousDay(days[0]));

  const byUser = (rows) => new Map(rows.map((r) => [r.user_id, r]));
  const totals = byUser(db.prepare(`
    SELECT user_id, SUM(seconds) AS seconds, SUM(xp) AS xp, SUM(lessons) AS lessons, SUM(reviews) AS reviews,
      MAX(day) AS last_active, COUNT(*) AS active_days
    FROM daily_activity GROUP BY user_id`).all());
  const words = byUser(db.prepare(`
    SELECT user_id, COUNT(*) AS learning, SUM(CASE WHEN state = 2 AND stability >= 21 THEN 1 ELSE 0 END) AS mastered
    FROM cards GROUP BY user_id`).all());
  const lessonsDone = byUser(db.prepare(`
    SELECT user_id, COUNT(*) AS n FROM lesson_progress WHERE times_completed > 0 GROUP BY user_id`).all());
  const lessonCount = db.prepare('SELECT COUNT(*) FROM lessons').pluck().get();

  const recent = new Map();
  for (const row of db.prepare(`
    SELECT user_id, day, seconds, xp, lessons, reviews FROM daily_activity WHERE day >= ?`).all(days[0])) {
    if (!recent.has(row.user_id)) recent.set(row.user_id, new Map());
    recent.get(row.user_id).set(row.day, row);
  }

  const users = db.prepare(`
    SELECT id, username, display_name, is_admin, created_at, last_login_at
    FROM users WHERE password_hash IS NOT NULL ORDER BY is_admin DESC, lower(display_name)`).all();

  const people = users.map((u) => {
    const t = totals.get(u.id);
    const w = words.get(u.id);
    const mine = recent.get(u.id) ?? new Map();
    const daily = days.map((day) => {
      const r = mine.get(day);
      return { day, seconds: r?.seconds ?? 0, xp: r?.xp ?? 0, lessons: r?.lessons ?? 0, reviews: r?.reviews ?? 0 };
    });
    return {
      ...publicUser(u),
      lastActive: t?.last_active ?? null,
      streak: currentStreak(u.id, today),
      seconds: { today: daily.at(-1).seconds, week: daily.slice(-7).reduce((s, d) => s + d.seconds, 0), total: t?.seconds ?? 0 },
      xp: t?.xp ?? 0,
      lessonsDone: lessonsDone.get(u.id)?.n ?? 0,
      reviews: t?.reviews ?? 0,
      words: { learning: w?.learning ?? 0, mastered: w?.mastered ?? 0 },
      daily,
    };
  });

  return {
    today,
    days,
    lessonCount,
    summary: {
      people: people.length,
      activeToday: people.filter((p) => p.seconds.today > 0 || p.daily.at(-1).xp > 0).length,
      secondsToday: people.reduce((s, p) => s + p.seconds.today, 0),
      secondsWeek: people.reduce((s, p) => s + p.seconds.week, 0),
    },
    people,
  };
}
