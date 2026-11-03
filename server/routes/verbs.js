import express from 'express';
import { verbTable } from '../services/verbs.js';

export default function verbsRoutes() {
  const router = express.Router();

  // Every verb the learner has reached, with its forms by tense and person (Review → Verbs).
  router.get('/', (req, res) => {
    res.json(verbTable(req.user.id, { unlockAll: req.user.isAdmin }));
  });

  return router;
}
