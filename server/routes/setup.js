import express from 'express';
import { requireAdmin } from '../auth.js';
import { httpError } from '../http.js';

export default function setupRoutes({ setup }) {
  const router = express.Router();

  // Polled by the setup screen and the Data section in Settings.
  router.get('/status', (req, res) => {
    res.json(setup.status());
  });

  // "Re-sync" in Settings: rebuilds the course from its files. Admins only.
  router.post('/resync', requireAdmin, (req, res) => {
    if (setup.isRunning()) throw httpError(409, 'An import is already running.');
    setup.run().catch((err) => console.error('[setup]', err));
    res.status(202).json(setup.status());
  });

  return router;
}
