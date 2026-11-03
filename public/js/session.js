import { api } from './api.js';
import { forgetSettings } from './settings.js';

// { user, needsFirstAccount }, shared by the router and the screens until someone signs in or out.
let cached = null;

export function loadMe() {
  cached ??= api.get('/auth/me').catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}

/** Call after signing in or out: the next screen fetches the new user and their settings. */
export function forgetMe() {
  cached = null;
  forgetSettings();
}
