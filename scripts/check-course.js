// Checks the course folder for authoring problems the server would not stop on:
//   node scripts/check-course.js [course folder] [--unit <slug>]
// Prints errors (the server would refuse the course), then warnings per unit, then totals.
import path from 'node:path';
import { ROOT } from '../server/config.js';
import { parseCurriculum } from '../server/importers/buildLessons.js';
import { readCourse } from '../server/importers/course.js';
import { normalizeAnswer, stemCandidates, tokenize } from '../server/services/text.js';

// A word should have at least this many sentences a learner can see in the lesson that teaches it.
const MIN_INTRO_SENTENCES = 2;
const MAX_SENTENCE_TOKENS = 8;

const args = process.argv.slice(2);
const unitFilter = args.includes('--unit') ? args[args.indexOf('--unit') + 1] : null;
const folder = path.resolve(ROOT, args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--unit') ?? 'data/course');

let course;
try {
  course = parseCurriculum(readCourse(folder));
} catch (err) {
  console.error(`ERROR ${err.message}`);
  process.exit(1);
}
const { words, forms, units, sentences, taughtIn, verbs } = course;

const lessonName = (order) => {
  const unit = units[Math.floor(order / 1000) - 1];
  return unit ? `${unit.slug}-${order % 1000}` : 'nowhere';
};
// The course word a token stands for: itself, the word a form belongs to, or a stem.
const courseWordOf = (token) => {
  if (words.has(token)) return token;
  if (forms.get(token)?.of) return forms.get(token).of;
  return stemCandidates(token).find((s) => words.has(s)) ?? null;
};
const isKnown = (token) => taughtIn.has(token) || stemCandidates(token).some((s) => taughtIn.has(s));

const warnings = new Map(units.map((u) => [u.slug, []]));
const warn = (order, message) => warnings.get(units[Math.floor(order / 1000) - 1]?.slug)?.push(message);

// Sentences: unknown words, length, duplicates, missing fields, and ones no lesson would show.
const introCount = new Map();
const seen = new Set();
for (const s of sentences) {
  const order = s.lessonOrder ?? 0;
  const tokens = tokenize(s.bn);
  const label = `"${s.bn}"`;
  if (seen.has(normalizeAnswer(s.bn))) warn(order, `${label} appears twice`);
  seen.add(normalizeAnswer(s.bn));
  const unknown = tokens.filter((t) => !isKnown(t));
  if (unknown.length) warn(order || 1000, `${label} uses words the course never defines: ${unknown.join(', ')}`);
  if (tokens.length > MAX_SENTENCE_TOKENS) warn(order, `${label} has ${tokens.length} words; lessons only use up to ${MAX_SENTENCE_TOKENS}`);
  if (!s.ro || !s.fr) warn(order, `${label} is missing ${['ro', 'fr'].filter((k) => !s[k]).join(' and ')}`);
  const linked = [...new Set(tokens.map(courseWordOf).filter(Boolean))];
  const shownIn = linked.filter((bn) => taughtIn.get(bn) === order);
  if (order && shownIn.length === 0) warn(order, `${label} is never shown: none of its words is taught in ${lessonName(order)}, where it unlocks`);
  for (const bn of shownIn) introCount.set(bn, (introCount.get(bn) ?? 0) + 1);
}

// Words: enough sentences in their own lesson, missing fields, meanings that clash in choice questions.
const byMeaning = new Map();
for (const w of words.values()) {
  const order = taughtIn.get(w.bn);
  if (order === undefined) warn(1000, `"${w.bn}" is defined but in no lesson`);
  const n = introCount.get(w.bn) ?? 0;
  if (n < MIN_INTRO_SENTENCES) warn(order, `"${w.bn}" (${w.en}) has ${n} sentence${n === 1 ? '' : 's'} in its own lesson ${lessonName(order)}`);
  if (!w.ro || !w.fr || !w.pos) warn(order, `"${w.bn}" is missing ${['ro', 'fr', 'pos'].filter((k) => !w[k]).join(', ')}`);
  const key = normalizeAnswer(w.en);
  if (byMeaning.has(key)) warn(order, `"${w.bn}" and "${byMeaning.get(key)}" both mean "${w.en}"`);
  byMeaning.set(key, w.bn);
}
for (const f of forms.values()) if (!f.ro || !f.fr) warn(taughtIn.get(f.bn) || 1000, `form "${f.bn}" is missing ${['ro', 'fr'].filter((k) => !f[k]).join(' and ')}`);

// Verbs: every verb the course teaches (and its forms) is in verbs.json, spelt and romanized the same.
if (verbs) {
  const cells = new Map();
  for (const v of verbs.verbs) {
    if (!v.ro || !v.fr) warn(v.reached, `verbs.json: verb "${v.bn}" is missing ${['ro', 'fr'].filter((k) => !v[k]).join(' and ')}`);
    for (const cell of Object.values(v.rows).flat()) if (cell) cells.set(cell.bn, { ...cell, verb: v.bn });
  }
  const taughtVerbs = [...words.values()].filter((w) => w.pos === 'verb');
  const verbForms = [...forms.values()].filter((f) => words.get(f.of)?.pos === 'verb');
  for (const w of [...taughtVerbs, ...verbForms]) {
    if (verbs.notInTable.includes(w.bn)) continue;
    const cell = cells.get(w.bn);
    if (!cell) warn(taughtIn.get(w.bn), `verb "${w.bn}" (${w.en}) is in no verb's table in verbs.json`);
    else if (cell.ro !== w.ro) warn(taughtIn.get(w.bn), `verb "${w.bn}" is "${w.ro}" in the course but "${cell.ro}" in the table of ${cell.verb}`);
  }
}

let total = 0;
for (const [i, u] of units.entries()) {
  if (unitFilter && u.slug !== unitFilter) continue;
  const list = warnings.get(u.slug);
  const unitWords = u.lessons.flat().length;
  const unitSentences = sentences.filter((s) => Math.floor((s.lessonOrder ?? 0) / 1000) === i + 1).length;
  console.log(`${u.level ?? '--'} ${String(i + 1).padStart(3)} ${u.slug}: ${unitWords} words, ${u.lessons.length} lessons, ${unitSentences} sentences${list.length ? `, ${list.length} warnings` : ''}`);
  for (const message of list) console.log(`      - ${message}`);
  total += list.length;
}
const levels = [...new Set(units.map((u) => u.level))].map((level) => {
  const inLevel = units.filter((u) => u.level === level);
  return `${level ?? '--'}: ${inLevel.length} units, ${inLevel.reduce((n, u) => n + u.lessons.flat().length, 0)} words`;
});
console.log(`\n${units.length} units, ${words.size} words, ${forms.size} forms/extras, ${sentences.length} sentences, ${verbs?.verbs.length ?? 0} verbs in the table, ${total} warnings`);
console.log(levels.join(' · '));
