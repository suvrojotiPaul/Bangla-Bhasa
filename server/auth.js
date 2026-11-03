import { currentSession } from './services/sessions.js';

/**
 * Refuses changes sent from another site. The session cookie is SameSite=Lax already; this also
 * covers browsers that treat a different port on the same host as the same site.
 */
export function sameOriginOnly(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  let sameHost = true;
  try {
    if (origin) sameHost = new URL(origin).host === req.get('host');
  } catch {
    sameHost = false;
  }
  if (sameHost) return next();
  res.status(403).json({ error: 'Requests from other sites are not allowed.' });
}

/** Sets req.user, or answers 401 { login: true } so the app shows the sign-in screen. */
export function requireUser(req, res, next) {
  const session = currentSession(req, res);
  if (!session) {
    res.status(401).json({ error: 'Please sign in.', login: true });
    return;
  }
  req.user = session.user;
  req.sessionTokenHash = session.tokenHash;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.isAdmin) return next();
  res.status(403).json({ error: 'Only an admin can do this.' });
}
