import express from 'express';
import { recordTime } from '../services/progress.js';

export default function activityRoutes() {
  const router = express.Router();

  // Sent every 30 s while the app is open and in use; adds to today's time for this user.
  router.post('/ping', (req, res) => {
    res.json({ counted: recordTime(req.user.id) });
  });

  return router;
}
