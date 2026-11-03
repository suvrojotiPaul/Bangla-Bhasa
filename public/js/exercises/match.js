import { h } from '../dom.js';

const WRONG_FLASH_MS = 650;

/** "Match the pairs": Bengali on the left, meanings on the right. Finishes itself when all pairs match. */
export function create(ex, ctx) {
  const matched = new Set();
  const missed = new Set();
  let left = null;
  let right = null;
  let mistakes = 0;
  let flashing = false;

  // aria-disabled instead of disabled, so keyboard focus isn't lost when a pair is done.
  const button = (side, item, ...content) =>
    h('button', { class: 'option', type: 'button', 'aria-pressed': 'false', onClick: () => pick(side, item.id) }, ...content);
  const leftButtons = new Map(
    ex.left.map((m) => [
      m.id,
      button('L', m, h('span', { class: 'match__bn', lang: 'bn' }, m.label), ctx.showRoman && m.ro ? h('span', { class: 'option__ro' }, m.ro) : null),
    ]),
  );
  const rightButtons = new Map(ex.right.map((m) => [m.id, button('R', m, h('span', { class: 'match__en' }, m.label))]));

  function paint() {
    for (const [buttons, chosen] of [[leftButtons, left], [rightButtons, right]]) {
      for (const [id, b] of buttons) {
        const done = matched.has(id);
        b.setAttribute('aria-pressed', String(chosen === id));
        b.classList.toggle('option--matched', done);
        b.setAttribute('aria-disabled', String(done));
      }
    }
  }

  function pick(side, id) {
    if (flashing || matched.has(id)) return;
    if (side === 'L') {
      left = id;
      const item = ex.left.find((m) => m.id === id);
      ctx.speak(item.label, { audioUrl: item.audioUrl });
    } else {
      right = id;
    }
    if (left === null || right === null) {
      paint();
      return;
    }

    if (left === right) {
      matched.add(left);
      left = right = null;
      paint();
      if (matched.size === ex.left.length) finish();
      return;
    }

    mistakes += 1;
    missed.add(left);
    const wrong = [leftButtons.get(left), rightButtons.get(right)];
    left = right = null;
    flashing = true;
    paint();
    wrong.forEach((b) => b.classList.add('option--wrong'));
    setTimeout(() => {
      flashing = false;
      wrong.forEach((b) => b.classList.remove('option--wrong'));
    }, WRONG_FLASH_MS);
  }

  function finish() {
    ctx.onDone({
      correct: true,
      mistakes,
      answer: null,
      note: mistakes ? `All pairs matched, with ${mistakes} ${mistakes === 1 ? 'slip' : 'slips'}.` : 'All pairs matched.',
      results: ex.left.map((m) => ({ wordId: m.id, correct: !missed.has(m.id) })),
    });
  }

  return {
    el: h(
      'div',
      { class: 'match' },
      h('div', { class: 'match__col', role: 'group', 'aria-label': 'Bengali' }, [...leftButtons.values()]),
      h('div', { class: 'match__col', role: 'group', 'aria-label': 'Meanings' }, [...rightButtons.values()]),
    ),
    selfChecking: true,
    hint: 'Tap a Bengali word, then its meaning',
    ready: () => false,
  };
}
