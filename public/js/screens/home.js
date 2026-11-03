import { api } from '../api.js';
import { maybeShowGuide } from '../components/guide.js';
import { tabbar } from '../components/tabbar.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { enableReminders, reminderState } from '../reminders.js';
import { forgetSettings, loadSettings } from '../settings.js';

function header(summary) {
  const days = summary.streak === 1 ? 'day' : 'days';
  return h(
    'header',
    { class: 'home__header' },
    h(
      'div',
      { class: 'home__brand' },
      h('div', { class: 'logo', lang: 'bn', 'aria-hidden': 'true' }, 'ভা'),
      h('span', { class: 'home__name' }, 'Bhasha'),
    ),
    h(
      'div',
      { class: 'home__stats' },
      h(
        'span',
        { class: 'stat stat--streak', title: `${summary.streak} ${days} in a row` },
        icon('flame', { size: 18, strokeWidth: 1.5 }),
        summary.streak,
        h('span', { class: 'sr-only' }, ` ${days} streak`),
      ),
      h(
        'span',
        { class: 'stat stat--xp', title: 'Total XP' },
        icon('bolt', { size: 16, strokeWidth: 1.5 }),
        `${summary.totalXp} XP`,
      ),
    ),
  );
}

function dailyGoal({ xpToday, dailyGoal: goal, goalMet }) {
  const pct = Math.min(100, Math.round((xpToday / goal) * 100));
  return h(
    'section',
    { class: 'goal card', 'aria-labelledby': 'goal-title' },
    h(
      'div',
      { class: 'goal__row' },
      h('h2', { class: 'goal__title', id: 'goal-title' }, 'Daily goal'),
      h('span', { class: `goal__count${goalMet ? ' goal__count--met' : ''}` }, `${xpToday} / ${goal} XP${goalMet ? ' · done' : ''}`),
    ),
    h(
      'div',
      { class: 'progress', role: 'progressbar', 'aria-labelledby': 'goal-title', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct },
      h('div', { class: 'progress__fill', style: `width:${pct}%` }),
    ),
  );
}

function reviewCard(dueCount) {
  if (dueCount === 0) {
    return h(
      'div',
      { class: 'review-cta review-cta--empty' },
      h('span', { class: 'review-cta__icon' }, icon('check', { size: 22, strokeWidth: 2.5 })),
      h(
        'span',
        { class: 'review-cta__text' },
        h('span', { class: 'review-cta__title' }, 'Nothing to review right now'),
        h('span', { class: 'review-cta__sub' }, 'Words you learn come back here when they start to fade'),
      ),
    );
  }
  return h(
    'a',
    { class: 'review-cta review-cta--due', href: '#/review' },
    h('span', { class: 'review-cta__icon' }, icon('review', { size: 22, strokeWidth: 2.2 })),
    h(
      'span',
      { class: 'review-cta__text' },
      h('span', { class: 'review-cta__title' }, `${dueCount} ${dueCount === 1 ? 'word' : 'words'} to review`),
      h('span', { class: 'review-cta__sub' }, 'Refresh them before they fade'),
    ),
    icon('chevronRight', { size: 20, strokeWidth: 2.5 }),
  );
}

/** A unit's review: a blue rounded square with a "Review" caption, so it stands apart from the lessons. */
function reviewNode(unit, lesson) {
  const href = `#/lesson/${lesson.slug}`;
  const done = lesson.status === 'done';
  if (lesson.status === 'locked') {
    return h('span', { class: 'node node--square node--locked', role: 'img', 'aria-label': `${unit.title} review: locked` }, icon('lock', { size: 18, strokeWidth: 2.2 }));
  }
  return h(
    'a',
    { class: 'node-labelled node-labelled--review', href, 'aria-label': `${unit.title} review${done ? ': completed. Practice again' : ''}` },
    h('span', { class: `node node--square ${done ? 'node--review-done' : 'node--review'}` },
      done ? icon('check', { size: 22, strokeWidth: 3 }) : icon('review', { size: 22, strokeWidth: 2.4 })),
    h('span', { 'aria-hidden': 'true' }, 'Review'),
  );
}

function lessonNode(unit, lesson) {
  if (lesson.kind === 'review') return reviewNode(unit, lesson);
  const name = `${unit.title}, ${lesson.title}`;
  const href = `#/lesson/${lesson.slug}`;
  if (lesson.status === 'done') {
    return h(
      'a',
      { class: 'node node--done', href, 'aria-label': `${name}: completed. Practice again` },
      icon('check', { size: 22, strokeWidth: 3 }),
    );
  }
  if (lesson.status === 'current') {
    return h(
      'a',
      { class: 'node-current', href, 'aria-label': `Start ${name}` },
      h('span', { class: 'node node--current' }, icon('play', { size: 22 })),
      h('span', { 'aria-hidden': 'true' }, 'Start'),
    );
  }
  // The rest of the open unit (and, for the admin, every unit after it).
  if (lesson.status === 'open') {
    return h('a', { class: 'node node--open', href, 'aria-label': `Open ${name}` }, icon('play', { size: 18 }));
  }
  return h('span', { class: 'node node--locked', role: 'img', 'aria-label': `${name}: locked` }, icon('lock', { size: 18, strokeWidth: 2.2 }));
}

