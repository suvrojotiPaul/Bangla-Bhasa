import express from 'express';
import { positiveInt } from '../http.js';
import { peopleDashboard } from '../services/dashboard.js';
import { endOtherSessions } from '../services/sessions.js';
import { deleteUser, setPassword } from '../services/users.js';

/** The People dashboard. Mounted behind requireAdmin. */
export default function adminRoutes() {
  const router = express.Router();

  router.get('/people', (req, res) => {
    res.json(peopleDashboard());
  });

  // { password }. Signs them out on every device.
  router.put('/people/:id/password', async (req, res) => {
    const id = positiveInt(req.params.id, 'id');
    await setPassword(id, req.body?.password);
    endOtherSessions(id);
    res.json({ ok: true });
  });

  // Removes the account and all of its progress.
  router.delete('/people/:id', (req, res) => {
    deleteUser(positiveInt(req.params.id, 'id'));
    res.json({ ok: true });
  });

  return router;
}
