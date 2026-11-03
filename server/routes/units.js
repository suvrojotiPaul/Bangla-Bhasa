import express from 'express';
import { learningPath } from '../services/lessons.js';
import { progressSummary } from '../services/progress.js';
import { dueCount } from '../services/srs.js';

export default function unitsRoutes() {
  const router = express.Router();

  // Everything the Home screen needs: streak, XP, daily goal, review count and the path.
  router.get('/', (req, res) => {
    const userId = req.user.id;
    res.json({ summary: progressSummary(userId), dueCount: dueCount(userId), units: learningPath(userId, { unlockAll: req.user.isAdmin }) });
  });

  return router;
}
