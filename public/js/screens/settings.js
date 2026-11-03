import { api } from '../api.js';
import { accountSection } from '../components/accountSections.js';
import { showGuide } from '../components/guide.js';
import { tabbar } from '../components/tabbar.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { iPhoneReminderProblem, isIPhone } from '../install.js';
import { disableReminders, enableReminders, reminderState } from '../reminders.js';
import { loadMe } from '../session.js';
import { forgetSettings, loadSettings } from '../settings.js';
import { hasBengaliVoice } from '../speech.js';

// The Data section is hidden from everyone for now. Set to true to show it again.
const SHOW_DATA = false;

const MESSAGE_MS = 6000;

const MEANING_LANGUAGES = [
  { value: 'en', label: 'English', sub: 'Water' },
  { value: 'fr', label: 'Français', sub: 'Eau' },
];
const GOALS = [
  { value: 10, label: 'Casual', sub: '10 XP' },
  { value: 20, label: 'Regular', sub: '20 XP' },
  { value: 30, label: 'Serious', sub: '30 XP' },
];
const SOURCES = {
  lessons: 'Course (data/course)',
  generated: 'Audio clips',
};
const SOURCE_PILLS = {
  done: ['Synced', 'pill--ok'],
  running: ['Syncing…', ''],
  pending: ['Waiting', ''],
  skipped: ['Not set', 'pill--soft'],
  error: ['Failed', 'pill--error'],
};

// data-key lets focus return to the same control after a save re-renders the screen.
function switchButton(key, label, on, onClick) {
  return h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label, 'data-key': key, onClick });
}

function segmented(key, label, options, current, onPick) {
  return h(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': label },
    options.map((o) =>
      h(
        'button',
        {
          class: 'segmented__option',
          type: 'button',
          'aria-pressed': String(o.value === current),
          'data-key': `${key}-${o.value}`,
          onClick: () => onPick(o.value),
        },
        h('span', { class: 'segmented__label' }, o.label),
        h('span', { class: 'segmented__sub' }, o.sub),
      ),
    ),
  );
}

/**
 * Screen 6: learning preferences, the account (with a link to the People dashboard for the
 * admin) and the local data (hidden for now).
 */
