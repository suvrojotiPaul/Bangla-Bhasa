import { api } from './api.js';

// Matches PING_SECONDS on the server. Time counts while the app is visible and someone has
// tapped, clicked, typed or scrolled in the last IDLE_MS; an app left open on a table doesn't.
const PING_MS = 30_000;
const IDLE_MS = 2 * 60_000;

let lastInput = Date.now();

function markActive() {
  lastInput = Date.now();
}

function ping() {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastInput > IDLE_MS) return;
  if (location.hash === '#/login') return;
  api.post('/activity/ping').catch(() => {
    // Signed out or offline: that half minute just isn't counted.
  });
}

/** Starts counting time in use for whoever is signed in. */
export function startActivityTracking() {
  for (const type of ['pointerdown', 'keydown', 'scroll', 'touchstart']) {
    window.addEventListener(type, markActive, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') markActive();
  });
  setInterval(ping, PING_MS);
}
