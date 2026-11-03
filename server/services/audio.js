import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeBn } from './text.js';

// Audio clips are named sha1(text).ext, where text is normalized like normalizeBn, so any
// Bengali string can find its clip.
const GENERATED_FILE = /^([0-9a-f]{40})\.(ogg|wav|mp3)$/;
const RESCAN_MS = 5000;

let audioDir = null;
let generated = new Map(); // hash -> file name
let scannedAt = 0;
let scannedMtime = 0;

export function initAudio(config) {
  audioDir = config.audioDir;
  indexGenerated();
}

export const generatedDir = () => path.join(audioDir, 'generated');

export function textHash(text) {
  return crypto.createHash('sha1').update(normalizeBn(text)).digest('hex');
}

/** Re-reads the generated folder. Returns how many clips it has. */
export function indexGenerated() {
  const dir = generatedDir();
  generated = new Map();
  scannedAt = Date.now();
  if (!fs.existsSync(dir)) return 0;
  scannedMtime = fs.statSync(dir).mtimeMs;
  for (const name of fs.readdirSync(dir)) {
    const match = GENERATED_FILE.exec(name);
    // MP3 wins when a clip exists in several formats: iPhones can't play Ogg.
    if (match && !generated.get(match[1])?.endsWith('.mp3')) generated.set(match[1], name);
  }
  return generated.size;
}

// Picks up clips the script writes while the server is running, without a restart.
function refreshIfChanged() {
  if (Date.now() - scannedAt < RESCAN_MS) return;
  scannedAt = Date.now();
  const dir = generatedDir();
  const mtime = fs.existsSync(dir) ? fs.statSync(dir).mtimeMs : 0;
  if (mtime !== scannedMtime) indexGenerated();
}

export function generatedUrl(text) {
  const file = generatedFile(text);
  return file ? `/api/audio/generated/${file}` : null;
}

/** The generated clip for a word (needs bn), or null: the browser's Bengali voice speaks it then. */
export function wordAudioUrl(word) {
  return generatedUrl(word.bn);
}

/** File name of the generated clip for `text`, if the script made one. */
export function generatedFile(text) {
  refreshIfChanged();
  return generated.get(textHash(text)) ?? null;
}

export function sentenceAudioUrl(sentence) {
  return generatedUrl(sentence.bn);
}

export function isGeneratedFile(name) {
  return GENERATED_FILE.test(name);
}
