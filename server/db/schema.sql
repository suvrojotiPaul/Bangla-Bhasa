CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ---------------------------------------------------------------------------
-- Content tables: built from the course files (data/course), safe to rebuild.
-- Words are upserted by their Bengali text, so word ids stay stable across
-- rebuilds and the user tables can point at them.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sources (
  id         TEXT PRIMARY KEY,
  status     TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | skipped | error
  detail     TEXT,
  item_count INTEGER,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS words (
  id            INTEGER PRIMARY KEY,
  bn            TEXT NOT NULL UNIQUE,           -- Bengali, Unicode NFC
  ro            TEXT,                           -- romanization
  pos           TEXT,                           -- part of speech
  en            TEXT,                           -- short English meaning used in exercises
  translations  TEXT NOT NULL DEFAULT '{}',     -- JSON {fr: "Eau"}: the meaning in other languages
  variant_group TEXT,                           -- words with the same group mean the same thing
  note          TEXT,
  in_curriculum INTEGER NOT NULL DEFAULT 0       -- 1: taught in a lesson; 2: a course form or extra (tap-hints only);
                                                -- 0: no longer in the course, kept because a learner has a card for it
);
CREATE INDEX IF NOT EXISTS words_curriculum ON words(in_curriculum);
CREATE INDEX IF NOT EXISTS words_variant ON words(variant_group);

CREATE TABLE IF NOT EXISTS sentences (
  id         INTEGER PRIMARY KEY,
  bn         TEXT NOT NULL,
  en         TEXT NOT NULL,
  ro         TEXT,
  translations TEXT NOT NULL DEFAULT '{}',      -- JSON {fr: "…"}: the meaning in other languages
  lesson_order INTEGER,                         -- the lesson that teaches the last of its words (see lessonOrder)
  source     TEXT NOT NULL,                     -- always 'curriculum' now (Tatoeba and Wiktionary sentences were removed)
  source_id  TEXT NOT NULL,
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS sentences_en ON sentences(en);

CREATE TABLE IF NOT EXISTS sentence_words (
  sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  word_id     INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  PRIMARY KEY (sentence_id, word_id)
);
CREATE INDEX IF NOT EXISTS sentence_words_word ON sentence_words(word_id);

CREATE TABLE IF NOT EXISTS units (
  id       INTEGER PRIMARY KEY,
  slug     TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL,
  title    TEXT NOT NULL,
  title_bn TEXT,
  subtitle TEXT,
  level    TEXT                                 -- CEFR level from the course folder: A1, A2, B1, B2
);

CREATE TABLE IF NOT EXISTS lessons (
  id       INTEGER PRIMARY KEY,
  unit_id  INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  slug     TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL,
  title    TEXT NOT NULL,
  kind     TEXT NOT NULL DEFAULT 'lesson'     -- lesson | review (a unit's last lesson: all its words)
);

CREATE TABLE IF NOT EXISTS lesson_items (
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  word_id   INTEGER NOT NULL REFERENCES words(id),
  position  INTEGER NOT NULL,
  PRIMARY KEY (lesson_id, position)
);
CREATE INDEX IF NOT EXISTS lesson_items_word ON lesson_items(word_id);

-- The verb table from data/course/verbs.json (Review → Verbs). Persons and tenses are in meta
-- (verb_table). "reached" and each form's "order" are lessonOrder()s: a learner sees a verb from
-- the lesson that first teaches one of its forms.
CREATE TABLE IF NOT EXISTS verbs (
  id           INTEGER PRIMARY KEY,
  position     INTEGER NOT NULL,
  bn           TEXT NOT NULL,                 -- dictionary form: করা, খাওয়া
  ro           TEXT,
  en           TEXT NOT NULL,
  translations TEXT NOT NULL DEFAULT '{}',
  note         TEXT,
  reached      INTEGER NOT NULL,
  forms        TEXT NOT NULL                  -- JSON { tense: [{ bn, ro, order } | null, …] }
);

-- ---------------------------------------------------------------------------
-- Accounts. Passwords are scrypt hashes; a session cookie holds a random token
-- and only its SHA-256 is stored here.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT,                           -- NULL only for progress saved before accounts existed, until the .env admin claims it
  is_admin      INTEGER NOT NULL DEFAULT 0,       -- only the ADMIN_USERNAME account from .env
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- User tables: one learner's progress each, never touched by the import
-- (except that a word removed from the course takes its cards with it).
-- Export/Import in Settings saves and restores one user's rows.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cards (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id   INTEGER NOT NULL REFERENCES words(id),
  due       TEXT NOT NULL,                      -- ISO time, UTC
  state     INTEGER NOT NULL,                   -- ts-fsrs State: 0 new, 1 learning, 2 review, 3 relearning
  reps      INTEGER NOT NULL,
  lapses    INTEGER NOT NULL,
  stability REAL NOT NULL,
  data      TEXT NOT NULL,                      -- full ts-fsrs card as JSON
  PRIMARY KEY (user_id, word_id)
);
CREATE INDEX IF NOT EXISTS cards_user_due ON cards(user_id, due);
CREATE INDEX IF NOT EXISTS cards_word ON cards(word_id);

CREATE TABLE IF NOT EXISTS review_log (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id     INTEGER NOT NULL,
  rating      INTEGER NOT NULL,                 -- 1 again, 2 hard, 3 good, 4 easy
  state       INTEGER NOT NULL,
  source      TEXT NOT NULL,                    -- lesson | review
  reviewed_at TEXT NOT NULL,
  data        TEXT NOT NULL                     -- ts-fsrs review log as JSON
);
CREATE INDEX IF NOT EXISTS review_log_user_word ON review_log(user_id, word_id);

CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_slug        TEXT NOT NULL,
  times_completed    INTEGER NOT NULL DEFAULT 0,
  best_accuracy      REAL,
  first_completed_at TEXT,
  last_completed_at  TEXT,
  PRIMARY KEY (user_id, lesson_slug)
);

CREATE TABLE IF NOT EXISTS daily_activity (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,                        -- local date YYYY-MM-DD
  xp      INTEGER NOT NULL DEFAULT 0,
  lessons INTEGER NOT NULL DEFAULT 0,
  reviews INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER NOT NULL DEFAULT 0,           -- time with the app open and in use
  PRIMARY KEY (user_id, day)
);

-- Devices that get practice reminders (web push). Removed when the push service says the
-- subscription has expired, or the learner turns reminders off on that device.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,              -- the browser's push service URL for this device
  p256dh       TEXT,                              -- the device's keys, to encrypt the message (RFC 8291)
  auth         TEXT,
  time_zone    TEXT NOT NULL,                     -- IANA zone, for the 9:00 / 15:00 / 21:00 local slots
  created_at   TEXT NOT NULL,
  last_slot    TEXT,                              -- "2026-10-30 15": the last slot handled
  last_sent_at TEXT
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,                        -- JSON
  PRIMARY KEY (user_id, key)
);
