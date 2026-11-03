import crypto from 'node:crypto';
import { getDb } from '../db/db.js';
import { userById } from './users.js';

const COOKIE = 'bhasha_session';
const DAY = 24 * 60 * 60 * 1000;
const SESSION_DAYS = 30;

// The cookie holds the token; the database only holds its hash, so a copied database can't sign anyone in.
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function readCookie(req) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE) return value.join('=');
  }
  return null;
}

function setCookie(req, res, token, maxAgeSeconds) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (req.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/** Signs `userId` in on this browser. */
export function startSession(req, res, userId) {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * DAY).toISOString());
  setCookie(req, res, token, SESSION_DAYS * DAY / 1000);
}

/**
 * The signed-in user for this request, or null. A session used at least once a month never
 * expires: each day it's used, it gets another 30 days.
 */
export function currentSession(req, res) {
  const token = readCookie(req);
  if (!token) return null;
  const db = getDb();
  const tokenHash = hashToken(token);
  const session = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(tokenHash);
  const now = Date.now();
  if (!session || Date.parse(session.expires_at) <= now) return null;
  const user = userById(session.user_id);
  if (!user) return null;
  if (Date.parse(session.expires_at) - now < (SESSION_DAYS - 1) * DAY) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(new Date(now + SESSION_DAYS * DAY).toISOString(), tokenHash);
    setCookie(req, res, token, SESSION_DAYS * DAY / 1000);
  }
  return { user, tokenHash };
}

export function endSession(req, res) {
  const token = readCookie(req);
  if (token) getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  setCookie(req, res, '', 0);
}

/** Signs a user out everywhere, except the session `keepTokenHash` (the one making the change). */
export function endOtherSessions(userId, keepTokenHash = null) {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?').run(userId, keepTokenHash);
}
