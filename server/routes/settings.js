import express from 'express';
import { getSettings, updateSettings } from '../services/settings.js';

export default function settingsRoutes() {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(getSettings(req.user.id));
  });

  // Partial update: { showRoman, dailyGoal, meaningLanguage, reminders }
  router.put('/', (req, res) => {
    res.json(updateSettings(req.user.id, req.body));
  });

  return router;
}
