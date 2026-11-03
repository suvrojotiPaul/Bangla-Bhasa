import { h } from '../dom.js';
import { icon } from '../icons.js';

export function speakButton(label, onClick, { large = false } = {}) {
  return h(
    'button',
    { class: `speak-btn${large ? ' speak-btn--large' : ''}`, type: 'button', 'aria-label': label, onClick },
    icon('volume', { size: large ? 24 : 20, strokeWidth: 2.2 }),
  );
}
