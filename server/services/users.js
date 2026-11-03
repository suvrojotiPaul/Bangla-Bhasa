import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { getDb } from '../db/db.js';
import { httpError } from '../http.js';

const scrypt = promisify(crypto.scrypt);

// Node's default scrypt cost (about 50 ms per hash). Stored with the hash, so it can be raised later.
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;
export const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const USERNAME = /^[a-z0-9][a-z0-9_.-]{1,31}$/;
const MAX_NAME = 40;

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

/** "scrypt$N$r$p$salt$hash" with base64 salt and hash. */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { ...SCRYPT, maxmem: MAX_MEMORY });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = (stored ?? '').split('$');
  if (scheme !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: MAX_MEMORY,
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Checked against when the username doesn't exist, so a wrong name takes as long as a wrong password.
let dummyHash = null;

// ---------------------------------------------------------------------------
// Input checks
// ---------------------------------------------------------------------------

function cleanUsername(value) {
  const username = String(value ?? '').trim().toLowerCase();
  if (!USERNAME.test(username)) {
    throw httpError(400, 'Usernames are 2–32 characters: letters, numbers, dots, dashes or underscores, starting with a letter or number.');
  }
  return username;
}

function cleanName(value, fallback) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return name || fallback;
}

function checkPassword(value) {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD) {
    throw httpError(400, `Passwords need at least ${MIN_PASSWORD} characters.`);
  }
  if (value.length > MAX_PASSWORD) throw httpError(400, `Passwords can be at most ${MAX_PASSWORD} characters.`);
  return value;
}

const USER_COLUMNS = 'id, username, display_name, is_admin, created_at, last_login_at';

export function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function findUser(id) {
  const row = getDb().prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? AND password_hash IS NOT NULL`).get(id);
  if (!row) throw httpError(404, `No user with id ${id}.`);
  return row;
}

/** Turns a duplicate username into a readable error. */
function withUniqueName(username, write) {
  try {
    return write();
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw httpError(409, `The username "${username}" is taken.`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * Makes the .env admin (ADMIN_USERNAME / ADMIN_PASSWORD) exist with that password, and the only
 * admin. Runs on every start. Progress saved before accounts existed goes to this account.
 * Without an admin in .env, nobody is an admin.
 */
export async function ensureAdmin(admin) {
  const db = getDb();
  if (!admin) {
    db.prepare('UPDATE users SET is_admin = 0').run();
    return null;
  }
  const name = cleanUsername(admin.username);
  const existing = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(name);
  // Hash only when the password changed, so a restart doesn't sign the admin out.
  const samePassword = existing?.password_hash && (await verifyPassword(admin.password, existing.password_hash));
  const hash = samePassword ? null : await hashPassword(admin.password);
  const now = new Date().toISOString();

  const id = db.transaction(() => {
    let adminId = existing?.id;
    if (adminId && hash) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, adminId);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
    }
    if (!adminId) {
      const waiting = db.prepare('SELECT id FROM users WHERE password_hash IS NULL ORDER BY id LIMIT 1').pluck().get();
      if (waiting) {
        db.prepare('UPDATE users SET username = ?, display_name = ?, password_hash = ? WHERE id = ?').run(name, name, hash, waiting);
        adminId = waiting;
      } else {
        adminId = db.prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)')
          .run(name, name, hash, now).lastInsertRowid;
      }
    }
    db.prepare('UPDATE users SET is_admin = CASE WHEN id = ? THEN 1 ELSE 0 END').run(adminId);
    return adminId;
  })();
  return publicUser(findUser(id));
}

/** Anyone can make a learner account from the sign-in screen. */
export async function signUp({ username, displayName, password } = {}) {
  const name = cleanUsername(username);
  const hash = await hashPassword(checkPassword(password));
  const now = new Date().toISOString();
  const id = withUniqueName(name, () => getDb().prepare(`
    INSERT INTO users (username, display_name, password_hash, is_admin, created_at, last_login_at)
    VALUES (?, ?, ?, 0, ?, ?)`).run(name, cleanName(displayName, name), hash, now, now).lastInsertRowid);
  return publicUser(findUser(id));
}

/** The user for this username and password, or null. */
export async function authenticate(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string' || password.length > MAX_PASSWORD) return null;
  const db = getDb();
  const row = db.prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE username = ? AND password_hash IS NOT NULL`)
    .get(username.trim());
  if (!row) {
    dummyHash ??= await hashPassword('not a real password');
    await verifyPassword(password, dummyHash);
    return null;
  }
  if (!(await verifyPassword(password, row.password_hash))) return null;
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, row.id);
  return publicUser({ ...row, last_login_at: now });
}

export function userById(id) {
  const row = getDb().prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? AND password_hash IS NOT NULL`).get(id);
  return row ? publicUser(row) : null;
}

const ADMIN_PASSWORD_IN_ENV = 'The admin password is set by ADMIN_PASSWORD in .env. Change it there and restart the server.';

export async function changeOwnPassword(user, { currentPassword, newPassword } = {}) {
  if (user.isAdmin) throw httpError(400, ADMIN_PASSWORD_IN_ENV);
  const db = getDb();
  const stored = db.prepare('SELECT password_hash FROM users WHERE id = ?').pluck().get(user.id);
  if (typeof currentPassword !== 'string' || !(await verifyPassword(currentPassword, stored))) {
    throw httpError(400, 'Your current password is not right.');
  }
  const hash = await hashPassword(checkPassword(newPassword));
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
}

// ---------------------------------------------------------------------------
// Admin actions (the routes check that the caller is the admin)
// ---------------------------------------------------------------------------

/** A new password for someone who forgot theirs. The caller signs them out everywhere. */
export async function setPassword(id, password) {
  const user = findUser(id);
  if (user.is_admin === 1) throw httpError(400, ADMIN_PASSWORD_IN_ENV);
  const hash = await hashPassword(checkPassword(password));
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
}

/** Removes the account and all of its progress. */
export function deleteUser(id) {
  const user = findUser(id);
  if (user.is_admin === 1) throw httpError(400, "The admin account comes from .env and can't be removed here.");
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
}
