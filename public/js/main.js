import { startActivityTracking } from './activity.js';
import { api } from './api.js';
import { h } from './dom.js';
// Imported now: Chrome's install offer can arrive right after the page loads.
import './install.js';
import { registerServiceWorker, syncReminders } from './reminders.js';
import * as admin from './screens/admin.js';
import * as home from './screens/home.js';
import * as lesson from './screens/lesson.js';
import * as login from './screens/login.js';
import * as review from './screens/review.js';
import * as settings from './screens/settings.js';
import * as setup from './screens/setup.js';
import * as verbs from './screens/verbs.js';
import * as words from './screens/words.js';
import { forgetMe, loadMe } from './session.js';
import { loadSettings } from './settings.js';

const root = document.getElementById('app');

// [pattern, screen]. A screen exports mount(root, ctx) and may return a cleanup function.
const ROUTES = [
  [/^\/login$/, login],
  [/^\/setup$/, setup],
  [/^\/home$/, home],
  [/^\/lesson\/([a-z0-9-]+)$/, lesson],
  [/^\/review$/, review],
  [/^\/review\/verbs$/, verbs],
  [/^\/words$/, words],
  [/^\/settings$/, settings],
  [/^\/admin$/, admin],
];

let unmount = null;

function go(path, { replace = false } = {}) {
  if (replace) location.replace(`#${path}`);
  else location.hash = path;
}

function clear() {
  unmount?.();
  unmount = null;
  root.replaceChildren();
}

/** For errors a screen can't recover from itself. */
function onError(err) {
  if (err?.needsLogin) {
    // Signed out elsewhere, or the session ran out.
    forgetMe();
    go('/login', { replace: true });
    return;
  }
  if (err?.needsSetup) {
    go('/setup', { replace: true });
    return;
  }
  clear();
  document.title = 'Error · Bhasha';
  root.append(
    h(
      'main',
      { class: 'screen placeholder' },
      h('h1', null, 'Something went wrong'),
      h('p', null, err?.message || String(err)),
      h('button', { class: 'btn btn--primary', type: 'button', onClick: render }, 'Try again'),
    ),
  );
}

let renderCount = 0;

async function render() {
  clear();
  const path = location.hash.slice(1) || '/';
  // Everything except the sign-in screen needs someone signed in.
  if (path !== '/login') {
    const count = ++renderCount;
    let me = null;
    try {
      me = await loadMe();
    } catch {
      // Offline: let the screen show its own message.
    }
    if (count !== renderCount) return; // another navigation happened meanwhile
    if (me && !me.user) {
      go('/login', { replace: true });
      return;
    }
  }
  for (const [pattern, screen] of ROUTES) {
    const match = path.match(pattern);
    if (!match) continue;
    unmount = screen.mount(root, { params: match.slice(1), go, onError }) ?? null;
    window.scrollTo(0, 0);
    return;
  }
  go('/home', { replace: true });
}

async function start() {
  window.addEventListener('hashchange', render);
  startActivityTracking();
  registerServiceWorker();
  // Reminders: brings this device in line with the learner's setting (never asks anything here).
  loadMe()
    .then(({ user }) => (user ? loadSettings().then(syncReminders) : null))
    .catch(() => {});
  if (location.hash && location.hash !== '#/') {
    render();
    return;
  }
  // First open: sign in, then the setup screen until the course is built, then Home.
  // Changing the hash fires hashchange, which renders.
  let ready = false;
  try {
    if (!(await loadMe()).user) {
      go('/login', { replace: true });
      return;
    }
    ready = (await api.get('/setup/status')).ready;
  } catch {
    // Offline: the setup screen explains it.
  }
  go(ready ? '/home' : '/setup', { replace: true });
}

start();
