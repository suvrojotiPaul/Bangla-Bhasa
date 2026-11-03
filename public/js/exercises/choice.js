import { meaningText } from '../components/hints.js';
import { h } from '../dom.js';

/**
 * Exercise controllers share one shape:
 *   el           the exercise's DOM
 *   ready()      can the learner press Check?
 *   check()      returns (or resolves to) a result:
 *                { correct, answer: { bn, ro }, given, results: [{ wordId, correct }], say?, note?, mistakes? }
 *   start?()     called once it is on screen
 *   selfChecking exercises call ctx.onDone(result) themselves instead of using Check.
 */

/** "Which one means …?": four Bengali options, one right. Also the base for listening. */
export function create(ex, ctx, { variant = 'choice' } = {}) {
  let selected = null;
  let locked = false;

  const buttons = ex.options.map((option, i) =>
    h(
      'button',
      { class: 'option', type: 'button', 'aria-pressed': 'false', onClick: () => pick(i) },
      h('span', { class: 'option__bn', lang: 'bn' }, option.bn),
      ctx.showRoman && option.ro ? h('span', { class: 'option__ro' }, option.ro) : null,
    ),
  );

  function pick(i) {
    if (locked) return;
    selected = i;
    buttons.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    ctx.speak(ex.options[i].bn, { audioUrl: ex.options[i].audioUrl });
    ctx.onChange();
  }

  return {
    el: h('div', { class: `options options--${variant}`, role: 'group', 'aria-label': 'Answers' }, buttons),
    ready: () => selected !== null,
    check() {
      locked = true;
      const correct = selected === ex.answerIndex;
      buttons.forEach((b, k) => {
        b.disabled = true;
        b.removeAttribute('aria-pressed');
        if (k === ex.answerIndex) b.classList.add('option--correct');
        else if (k === selected) b.classList.add('option--wrong');
        // Now that it's answered, every option shows what it means.
        const { meaning } = ex.options[k];
        if (meaning?.text) b.append(h('span', { class: 'option__meaning' }, meaningText(meaning, ctx.lang)));
      });
      const answer = ex.options[ex.answerIndex];
      return {
        correct,
        answer: { bn: answer.bn, ro: answer.ro },
        given: ex.options[selected].bn,
        results: [{ wordId: ex.wordId, correct }],
      };
    },
  };
}
