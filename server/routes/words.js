import express from 'express';
import { positiveInt } from '../http.js';
import { listWords, wordDetail } from '../services/words.js';

export default function wordsRoutes() {
  const router = express.Router();

  // ?q=search&tab=all|learning|mastered|new&limit=200
  router.get('/', (req, res) => {
    res.json(listWords(req.user.id, req.query));
  });

  router.get('/:id', (req, res) => {
    res.json(wordDetail(req.user.id, positiveInt(req.params.id, 'id')));
  });

  return router;
}
