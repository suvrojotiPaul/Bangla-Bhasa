import { getDb } from '../db/db.js';
import { httpError } from '../http.js';
import { generatedUrl, sentenceAudioUrl, wordAudioUrl } from './audio.js';
import { exampleWithHints, hintTokens, meaningIn } from './hints.js';
import { addActivity, LESSON_XP, PERFECT_LESSON_BONUS, progressSummary } from './progress.js';
import { getSettings } from './settings.js';
import { getCard, rate } from './srs.js';
import { normalizeAnswer, shuffle, tokenize } from './text.js';

const MAX_WORD_QUESTIONS = 5;
const LISTEN_QUESTIONS = 2;
const MATCH_PAIRS = 4;
const MAX_SENTENCE_TOKENS = 8;
const SENTENCE_QUESTIONS = 2;
// A unit review: questions on a random mix of the unit's words, and more sentences.
const REVIEW = { choice: 5, listen: 3, sentences: 4 };
const BANK_DISTRACTORS = 3;

const WORD_COLUMNS = 'w.id, w.bn, w.ro, w.pos, w.en, w.translations, w.variant_group, w.note';

const sameMeaning = (a, b) => normalizeAnswer(a) === normalizeAnswer(b);

/**
 * A lesson's place in the whole course, comparable across units. Each curriculum sentence stores
 * the one of the lesson that teaches the last of its words, and only shows from that lesson on.
 */
export const lessonOrder = (unitPosition, lessonPosition) => unitPosition * 1000 + lessonPosition;

// ---------------------------------------------------------------------------
// Learning path (Home screen)
// ---------------------------------------------------------------------------

/**
 * Units with each lesson marked done / current / open / locked for this user. A whole unit opens
 * at once, and the next one opens when its lessons are done (its review is optional, so finishing
 * a unit never depends on it). The first unfinished lesson of the newest open unit is current.
 * With unlockAll (the admin, for checking content), every unit is open.
 */
export function learningPath(userId, { unlockAll = false } = {}) {
  const db = getDb();
  const units = db.prepare('SELECT id, slug, position, title, title_bn, subtitle, level FROM units ORDER BY position').all();
  const lessons = db.prepare(`
    SELECT l.unit_id, l.slug, l.title, l.kind, p.times_completed, p.best_accuracy
    FROM lessons l JOIN units u ON u.id = l.unit_id
    LEFT JOIN lesson_progress p ON p.lesson_slug = l.slug AND p.user_id = ?
    ORDER BY u.position, l.position`).all(userId);

  const byUnit = new Map(units.map((u) => [u.id, []]));
  for (const l of lessons) byUnit.get(l.unit_id).push(l);

  // Units stay open up to and including the first one whose lessons aren't all done.
  let open = true;
  let currentFound = false;
  const marked = new Map();
  for (const u of units) {
    const list = byUnit.get(u.id);
    const passed = list.every((l) => l.kind === 'review' || l.times_completed > 0);
    marked.set(u.id, list.map((l) => {
      let status = open || unlockAll ? 'open' : 'locked';
      if (l.times_completed > 0) status = 'done';
      else if (open && !passed && !currentFound && l.kind !== 'review') {
        status = 'current';
        currentFound = true;
      }
      return { slug: l.slug, title: l.title, kind: l.kind ?? 'lesson', status, bestAccuracy: l.best_accuracy ?? null };
    }));
    if (!passed) open = false;
  }

  return units.map((u) => {
    const list = marked.get(u.id);
    const notYet = list.some((l) => l.status === 'open') ? 'open' : 'locked';
    const done = list.filter((l) => l.status === 'done').length;
    let status = notYet;
    if (done === list.length) status = 'done';
    else if (list.some((l) => l.status === 'current')) status = 'current';
    else if (done > 0) status = 'started';
    return {
      slug: u.slug,
      number: u.position,
      title: u.title,
      titleBn: u.title_bn,
      subtitle: u.subtitle,
      level: u.level,
      status,
      done,
      total: list.length,
      lessons: list,
    };
  });
}

