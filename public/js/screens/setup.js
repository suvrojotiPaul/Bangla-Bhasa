import { api } from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';

const POLL_MS = 1000;
const IDLE_POLL_MS = 5000; // picks up a re-sync started from Settings
const OFFLINE_RETRY_MS = 3000;

const LABELS = { pending: 'Waiting', running: 'Loading…', done: 'Done', skipped: 'Skipped', error: 'Failed' };
const PILLS = { running: 'pill--ok', done: 'pill--ok', skipped: 'pill--soft', error: 'pill--error' };

// Optional steps that simply aren't set up yet.
const SKIPPED = { generated: 'Not yet' };

function stepLabel(step) {
  if (step.status === 'skipped') return SKIPPED[step.id] ?? LABELS.skipped;
  return LABELS[step.status] ?? step.status;
}

function stepIcon(status) {
  if (status === 'running') return h('span', { class: 'step__icon' }, h('span', { class: 'spinner' }));
  const glyph = { done: 'check', skipped: 'minus', error: 'close' }[status];
  return h(
    'span',
    { class: `step__icon step__icon--${glyph ? status : 'pending'}` },
    glyph ? icon(glyph, { size: 16, strokeWidth: 3 }) : null,
  );
}

function stepRow(step) {
  const detail = step.detail && step.status !== 'pending'
    ? h('span', { class: `step__detail${step.status === 'error' ? ' step__detail--error' : ''}` }, step.detail)
    : null;
  return h(
    'li',
    { class: 'step' },
    stepIcon(step.status),
    h(
      'div',
      { class: 'step__body' },
      h('span', { class: 'step__title' }, step.title),
      h('span', { class: 'step__env' }, step.env),
      detail,
    ),
    h('span', { class: `pill ${PILLS[step.status] ?? ''}` }, stepLabel(step)),
  );
}

/** Screen 1: first launch. Shows the import pipeline live, then lets the learner in. */
export function mount(root) {
  document.title = 'Setting up · Bhasha';
  let timer = null;
  let stopped = false;
  let previous = new Map();

  const subtitle = h('p', { class: 'setup__subtitle' }, 'Setting up your Bengali course');
  const banner = h('div', { 'aria-live': 'polite' });
  const steps = h('ol', { class: 'setup__steps card', 'aria-label': 'Setup steps' });
  const fill = h('div', { class: 'progress__fill' });
  const bar = h(
    'div',
    { class: 'progress', role: 'progressbar', 'aria-label': 'Setup progress', 'aria-valuemin': 0, 'aria-valuemax': 100 },
    fill,
  );
  const note = h('p', { class: 'setup__note' });
  const announcer = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const actions = h('div', { class: 'setup__actions' });

  root.append(
    h(
      'main',
      { class: 'screen setup' },
      h(
        'div',
        { class: 'setup__brand' },
        h('div', { class: 'logo', lang: 'bn', 'aria-hidden': 'true' }, 'ভা'),
        h('h1', { class: 'setup__title' }, 'Bhasha'),
        subtitle,
      ),
      banner,
      steps,
      h('div', { class: 'setup__progress' }, bar, note),
      announcer,
      actions,
    ),
  );

  function schedule(ms) {
    clearTimeout(timer);
    if (!stopped && ms) timer = setTimeout(poll, ms);
  }

  async function resync() {
    try {
      render(await api.post('/setup/resync'));
    } catch (err) {
      if (err.status !== 409) showBanner(err.message, 'error'); // 409: already running, just keep polling
    }
    schedule(POLL_MS);
  }

  function showBanner(text, kind) {
    banner.replaceChildren(text ? h('p', { class: `banner banner--${kind}` }, text) : '');
  }

  // Screen readers hear each step change once, not every progress tick.
  function announceChanges(status) {
    const changes = status.steps
      .filter((s) => previous.size && previous.get(s.id) !== s.status)
      .map((s) => `${s.title}: ${stepLabel(s)}.`);
    if (previous.get('_ready') === false && status.ready && !status.running) changes.push('Your course is ready.');
    previous = new Map([...status.steps.map((s) => [s.id, s.status]), ['_ready', status.ready]]);
    if (changes.length) announcer.textContent = changes.join(' ');
  }

  function render(status) {
    showBanner(null);
    announceChanges(status);
    steps.replaceChildren(...status.steps.map(stepRow));

    fill.style.width = `${status.progress}%`;
    bar.setAttribute('aria-valuenow', String(status.progress));

    const failed = status.steps.filter((s) => s.status === 'error');
    // Optional audio steps can keep going in the background once the lessons exist.
    const coreBusy = status.steps.some((s) => !s.optional && (s.status === 'running' || s.status === 'pending'));
    const finished = status.ready && (!status.running || !coreBusy);
    subtitle.textContent = finished ? 'Your course is ready' : 'Setting up your Bengali course';
    note.replaceChildren(
      'Everything is saved to one local SQLite file (',
      h('code', null, status.dbPath),
      '). After this first run the app works offline, with no ads.',
    );

    const buttons = [];
    if (finished) {
      buttons.push(h('a', { class: 'btn btn--primary', href: '#/home' }, 'Start learning'));
      if (status.running) {
        showBanner('Audio is still being indexed in the background. You can start now.', 'soft');
      } else if (failed.length) {
        showBanner(
          `${failed.map((s) => s.title).join(' and ')} didn't load. Lessons still work with what did. Fix the setting shown above, restart the server, then retry.`,
          'soft',
        );
        buttons.push(h('button', { class: 'btn btn--text', type: 'button', onClick: resync }, 'Retry the import'));
      }
    } else if (status.running) {
      buttons.push(h('button', { class: 'btn btn--waiting', type: 'button', disabled: true }, 'Preparing your course…'));
    } else {
      showBanner(
        failed.length
          ? 'The course could not be built. Check the failed step above, fix it in .env or the course files (data/course), restart the server, and try again.'
          : 'The import has not started yet.',
        'error',
      );
      buttons.push(h('button', { class: 'btn btn--primary', type: 'button', onClick: resync }, 'Try again'));
    }
    actions.replaceChildren(...buttons);
  }

  async function poll() {
    try {
      const status = await api.get('/setup/status');
      if (stopped) return;
      render(status);
      schedule(status.running ? POLL_MS : IDLE_POLL_MS);
    } catch (err) {
      if (stopped) return;
      showBanner(err.offline ? "Can't reach the Bhasha server. Start it with npm start; this page retries on its own." : err.message, 'error');
      schedule(OFFLINE_RETRY_MS);
    }
  }

  poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