function unitCard(unit) {
  const titleId = `unit-${unit.slug}-title`;
  return h(
    'section',
    { class: 'unit card', 'aria-labelledby': titleId },
    h(
      'div',
      { class: `unit__head unit__head--${unit.status}` },
      h(
        'div',
        { class: 'unit__titles' },
        h('span', { class: 'unit__number' }, `Unit ${unit.number}`),
        h(
          'h2',
          { class: 'unit__title', id: titleId },
          unit.title,
          unit.titleBn ? [' · ', h('span', { lang: 'bn' }, unit.titleBn)] : null,
        ),
        unit.subtitle ? h('span', { class: 'unit__subtitle' }, unit.subtitle) : null,
      ),
      h('span', { class: 'unit__status' }, unit.status === 'locked' ? 'Locked' : `${unit.done} / ${unit.total}`),
    ),
    h(
      'ol',
      { class: 'unit__lessons', 'aria-label': `${unit.title} lessons` },
      unit.lessons.map((lesson) => h('li', null, lessonNode(unit, lesson))),
    ),
  );
}

/**
 * "Get practice reminders": shown while reminders are on for this learner (the default) but this
 * device hasn't been asked yet. Chrome only asks for permission after a tap, hence the card.
 */
function reminderPrompt() {
  const slot = h('div', { hidden: true });
  Promise.all([loadSettings(), reminderState()])
    .then(([settings, state]) => {
      if (!settings.reminders || state !== 'off') return;
      const note = h('p', { class: 'reminder-prompt__note', 'aria-live': 'polite' });
      const card = h(
        'section',
        { class: 'reminder-prompt card', 'aria-labelledby': 'reminder-title' },
        h('span', { class: 'reminder-prompt__icon' }, icon('bell', { size: 22, strokeWidth: 2.2 })),
        h(
          'div',
          { class: 'reminder-prompt__text' },
          h('h2', { class: 'reminder-prompt__title', id: 'reminder-title' }, 'Get practice reminders'),
          h('span', { class: 'reminder-prompt__sub' }, 'At 9:00, 15:00 and 21:00, only if you haven’t practised.'),
          note,
          h(
            'div',
            { class: 'reminder-prompt__actions' },
            h('button', { class: 'btn btn--primary btn--inline', type: 'button', onClick: turnOn }, 'Turn on'),
            h('button', { class: 'btn btn--text btn--inline', type: 'button', onClick: notNow }, 'Not now'),
          ),
        ),
      );
      async function turnOn() {
        try {
          const result = await enableReminders();
          if (result === 'on') card.replaceWith(h('p', { class: 'banner banner--soft' }, 'Reminders are on. Change them any time in Settings.'));
          else note.textContent = result === 'blocked'
            ? 'Notifications are blocked for this site. Allow them in Chrome’s site settings, then tap Turn on again.'
            : 'Reminders need notifications to be allowed.';
        } catch (err) {
          note.textContent = err.message;
        }
      }
      async function notNow() {
        card.remove();
        try {
          await api.put('/settings', { reminders: false });
          forgetSettings();
        } catch {
          // The card shows again next time; nothing else depends on it.
        }
      }
      slot.replaceWith(card);
    })
    .catch(() => {});
  return slot;
}

const LEVEL_NAMES = { A1: 'Beginner', A2: 'Elementary', B1: 'Intermediate', B2: 'Upper intermediate' };

/** The units, with a heading wherever the CEFR level changes. */
function unitPath(units) {
  return units.map((unit, i) => [
    unit.level && unit.level !== units[i - 1]?.level
      ? h('h2', { class: 'level-heading' }, h('span', { class: 'level-heading__code' }, unit.level), LEVEL_NAMES[unit.level] ?? null)
      : null,
    unitCard(unit),
  ]);
}

/** Screen 2: streak, XP, daily goal, review shortcut and the unit path. */
export function mount(root, { onError }) {
  document.title = 'Learn · Bhasha';
  let stopped = false;

  const screen = h('main', { class: 'screen', 'aria-busy': 'true' }, h('p', { class: 'home__loading' }, 'Loading your course…'));
  root.append(screen, tabbar('/home'));

  api
    .get('/units')
    .then(({ summary, dueCount, units }) => {
      if (stopped) return;
      screen.removeAttribute('aria-busy');
      screen.replaceChildren(
        h('h1', { class: 'sr-only' }, 'Learn'),
        header(summary),
        h('div', { class: 'home__body' }, dailyGoal(summary), reviewCard(dueCount), reminderPrompt(), unitPath(units)),
      );
      // Scroll just enough to show the unit you're working on, keeping the header in view if it fits.
      const current = units.findIndex((u) => u.status === 'current');
      if (current > 0) screen.querySelectorAll('.unit')[current].scrollIntoView({ block: 'nearest' });
      // First visit on this device (or something new since): what's new, install, reminders.
      maybeShowGuide();
    })
    .catch((err) => {
      if (!stopped) onError(err);
    });

  return () => {
    stopped = true;
  };
}
