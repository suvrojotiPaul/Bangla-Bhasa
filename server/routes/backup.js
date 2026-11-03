import express from 'express';
import { exportUserData, importUserData } from '../services/backup.js';
import { localDay } from '../services/text.js';

export default function backupRoutes() {
  const router = express.Router();

  router.get('/export', (req, res) => {
    res.attachment(`bhasha-backup-${localDay()}.json`);
    res.type('application/json').send(JSON.stringify(exportUserData(req.user.id), null, 2));
  });

  // Body: the exported JSON file as-is.
  router.post('/import', (req, res) => {
    res.json(importUserData(req.user.id, req.body));
  });

  return router;
}
