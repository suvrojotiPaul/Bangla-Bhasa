import { normalizeBn } from '../services/text.js';

// The verb table (data/course/verbs.json): every verb's forms by tense and person, for the Verbs
// view in Review. Regular forms are made from the verb's stem; a verb lists the forms that break
// the pattern. Each ending is [Bengali, roman, high]: high endings go on the verb's second stem
// (শোনা: শুনি, শুনছি, শুনব but শোনো, শোনে), which is the same stem for most verbs.
//
// Two patterns, picked by the dictionary form:
//   c  consonant stems: করা, বলা, শোনা (শোন / শুন), ফেরা (ফের / ফির)
//   v  vowel stems, dictionary form in -ওয়া or -নো: খাওয়া, হওয়া, দেওয়া (দে / দি), চালানো
// A tense with no persons has a single form ("" below), like the infinitive করতে.
const ENDINGS = {
  c: {
    present: { ami: ['ি', 'i', true], tumi: ['ো', 'o'], apni: ['েন', 'en'], o: ['ে', 'e'] },
    continuous: { ami: ['ছি', 'chhi', true], tumi: ['ছ', 'chho', true], apni: ['ছেন', 'chhen', true], o: ['ছে', 'chhe', true] },
    future: { ami: ['ব', 'bo', true], tumi: ['বে', 'be', true], apni: ['বেন', 'ben', true], o: ['বে', 'be', true] },
    imperative: { tumi: ['ো', 'o'], apni: ['ুন', 'un', true] },
    infinitive: { '': ['তে', 'te', true] },
  },
  v: {
    present: { ami: ['ই', 'i', true], tumi: ['ও', 'o'], apni: ['ন', 'n'], o: ['য়', 'y'] },
    continuous: { ami: ['চ্ছি', 'chchhi', true], tumi: ['চ্ছ', 'chchho', true], apni: ['চ্ছেন', 'chchhen', true], o: ['চ্ছে', 'chchhe', true] },
    future: { ami: ['ব', 'bo'], tumi: ['বে', 'be'], apni: ['বেন', 'ben'], o: ['বে', 'be'] },
    imperative: { tumi: ['ও', 'o'], apni: ['ন', 'n', true] },
    infinitive: { '': ['তে', 'te', true] },
  },
};
export const TENSES = Object.keys(ENDINGS.c);
const PERSONS = ['ami', 'tumi', 'apni', 'o'];

const patternOf = (bn) => (/(ওয়া|নো)$/.test(normalizeBn(bn)) ? 'v' : 'c');
const cellKey = (tense, person) => (person ? `${tense}.${person}` : tense);

/** "করি kori" -> { bn: "করি", ro: "kori" } */
function split(text) {
  const [bn, ...ro] = String(text).trim().split(/\s+/);
  return { bn: normalizeBn(bn), ro: ro.join(' ') || null };
}

/** Stem + ending, said the way the course writes it: স before ছ or ত is "s" (আসছি aschhi, আসতে aste). */
function join(stem, [bn, ro]) {
  const stemRo = stem.bn.endsWith('স') && /^(ch|t)/.test(ro) ? stem.ro.replace(/sh$/, 's') : stem.ro;
  return { bn: normalizeBn(stem.bn + bn), ro: stemRo + ro };
}

/**
 * Checks verbs.json and makes every verb's forms. `taughtIn` maps course words and forms to the
 * lesson that teaches them; each form carries that lesson's order (or null) so the Verbs view
 * shows a learner only what they've reached. Returns { persons, tenses, verbs, notInTable }.
 */
export function parseVerbs(data, taughtIn, errors) {
  const persons = data.persons ?? {};
  for (const p of PERSONS) if (!persons[p]?.bn) errors.push(`verbs.json: person "${p}" needs "bn" and "en"`);
  const orderOf = (bn) => taughtIn.get(normalizeBn(bn)) ?? null;

  const tenses = (data.tenses ?? []).map((t) => {
    if (!ENDINGS.c[t.key]) errors.push(`verbs.json: unknown tense "${t.key}" (known: ${TENSES.join(', ')})`);
    if (!t.title) errors.push(`verbs.json: tense "${t.key}" has no "title"`);
    const from = orderOf(t.from ?? '');
    if (!from) errors.push(`verbs.json: tense "${t.key}" needs "from", a course word that opens it`);
    return { ...t, from, persons: Object.keys(ENDINGS.c[t.key] ?? {}).filter(Boolean) };
  });

  const seen = new Set();
  const verbs = (data.verbs ?? []).map((v, i) => {
    const name = `verbs.json: verb ${v.bn ?? i + 1}`;
    if (!v.bn || !v.en || !v.stem) errors.push(`${name} needs "bn", "en" and "stem"`);
    if (seen.has(v.bn)) errors.push(`${name} is listed twice`);
    seen.add(v.bn);
    const stem = split(v.stem ?? '');
    const high = v.stem2 ? split(v.stem2) : stem;
    const endings = ENDINGS[v.pattern ?? patternOf(v.bn ?? '')];
    const overrides = v.forms ?? {};
    for (const key of Object.keys(overrides)) {
      const [tense, person = ''] = key.split('.');
      if (!endings?.[tense] || (!Array.isArray(overrides[key]) && !(person in endings[tense]))) errors.push(`${name}: no form "${key}"`);
    }

    const rows = {};
    for (const t of tenses) {
      if (!endings?.[t.key] || (v.skip ?? []).includes(t.key)) continue;
      const people = Object.keys(endings[t.key]);
      const whole = Array.isArray(overrides[t.key]) ? overrides[t.key] : null;
      const cells = people.map((person, k) => {
        if (v.persons && person && !v.persons.includes(person)) return null;
        const key = cellKey(t.key, person);
        const given = whole ? whole[k] : overrides[key];
        if (given === null) return null;
        const form = given !== undefined ? split(given) : join(endings[t.key][person][2] ? high : stem, endings[t.key][person]);
        return { ...form, order: orderOf(form.bn) };
      });
      if (cells.some(Boolean)) rows[t.key] = cells;
    }
    const orders = Object.values(rows).flat().map((c) => c?.order).filter(Boolean);
    if (orders.length === 0) errors.push(`${name}: none of its forms is a course word, so no learner would reach it`);
    return { bn: normalizeBn(v.bn ?? ''), ro: v.ro ?? null, en: v.en, fr: v.fr, note: v.note ?? null, reached: Math.min(...orders), rows };
  });
  return { persons, tenses, verbs, notInTable: (data.notInTable ?? []).map(normalizeBn) };
}
