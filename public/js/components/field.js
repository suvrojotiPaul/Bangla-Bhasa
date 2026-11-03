import { h } from '../dom.js';
import { icon } from '../icons.js';

let nextId = 0;

/** An eye button that shows or hides the password as typed. */
function revealButton(input) {
  const button = h('button', { class: 'field__reveal', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Show password' });
  const draw = (shown) => {
    button.setAttribute('aria-pressed', String(shown));
    button.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
    button.replaceChildren(icon(shown ? 'eyeOff' : 'eye', { size: 20 }));
  };
  button.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    draw(show);
  });
  draw(false);
  return button;
}

/**
 * A labelled text input. Returns the wrapper and the input.
 * `reveal: true` on a password field adds a button to show what was typed.
 */
export function field(label, { reveal = false, ...attrs } = {}) {
  nextId += 1;
  const input = h('input', { id: `field-${nextId}`, type: 'text', ...attrs });
  const control = reveal ? h('div', { class: 'field__control' }, input, revealButton(input)) : input;
  return { el: h('div', { class: 'field' }, h('label', { class: 'field__label', for: input.id }, label), control), input };
}
