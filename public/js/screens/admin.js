import { api } from '../api.js';
import { avatar, expandable, MIN_PASSWORD, submitter } from '../components/accountSections.js';
import { field } from '../components/field.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { loadMe } from '../session.js';

const MESSAGE_MS = 6000;

/** 0 → "0 min", 40 → "< 1 min", 3900 → "1 h 5 min". */
export function formatDuration(seconds) {
  if (!seconds) return '0 min';
  if (seconds < 60) return '< 1 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dateOf = (day) => new Date(`${day}T00:00`);
const shortDate = (day) => dateOf(day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const longDate = (day) => dateOf(day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

function lastActive(day, today) {
  if (!day) return 'not started yet';
  if (day === today) return 'active today';
  return `last active ${shortDate(day)}`;
}

function tile(label, value) {
  return h('div', { class: 'stat-tile card' }, h('span', { class: 'stat-tile__label' }, label), h('span', { class: 'stat-tile__value' }, value));
}

/**
 * Minutes in the app per day, one column per day. Each column is its own hover and focus target
 * with a tooltip; the "Day by day" table under it has the same numbers without hovering.
 */
function timeChart(person, today) {
  const max = Math.max(...person.daily.map((d) => d.seconds));
  const tooltip = h('div', { class: 'time-chart__tooltip', role: 'status', hidden: true });

  function show(column, d) {
    tooltip.replaceChildren(
      h('strong', null, formatDuration(d.seconds)),
      h('span', null, `${d.day === today ? 'Today' : longDate(d.day)} · ${count(d.lessons, 'lesson')} · ${count(d.reviews, 'review')}`),
    );
    tooltip.hidden = false;
    const left = column.offsetLeft + column.offsetWidth / 2;
    tooltip.style.left = `${Math.min(Math.max(left, 70), column.parentElement.offsetWidth - 70)}px`;
  }
  const hide = () => {
    tooltip.hidden = true;
  };

  const columns = person.daily.map((d) => {
    const label = `${d.day === today ? 'Today' : longDate(d.day)}: ${formatDuration(d.seconds)}`;
    const column = h(
      'div',
      { class: 'time-chart__col', tabindex: '0', role: 'img', 'aria-label': label },
      d.seconds > 0 ? h('span', { class: 'time-chart__bar', style: `height: ${Math.max((d.seconds / max) * 100, 3)}%` }) : null,
    );
    column.addEventListener('pointerenter', () => show(column, d));
    column.addEventListener('focus', () => show(column, d));
    column.addEventListener('pointerleave', hide);
    column.addEventListener('blur', hide);
    return column;
  });

  return h(
    'figure',
    { class: 'time-chart' },
    h('figcaption', { class: 'time-chart__caption' }, 'Time in the app, last 14 days', h('span', null, max ? `max ${formatDuration(max)}` : 'no time yet')),
    h('div', { class: 'time-chart__plot' }, columns, tooltip),
    h(
      'div',
      { class: 'time-chart__axis', 'aria-hidden': 'true' },
      h('span', null, shortDate(person.daily[0].day)),
      h('span', null, 'Today'),
    ),
  );
}

function dayTable(person, today) {
  const rows = [...person.daily].reverse().filter((d) => d.seconds || d.xp || d.lessons || d.reviews);
  if (!rows.length) return h('p', { class: 'settings__note' }, 'Nothing in the last 14 days.');
  return h(
    'div',
    { class: 'day-table__wrap' },
    h(
      'table',
      { class: 'day-table' },
      h('thead', null, h('tr', null, ['Day', 'Time', 'Lessons', 'Reviews', 'XP'].map((t) => h('th', { scope: 'col' }, t)))),
      h(
        'tbody',
        null,
        rows.map((d) =>
          h(
            'tr',
            null,
            h('th', { scope: 'row' }, d.day === today ? 'Today' : longDate(d.day)),
            h('td', null, formatDuration(d.seconds)),
            h('td', null, d.lessons),
            h('td', null, d.reviews),
            h('td', null, d.xp),
          ),
        ),
      ),
    ),
  );
}

function manage(person, { say, reload }) {
  const run = submitter({ say, reload });
  const password = field(`New password for ${person.displayName}`, {
    type: 'password', reveal: true, autocomplete: 'new-password', required: true, minlength: MIN_PASSWORD,
  });
  const save = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Set password');

  async function remove() {
    if (!window.confirm(`Remove ${person.displayName}? Their progress is deleted too, and this can't be undone.`)) return;
    try {
      await api.delete(`/admin/people/${person.id}`);
      say(`${person.displayName} was removed.`);
      reload();
    } catch (err) {
      say(err.message, 'error');
    }
  }

  return expandable(
    h('span', { class: 'settings-row__text' }, h('span', { class: 'settings-row__title' }, 'Manage account')),
    h(
      'form',
      {
        class: 'settings-form',
        onSubmit: run(save, () => api.put(`/admin/people/${person.id}/password`, { password: password.input.value }),
          `New password set for ${person.displayName}. They have been signed out on their devices.`),
      },
      password.el,
      save,
      h('button', { class: 'btn btn--text btn--text-danger', type: 'button', onClick: remove }, 'Remove this account'),
    ),
  );
}

function personCard(person, data, ctx) {
  const words = person.words.mastered ? `${person.words.learning} words (${person.words.mastered} mastered)` : `${person.words.learning} words`;
  return h(
    'section',
    { class: 'card person' },
    h(
      'div',
      { class: 'settings-row' },
      avatar(person),
      h(
        'div',
        { class: 'settings-row__text' },
        h('span', { class: 'settings-row__title' }, person.displayName),
        h('span', { class: 'settings-row__sub' }, `@${person.username}${person.isAdmin ? ' · Admin' : ''} · joined ${shortDate(person.createdAt.slice(0, 10))}`),
        h('span', { class: 'settings-row__sub' }, lastActive(person.lastActive, data.today)),
      ),
      h('div', { class: 'person__today' }, h('span', { class: 'person__today-value' }, formatDuration(person.seconds.today)), h('span', { class: 'person__today-label' }, 'today')),
    ),
    h(
      'dl',
      { class: 'person__stats' },
      [
        ['This week', formatDuration(person.seconds.week)],
        ['All time', formatDuration(person.seconds.total)],
        ['XP', person.xp],
        ['Streak', count(person.streak, 'day')],
        ['Lessons', `${person.lessonsDone} of ${data.lessonCount}`],
        ['Words', words],
      ].map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v))),
    ),
    timeChart(person, data.today),
    expandable(
      h('span', { class: 'settings-row__text' }, h('span', { class: 'settings-row__title' }, 'Day by day')),
      dayTable(person, data.today),
    ),
    person.isAdmin ? null : manage(person, ctx),
  );
}

