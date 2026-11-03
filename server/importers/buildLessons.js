import crypto from 'node:crypto';
import { getDb, setMeta } from '../db/db.js';
import { MEANING_LANGUAGES } from '../services/languages.js';
import { lessonOrder } from '../services/lessons.js';
import { ENDINGS, normalizeBn, normalizeAnswer, stemCandidates, tokenize } from '../services/text.js';
import { readCourse } from './course.js';
import { parseVerbs } from './verbs.js';

const SLUG = /^[a-z0-9-]+$/;
// A listed word matches itself or itself plus an ending, not a longer word that starts with it.
const WORD_ENDINGS = new Set(['', ...ENDINGS]);

// Other languages a word or sentence can give its meaning in, e.g. "fr": "Eau".
const TRANSLATIONS = Object.keys(MEANING_LANGUAGES).filter((lang) => lang !== 'en');
const translationsOf = (item) =>
  JSON.stringify(Object.fromEntries(TRANSLATIONS.filter((lang) => item[lang]).map((lang) => [lang, item[lang]])));

// Bump when the way the course is built changes, so every install rebuilds its lessons on the
// next start even though the course files didn't change (2: draft units removed; 3: unit reviews;
// 4: sentences linked to course words through endings; 5: imported Wiktionary/Tatoeba data removed;
// 6: the verb table).
const COURSE_BUILD = 6;
// Every unit ends with a review lesson of all its words, when it has at least this many.
const REVIEW_MIN_WORDS = 6;

export function curriculumHash(raw) {
  return crypto.createHash('sha1').update(`${COURSE_BUILD}
`).update(raw).digest('hex');
}

/** Checks the course (see readCourse) and returns it with every Bengali string in NFC. */
export function parseCurriculum({ data, problems = [] }) {
  const errors = [...problems];
  const words = new Map();
  for (const [key, w] of Object.entries(data.words || {})) {
    const bn = normalizeBn(key);
    if (!w?.en) errors.push(`word "${key}" has no "en"`);
    words.set(bn, { ...w, bn });
  }
  const forms = new Map();
  for (const [key, f] of Object.entries(data.forms || {})) {
    const bn = normalizeBn(key);
    if (!f?.en) errors.push(`form "${key}" has no "en"`);
    if (words.has(bn)) errors.push(`form "${key}" is also a course word`);
    forms.set(bn, { ...f, bn, of: f.of ? normalizeBn(f.of) : null });
  }
  for (const group of data.variants || []) {
    for (const bn of group.map(normalizeBn)) {
      if (!words.has(bn)) errors.push(`variant "${bn}" is not in "words"`);
      else words.get(bn).variantGroup = normalizeBn(group[0]);
    }
  }
  // Safety check on the course itself: no vulgar words.
  const isRude = wordListMatcher((data.rudeWords || []).map(normalizeAnswer).filter(Boolean));
  for (const bn of words.keys()) {
    if (isRude(bn)) errors.push(`word "${bn}" is listed in "rudeWords"`);
  }
  const seenSlugs = new Set();
  const units = (data.units || []).map((u, i) => {
    if (!SLUG.test(u.slug || '')) errors.push(`unit ${i + 1} needs a lower-case "slug"`);
    if (seenSlugs.has(u.slug)) errors.push(`unit slug "${u.slug}" is used twice`);
    seenSlugs.add(u.slug);
    if (!u.title) errors.push(`unit "${u.slug}" has no "title"`);
    const lessons = (u.lessons || []).map((list) => list.map(normalizeBn));
    for (const bn of lessons.flat()) if (!words.has(bn)) errors.push(`unit "${u.slug}" uses "${bn}" which is not in "words"`);
    if (lessons.length === 0) errors.push(`unit "${u.slug}" has no lessons`);
    return { ...u, level: u.level ?? null, lessons };
  });
  if (units.length === 0) errors.push('no units');

  // The lesson that teaches each word; a form counts from its word's lesson, an extra from its unit's first.
  const taughtIn = new Map();
  units.forEach((u, i) => u.lessons.forEach((list, l) => {
    for (const bn of list) if (!taughtIn.has(bn)) taughtIn.set(bn, lessonOrder(i + 1, l + 1));
  }));
  for (const f of forms.values()) {
    if (f.of && !words.has(f.of)) errors.push(`form "${f.bn}" belongs to "${f.of}", which is not a course word`);
    const unit = units.findIndex((u) => u.slug === f.unit);
    taughtIn.set(f.bn, f.of ? taughtIn.get(f.of) ?? 0 : unit >= 0 ? lessonOrder(unit + 1, 1) : 0);
  }
  const tokenLesson = (token) => {
    const bn = normalizeBn(token);
    if (taughtIn.has(bn)) return taughtIn.get(bn);
    const stem = stemCandidates(bn).find((s) => taughtIn.has(s));
    return stem ? taughtIn.get(stem) : 0;
  };

  const sentences = (data.sentences || []).map((s) => {
    if (!s.bn || !s.en) errors.push(`sentence ${JSON.stringify(s)} needs "bn" and "en"`);
    else if (isRude(s.bn)) errors.push(`sentence "${s.bn}" uses a word listed in "rudeWords"`);
    // A sentence is shown from the lesson that teaches the last of its words.
    return { ...s, bn: normalizeBn(s.bn), lessonOrder: Math.max(0, ...tokenize(s.bn ?? '').map(tokenLesson)) || null };
  });
  const verbs = data.verbs ? parseVerbs(data.verbs, taughtIn, errors) : null;
  if (errors.length) throw new Error(`course: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ''}`);
  return { words, forms, units, sentences, taughtIn, verbs };
}