// ---------------------------------------------------------------------------
// Building a lesson
// ---------------------------------------------------------------------------

function findLesson(db, slug) {
  const lesson = db.prepare(`
    SELECT l.id, l.slug, l.title, l.position, l.kind, u.id AS unit_id, u.slug AS unit_slug, u.title AS unit_title,
      u.title_bn AS unit_title_bn, u.position AS unit_position
    FROM lessons l JOIN units u ON u.id = l.unit_id WHERE l.slug = ?`).get(slug);
  if (!lesson) throw httpError(404, `No lesson "${slug}".`);
  return { ...lesson, order: lessonOrder(lesson.unit_position, lesson.position) };
}

function lessonWords(db, lessonId) {
  return db.prepare(`
    SELECT ${WORD_COLUMNS} FROM lesson_items li JOIN words w ON w.id = li.word_id
    WHERE li.lesson_id = ? ORDER BY li.position`).all(lessonId);
}

/**
 * Candidate wrong answers, all from words taught up to this lesson: this unit's first, then the
 * rest. The whole course is only the last resort, so early lessons don't show unseen words.
 */
function distractorPool(db, lesson) {
  const taught = db.prepare(`
    SELECT DISTINCT ${WORD_COLUMNS}, l.unit_id FROM lesson_items li
    JOIN lessons l ON l.id = li.lesson_id JOIN units u ON u.id = l.unit_id JOIN words w ON w.id = li.word_id
    WHERE u.position * 1000 + l.position <= ?`).all(lesson.order);
  const unit = taught.filter((w) => w.unit_id === lesson.unit_id);
  const all = db.prepare(`SELECT ${WORD_COLUMNS} FROM words w WHERE w.in_curriculum = 1`).all();
  return { unit, taught, all };
}

/** Believable wrong answers: same unit and part of speech first; never a synonym of the target. */
function pickDistractors(target, pool, count, exclude = []) {
  const bad = (w) =>
    w.id === target.id ||
    (target.variant_group && w.variant_group === target.variant_group) ||
    sameMeaning(w.en, target.en) ||
    exclude.some((x) => x.id === w.id || sameMeaning(x.en, w.en));
  const picked = [];
  const tiers = [
    pool.unit.filter((w) => w.pos === target.pos),
    pool.unit,
    pool.taught.filter((w) => w.pos === target.pos),
    pool.taught,
    pool.all,
  ];
  for (const tier of tiers) {
    for (const w of shuffle(tier)) {
      if (picked.length >= count) return picked;
      if (!bad(w) && !picked.some((p) => p.id === w.id || sameMeaning(p.en, w.en))) picked.push(w);
    }
  }
  return picked;
}

// Each option carries its meaning, shown once the question is answered.
const optionOf = (w, lang) => ({ wordId: w.id, bn: w.bn, ro: w.ro, audioUrl: wordAudioUrl(w), meaning: meaningIn(w, lang) });

/**
 * Teaches a word the learner hasn't seen yet, before the first question about it: the word,
 * its meaning and sound, and a short example sentence whose words can be tapped for hints.
 */
function learnCard(db, word, lang, order) {
  const example = db.prepare(`
    SELECT s.id, s.bn, s.en, s.ro, s.translations FROM sentence_words sw JOIN sentences s ON s.id = sw.sentence_id
    WHERE sw.word_id = ? AND (s.lesson_order IS NULL OR s.lesson_order <= ?)
    ORDER BY (s.source = 'curriculum') DESC, length(s.bn) LIMIT 1`).get(word.id, order);
  return {
    type: 'learn',
    kind: 'New word',
    prompt: 'Learn this word',
    wordId: word.id,
    bn: word.bn,
    ro: word.ro,
    meaning: meaningIn(word, lang),
    note: word.note,
    audioUrl: wordAudioUrl(word),
    example: example ? exampleWithHints(example, lang, sentenceAudioUrl(example)) : null,
  };
}