/** The admin's view of everyone: time spent each day, progress, and account fixes. */
export function mount(root, { go, onError }) {
  document.title = 'People · Bhasha';
  let stopped = false;
  let messageTimer = null;
  const toast = h('div', { class: 'settings__toast', 'aria-live': 'polite' });
  const body = h('div', { class: 'page-body' }, h('p', { class: 'home__loading' }, 'Loading people…'));
  root.append(
    h(
      'main',
      { class: 'screen' },
      h(
        'header',
        { class: 'page-header' },
        h('a', { class: 'back-link', href: '#/settings' }, icon('back', { size: 18 }), 'Settings'),
        h('h1', null, 'People'),
      ),
      body,
    ),
  );

  function say(text, kind = 'soft') {
    clearTimeout(messageTimer);
    toast.replaceChildren(text ? h('p', { class: `banner banner--${kind}` }, text) : '');
    if (text && kind !== 'error') messageTimer = setTimeout(() => toast.replaceChildren(), MESSAGE_MS);
  }

  async function load() {
    try {
      const { user } = await loadMe();
      if (!user?.isAdmin) {
        go('/home', { replace: true });
        return;
      }
      const data = await api.get('/admin/people');
      if (stopped) return;
      const ctx = { say, reload: load };
      body.replaceChildren(
        toast,
        h(
          'div',
          { class: 'stat-tiles' },
          tile('People', data.summary.people),
          tile('Active today', data.summary.activeToday),
          tile('Time today', formatDuration(data.summary.secondsToday)),
          tile('Time this week', formatDuration(data.summary.secondsWeek)),
        ),
        h('p', { class: 'footnote' }, 'Time counts while the app is open and someone has used it in the last 2 minutes.'),
        ...data.people.map((p) => personCard(p, data, ctx)),
      );
    } catch (err) {
      if (!stopped) onError(err);
    }
  }

  load();
  return () => {
    stopped = true;
    clearTimeout(messageTimer);
  };
}