export function mount(root, { onError, go }) {
  document.title = 'Settings · Bhasha';
  let stopped = false;
  let refocus = null;
  let messageTimer = null;
  const screen = h('main', { class: 'screen' }, h('p', { class: 'home__loading' }, 'Loading settings…'));
  root.append(screen, tabbar('/settings'));

  // Outside render(), so a message survives the re-render that follows a change.
  const toast = h('div', { class: 'settings__toast', 'aria-live': 'polite' });
  function say(text, kind = 'soft') {
    clearTimeout(messageTimer);
    toast.replaceChildren(text ? h('p', { class: `banner banner--${kind}` }, text) : '');
    if (text && kind !== 'error') messageTimer = setTimeout(() => toast.replaceChildren(), MESSAGE_MS);
  }

  async function load() {
    try {
      const { user } = await loadMe();
      const [settings, setup, voice, device] = await Promise.all([
        loadSettings(), api.get('/setup/status'), hasBengaliVoice(), reminderState(),
      ]);
      if (!stopped) render(settings, setup, voice, device, user);
    } catch (err) {
      if (!stopped) onError(err);
    }
  }

  function render(settings, setup, voice, device, me) {

    async function save(patch) {
      try {
        await api.put('/settings', patch);
        forgetSettings();
        refocus = document.activeElement?.dataset?.key ?? null;
        load();
      } catch (err) {
        say(err.message, 'error');
      }
    }

    // Reminders need both the learner's setting and this device's permission.
    const remindersOn = settings.reminders && device === 'on';
    async function toggleReminders() {
      try {
        if (remindersOn) {
          await disableReminders();
          await save({ reminders: false });
          return;
        }
        const result = await enableReminders();
        if (result === 'on') await save({ reminders: true });
        else say(result === 'blocked'
          ? 'Notifications are blocked for this site. Allow them in Chrome’s site settings (the icon left of the address), then try again.'
          : 'Reminders need notifications to be allowed.', 'error');
      } catch (err) {
        say(err.message, 'error');
      }
    }
    async function testReminder() {
      try {
        const { sent, devices } = await api.post('/reminders/test');
        say(sent ? 'Test sent. It should arrive in a few seconds.' : `Couldn't reach ${devices === 1 ? 'this device' : 'your devices'}. Try turning reminders off and on.`, sent ? 'soft' : 'error');
      } catch (err) {
        say(err.message, 'error');
      }
    }
    const reminderNote = {
      old: 'On iPhone, reminders need iOS 16.4 or later.',
      'not-installed': 'On iPhone, reminders work in the Home Screen app: add Bhasha to your Home Screen (see App guide below) and turn them on there.',
    }[iPhoneReminderProblem()] ?? {
      unsupported: 'This browser can’t show reminders. On Android, use Chrome.',
      blocked: isIPhone()
        ? 'Notifications are off for Bhasha. Turn them on in the iPhone Settings app → Notifications → Bhasha.'
        : 'Notifications are blocked for this site. Allow them in Chrome’s site settings to turn reminders on.',
    }[device];

    async function resync() {
      try {
        await api.post('/setup/resync', {});
      } catch (err) {
        if (err.status !== 409) {
          say(err.message, 'error');
          return;
        }
      }
      go('/setup');
    }

    const fileInput = h('input', {
      type: 'file',
      accept: 'application/json,.json',
      class: 'sr-only',
      tabindex: '-1',
      'aria-hidden': 'true',
      onChange: async () => {
        const file = fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        let data;
        try {
          data = JSON.parse(await file.text());
        } catch {
          say('That file is not valid JSON.', 'error');
          return;
        }
        if (!window.confirm('Replace all your progress on this computer with this backup?')) return;
        try {
          const res = await api.post('/backup/import', data);
          forgetSettings();
          const skipped = res.skipped.cards ? ` ${res.skipped.cards} words weren't in this course and were skipped.` : '';
          say(`Backup restored: ${res.imported.cards} words and ${res.imported.lessonProgress} lessons.${skipped}`);
        } catch (err) {
          say(err.message, 'error');
        }
      },
    });

    const steps = new Map(setup.steps.map((s) => [s.id, s]));
    const hasGenerated = steps.get('generated')?.status === 'done';
    const sourceRows = Object.entries(SOURCES).map(([id, name]) => {
      const step = steps.get(id) ?? { status: 'pending', env: '' };
      const [text, cls] = SOURCE_PILLS[step.status] ?? [step.status, ''];
      return h(
        'div',
        { class: 'settings-row' },
        h(
          'div',
          { class: 'settings-row__text' },
          h('span', { class: 'settings-row__title' }, name),
          h('span', { class: 'settings-row__env' }, step.env),
          step.detail && step.status !== 'pending' ? h('span', { class: 'settings-row__sub' }, step.detail) : null,
        ),
        h('span', { class: `pill ${cls}` }, text),
      );
    });

    screen.replaceChildren(
      h('header', { class: 'page-header' }, h('h1', null, 'Settings')),
      h(
        'div',
        { class: 'page-body' },
        toast,
        h('h2', { class: 'settings__group' }, 'Learning'),
        h(
          'section',
          { class: 'card settings-card' },
          h(
            'div',
            { class: 'settings-row' },
            h(
              'div',
              { class: 'settings-row__text' },
              h('span', { class: 'settings-row__title' }, 'Show transliteration'),
              h('span', { class: 'settings-row__sub' }, h('span', { lang: 'bn' }, 'মা'), ' → ma under Bengali words'),
            ),
            switchButton('roman', 'Show transliteration', settings.showRoman, () => save({ showRoman: !settings.showRoman })),
          ),
          voice || hasGenerated
            ? null
            : h(
                'div',
                { class: 'settings-row settings-row--stack' },
                h('div', { class: 'settings-row__text' }, h('span', { class: 'settings-row__title' }, 'Sound')),
                h(
                  'p',
                  { class: 'banner banner--soft' },
                  'This browser has no Bengali voice, so most words are silent and listening exercises are skipped. Microsoft Edge and most Android phones have a Bengali voice.',
                ),
              ),
          h(
            'div',
            { class: 'settings-row settings-row--stack' },
            h(
              'div',
              { class: 'settings-row__text' },
              h('span', { class: 'settings-row__title' }, 'Meanings in'),
              h('span', { class: 'settings-row__sub' }, 'Word meanings, hints and new-word cards.'),
            ),
            segmented('meaning', 'Meanings in', MEANING_LANGUAGES, settings.meaningLanguage, (meaningLanguage) => save({ meaningLanguage })),
          ),
          h(
            'div',
            { class: 'settings-row settings-row--stack' },
            h('span', { class: 'settings-row__title' }, 'Daily goal'),
            segmented('goal', 'Daily goal', GOALS, settings.dailyGoal, (dailyGoal) => save({ dailyGoal })),
          ),
          h(
            'div',
            { class: 'settings-row' },
            h(
              'div',
              { class: 'settings-row__text' },
              h('span', { class: 'settings-row__title' }, 'Practice reminders'),
              h('span', { class: 'settings-row__sub' }, 'On this device at 9:00, 15:00 and 21:00, only if you haven’t practised in 6 hours.'),
              reminderNote ? h('span', { class: 'settings-row__sub' }, reminderNote) : null,
              remindersOn ? h('button', { class: 'btn btn--text btn--inline settings-row__action', type: 'button', onClick: testReminder }, 'Send a test reminder') : null,
            ),
            reminderNote ? null : switchButton('reminders', 'Practice reminders', remindersOn, toggleReminders),
          ),
          h(
            'button',
            { class: 'settings-row settings-row--link settings-row--button', type: 'button', onClick: showGuide },
            h('span', { class: 'settings-row__icon' }, icon('info', { size: 22 })),
            h(
              'span',
              { class: 'settings-row__text' },
              h('span', { class: 'settings-row__title' }, 'App guide'),
              h('span', { class: 'settings-row__sub' }, 'What’s new, installing Bhasha on your phone, and reminders'),
            ),
            h('span', { class: 'settings-details__chevron' }, icon('back', { size: 18 })),
          ),
        ),
        me ? accountSection(me, { say, reload: load, go }) : null,
        SHOW_DATA ? dataSection() : null,
      ),
    );
    if (refocus) screen.querySelector(`[data-key="${refocus}"]`)?.focus();
    refocus = null;

    function dataSection() {
      return [
        h('h2', { class: 'settings__group' }, 'Data (stored on this computer)'),
        h(
          'section',
          { class: 'card settings-card' },
          h(
            'div',
            { class: 'settings-row' },
            h('span', { class: 'settings-row__icon' }, icon('database', { size: 22 })),
            h(
              'div',
              { class: 'settings-row__text' },
              h('span', { class: 'settings-row__title' }, 'Local database'),
              h('span', { class: 'settings-row__env' }, setup.dbPath),
            ),
            h('span', { class: 'pill pill--ok' }, 'Offline'),
          ),
          sourceRows,
          h(
            'div',
            { class: 'data-actions' },
            h('button', { class: 'data-action', type: 'button', onClick: resync, disabled: setup.running }, icon('review', { size: 20 }), setup.running ? 'Syncing…' : 'Re-sync'),
            h('a', { class: 'data-action', href: '/api/backup/export', download: '' }, icon('download', { size: 20 }), 'Export'),
            h('button', { class: 'data-action', type: 'button', onClick: () => fileInput.click() }, icon('upload', { size: 20 }), 'Import'),
          ),
          fileInput,
        ),
      ];
    }
  }

  load();
  return () => {
    stopped = true;
    clearTimeout(messageTimer);
  };
}
