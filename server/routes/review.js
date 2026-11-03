import express from 'express';
import { positiveInt } from '../http.js';
import { reviewQueue, reviewWord } from '../services/srs.js';

const MAX_QUEUE = 100;

export default function reviewRoutes() {
  const router = express.Router();

  router.get('/queue', (req, res) => {
    const limit = req.query.limit ? Math.min(positiveInt(req.query.limit, 'limit'), MAX_QUEUE) : 20;
    res.json(reviewQueue(req.user.id, limit));
  });

  // { rating: "again" | "hard" | "good" | "easy" }
  router.post('/:wordId', (req, res) => {
    res.json(reviewWord(req.user.id, positiveInt(req.params.wordId, 'wordId'), req.body?.rating));
  });

  return router;
}
