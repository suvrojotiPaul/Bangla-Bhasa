import { api } from '../api.js';
import { hintText, meaningText } from '../components/hints.js';
import { reviewSwitch } from '../components/reviewSwitch.js';
import { speakButton } from '../components/speakButton.js';
import { tabbar } from '../components/tabbar.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { loadSettings } from '../settings.js';
import { speak, stop as stopSpeech } from '../speech.js';

const BATCH = 20;
const RATINGS = [
  { key: 'again', label: 'Again' },
  { key: 'hard', label: 'Hard' },
  { key: 'good', label: 'Good' },
  { key: 'easy', label: 'Easy' },
];

function allDone({ title, text, extra = null, action }) {
  return h(
    'div',
    { class: 'all-done' },
    h('div', { class: 'all-done__badge', 'aria-hidden': 'true' }, icon('check', { size: 56, strokeWidth: 2.5 })),
    h('h2', { tabindex: '-1' }, title),
    h('p', null, text),
    extra,
    action,
  );
}

/** Screen 4: due words one at a time; the learner rates how well they remembered (FSRS). */
export function mount(root, { onError }) {
  document.title = 'Review · Bhasha';
  let stopped = false;
  const screen = h('main', { class: 'screen' });
  root.append(screen, tabbar('/review'));

  function load() {
    screen.replaceChildren(h('p', { class: 'home__loading' }, 'Loading your review…'));
    Promise.all([api.get(`/review/queue?limit=${BATCH}`), loadSettings()])
      .then(([queue, settings]) => {
        if (!stopped) run(queue, settings);
      })
      .catch((err) => {
        if (!stopped) onError(err);
      });
  }

  function run(queue, settings) {
    const { cards } = queue;
    const tally = { again: 0, hard: 0, good: 0, easy: 0 };
    let index = 0;
    let remaining = queue.total;

    const meta = h('span', { class: 'page-header__meta' });
    const dots = h('div', { class: 'review__dots', 'aria-hidden': 'true', style: `grid-template-columns: repeat(${Math.max(cards.length, 1)}, minmax(0, 1fr))` });
    const main = h('div', { class: 'review__main' });
    const actions = h('div', { class: 'review__actions' });
    const announcer = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    screen.replaceChildren(
      h('header', { class: 'page-header' }, h('div', { class: 'page-header__row' }, h('h1', null, 'Review'), meta), reviewSwitch('/review'), cards.length ? dots : null),
      main,
      actions,
      announcer,
    );

    if (cards.length === 0) {
      meta.textContent = 'Nothing due';
      main.append(
        allDone({
          title: 'Nothing to review',
          text: 'Words you learn come back here when they start to fade. Finish a lesson to add more.',
          action: h('a', { class: 'btn btn--primary', href: '#/home' }, 'Go to lessons'),
        }),
      );
      return;
    }

    function paintHeader() {
      const finished = index >= cards.length;
      meta.textContent = finished ? 'Done for now' : `${cards.length - index} left · ${remaining} due`;
      dots.replaceChildren(
        ...cards.map((_, k) => h('span', { class: `dot${k < index ? ' dot--done' : k === index && !finished ? ' dot--current' : ''}` })),
      );
    }

    function showCard() {
      const card = cards[index];
      const say = () => speak(card.bn, { audioUrl: card.audioUrl });
      const article = h(
        'article',
        { class: 'flashcard card', 'aria-label': 'Flashcard' },
        h('div', { class: 'flashcard__meta' }, h('span', { class: 'tag' }, card.tag), h('span', null, card.due)),
        h(
          'div',
          { class: 'flashcard__front' },
          h('p', { class: 'flashcard__bn', lang: 'bn', tabindex: '-1' }, card.bn),
          settings.showRoman && card.ro ? h('span', { class: 'flashcard__ro' }, card.ro) : null,
          speakButton('Play pronunciation', say, { large: true }),
        ),
      );
      main.replaceChildren(article);
      const reveal = h('button', { class: 'btn btn--primary', type: 'button', onClick: () => showBack(card, article) }, 'Show answer');
      actions.replaceChildren(reveal);
      paintHeader();
      article.querySelector('.flashcard__bn').focus({ preventScroll: true });
    }

    function showBack(card, article) {
      const ex = card.example;
      article.append(
        h(
          'div',
          { class: 'flashcard__back' },
          h('span', { class: 'flashcard__en' }, meaningText(card.meaning, settings.meaningLanguage)),
          ex
            ? h(
                'div',
                { class: 'example' },
                h(
                  'span',
                  { class: 'example__text' },
                  h('span', { class: 'example__bn' }, hintText(ex.tokens, { lang: settings.meaningLanguage, showRoman: settings.showRoman, speak })),
                  h('span', { class: 'example__en' }, meaningText(ex.meaning, settings.meaningLanguage)),
                ),
                speakButton('Play example sentence', () => speak(ex.bn, { audioUrl: ex.audioUrl })),
              )
            : null,
          card.note ? h('div', { class: 'note' }, icon('info', { size: 18 }), h('span', null, card.note)) : null,
        ),
      );
      announcer.textContent = `${card.meaning.text}.`;
      speak(card.bn, { audioUrl: card.audioUrl });

      const buttons = RATINGS.map((r) =>
        h(
          'button',
          { class: `rating rating--${r.key}`, type: 'button', onClick: () => rate(card, r.key, buttons) },
          h('span', { class: 'rating__label' }, r.label),
          h('span', { class: 'rating__when' }, card.intervals[r.key]),
        ),
      );
      actions.replaceChildren(
        h('span', { class: 'ratings__label', id: 'ratings-label' }, 'How well did you remember it?'),
        h('div', { class: 'ratings', role: 'group', 'aria-labelledby': 'ratings-label' }, buttons),
      );
      buttons[2].focus();
    }

    async function rate(card, key, buttons) {
      buttons.forEach((b) => { b.disabled = true; });
      try {
        const res = await api.post(`/review/${card.wordId}`, { rating: key });
        if (stopped) return;
        tally[key] += 1;
        remaining = res.remaining;
        stopSpeech();
        index += 1;
        if (index < cards.length) showCard();
        else finish();
      } catch (err) {
        buttons.forEach((b) => { b.disabled = false; });
        actions.prepend(h('p', { class: 'banner banner--error' }, err.message));
      }
    }

    function finish() {
      paintHeader();
      actions.replaceChildren();
      main.replaceChildren(
        allDone({
          title: remaining ? 'Batch done' : 'All caught up',
          text: 'Each word was rescheduled by how well you knew it. Words you found hard come back sooner.',
          extra: h(
            'div',
            { class: 'tally' },
            RATINGS.map((r) => h('div', { class: 'tally__item' }, h('span', { class: 'tally__n' }, tally[r.key]), h('span', { class: 'tally__label' }, r.label))),
          ),
          action: remaining
            ? h('button', { class: 'btn btn--primary', type: 'button', onClick: load }, `Review ${remaining} more`)
            : h('a', { class: 'btn btn--primary', href: '#/home' }, 'Back to lessons'),
        }),
      );
      main.querySelector('h2').focus();
    }

    showCard();
  }

  load();
  return () => {
    stopped = true;
    stopSpeech();
  };
}
