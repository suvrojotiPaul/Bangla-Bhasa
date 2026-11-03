import { getDb } from '../db/db.js';
import { httpError } from '../http.js';
import { MEANING_LANGUAGES } from './languages.js';

export const DEFAULT_SETTINGS = {
  showRoman: true,
  dailyGoal: 20, // XP per day
  meaningLanguage: 'en', // word meanings and hints: a key of MEANING_LANGUAGES
  reminders: true, // practice reminders by push; each device still needs the learner's permission
};

const VALID = {
  showRoman: (v) => typeof v === 'boolean',
  dailyGoal: (v) => Number.isInteger(v) && v >= 1 && v <= 500,
  meaningLanguage: (v) => Object.hasOwn(MEANING_LANGUAGES, v),
  reminders: (v) => typeof v === 'boolean',
};

export function getSettings(userId) {
  const settings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of getDb().prepare('SELECT key, value FROM settings WHERE user_id = ?').all(userId)) {
    try {
      const parsed = JSON.parse(value);
      if (VALID[key]?.(parsed)) settings[key] = parsed;
    } catch {
      // Ignore a broken row and keep the default.
    }
  }
  return settings;
}

/** The valid known keys of `input`; everything else is dropped. Used by backup import. */
export function sanitizeSettings(input) {
  const out = {};
  for (const [key, value] of Object.entries(input ?? {})) if (VALID[key]?.(value)) out[key] = value;
  return out;
}

export function saveSettings(userId, values) {
  const upsert = getDb().prepare(
    'INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
  );
  for (const [key, value] of Object.entries(values)) upsert.run(userId, key, JSON.stringify(value));
}

export function updateSettings(userId, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw httpError(400, 'Send settings as a JSON object.');
  for (const [key, value] of Object.entries(patch)) {
    if (!VALID[key]) throw httpError(400, `Unknown setting "${key}".`);
    if (!VALID[key](value)) throw httpError(400, `Invalid value for "${key}": ${JSON.stringify(value)}.`);
  }
  saveSettings(userId, patch);
  return getSettings(userId);
}