function choiceExercise(word, pool, seen, lang) {
  const options = shuffle([word, ...pickDistractors(word, pool, 3)]);
  return {
    type: 'choice',
    kind: seen ? 'Practice' : 'New word',
    prompt: `Which one means “${meaningIn(word, lang).text}”?`,
    wordId: word.id,
    options: options.map((o) => optionOf(o, lang)),
    answerIndex: options.indexOf(word),
  };
}

function listenExercise(word, pool, lang) {
  const options = shuffle([word, ...pickDistractors(word, pool, 3)]);
  return {
    type: 'listen',
    kind: 'Listening',
    prompt: 'Tap what you hear',
    wordId: word.id,
    say: word.bn,
    audioUrl: wordAudioUrl(word),
    options: options.map((o) => optionOf(o, lang)),
    answerIndex: options.indexOf(word),
  };
}

/**
 * Short sentences that use this lesson's words. Course sentences come first, and only ones whose
 * words have all been taught by this lesson; imported ones fill in when there are none.
 */
function sentenceExercises(db, words, pool, lang, order, count = SENTENCE_QUESTIONS) {
  if (words.length === 0) return [];
  const ids = words.map((w) => w.id);
  const candidates = db.prepare(`
    SELECT DISTINCT s.id, s.bn, s.en, s.ro, s.translations, s.source
    FROM sentence_words sw JOIN sentences s ON s.id = sw.sentence_id
    WHERE sw.word_id IN (${ids.map(() => '?').join(',')}) AND (s.lesson_order IS NULL OR s.lesson_order <= ?)`).all(...ids, order);

  const courseWords = db.prepare('SELECT id, bn, ro FROM words WHERE in_curriculum IN (1, 2)').all();
  const known = new Map(courseWords.map((w) => [normalizeAnswer(w.bn), w]));

  const scored = [];
  for (const s of candidates) {
    const tokens = tokenize(s.bn);
    if (tokens.length < 2 || tokens.length > MAX_SENTENCE_TOKENS) continue;
    const knownShare = tokens.filter((t) => known.has(t)).length / tokens.length;
    const score = knownShare * 2 - tokens.length * 0.05;
    scored.push({ ...s, tokens, score });
  }
  const course = scored.filter((s) => s.source === 'curriculum');
  const pick = course.length ? course : scored;
  pick.sort((a, b) => b.score - a.score);
  const wanted = course.length ? count : 1;
  return shuffle(pick.slice(0, wanted * 3)).slice(0, wanted).map((sentence) => buildExercise(sentence, words, pool, lang, known));
}

function buildExercise(sentence, words, pool, lang, known) {
  const extras = shuffle(pool.unit)
    .filter((w) => !w.bn.includes(' ') && !sentence.tokens.includes(normalizeAnswer(w.bn)))
    .slice(0, BANK_DISTRACTORS)
    .map((w) => normalizeAnswer(w.bn));
  const bank = shuffle([...sentence.tokens, ...extras]).map((t) => {
    const word = known.get(t);
    return { bn: t, ro: word?.ro ?? null, audioUrl: word ? wordAudioUrl(word) : generatedUrl(t) };
  });

  return {
    type: 'build',
    kind: 'Sentence',
    prompt: 'Translate this sentence',
    en: sentence.en,
    source: meaningIn(sentence, lang),
    sentenceId: sentence.id,
    audioUrl: sentenceAudioUrl(sentence),
    bank,
    wordIds: words.filter((w) => sentence.tokens.includes(normalizeAnswer(w.bn))).map((w) => w.id),
  };
}

function matchExercise(words, pool, lang) {
  const pairs = [];
  for (const w of words) {
    if (pairs.length < MATCH_PAIRS && !pairs.some((p) => sameMeaning(p.en, w.en))) pairs.push(w);
  }
  if (pairs.length < MATCH_PAIRS && pairs.length > 0) {
    pairs.push(...pickDistractors(pairs[0], { unit: pool.unit, taught: pool.unit, all: pool.unit }, MATCH_PAIRS - pairs.length, pairs));
  }
  if (pairs.length < 3) return null;
  return {
    type: 'match',
    kind: 'Review',
    prompt: 'Match the pairs',
    wordIds: pairs.map((w) => w.id),
    left: shuffle(pairs).map((w) => ({ id: w.id, label: w.bn, ro: w.ro, audioUrl: wordAudioUrl(w) })),
    right: shuffle(pairs).map((w) => ({ id: w.id, label: meaningIn(w, lang).text })),
  };
}

