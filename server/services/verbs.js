import { getDb, getMeta } from '../db/db.js';
import { generatedUrl } from './audio.js';
import { meaningIn } from './hints.js';
import { getSettings } from './settings.js';

/**
 * The verb table for Review → Verbs, cut to what this learner has reached: a verb shows once
 * they've done a lesson that teaches one of its forms, and a tense row once they've done the
 * lesson that opens the tense (or one that teaches a form in that row). Forms the course taught
 * are marked; the others follow the same pattern. With unlockAll (the admin) everything shows.
 */
export function verbTable(userId, { unlockAll = false } = {}) {
  const db = getDb();
  const table = JSON.parse(getMeta('verb_table') ?? 'null');
  if (!table) return { persons: {}, tenses: [], verbs: [] };
  const lang = getSettings(userId).meaningLanguage;

  const done = new Set(db.prepare(`
    SELECT u.position * 1000 + l.position FROM lesson_progress p
    JOIN lessons l ON l.slug = p.lesson_slug JOIN units u ON u.id = l.unit_id
    WHERE p.user_id = ? AND p.times_completed > 0`).pluck().all(userId));
  const reached = (order) => order != null && (unlockAll || done.has(order));
  const taught = (cell) => !!cell && reached(cell.order);

  const shown = new Set();
  const verbs = [];
  for (const v of db.prepare('SELECT bn, ro, en, translations, note, forms FROM verbs ORDER BY position').all()) {
    const rows = JSON.parse(v.forms);
    if (!Object.values(rows).flat().some(taught)) continue;
    const visible = {};
    for (const t of table.tenses) {
      const cells = rows[t.key];
      if (!cells || !(reached(t.from) || cells.some(taught))) continue;
      visible[t.key] = cells.map((c) => c && { bn: c.bn, ro: c.ro, taught: taught(c), audioUrl: generatedUrl(c.bn) });
      shown.add(t.key);
    }
    verbs.push({ bn: v.bn, ro: v.ro, meaning: meaningIn(v, lang), note: v.note, rows: visible });
  }

  return {
    persons: Object.fromEntries(Object.entries(table.persons).map(([key, p]) => [key, { bn: p.bn, meaning: p[lang] ?? p.en }])),
    tenses: table.tenses.filter((t) => shown.has(t.key)).map(({ key, title, hint, persons }) => ({ key, title, hint, persons })),
    verbs,
  };
}
