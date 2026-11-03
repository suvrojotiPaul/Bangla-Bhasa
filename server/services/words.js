import { getDb } from '../db/db.js';
import { httpError } from '../http.js';
import { sentenceAudioUrl, wordAudioUrl } from './audio.js';
import { getCard, mastery, masteryStatus } from './srs.js';
import { normalizeBn } from './text.js';

const TABS = new Set(['all', 'learning', 'mastered', 'new']);
const MAX_LIMIT = 500;

function likePattern(q) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function toRow(w) {
  const level = mastery(w.data ? JSON.parse(w.data) : null);
  return {
    id: w.id,
    bn: w.bn,
    ro: w.ro,
    en: w.en,
    note: w.note,
    audioUrl: wordAudioUrl(w),
    mastery: level,
    status: masteryStatus(level),
  };
}

/** Every course word plus anything this user has a review card for, in course order. */
export function listWords(userId, { q = '', tab = 'all', limit = 200 } = {}) {
  if (!TABS.has(tab)) throw httpError(400, `tab must be one of: ${[...TABS].join(', ')}.`);
  const max = Math.min(Math.max(Number(limit) || 200, 1), MAX_LIMIT);
  const search = normalizeBn(String(q));
  const db = getDb();

  const where = ['(w.in_curriculum = 1 OR c.word_id IS NOT NULL)'];
  const whereParams = [];

  // Searching: exact matches first, then words that start with the term, then the rest.
  let rank = '0';
  const rankParams = [];
  if (search) {
    const fields = ['w.bn', 'w.ro', 'w.en'];
    where.push(`(${fields.map((f) => `${f} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    whereParams.push(...fields.map(() => likePattern(search)));
    const prefix = `${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    rank = `CASE
      WHEN w.bn = ? OR lower(w.ro) = lower(?) OR lower(w.en) = lower(?) THEN 0
      WHEN w.bn LIKE ? ESCAPE '\\' OR w.ro LIKE ? ESCAPE '\\' OR w.en LIKE ? ESCAPE '\\' THEN 1
      WHEN w.en LIKE ? ESCAPE '\\' THEN 2
      ELSE 3 END`;
    rankParams.push(search, search, search, prefix, prefix, prefix, likePattern(search));
  }

  // Course words come back in the order the course teaches them.
  const rows = db.prepare(`
    SELECT w.id, w.bn, w.ro, w.en, w.note, c.data,
      ${rank} AS search_rank,
      (SELECT MIN(u.position * 10000 + l.position * 100 + li.position)
         FROM lesson_items li JOIN lessons l ON l.id = li.lesson_id JOIN units u ON u.id = l.unit_id
        WHERE li.word_id = w.id) AS course_order
    FROM words w LEFT JOIN cards c ON c.word_id = w.id AND c.user_id = ?
    WHERE ${where.join(' AND ')}
    ORDER BY search_rank, course_order IS NULL, course_order, length(w.bn), w.bn`).all(...rankParams, userId, ...whereParams);

  const words = rows.map(toRow).filter((w) => tab === 'all' || w.status === tab).slice(0, max);

  const all = db.prepare(`
    SELECT c.data FROM words w LEFT JOIN cards c ON c.word_id = w.id AND c.user_id = ?
    WHERE w.in_curriculum = 1 OR c.word_id IS NOT NULL`).pluck().all(userId);
  const levels = all.map((data) => mastery(data ? JSON.parse(data) : null));
  const summary = {
    total: levels.length,
    mastered: levels.filter((l) => l >= 4).length,
    learning: levels.filter((l) => l > 0 && l < 4).length,
    new: levels.filter((l) => l === 0).length,
  };
  return { summary, words };
}

export function wordDetail(userId, id) {
  const db = getDb();
  const w = db.prepare('SELECT * FROM words WHERE id = ?').get(id);
  if (!w) throw httpError(404, `No word with id ${id}.`);
  const card = getCard(userId, id);
  const variants = w.variant_group
    ? db.prepare('SELECT id, bn, ro, en FROM words WHERE variant_group = ? AND id != ?').all(w.variant_group, id)
    : [];
  const sentences = db.prepare(`
    SELECT s.id, s.bn, s.en, s.ro FROM sentence_words sw JOIN sentences s ON s.id = sw.sentence_id
    WHERE sw.word_id = ? ORDER BY length(s.bn) LIMIT 5`).all(id);
  const level = mastery(card);
  return {
    id: w.id,
    bn: w.bn,
    ro: w.ro,
    pos: w.pos,
    en: w.en,
    note: w.note,
    inCourse: w.in_curriculum === 1,
    audioUrl: wordAudioUrl(w),
    variants,
    sentences: sentences.map((s) => ({
      bn: s.bn, en: s.en, ro: s.ro,
      audioUrl: sentenceAudioUrl(s),
    })),
    card: card
      ? { due: card.due.toISOString(), reps: card.reps, lapses: card.lapses, mastery: level, status: masteryStatus(level) }
      : null,
  };
}