/**
 * A unit review: a random mix of the unit's words and sentences. Words are only taught on a card
 * if this learner hasn't met them yet (the unit's lessons can be taken in any order).
 */
function reviewExercises(db, lesson, words, pool, lang, isNew) {
  const exercises = [];
  for (const w of words.slice(0, REVIEW.choice)) {
    if (isNew.has(w.id)) exercises.push(learnCard(db, w, lang, lesson.order));
    exercises.push(choiceExercise(w, pool, !isNew.has(w.id), lang));
  }
  const heard = words.slice(REVIEW.choice, REVIEW.choice + REVIEW.listen);
  for (const w of heard.length ? heard : words.slice(0, REVIEW.listen)) {
    if (isNew.has(w.id) && !words.slice(0, REVIEW.choice).includes(w)) exercises.push(learnCard(db, w, lang, lesson.order));
    exercises.push(listenExercise(w, pool, lang));
  }
  exercises.push(...sentenceExercises(db, words, pool, lang, lesson.order, REVIEW.sentences));
  const match = matchExercise(shuffle(words), pool, lang);
  if (match) exercises.push(match);
  return exercises;
}

export function buildLesson(userId, slug) {
  const db = getDb();
  const lesson = findLesson(db, slug);
  const review = lesson.kind === 'review';
  const words = review ? shuffle(lessonWords(db, lesson.id)) : lessonWords(db, lesson.id);
  const pool = distractorPool(db, lesson);
  const lang = getSettings(userId).meaningLanguage;
  const isNew = new Set(words.filter((w) => getCard(userId, w.id) === null).map((w) => w.id));

  // A new word is taught on a card right before its first question.
  const exercises = review ? reviewExercises(db, lesson, words, pool, lang, isNew) : [];
  if (!review) {
    for (const w of words.slice(0, MAX_WORD_QUESTIONS)) {
      if (isNew.has(w.id)) exercises.push(learnCard(db, w, lang, lesson.order));
      exercises.push(choiceExercise(w, pool, !isNew.has(w.id), lang));
    }
    for (const w of words.slice(MAX_WORD_QUESTIONS)) if (isNew.has(w.id)) exercises.push(learnCard(db, w, lang, lesson.order));
    for (const w of shuffle(words).slice(0, LISTEN_QUESTIONS)) exercises.push(listenExercise(w, pool, lang));
    exercises.push(...sentenceExercises(db, words, pool, lang, lesson.order));
    const match = matchExercise(words, pool, lang);
    if (match) exercises.push(match);
  }

  return {
    lesson: {
      slug: lesson.slug,
      title: lesson.title,
      kind: lesson.kind ?? 'lesson',
      unit: { slug: lesson.unit_slug, title: lesson.unit_title, titleBn: lesson.unit_title_bn },
    },
    words: words.map((w) => ({
      id: w.id, bn: w.bn, ro: w.ro, en: w.en, meaning: meaningIn(w, lang), note: w.note, audioUrl: wordAudioUrl(w),
    })),
    exercises: exercises.map((e, i) => ({ id: i, ...e })),
  };
}

// ---------------------------------------------------------------------------
// Checking and finishing
// ---------------------------------------------------------------------------

/** Maps each word to its variant group, so words listed as variants count as the same answer. */
function variantCanonicalizer(db) {
  const groups = new Map();
  for (const [bn, group] of db.prepare('SELECT bn, variant_group FROM words WHERE variant_group IS NOT NULL').raw().all()) {
    groups.set(normalizeAnswer(bn), group);
  }
  return (text) => tokenize(text).map((t) => groups.get(t) ?? t).join(' ');
}

