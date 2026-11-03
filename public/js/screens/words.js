import { api } from '../api.js';
import { speakButton } from '../components/speakButton.js';
import { tabbar } from '../components/tabbar.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { loadSettings } from '../settings.js';
import { speak, stop as stopSpeech } from '../speech.js';

const SEARCH_DELAY_MS = 200;
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'learning', label: 'Learning' },
  { key: 'mastered', label: 'Mastered' },
  { key: 'new', label: 'New' },
];

function masteryBars(level) {
  const kind = level >= 4 ? 'mastered' : 'learning';
  return h(
    'span',
    { class: `mastery mastery--${kind}`, role: 'img', 'aria-label': `Mastery ${level} of 4` },
    [0, 1, 2, 3].map((k) => h('span', { class: k < level ? 'on' : null })),
  );
}

function detailView(word, showRoman) {
  const bits = [];
  for (const v of word.variants) {
    bits.push(
      h('span', null, 'Also: ', h('span', { lang: 'bn' }, v.bn), showRoman && v.ro ? ` (${v.ro})` : ''),
    );
  }
  if (word.note) bits.push(h('div', { class: 'note' }, icon('info', { size: 18 }), h('span', null, word.note)));
  for (const s of word.sentences.slice(0, 3)) {
    bits.push(
      h(
        'div',
        { class: 'example' },
        h('span', { class: 'example__text' }, h('span', { class: 'example__bn', lang: 'bn' }, s.bn), h('span', { class: 'example__en' }, s.en)),
        speakButton('Play sentence', () => speak(s.bn, { audioUrl: s.audioUrl })),
      ),
    );
  }
  if (!word.inCourse) bits.push(h('span', { class: 'word-detail__pos' }, 'No longer in the course; you still review it.'));
  if (word.card) bits.push(h('span', { class: 'word-detail__pos' }, `Reviewed ${word.card.reps} times · next ${new Date(word.card.due).toLocaleDateString()}`));
  return bits.length ? bits : [h('span', { class: 'word-detail__pos' }, 'No more details for this word.')];
}

/** Screen 5: every course word with its mastery, searchable. */
export function mount(root, { onError }) {
  document.title = 'Words · Bhasha';
  let stopped = false;
  let settings = { showRoman: true };
  const state = { q: '', tab: 'all' };
  let requestId = 0;
  let timer = null;

  const summary = h('span', { class: 'page-header__meta' });
  const input = h('input', {
    type: 'search',
    placeholder: 'Search Bengali, roman or English',
    autocomplete: 'off',
    onInput: () => {
      state.q = input.value;
      clearTimeout(timer);
      timer = setTimeout(load, SEARCH_DELAY_MS);
    },
  });
  const filters = h('div', { class: 'filters' });
  const list = h('ul', { class: 'word-list card', 'aria-label': 'Words', 'aria-busy': 'true' });
  const status = h('p', { class: 'sr-only', 'aria-live': 'polite' });

  root.append(
    h(
      'main',
      { class: 'screen' },
      h(
        'header',
        { class: 'page-header' },
        h('div', { class: 'page-header__row' }, h('h1', null, 'Words'), summary),
        h('label', { class: 'search' }, icon('search', { size: 20, strokeWidth: 2.2 }), h('span', { class: 'sr-only' }, 'Search words'), input),
        filters,
      ),
      h(
        'div',
        { class: 'page-body' },
        list,
        status,
        h('p', { class: 'footnote' }, 'Words are spoken by your device’s Bengali voice.'),
      ),
    ),
    tabbar('/words'),
  );

  function paintFilters() {
    const pill = (item, on, onClick) =>
      h('button', { class: 'filter', type: 'button', 'aria-pressed': String(on), onClick }, item.label);
    filters.replaceChildren(...TABS.map((t) => pill(t, state.tab === t.key, () => { state.tab = t.key; load(); })));
  }

  function row(w) {
    const detail = h('div', { class: 'word-detail', hidden: true });
    const sub = settings.showRoman ? w.ro : null;
    const toggle = h(
      'button',
      { class: 'word-row__main', type: 'button', 'aria-expanded': 'false', onClick: () => expand(w, toggle, detail) },
      h('span', { class: 'word-row__text' }, h('span', { class: 'word-row__bn', lang: 'bn' }, w.bn), sub ? h('span', { class: 'word-row__sub' }, sub) : null),
      h('span', { class: 'word-row__right' }, h('span', { class: 'word-row__en' }, w.en ?? ''), masteryBars(w.mastery)),
    );
    return h(
      'li',
      { class: 'word-row' },
      h('div', { class: 'word-row__line' }, speakButton(`Play ${w.ro || w.bn}`, () => speak(w.bn, { audioUrl: w.audioUrl })), toggle),
      detail,
    );
  }

  async function expand(w, toggle, detail) {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    detail.hidden = !open;
    if (!open || detail.childElementCount) return;
    detail.replaceChildren(h('span', { class: 'word-detail__pos' }, 'Loading…'));
    try {
      detail.replaceChildren(...detailView(await api.get(`/words/${w.id}`), settings.showRoman));
    } catch (err) {
      detail.replaceChildren(h('span', { class: 'banner banner--error' }, err.message));
    }
  }

  async function load() {
    paintFilters();
    const id = ++requestId;
    const params = new URLSearchParams({ q: state.q, tab: state.tab, limit: '500' });
    try {
      const data = await api.get(`/words?${params}`);
      if (stopped || id !== requestId) return;
      if (data.summary) summary.textContent = `${data.summary.total} words · ${data.summary.mastered} mastered`;
      list.removeAttribute('aria-busy');
      list.replaceChildren(
        ...(data.words.length
          ? data.words.map(row)
          : [h('li', { class: 'empty' }, state.q ? `No words match “${state.q}”.` : 'No words here yet.')]),
      );
      status.textContent = `${data.words.length} ${data.words.length === 1 ? 'word' : 'words'}`;
    } catch (err) {
      if (!stopped && id === requestId) onError(err);
    }
  }

  loadSettings()
    .then((s) => {
      settings = s;
    })
    .catch(() => {})
    .finally(() => {
      if (!stopped) load();
    });

  return () => {
    stopped = true;
    clearTimeout(timer);
    stopSpeech();
  };
}