/** (text) => true when any word in it is one of `list` or a form of one (পানি, পানির…). */
function wordListMatcher(list) {
  const single = list.filter((w) => !w.includes(' '));
  return (text) => tokenize(text).some((token) =>
    single.some((w) => token.startsWith(w) && WORD_ENDINGS.has(token.slice(w.length))));
}

/**
 * Removes what the old Wiktionary and Tatoeba imports left in an existing database: their
 * sentences, and their words, except words a learner has a review card for.
 */
function removeImported(db) {
  const sentences = db.prepare("DELETE FROM sentences WHERE source != 'curriculum'").run().changes;
  const words = db.prepare('DELETE FROM words WHERE in_curriculum = 0 AND id NOT IN (SELECT word_id FROM cards)').run().changes;
  return { sentences, words };
}

/**
 * Links each sentence to the words in it. A course word's forms (খাচ্ছি) and its forms with an
 * ending (দরজাটা, কলেজের) count as the course word, the way check-course counts them.
 */
function linkSentences(db, forms) {
  const wordIds = new Map();
  // Course words last, so they win over another word that normalizes to the same text.
  for (const [bn, id] of db.prepare('SELECT bn, id FROM words ORDER BY in_curriculum = 1').raw().all()) wordIds.set(normalizeAnswer(bn), id);
  const courseIds = new Map(db.prepare('SELECT bn, id FROM words WHERE in_curriculum = 1').raw().all().map(([bn, id]) => [normalizeAnswer(bn), id]));
  const baseOf = new Map([...forms.values()].filter((f) => f.of).map((f) => [normalizeAnswer(f.bn), wordIds.get(normalizeAnswer(f.of))]));
  const stemOf = (token) => (courseIds.has(token) || baseOf.has(token) ? null : courseIds.get(stemCandidates(token).find((s) => courseIds.has(s))));
  const sentences = db.prepare('SELECT id, bn FROM sentences').raw().all();
  const insert = db.prepare('INSERT OR IGNORE INTO sentence_words (sentence_id, word_id) VALUES (?, ?)');
  let linked = 0;
  db.transaction(() => {
    db.prepare('DELETE FROM sentence_words').run();
    for (const [sentenceId, bn] of sentences) {
      let any = false;
      for (const token of tokenize(bn)) {
        for (const wordId of [wordIds.get(token), baseOf.get(token), stemOf(token)]) {
          if (!wordId) continue;
          insert.run(sentenceId, wordId);
          any = true;
        }
      }
      if (any) linked += 1;
    }
  })();
  return linked;
}

/**
 * Course words, units, lessons and lesson items. Lesson progress is keyed by slug, so rebuilding
 * these rows keeps every learner's progress. Runs inside a transaction.
 */
