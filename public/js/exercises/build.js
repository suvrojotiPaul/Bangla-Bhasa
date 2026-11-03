import { api } from '../api.js';
import { h } from '../dom.js';

function chip(token, ctx, onClick, disabled = false) {
  return h(
    'button',
    { class: 'chip', type: 'button', onClick, disabled },
    h('span', { class: 'chip__bn', lang: 'bn' }, token.bn),
    ctx.showRoman && token.ro ? h('span', { class: 'chip__ro' }, token.ro) : null,
  );
}

/** "Translate this sentence": tap word tiles into order. The server checks the answer. */
export function create(ex, ctx) {
  const built = []; // indexes into ex.bank, in answer order
  let locked = false;

  const answer = h('div', { class: 'build__answer', role: 'group', 'aria-label': 'Your answer' });
  const bankButtons = ex.bank.map((token, i) => chip(token, ctx, () => add(i)));

  function render() {
    answer.replaceChildren(...built.map((i, pos) => chip(ex.bank[i], ctx, () => remove(pos), locked)));
    bankButtons.forEach((button, i) => {
      const used = built.includes(i);
      button.disabled = used || locked;
      button.classList.toggle('chip--used', used);
    });
    ctx.onChange();
  }

  function add(i) {
    if (locked || built.includes(i)) return;
    built.push(i);
    ctx.speak(ex.bank[i].bn, { audioUrl: ex.bank[i].audioUrl });
    render();
  }

  function remove(pos) {
    if (locked) return;
    built.splice(pos, 1);
    render();
  }

  const el = h(
    'div',
    { class: 'build' },
    h(
      'div',
      { class: 'build__source' },
      h('span', { class: 'build__lang', 'aria-hidden': 'true' }, (ex.source?.lang ?? 'en').toUpperCase()),
      h('span', { class: 'build__en' }, ex.source?.text ?? ex.en),
    ),
    answer,
    h('div', { class: 'build__bank', role: 'group', 'aria-label': 'Word tiles' }, bankButtons),
  );

  return {
    el,
    ready: () => built.length > 0,
    async check() {
      const given = built.map((i) => ex.bank[i].bn).join(' ');
      const res = await api.post(`/lessons/${ctx.slug}/check`, { sentenceId: ex.sentenceId, answer: given });
      locked = true;
      render();
      return {
        correct: res.correct,
        answer: { bn: res.expected, ro: res.expectedRo },
        answerTokens: res.expectedTokens,
        given,
        say: { text: res.expected, audioUrl: ex.audioUrl },
        results: ex.wordIds.map((wordId) => ({ wordId, correct: res.correct })),
      };
    },
  };
}
