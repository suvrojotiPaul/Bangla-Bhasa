import path from 'node:path';
import express from 'express';
import { httpError } from '../http.js';
import { generatedDir, isGeneratedFile } from '../services/audio.js';

export default function audioRoutes() {
  const router = express.Router();

  // Audio clips in AUDIO_DIR/generated, named by a hash of their text.
  router.get('/generated/:file', (req, res) => {
    if (!isGeneratedFile(req.params.file)) throw httpError(400, 'Bad audio file name.');
    res.sendFile(path.join(generatedDir(), req.params.file), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'No such clip.' });
    });
  });

  return router;
}