function writeCourse(db, curriculum) {
  const upsertWord = db.prepare(`
    INSERT INTO words (bn, ro, pos, en, translations, variant_group, note, in_curriculum)
    VALUES (@bn, @ro, @pos, @en, @translations, @variantGroup, @note, 1)
    ON CONFLICT(bn) DO UPDATE SET
      ro = COALESCE(excluded.ro, words.ro),
      pos = COALESCE(excluded.pos, words.pos),
      en = excluded.en,
      translations = excluded.translations,
      variant_group = excluded.variant_group,
      note = excluded.note,
      in_curriculum = 1`);
  // A form or extra: not taught on its own, but tap-hints show its meaning.
  const upsertForm = db.prepare(`
    INSERT INTO words (bn, ro, en, translations, in_curriculum) VALUES (@bn, @ro, @en, @translations, 2)
    ON CONFLICT(bn) DO UPDATE SET
      ro = COALESCE(excluded.ro, words.ro), en = excluded.en, translations = excluded.translations, in_curriculum = 2`);
  const insertUnit = db.prepare('INSERT INTO units (slug, position, title, title_bn, subtitle, level) VALUES (?, ?, ?, ?, ?, ?)');
  const insertLesson = db.prepare('INSERT INTO lessons (unit_id, slug, position, title, kind) VALUES (?, ?, ?, ?, ?)');
  const insertItem = db.prepare('INSERT INTO lesson_items (lesson_id, word_id, position) VALUES (?, ?, ?)');
  const wordId = db.prepare('SELECT id FROM words WHERE bn = ?').pluck();

  db.prepare("UPDATE words SET in_curriculum = 0, translations = '{}', variant_group = NULL, note = NULL WHERE in_curriculum IN (1, 2)").run();
  for (const f of curriculum.forms.values()) {
    upsertForm.run({ bn: f.bn, ro: f.ro ?? null, en: f.en, translations: translationsOf(f) });
  }
  for (const w of curriculum.words.values()) {
    upsertWord.run({
      bn: w.bn,
      ro: w.ro ?? null,
      pos: w.pos ?? null,
      en: w.en,
      translations: translationsOf(w),
      variantGroup: w.variantGroup ?? null,
      note: w.note ?? null,
    });
  }

  db.prepare('DELETE FROM units').run();
  let units = 0;
  let lessons = 0;
  const addUnit = (slug, title, titleBn, subtitle, lessonWordIds, level) => {
    units += 1;
    const unitId = insertUnit.run(slug, units, title, titleBn, subtitle, level).lastInsertRowid;
    lessonWordIds.forEach((ids, l) => {
      const lessonId = insertLesson.run(unitId, `${slug}-${l + 1}`, l + 1, `Lesson ${l + 1}`, 'lesson').lastInsertRowid;
      ids.forEach((id, i) => insertItem.run(lessonId, id, i + 1));
      lessons += 1;
    });
    const all = lessonWordIds.flat();
    if (all.length >= REVIEW_MIN_WORDS) {
      const reviewId = insertLesson.run(unitId, `${slug}-review`, lessonWordIds.length + 1, 'Unit review', 'review').lastInsertRowid;
      all.forEach((id, i) => insertItem.run(reviewId, id, i + 1));
      lessons += 1;
    }
  };
  for (const unit of curriculum.units) {
    addUnit(unit.slug, unit.title, unit.titleBn ?? null, unit.subtitle ?? null, unit.lessons.map((list) => list.map((bn) => wordId.get(bn))), unit.level);
  }
  writeVerbs(db, curriculum.verbs);
  return { units, lessons };
}

/** The verb table: one row per verb with its forms, and the persons and tenses in meta. */
function writeVerbs(db, table) {
  db.prepare('DELETE FROM verbs').run();
  setMeta('verb_table', table ? JSON.stringify({ persons: table.persons, tenses: table.tenses }) : null);
  const insert = db.prepare(`
    INSERT INTO verbs (position, bn, ro, en, translations, note, reached, forms)
    VALUES (@position, @bn, @ro, @en, @translations, @note, @reached, @forms)`);
  table?.verbs.forEach((v, i) => insert.run({
    position: i + 1,
    bn: v.bn,
    ro: v.ro,
    en: v.en,
    translations: translationsOf(v),
    note: v.note,
    reached: v.reached,
    forms: JSON.stringify(v.rows),
  }));
}

/** The course files -> words, units, lessons, lesson items, sentences and their links. */
export async function buildLessons({ config, report }) {
  const source = readCourse(config.curriculumPath);
  const curriculum = parseCurriculum(source);
  const db = getDb();

  report('Writing units and lessons…');
  const upsertSentence = db.prepare(`
    INSERT INTO sentences (bn, en, ro, translations, lesson_order, source, source_id) VALUES (?, ?, ?, ?, ?, 'curriculum', ?)
    ON CONFLICT(source, source_id) DO UPDATE SET
      en = excluded.en, ro = excluded.ro, translations = excluded.translations, lesson_order = excluded.lesson_order`);

  let course;
  let removed;
  db.transaction(() => {
    course = writeCourse(db, curriculum);

    const keep = new Set(curriculum.sentences.map((s) => s.bn));
    for (const [id, sourceId] of db.prepare(`SELECT id, source_id FROM sentences WHERE source = 'curriculum'`).raw().all()) {
      if (!keep.has(sourceId)) db.prepare('DELETE FROM sentences WHERE id = ?').run(id);
    }
    for (const s of curriculum.sentences) upsertSentence.run(s.bn, s.en, s.ro ?? null, translationsOf(s), s.lessonOrder, s.bn);
    removed = removeImported(db);
  })();

  report('Linking sentences to words…');
  const linked = linkSentences(db, curriculum.forms);
  setMeta('curriculum_hash', curriculumHash(source.raw));
  const old = removed.sentences || removed.words
    ? `; removed ${removed.words.toLocaleString('en')} old dictionary words and ${removed.sentences.toLocaleString('en')} imported sentences`
    : '';

  return {
    count: course.lessons,
    detail: `${course.units} units, ${course.lessons} lessons, ${linked.toLocaleString('en')} sentences linked${old}`,
  };
}
