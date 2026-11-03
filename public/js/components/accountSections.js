import { api } from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { disableReminders } from '../reminders.js';
import { forgetMe } from '../session.js';
import { field } from './field.js';

export const MIN_PASSWORD = 8;

const initial = (user) => (user.displayName || user.username).trim().charAt(0).toUpperCase();

export function avatar(user) {
  return h('span', { class: 'settings-row__icon settings-row__icon--avatar', 'aria-hidden': 'true' }, initial(user));
}

/** A row that opens into a small form or list below it. */
export function expandable(summaryChildren, ...body) {
  return h(
    'details',
    { class: 'settings-details' },
    h('summary', { class: 'settings-row' }, summaryChildren, h('span', { class: 'settings-details__chevron' }, icon('back', { size: 18 }))),
    ...body,
  );
}

/**
 * Runs a request from a form: disables its button meanwhile and reports the outcome.
 * `say(text, kind)` shows a message at the top of the screen; `reload()` re-renders it.
 * `done` is the success message, or a function that makes it from what was typed.
 */
export function submitter({ say, reload }) {
  return (button, request, done) => async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      await request();
      say(typeof done === 'function' ? done() : done);
      reload();
    } catch (err) {
      button.disabled = false;
      say(err.message, 'error');
    }
  };
}

function changePassword(run) {
  const current = field('Current password', { type: 'password', reveal: true, autocomplete: 'current-password', required: true });
  const next = field('New password', { type: 'password', reveal: true, autocomplete: 'new-password', required: true, minlength: MIN_PASSWORD });
  const save = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Change password');
  return expandable(
    h('span', { class: 'settings-row__text' }, h('span', { class: 'settings-row__title' }, 'Change password')),
    h(
      'form',
      {
        class: 'settings-form',
        onSubmit: run(save, () => api.put('/auth/password', {
          currentPassword: current.input.value, newPassword: next.input.value,
        }), 'Password changed. Other devices signed in to this account have been signed out.'),
      },
      current.el,
      next.el,
      save,
    ),
  );
}

function adminLink(href, iconName, title, sub) {
  return h(
    'a',
    { class: 'settings-row settings-row--link', href },
    h('span', { class: 'settings-row__icon' }, icon(iconName, { size: 22 })),
    h('span', { class: 'settings-row__text' }, h('span', { class: 'settings-row__title' }, title), h('span', { class: 'settings-row__sub' }, sub)),
    h('span', { class: 'settings-details__chevron' }, icon('back', { size: 18 })),
  );
}

/** Who is signed in, change password, sign out, and (for the admin) the admin pages. */
export function accountSection(me, { say, reload, go }) {
  const run = submitter({ say, reload });

  async function signOut() {
    try {
      // This phone stops getting this learner's reminders.
      await disableReminders().catch(() => {});
      await api.post('/auth/logout');
    } catch {
      // Signing out locally still works: the next request asks for a sign-in.
    }
    forgetMe();
    go('/login', { replace: true });
  }

  return [
    h('h2', { class: 'settings__group' }, 'Account'),
    h(
      'section',
      { class: 'card settings-card' },
      h(
        'div',
        { class: 'settings-row' },
        avatar(me),
        h(
          'div',
          { class: 'settings-row__text' },
          h('span', { class: 'settings-row__title' }, me.displayName),
          h('span', { class: 'settings-row__sub' }, `@${me.username}${me.isAdmin ? ' · Admin' : ''}`),
        ),
        h('button', { class: 'btn btn--text btn--inline', type: 'button', onClick: signOut }, 'Sign out'),
      ),
      // The admin's password comes from ADMIN_PASSWORD in .env, so it can't be changed here.
      me.isAdmin
        ? adminLink('#/admin', 'chart', 'People dashboard', 'Everyone’s progress and time spent each day')
        : changePassword(run),
    ),
  ];
}
