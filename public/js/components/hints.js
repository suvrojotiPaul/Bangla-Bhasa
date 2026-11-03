import { h } from '../dom.js';

const LANGUAGE_NAMES = { en: 'English', fr: 'French' };

// Only one hint is open at a time; tapping elsewhere or pressing Escape closes it.
let closeOpen = null;

document.addEventListener('pointerdown', (event) => {
  if (closeOpen && !event.target.closest?.('.hint')) closeOpen();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && closeOpen) closeOpen();
});

/** "Water", plus "(in English)" when the chosen language had no meaning for this word. */
export function meaningText(meaning, lang) {
  return [meaning.text, meaning.lang !== lang ? h('span', { class: 'hint__lang' }, ` (in ${LANGUAGE_NAMES[meaning.lang] ?? meaning.lang})`) : null];
}

let nextId = 0;

function hintWord(token, { lang, showRoman, speak, above = false }) {
  nextId += 1;
  const { hint } = token;
  const bubble = h(
    'span',
    { class: 'hint__bubble', id: `hint-${nextId}`, role: 'tooltip', hidden: true },
    h('strong', { class: 'hint__meaning' }, meaningText(hint.meaning, lang)),
    showRoman && hint.ro ? h('span', { class: 'hint__ro' }, hint.ro) : null,
    hint.formOf ? h('span', { class: 'hint__form' }, 'a form of ', h('span', { lang: 'bn' }, hint.bn)) : null,
  );
  const button = h('button', { class: 'hint__word', type: 'button', lang: 'bn', 'aria-expanded': 'false', 'aria-describedby': bubble.id }, token.text);
  const wrap = h('span', { class: 'hint' }, button, bubble);

  function close() {
    bubble.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (closeOpen === close) closeOpen = null;
  }

  function open() {
    closeOpen?.();
    bubble.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    closeOpen = close;
    // Keep the bubble on screen: flip it above the word near the bottom, nudge it in from the edges.
    wrap.classList.toggle('hint--above', above);
    bubble.style.transform = '';
    let box = bubble.getBoundingClientRect();
    if (!above && box.bottom > window.innerHeight - 8) {
      wrap.classList.add('hint--above');
      box = bubble.getBoundingClientRect();
    }
    const shift = Math.min(0, window.innerWidth - 8 - box.right) || Math.max(0, 8 - box.left);
    if (shift) bubble.style.transform = `translateX(${shift}px)`;
    speak?.(hint.bn, { audioUrl: hint.audioUrl });
  }

  button.addEventListener('click', () => (bubble.hidden ? open() : close()));
  return wrap;
}

/**
 * Bengali text whose known words have a dotted underline: tap one to see its meaning
 * (in `lang`, else English), its romanization, and hear it. `tokens` come from the server.
 * `above: true` opens the bubbles upward, e.g. in the answer panel above the Continue button.
 */
export function hintText(tokens, options) {
  return h(
    'span',
    { class: 'hint-text', lang: 'bn' },
    tokens.map((token) => (token.hint ? hintWord(token, options) : token.text)),
  );
}
