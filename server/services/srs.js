import { createEmptyCard, fsrs, generatorParameters, Rating, State } from 'ts-fsrs';
import { getDb } from '../db/db.js';
import { httpError } from '../http.js';
import { sentenceAudioUrl, wordAudioUrl } from './audio.js';
import { exampleWithHints, meaningIn } from './hints.js';
import { addActivity, progressSummary, REVIEW_XP } from './progress.js';
import { getSettings } from './settings.js';
import { localDay } from './text.js';

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export const RATINGS = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function parseCard(json) {
  const card = JSON.parse(json);
  card.due = new Date(card.due);
  if (card.last_review) card.last_review = new Date(card.last_review);
  return card;
}

export function getCard(userId, wordId) {
  const json = getDb().prepare('SELECT data FROM cards WHERE user_id = ? AND word_id = ?').pluck().get(userId, wordId);
  return json ? parseCard(json) : null;
}

/** Schedules `wordId` for this user with an FSRS rating. Creates the card on first sight. */
export function rate(userId, wordId, ratingKey, source, now = new Date()) {
  const grade = RATINGS[ratingKey];
  if (!grade) throw httpError(400, `Rating must be one of: ${Object.keys(RATINGS).join(', ')}.`);
  const db = getDb();
  const { card, log } = scheduler.next(getCard(userId, wordId) ?? createEmptyCard(now), now, grade);
  db.prepare(`
    INSERT INTO cards (user_id, word_id, due, state, reps, lapses, stability, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, word_id) DO UPDATE SET
      due = excluded.due, state = excluded.state, reps = excluded.reps,
      lapses = excluded.lapses, stability = excluded.stability, data = excluded.data`)
    .run(userId, wordId, card.due.toISOString(), card.state, card.reps, card.lapses, card.stability, JSON.stringify(card));
  db.prepare('INSERT INTO review_log (user_id, word_id, rating, state, source, reviewed_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userId, wordId, grade, log.state, source, now.toISOString(), JSON.stringify(log));
  return card;
}

/** 0 = new, 1 = learning, 2–3 = getting there, 4 = mastered (stable for 3+ weeks). */
export function mastery(card) {
  if (!card || card.state === State.New) return 0;
  if (card.state === State.Learning || card.state === State.Relearning) return 1;
  if (card.stability < 7) return 2;
  if (card.stability < 21) return 3;
  return 4;
}

export function masteryStatus(level) {
  if (level === 0) return 'new';
  return level >= 4 ? 'mastered' : 'learning';
}

export function formatInterval(ms) {
  if (ms < MINUTE) return '< 1 min';
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} min`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
  const days = Math.round(ms / DAY);
  if (days < 31) return days === 1 ? '1 day' : `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')} yr`;
}

/** What each button would do, e.g. { again: '10 min', good: '3 days', ... }. */
export function previewIntervals(card, now = new Date()) {
  const preview = scheduler.repeat(card, now);
  return Object.fromEntries(
    Object.entries(RATINGS).map(([key, grade]) => [key, formatInterval(preview[grade].card.due - now)]),
  );
}

function dueLabel(due, now) {
  const [dueDay, today] = [localDay(due), localDay(now)];
  if (dueDay >= today) return 'Due today';
  const days = Math.round((new Date(today) - new Date(dueDay)) / DAY);
  return `Overdue ${days} day${days === 1 ? '' : 's'}`;
}

export function dueCount(userId, now = new Date()) {
  return getDb().prepare('SELECT COUNT(*) FROM cards WHERE user_id = ? AND due <= ?').pluck().get(userId, now.toISOString());
}

export function reviewQueue(userId, limit = 20) {
  const db = getDb();
  const now = new Date();
  const rows = db.prepare(`
    SELECT c.word_id, c.data, w.bn, w.ro, w.en, w.translations, w.note,
      (SELECT u.title FROM lesson_items li
         JOIN lessons l ON l.id = li.lesson_id JOIN units u ON u.id = l.unit_id
        WHERE li.word_id = w.id ORDER BY u.position, l.position LIMIT 1) AS unit_title
    FROM cards c JOIN words w ON w.id = c.word_id
    WHERE c.user_id = ? AND c.due <= ? ORDER BY c.due LIMIT ?`).all(userId, now.toISOString(), limit);
  const example = db.prepare(`
    SELECT s.id, s.bn, s.en, s.ro, s.translations FROM sentence_words sw JOIN sentences s ON s.id = sw.sentence_id
    WHERE sw.word_id = ? ORDER BY (s.source = 'curriculum') DESC, length(s.bn) LIMIT 1`);
  const lang = getSettings(userId).meaningLanguage;

  return {
    total: dueCount(userId, now),
    cards: rows.map((row) => {
      const card = parseCard(row.data);
      const ex = example.get(row.word_id);
      return {
        wordId: row.word_id,
        bn: row.bn,
        ro: row.ro,
        en: row.en,
        meaning: meaningIn(row, lang),
        note: row.note,
        audioUrl: wordAudioUrl(row),
        tag: row.unit_title ?? 'Everyday',
        due: dueLabel(card.due, now),
        mastery: mastery(card),
        example: ex ? exampleWithHints(ex, lang, sentenceAudioUrl(ex)) : null,
        intervals: previewIntervals(card, now),
      };
    }),
  };
}

export function reviewWord(userId, wordId, ratingKey) {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM words WHERE id = ?').get(wordId)) throw httpError(404, `No word with id ${wordId}.`);
  let card;
  db.transaction(() => {
    card = rate(userId, wordId, ratingKey, 'review');
    addActivity(userId, { xp: REVIEW_XP, reviews: 1 });
  })();
  return {
    wordId,
    nextDue: card.due.toISOString(),
    nextIn: formatInterval(card.due - new Date()),
    mastery: mastery(card),
    remaining: dueCount(userId),
    summary: progressSummary(userId),
  };
}
