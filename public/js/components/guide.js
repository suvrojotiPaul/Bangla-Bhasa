// The app guide: what's new, installing the app, and turning on reminders, in three short steps.
// It opens once per device (and again when GUIDE_VERSION goes up), from Home; Settings can
// reopen it. Installing and notifications belong to the device, so "seen" is kept in this browser.
import { api } from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { canPromptInstall, iPhoneReminderProblem, isInstalled, isIPhone, onInstallChange, promptInstall } from '../install.js';
import { enableReminders, reminderState } from '../reminders.js';
import { forgetSettings } from '../settings.js';

// Bump when there is something new to tell: everyone sees the guide once more.
// iPhones are on 2: reminders work there now, so iPhone users see the guide again.
const GUIDE_VERSION = isIPhone() ? 2 : 1;
const SEEN_KEY = 'bhasha:guide-seen';

const NEWS = [
  ['book', 'A new A1 course', '28 units of everyday Bengali, written for this app.'],
  ['review', 'Whole units open at once', 'Take a unit’s lessons in any order, then its blue Review.'],
  ['bell', 'Practice reminders', 'A nudge at 9:00, 15:00 and 21:00 if you haven’t practised.'],
];

function seenVersion() {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return GUIDE_VERSION; // no storage (private window): don't show it on every visit
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, String(GUIDE_VERSION));
  } catch {
    // Nothing to do: it just shows again next time.
  }
}

/** Opens the guide if this device hasn't seen this version of it. */
export function maybeShowGuide() {
  if (seenVersion() < GUIDE_VERSION) showGuide();
}

const done = (text) => h('p', { class: 'guide__done' }, icon('check', { size: 18, strokeWidth: 3 }), text);

// A small drawing of Chrome's address bar and ⋮ menu, with the parts to tap highlighted.
function chromeDrawing() {
  return h(
    'div',
    { class: 'chrome-drawing', 'aria-hidden': 'true' },
    h('div', { class: 'chrome-drawing__bar' }, h('span', { class: 'chrome-drawing__url' }, location.host), h('span', { class: 'chrome-drawing__dots chrome-drawing__tap' }, '⋮')),
    h(
      'div',
      { class: 'chrome-drawing__menu' },
      h('span', null, 'New tab'),
      h('span', null, 'History'),
      h('span', { class: 'chrome-drawing__tap' }, 'Install app'),
      h('span', null, 'Settings'),
    ),
  );
}

function copyAddress() {
  const button = h('button', {
    class: 'btn btn--text btn--inline guide__copy',
    type: 'button',
    onClick: async () => {
      try {
        await navigator.clipboard.writeText(location.origin);
        button.textContent = 'Copied';
      } catch {
        button.textContent = 'Copy it by hand';
      }
    },
  }, 'Copy');
  return h('span', { class: 'guide__address' }, h('code', null, location.host), button);
}

function newsStep() {
  return h(
    'ul',
    { class: 'guide__news' },
    NEWS.map(([glyph, title, text]) => h(
      'li',
      null,
      h('span', { class: 'guide__news-icon' }, icon(glyph, { size: 20, strokeWidth: 2.2 })),
      h('span', null, h('strong', null, title), h('span', null, text)),
    )),
  );
}

function installStep(refresh) {
  if (isInstalled()) return done('You’re using the installed app. Open it from its ভা icon.');
  const steps = isIPhone()
    ? [
        ['Open ', copyAddress(), ' in Safari.'],
        'Tap the Share button (the square with an arrow).',
        'Scroll down, tap Add to Home Screen, then Add.',
        'Open Bhasha from its new icon and sign in once more: the Home Screen app keeps its own sign-in.',
      ]
    : [
        ['Open ', copyAddress(), ' in Chrome.'],
        'Tap ⋮ at the top right.',
        'Tap Install app (or Add to home screen).',
        'Tap Install. Bhasha appears on your home screen.',
      ];
  return [
    h('p', null, 'Bhasha opens full screen from its own icon, like any app. Nothing to download from a store.'),
    canPromptInstall()
      ? h('button', {
          class: 'btn btn--primary',
          type: 'button',
          onClick: async () => {
            await promptInstall();
            refresh();
          },
        }, icon('download', { size: 20 }), 'Install Bhasha')
      : null,
    h('p', { class: 'guide__or' }, canPromptInstall() ? 'Or by hand:' : 'How:'),
    h('ol', { class: 'guide__steps' }, steps.map((s) => h('li', null, s))),
    isIPhone() ? null : chromeDrawing(),
  ];
}

