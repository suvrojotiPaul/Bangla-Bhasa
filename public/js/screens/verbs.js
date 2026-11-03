import { api } from '../api.js';
import { meaningText } from '../components/hints.js';
import { reviewSwitch } from '../components/reviewSwitch.js';
import { speakButton } from '../components/speakButton.js';
import { tabbar } from '../components/tabbar.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { loadSettings } from '../settings.js';
import { speak, stop as stopSpeech } from '../speech.js';

// The tense picked last, kept while the app is open so coming back shows the same table.
let lastTense = null;

/**
 * Review → Verbs: every verb the learner has reached with its forms, one tense at a time
 * (verbs down, persons across), or one verb with all its tenses.
 */
export function mount(root, { onError }) {
  document.title = 'Verbs · Bhasha';
  let stopped = false;
  let settings = { showRoman: true };
  let data = null;

  const meta = h('span', { class: 'page-header__meta' });
  const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'Tense' });
  const body = h('div', { class: 'page-body' }, h('p', { class: 'home__loading' }, 'Loading your verbs…'));
  root.append(
    h(
      'main',
      { class: 'screen' },
      h(
        'header',
        { class: 'page-header' },
        h('div', { class: 'page-header__row' }, h('h1', null, 'Review'), meta),
        reviewSwitch('/review/verbs'),
        filters,
      ),
      body,
    ),
    tabbar('/review'),
  );

  const say = (form) => speak(form.bn, { audioUrl: form.audioUrl });
  const ro = (text) => (settings.showRoman && text ? h('span', { class: 'verb-form__ro' }, text) : null);
  const formButton = (form) =>
    form
      ? h(
          'button',
          { class: `verb-form${form.taught ? ' verb-form--taught' : ''}`, type: 'button', onClick: () => say(form) },
          h('span', { class: 'verb-form__bn', lang: 'bn' }, form.bn),
          ro(form.ro),
        )
      : h('span', { class: 'verb-form verb-form--none', 'aria-label': 'No form' }, '–');

  const legend = () =>
    h(
      'p',
      { class: 'footnote' },
      'Dark forms are ones you’ve had in a lesson; grey ones follow the same pattern. Tap a form to hear it. ',
      'উনি (he, she, polite) uses the আপনি form, and plurals are the same: আমরা like আমি, তোমরা like তুমি, ওরা like ও.',
    );

  function paintFilters(current) {
    filters.replaceChildren(
      ...data.tenses.map((t) =>
        h('button', { class: 'filter', type: 'button', 'aria-pressed': String(current === t.key), onClick: () => showTense(t.key) }, t.title),
      ),
    );
  }

  /** All verbs in one tense: verbs down, persons across. */
  function showTense(key) {
    lastTense = key;
    const tense = data.tenses.find((t) => t.key === key);
    paintFilters(key);
    const verbs = data.verbs.filter((v) => v.rows[key]);
    const columns = tense.persons.length ? tense.persons.map((p) => data.persons[p]) : [{ bn: tense.title, meaning: null }];
    const table = h(
      'table',
      { class: 'verb-table' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', { scope: 'col', class: 'verb-table__verb' }, 'Verb'),
          columns.map((p) =>
            h('th', { scope: 'col' }, h('span', { class: 'verb-table__person', lang: 'bn' }, p.bn), p.meaning ? h('span', { class: 'verb-table__en' }, p.meaning) : null),
          ),
        ),
      ),
      h(
        'tbody',
        null,
        verbs.map((v) =>
          h(
            'tr',
            null,
            h(
              'th',
              { scope: 'row', class: 'verb-table__verb' },
              h(
                'button',
                { class: 'verb-name', type: 'button', onClick: () => showVerb(v), 'aria-label': `${v.bn}, ${v.meaning.text}: all its forms` },
                h('span', { class: 'verb-name__bn', lang: 'bn' }, v.bn),
                h('span', { class: 'verb-name__en' }, meaningText(v.meaning, settings.meaningLanguage)),
              ),
            ),
            v.rows[key].map((form) => h('td', null, formButton(form))),
          ),
        ),
      ),
    );
    body.replaceChildren(
      h('p', { class: 'verbs__hint' }, tense.hint),
      h('div', { class: 'verb-table__wrap card' }, table),
      h('p', { class: 'footnote' }, 'Tap a verb to see all its forms.'),
      legend(),
    );
  }

  /** One verb with every tense the learner has reached. */
  function showVerb(v) {
    const back = h('button', { class: 'back-link verbs__back', type: 'button', onClick: () => showTense(lastTense) }, icon('back', { size: 18 }), 'All verbs');
    const tenses = data.tenses.filter((t) => v.rows[t.key]);
    body.replaceChildren(
      back,
      h(
        'section',
        { class: 'verb-card card' },
        h(
          'div',
          { class: 'verb-card__head' },
          h(
            'div',
            { class: 'verb-card__title' },
            h('h2', { class: 'verb-card__bn', lang: 'bn', tabindex: '-1' }, v.bn),
            settings.showRoman && v.ro ? h('span', { class: 'verb-card__ro' }, v.ro) : null,
            h('span', { class: 'verb-card__en' }, meaningText(v.meaning, settings.meaningLanguage)),
          ),
          speakButton(`Play ${v.ro || v.bn}`, () => speak(v.bn)),
        ),
        v.note ? h('div', { class: 'note' }, icon('info', { size: 18 }), h('span', null, v.note)) : null,
        tenses.map((t) => {
          const people = t.persons.length ? t.persons : [null];
          return h(
            'div',
            { class: 'verb-card__tense' },
            h('h3', null, t.title, h('span', { class: 'verb-card__hint' }, t.hint)),
            h(
              'dl',
              { class: 'verb-card__forms' },
              people.map((p, k) => [
                h('dt', { lang: 'bn' }, p ? data.persons[p].bn : ''),
                h('dd', null, formButton(v.rows[t.key][k])),
              ]),
            ),
          );
        }),
      ),
      legend(),
    );
    body.querySelector('.verb-card__bn').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function show() {
    meta.textContent = `${data.verbs.length} ${data.verbs.length === 1 ? 'verb' : 'verbs'}`;
    if (data.verbs.length === 0) {
      body.replaceChildren(
        h('div', { class: 'card empty' }, 'Verbs you learn show up here, with all their forms in one table. The first ones come in unit 2.'),
      );
      return;
    }
    showTense(data.tenses.some((t) => t.key === lastTense) ? lastTense : data.tenses[0].key);
  }

  Promise.all([api.get('/verbs'), loadSettings().catch(() => settings)])
    .then(([verbs, s]) => {
      if (stopped) return;
      data = verbs;
      settings = s;
      show();
    })
    .catch((err) => {
      if (!stopped) onError(err);
    });

  return () => {
    stopped = true;
    stopSpeech();
  };
}
