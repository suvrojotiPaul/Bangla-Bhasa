import { isIP } from 'node:net';
import express from 'express';
import { requireUser } from '../auth.js';
import { httpError } from '../http.js';
import { currentSession, endOtherSessions, endSession, startSession } from '../services/sessions.js';
import { authenticate, changeOwnPassword, signUp } from '../services/users.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10; // wrong passwords per address per window
const MAX_SIGNUPS = 5; // new accounts per address per window

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The visitor's address, for the limits below. Behind a reverse proxy on this machine every
 * request comes from the proxy, so the limits would be shared by everyone; CLIENT_IP_HEADER names
 * the header the proxy puts the visitor's address in. It's only read on connections from this
 * machine: anyone else could fake it.
 */
function clientIp(req, header) {
  const forwarded = header ? req.get(header)?.trim() : null;
  if (forwarded && isIP(forwarded) && LOOPBACK.has(req.socket.remoteAddress)) return forwarded;
  return req.ip;
}

/** Counts per address. Kept in memory: a restart forgives everyone. */
function counter(max, message) {
  const entries = new Map();
  return {
    check(ip) {
      const entry = entries.get(ip);
      if (entry && entry.until > Date.now() && entry.count >= max) throw httpError(429, message);
    },
    add(ip) {
      const now = Date.now();
      const entry = entries.get(ip);
      if (!entry || entry.until <= now) entries.set(ip, { count: 1, until: now + WINDOW_MS });
      else entry.count += 1;
    },
    reset(ip) {
      entries.delete(ip);
    },
  };
}

const failures = counter(MAX_FAILURES, 'Too many wrong passwords. Wait a few minutes and try again.');
const signups = counter(MAX_SIGNUPS, 'Too many new accounts from this device. Wait a few minutes and try again.');

export default function authRoutes({ config }) {
  const router = express.Router();
  const clientIpHeader = config.clientIpHeader;

  // Who is signed in on this browser.
  router.get('/me', (req, res) => {
    res.json({ user: currentSession(req, res)?.user ?? null });
  });

  // { username, displayName, password }. Anyone can make a learner account.
  router.post('/signup', async (req, res) => {
    const ip = clientIp(req, clientIpHeader);
    signups.check(ip);
    const user = await signUp(req.body);
    signups.add(ip);
    startSession(req, res, user.id);
    res.status(201).json({ user });
  });

  // { username, password }
  router.post('/login', async (req, res) => {
    const ip = clientIp(req, clientIpHeader);
    failures.check(ip);
    const user = await authenticate(req.body?.username, req.body?.password);
    if (!user) {
      failures.add(ip);
      throw httpError(401, "That username and password don't match.");
    }
    failures.reset(ip);
    startSession(req, res, user.id);
    res.json({ user });
  });

  router.post('/logout', (req, res) => {
    endSession(req, res);
    res.json({ ok: true });
  });

  // { currentPassword, newPassword }. Signs this account out on every other device.
  router.put('/password', requireUser, async (req, res) => {
    await changeOwnPassword(req.user, req.body);
    endOtherSessions(req.user.id, req.sessionTokenHash);
    res.json({ ok: true });
  });

  return router;
}