function remindersStep(refresh) {
  const body = h('div', { class: 'guide__reminders' }, h('p', null, 'Checking this phone…'));
  const iPhone = iPhoneReminderProblem();
  if (iPhone === 'old') {
    body.replaceChildren(h('p', null, 'Reminders on iPhone need iOS 16.4 or later. Update it in Settings → General → Software Update.'));
    return body;
  }
  if (iPhone === 'not-installed') {
    body.replaceChildren(
      h('p', null, 'On iPhone, reminders work in the Home Screen app. Add Bhasha to your Home Screen (the previous step), open it from there, and turn reminders on.'),
      h('p', { class: 'guide__hint' }, 'This guide opens there again, or find it in Settings → App guide.'),
    );
    return body;
  }
  reminderState().then((state) => {
    const later = h('p', { class: 'guide__hint' }, 'Change it any time in Settings → Practice reminders.');
    if (state === 'on') {
      body.replaceChildren(done('Reminders are on for this phone.'), later);
    } else if (state === 'off') {
      const note = h('p', { class: 'guide__hint', 'aria-live': 'polite' });
      body.replaceChildren(
        h('p', null, 'A notification at 9:00, 15:00 and 21:00, only if you haven’t done a lesson or review in the last 6 hours.'),
        h('button', {
          class: 'btn btn--primary',
          type: 'button',
          onClick: async () => {
            try {
              const result = await enableReminders();
              if (result === 'on') {
                await api.put('/settings', { reminders: true });
                forgetSettings();
                refresh();
              } else {
                note.textContent = 'Chrome didn’t allow notifications. You can turn them on later in Settings.';
              }
            } catch (err) {
              note.textContent = err.message;
            }
          },
        }, icon('bell', { size: 20 }), 'Turn on reminders'),
        note,
        later,
      );
    } else if (state === 'blocked') {
      body.replaceChildren(
        h('p', null, 'Notifications are blocked for Bhasha on this phone. To allow them:'),
        isIPhone()
          ? h('ol', { class: 'guide__steps' },
              h('li', null, 'Open the iPhone Settings app → Notifications → Bhasha.'),
              h('li', null, 'Turn on Allow Notifications.'),
              h('li', null, 'Then turn on Settings → Practice reminders in Bhasha.'))
          : h('ol', { class: 'guide__steps' },
              h('li', null, 'In Chrome, tap ⋮ → Settings → Site settings → Notifications.'),
              h('li', null, ['Find ', h('code', null, location.host), ' and set it to Allow.']),
              h('li', null, 'Then turn on Settings → Practice reminders in Bhasha.')),
      );
    } else {
      body.replaceChildren(h('p', null, isIPhone()
        ? 'This iPhone can’t show reminders. They need iOS 16.4 or later and the app opened from the Home Screen.'
        : 'This browser can’t show reminders. Open Bhasha in Chrome on Android to get them.'));
    }
  });
  return body;
}

const STEPS = [
  { title: 'What’s new in Bhasha', body: newsStep },
  { title: 'Put Bhasha on your home screen', body: installStep },
  { title: 'Get practice reminders', body: remindersStep },
];

/** Opens the guide as a dialog. Closing it in any way counts as seen. */
export function showGuide() {
  if (document.querySelector('dialog.guide')) return;
  let index = 0;
  const dialog = h('dialog', { class: 'guide', 'aria-labelledby': 'guide-title', tabindex: '-1' });
  const stopWatching = onInstallChange(() => render());

  function close() {
    markSeen();
    stopWatching();
    dialog.close();
    dialog.remove();
  }
  // Escape, or the Android back gesture where the browser maps it to cancel.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });

  function render({ moved = false } = {}) {
    const step = STEPS[index];
    const last = index === STEPS.length - 1;
    dialog.replaceChildren(
      h(
        'div',
        { class: 'guide__head' },
        h('span', { class: 'guide__count' }, `${index + 1} of ${STEPS.length}`),
        h('button', { class: 'guide__close', type: 'button', 'aria-label': 'Close the guide', onClick: close }, icon('close', { size: 20, strokeWidth: 2.4 })),
      ),
      h('h2', { class: 'guide__title', id: 'guide-title', tabindex: '-1' }, step.title),
      h('div', { class: 'guide__body' }, step.body(render)),
      h(
        'div',
        { class: 'guide__foot' },
        h('span', { class: 'guide__dots', 'aria-hidden': 'true' }, STEPS.map((_, i) => h('span', { class: i === index ? 'on' : null }))),
        index > 0 ? h('button', { class: 'btn btn--text btn--inline', type: 'button', onClick: () => { index -= 1; render({ moved: true }); } }, 'Back') : null,
        h('button', {
          class: 'btn btn--primary btn--inline',
          type: 'button',
          onClick: () => {
            if (last) close();
            else {
              index += 1;
              render({ moved: true });
            }
          },
        }, last ? 'Done' : 'Next'),
      ),
    );
    // A new step: screen readers start at its title.
    if (moved) dialog.querySelector('.guide__title').focus();
  }

  document.body.append(dialog);
  render();
  dialog.showModal();
  // The dialog itself takes focus on open, not the close button (which would show a focus ring).
  dialog.focus();
}
