import { h } from '../dom.js';
import { icon } from '../icons.js';
import { create as createChoice } from './choice.js';

const AUTOPLAY_DELAY_MS = 300;

/** "Tap what you hear": plays the word, then four Bengali options. */
export function create(ex, ctx) {
  const options = createChoice(ex, ctx, { variant: 'listen' });
  const play = (rate) => ctx.speak(ex.say, { rate, audioUrl: ex.audioUrl });

  const el = h(
    'div',
    { class: 'listen' },
    h(
      'div',
      { class: 'listen__controls' },
      h(
        'button',
        { class: 'listen__play', type: 'button', 'aria-label': 'Play the word', onClick: () => play(0.9) },
        icon('volume', { size: 40, strokeWidth: 2.2 }),
      ),
      h('button', { class: 'listen__slow', type: 'button', onClick: () => play(0.55) }, 'Slower'),
    ),
    options.el,
  );

  return { ...options, el, start: () => setTimeout(() => el.isConnected && play(0.9), AUTOPLAY_DELAY_MS) };
}
