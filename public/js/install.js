// Installing the app. Chrome (Android and desktop) offers installation through a
// beforeinstallprompt event; holding on to it lets the guide show its own Install button.
// Imported early by main.js, because the event can fire right after the page loads.

let offer = null;
const listeners = new Set();
const changed = () => listeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  offer = event;
  changed();
});
window.addEventListener('appinstalled', () => {
  offer = null;
  changed();
});

/** True inside the installed app (opened from its icon). */
export const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

/** True when Chrome has offered to install, so promptInstall() will show its dialog. */
export const canPromptInstall = () => offer !== null;

// iPads since iPadOS 13 say they are Macs; a touch screen gives them away.
export const isIPhone = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** The iOS version as a number (16.4), or null when it can't be told. */
export function iosVersion() {
  const match = navigator.userAgent.match(/OS (\d+)_(\d+)/) ?? navigator.userAgent.match(/Version\/(\d+)\.(\d+)/);
  return match ? Number(`${match[1]}.${match[2]}`) : null;
}

/**
 * Why reminders can't work on this iPhone right now, or null: they need iOS 16.4+ and the app
 * opened from the Home Screen (Safari tabs, and every other iPhone browser, can't get them).
 */
export function iPhoneReminderProblem() {
  if (!isIPhone()) return null;
  const version = iosVersion();
  if (version !== null && version < 16.4) return 'old';
  return isInstalled() ? null : 'not-installed';
}

/** Shows Chrome's install dialog. Resolves to 'accepted' or 'dismissed'. */
export async function promptInstall() {
  if (!offer) return 'dismissed';
  const current = offer;
  offer = null;
  current.prompt();
  const { outcome } = await current.userChoice;
  changed();
  return outcome;
}

/** Calls fn whenever the install offer comes or goes. Returns a function that stops it. */
export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
