import { getDb } from '../db/db.js';
import { generatedUrl, indexGenerated } from '../services/audio.js';

/** Counts the audio clips in AUDIO_DIR/generated, and how much of the course has one. */
export async function indexGeneratedAudio() {
  const clips = indexGenerated();
  if (clips === 0) {
    return { skipped: true, detail: 'None. The browser’s Bengali voice speaks every word.' };
  }
  const words = getDb().prepare('SELECT bn FROM words WHERE in_curriculum = 1').all();
  const covered = words.filter((w) => generatedUrl(w.bn)).length;
  const noun = clips === 1 ? 'clip' : 'clips';
  return { count: clips, detail: `${clips.toLocaleString('en')} ${noun}; ${covered} of ${words.length} course words have audio` };
}
