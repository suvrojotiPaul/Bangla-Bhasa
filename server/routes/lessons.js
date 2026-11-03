import express from 'express';
import { positiveInt } from '../http.js';
import { buildLesson, checkSentence, completeLesson } from '../services/lessons.js';

export default function lessonsRoutes() {
  const router = express.Router();

  // A fresh set of exercises each time (options are shuffled).
  router.get('/:slug', (req, res) => {
    res.json(buildLesson(req.user.id, req.params.slug));
  });

  // Sentence-building answers are checked here: { sentenceId, answer }.
  router.post('/:slug/check', (req, res) => {
    res.json(checkSentence(req.user.id, positiveInt(req.body?.sentenceId, 'sentenceId'), req.body?.answer));
  });

  // { results: [{ wordId, correct }], mistakes }
  router.post('/:slug/complete', (req, res) => {
    res.json(completeLesson(req.user.id, req.params.slug, req.body));
  });

  return router;
}
