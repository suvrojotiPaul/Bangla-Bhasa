import fs from 'node:fs';
import path from 'node:path';

// A course folder holds course.json (filters, and the unit files in course order) and the unit files,
// each one { "level": "A1", "units": [...] }.
const COURSE_FILE = 'course.json';
// The verb table: every verb's forms by tense and person (server/importers/verbs.js). Optional.
const VERBS_FILE = 'verbs.json';
// Units that don't list their lessons get their words split into lessons of about this size.
const LESSON_SIZE = 4;

function parseJson(raw, name) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${name} is not valid JSON: ${err.message}`);
  }
}

/** ["a", "b", …] split into lessons of LESSON_SIZE or a little less, as even as they go. */
export function splitIntoLessons(words) {
  const count = Math.max(1, Math.ceil(words.length / LESSON_SIZE));
  const lessons = [];
  let start = 0;
  for (let i = 0; i < count; i += 1) {
    const size = Math.floor(words.length / count) + (i < words.length % count ? 1 : 0);
    lessons.push(words.slice(start, start + size));
    start += size;
  }
  return lessons;
}

/**
 * Reads the course folder at CURRICULUM_PATH, where each unit carries its own words, forms and
 * sentences. Returns the text read (for the change hash), the course merged into one object
 * (words, forms, units with their level, sentences, filters), and any problems found merging it.
 */
export function readCourse(coursePath) {
  if (!fs.statSync(coursePath).isDirectory()) {
    throw new Error(`CURRICULUM_PATH must be the course folder (data/course), not a file: ${coursePath}`);
  }

  const texts = [];
  const read = (name) => {
    const raw = fs.readFileSync(path.join(coursePath, name), 'utf8');
    texts.push(raw);
    return parseJson(raw, name);
  };
  const top = read(COURSE_FILE);
  const problems = [];
  const data = {
    rudeWords: top.rudeWords ?? [],
    variants: top.variants ?? [],
    words: {},
    forms: {},
    units: [],
    sentences: [],
    verbs: fs.existsSync(path.join(coursePath, VERBS_FILE)) ? read(VERBS_FILE) : null,
  };
  const where = new Map();
  const claim = (bn, place) => {
    if (where.has(bn)) problems.push(`"${bn}" is defined in ${where.get(bn)} and again in ${place}`);
    where.set(bn, place);
  };

  for (const file of top.files ?? []) {
    const level = read(file);
    for (const unit of level.units ?? []) {
      const place = `${file} unit "${unit.slug}"`;
      for (const [bn, w] of Object.entries(unit.words ?? {})) {
        claim(bn, place);
        const { forms, ...word } = w;
        data.words[bn] = word;
        // Inflected forms of a course word: tap-hints, and sentences using them count for the word.
        for (const [form, f] of Object.entries(forms ?? {})) {
          claim(form, place);
          data.forms[form] = { ...(typeof f === 'string' ? { en: f } : f), of: bn };
        }
      }
      // Words the unit's sentences use without teaching them (names, places…): tap-hints only.
      for (const [bn, f] of Object.entries(unit.extra ?? {})) {
        claim(bn, place);
        data.forms[bn] = { ...(typeof f === 'string' ? { en: f } : f), unit: unit.slug };
      }
      data.units.push({
        slug: unit.slug,
        title: unit.title,
        titleBn: unit.titleBn,
        subtitle: unit.subtitle,
        level: level.level ?? null,
        lessons: unit.lessons ?? splitIntoLessons(Object.keys(unit.words ?? {})),
      });
      data.sentences.push(...(unit.sentences ?? []));
    }
  }
  return { raw: texts.join('\n'), data, problems };
}
