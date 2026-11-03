import { hintText, meaningText } from '../components/hints.js';
import { speakButton } from '../components/speakButton.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';

const AUTOPLAY_DELAY_MS = 300;

/**
 * A new word, taught before it is asked: Bengali, sound, meaning, and an example sentence with
 * tappable words. Nothing to answer, so it is `info`: the lesson shows Continue instead of Check.
 */
export function create(ex, ctx) {
  const say = () => ctx.speak(ex.bn, { audioUrl: ex.audioUrl });
  const example = ex.example;

  const el = h(
    'div',
    { class: 'learn card' },
    h(
      'div',
      { class: 'learn__word' },
      h('span', { class: 'learn__bn', lang: 'bn' }, ex.bn),
      ex.ro ? h('span', { class: 'learn__ro' }, ex.ro) : null,
      speakButton('Play the word', say, { large: true }),
    ),
    h('p', { class: 'learn__meaning' }, meaningText(ex.meaning, ctx.lang)),
    ex.note ? h('div', { class: 'note' }, icon('info', { size: 18 }), h('span', null, ex.note)) : null,
    example
      ? h(
          'div',
          { class: 'example' },
          h(
            'span',
            { class: 'example__text' },
            h('span', { class: 'example__bn' }, hintText(example.tokens, ctx)),
            h('span', { class: 'example__en' }, meaningText(example.meaning, ctx.lang)),
          ),
          speakButton('Play example sentence', () => ctx.speak(example.bn, { audioUrl: example.audioUrl })),
        )
      : null,
    example ? h('p', { class: 'learn__tip' }, 'Tap a dotted word to see what it means.') : null,
  );

  return {
    el,
    info: true,
    ready: () => true,
    start: () => setTimeout(() => el.isConnected && say(), AUTOPLAY_DELAY_MS),
  };
}
