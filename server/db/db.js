import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ROOT } from '../config.js';

// Bump when schema.sql changes the content tables; the next start re-runs the whole import.
export const SCHEMA_VERSION = 3;

const SCHEMA_FILE = path.join(ROOT, 'server', 'db', 'schema.sql');

// Columns added after the first release. schema.sql has them for new databases;
// older databases get them here (and a version bump refills the content ones).
const ADDED_COLUMNS = [
  ['daily_activity', 'seconds', 'INTEGER NOT NULL DEFAULT 0'],
  ['words', 'translations', "TEXT NOT NULL DEFAULT '{}'"],
  ['sentences', 'translations', "TEXT NOT NULL DEFAULT '{}'"],
  ['units', 'level', 'TEXT'],
  ['sentences', 'lesson_order', 'INTEGER'],
  ['lessons', 'kind', "TEXT NOT NULL DEFAULT 'lesson'"],
  ['push_subscriptions', 'p256dh', 'TEXT'],
  ['push_subscriptions', 'auth', 'TEXT'],
];

// Columns no longer used: words.dialect (the course has one variety of Bengali); the rest
// held Wiktionary, Commons and Common Voice data, removed when the course became the only source.
const DROPPED_COLUMNS = [
  ['words', 'dialect'],
  ['words', 'ipa'],
  ['words', 'rude'],
  ['words', 'meanings'],
  ['words', 'audio_path'],
  ['words', 'audio_source'],
  ['words', 'recording_url'],
  ['sentences', 'audio_path'],
  ['sentences', 'audio_source'],
];

// Tables no longer used: the admin's draft units ("Common words"), replaced by the course files.
const DROPPED_TABLES = ['draft_words', 'draft_units'];

// Before accounts, the user tables had no user_id. Their columns, for moving rows across.
const SINGLE_USER_TABLES = {
  cards: 'word_id, due, state, reps, lapses, stability, data',
  review_log: 'word_id, rating, state, source, reviewed_at, data',
  lesson_progress: 'lesson_slug, times_completed, best_accuracy, first_completed_at, last_completed_at',
  daily_activity: 'day, xp, lessons, reviews',
  settings: 'key, value',
};
const SINGLE_USER_INDEXES = ['cards_due', 'review_log_word'];

let db = null;

const hasColumn = (table, column) =>
  !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
const hasTable = (table) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);

function migrateColumns() {
  for (const [table, column, type] of ADDED_COLUMNS) {
    if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  for (const [table, column] of DROPPED_COLUMNS) {
    if (hasColumn(table, column)) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
  for (const table of DROPPED_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
}

/** Renames the pre-accounts user tables to legacy_*, so schema.sql can create the per-user ones. */
function setAsideSingleUserTables() {
  if (!hasTable('cards') || hasColumn('cards', 'user_id')) return;
  db.transaction(() => {
    for (const table of Object.keys(SINGLE_USER_TABLES)) db.exec(`ALTER TABLE ${table} RENAME TO legacy_${table}`);
    for (const index of SINGLE_USER_INDEXES) db.exec(`DROP INDEX IF EXISTS ${index}`);
  })();
}

/**
 * Progress saved before accounts goes to an account with no password yet. The .env admin
 * claims it on start (ensureAdmin in services/users.js).
 */
function moveSingleUserProgress() {
  if (!hasTable('legacy_cards')) return;
  db.transaction(() => {
    const tables = Object.keys(SINGLE_USER_TABLES);
    const rows = tables.reduce((n, t) => n + db.prepare(`SELECT COUNT(*) FROM legacy_${t}`).pluck().get(), 0);
    if (rows > 0) {
      const ownerId = db.prepare(`
        INSERT INTO users (username, display_name, password_hash, is_admin, created_at)
        VALUES ('owner', 'Owner', NULL, 1, ?)`).run(new Date().toISOString()).lastInsertRowid;
      for (const [table, columns] of Object.entries(SINGLE_USER_TABLES)) {
        const knownWords = table === 'cards' ? 'WHERE word_id IN (SELECT id FROM words)' : '';
        db.prepare(`INSERT INTO ${table} (user_id, ${columns}) SELECT ?, ${columns} FROM legacy_${table} ${knownWords}`)
          .run(ownerId);
      }
    }
    for (const table of tables) db.exec(`DROP TABLE legacy_${table}`);
  })();
}

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  setAsideSingleUserTables();
  db.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  migrateColumns();
  moveSingleUserProgress();
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database is not open yet.');
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
}

export function getMeta(key) {
  return getDb().prepare('SELECT value FROM meta WHERE key = ?').pluck().get(key) ?? null;
}

export function setMeta(key, value) {
  getDb()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? null : String(value));
}