/**
 * Sentence answers: NFC, punctuation (।, ?, …) ignored, curriculum variants accepted, and any
 * other Bengali sentence with the same English translation accepted as an alternative.
 */
export function checkSentence(userId, sentenceId, answer) {
  if (typeof answer !== 'string') throw httpError(400, 'Send "answer" as text.');
  const db = getDb();
  const sentence = db.prepare('SELECT id, bn, en, ro FROM sentences WHERE id = ?').get(sentenceId);
  if (!sentence) throw httpError(404, `No sentence with id ${sentenceId}.`);
  const alternatives = db.prepare('SELECT bn FROM sentences WHERE en = ? AND id != ?').pluck().all(sentence.en, sentence.id);
  const canonical = variantCanonicalizer(db);
  const given = canonical(answer);
  const correct = given !== '' && [sentence.bn, ...alternatives].some((bn) => canonical(bn) === given);
  return {
    correct,
    expected: sentence.bn,
    expectedRo: sentence.ro,
    // The right answer with each word tappable for its meaning.
    expectedTokens: hintTokens(sentence.bn, getSettings(userId).meaningLanguage),
    en: sentence.en,
  };
}

/**
 * Records a finished lesson. `results` is one entry per answered word: { wordId, correct }.
 * New words get an FSRS card; any word answered wrong is rated Again so it shows up in review.
 */
export function completeLesson(userId, slug, body) {
  const db = getDb();
  const lesson = findLesson(db, slug);
  const results = Array.isArray(body?.results) ? body.results : null;
  if (!results) throw httpError(400, 'Send "results": [{ "wordId": 1, "correct": true }, …].');
  for (const r of results) {
    if (!Number.isInteger(r?.wordId) || typeof r.correct !== 'boolean') {
      throw httpError(400, 'Each result needs a whole-number "wordId" and a true/false "correct".');
    }
  }
  const mistakes = Number.isInteger(body.mistakes) && body.mistakes >= 0 ? body.mistakes : null;

  // A review only rates the words it asked about; a lesson also starts cards for the words it taught.
  const taught = lesson.kind === 'review' ? [] : lessonWords(db, lesson.id).map((w) => w.id);
  const ids = new Set([...taught, ...results.map((r) => r.wordId)]);
  const wordExists = db.prepare('SELECT 1 FROM words WHERE id = ?').pluck();
  const existing = new Set([...ids].filter((id) => wordExists.get(id)));
  const wrong = new Set(results.filter((r) => !r.correct).map((r) => r.wordId));
  const correctCount = results.filter((r) => r.correct).length;
  const accuracy = results.length ? correctCount / results.length : 1;
  const perfect = wrong.size === 0 && !mistakes;
  const xp = LESSON_XP + (perfect ? PERFECT_LESSON_BONUS : 0);
  const now = new Date();

  db.transaction(() => {
    for (const id of existing) {
      if (!getCard(userId, id)) rate(userId, id, wrong.has(id) ? 'again' : 'good', 'lesson', now);
      else if (wrong.has(id)) rate(userId, id, 'again', 'lesson', now);
    }
    db.prepare(`
      INSERT INTO lesson_progress (user_id, lesson_slug, times_completed, best_accuracy, first_completed_at, last_completed_at)
      VALUES (?, ?, 1, ?, ?, ?)
      ON CONFLICT(user_id, lesson_slug) DO UPDATE SET
        times_completed = times_completed + 1,
        best_accuracy = MAX(COALESCE(best_accuracy, 0), excluded.best_accuracy),
        last_completed_at = excluded.last_completed_at`)
      .run(userId, lesson.slug, accuracy, now.toISOString(), now.toISOString());
    addActivity(userId, { xp, lessons: 1 });
  })();

  return {
    xpEarned: xp,
    perfect,
    accuracy,
    toReview: [...wrong].filter((id) => existing.has(id)),
    summary: progressSummary(userId),
  };
}
