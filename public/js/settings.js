import { api } from './api.js';

// Settings change rarely, so screens share one copy until the Settings screen saves.
let cached = null;

export function loadSettings() {
  cached ??= api.get('/settings').catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}

export function forgetSettings() {
  cached = null;
}
