import { api } from '../api.js';
import { hintText } from '../components/hints.js';
import { h } from '../dom.js';
import * as build from '../exercises/build.js';
import * as choice from '../exercises/choice.js';
import * as learn from '../exercises/learn.js';
import * as listen from '../exercises/listen.js';
import * as match from '../exercises/match.js';
import { icon } from '../icons.js';
import { loadSettings } from '../settings.js';
import { hasBengaliVoice, speak, stop as stopSpeech } from '../speech.js';

const EXERCISES = { learn, choice, listen, build, match };

const withRoman = (answer, showRoman) =>
  answer.bn + (showRoman && answer.ro ? ` (${answer.ro})` : '');

function doneView(lesson, outcome, showRoman) {
  const missed = new Set(outcome.toReview);
  return h(
    'div',
    { class: 'lesson-done' },
    h('div', { class: 'lesson-done__badge', 'aria-hidden': 'true' }, icon('star', { size: 64, strokeWidth: 1.5 })),
    h('h1', { class: 'lesson-done__title', tabindex: '-1' }, 'Lesson complete!'),
    h('p', { class: 'lesson-done__cheer' }, h('span', { lang: 'bn' }, outcome.perfect ? 'অসাধারণ!' : 'দারুণ!'), outcome.perfect ? ' (Perfect!)' : ' (Great job!)'),
    h(
      'div',
      { class: 'lesson-done__stats' },
      h('div', { class: 'result-tile result-tile--xp' }, h('div', { class: 'result-tile__label' }, 'Total XP'), h('div', { class: 'result-tile__value' }, `+${outcome.xpEarned}`)),
      h('div', { class: 'result-tile result-tile--accuracy' }, h('div', { class: 'result-tile__label' }, 'Accuracy'), h('div', { class: 'result-tile__value' }, `${Math.round(outcome.accuracy * 100)}%`)),
    ),
    h(
      'section',
      { class: 'lesson-done__words' },
      h('h2', null, missed.size ? 'In your review queue (missed ones come back soon)' : 'In your review queue'),
      h(
        'ul',
        { class: 'word-chips' },
        lesson.words.map((w) =>
          h(
            'li',
            { class: `word-chip${missed.has(w.id) ? ' word-chip--missed' : ''}` },
            h('span', { lang: 'bn' }, w.bn),
            showRoman && w.ro ? ` ${w.ro}` : '',
            missed.has(w.id) ? h('span', { class: 'sr-only' }, ' (missed)') : null,
          ),
        ),
      ),
    ),
  );
}

/** Screen 3: one lesson, exercise by exercise, then the results. */
export function mount(root, { params: [slug], onError }) {
  document.title = 'Lesson · Bhasha';
  let stopped = false;
  const screen = h('main', { class: 'screen lesson' });
  root.append(screen);

  function load() {
    screen.replaceChildren(h('p', { class: 'home__loading' }, 'Loading lesson…'));
    Promise.all([api.get(`/lessons/${slug}`), loadSettings(), hasBengaliVoice()])
      .then(([lesson, settings, voice]) => {
        if (!stopped) run(lesson, settings, voice);
      })
      .catch((err) => {
        if (!stopped) onError(err);
      });
  }

  function run(lesson, settings, voice) {
    // Without a recorded clip or a Bengali system voice, a listening question can't be answered.
    const exercises = lesson.exercises.filter((e) => e.type !== 'listen' || e.audioUrl || voice);
    const total = exercises.length;
    const wordResults = new Map(); // wordId -> answered right every time so far
    let mistakes = 0;
    let index = 0;
    let current = null;
    let checkButton = null;
    let checking = false;

    document.title = `${lesson.lesson.unit.title}, ${lesson.lesson.title} · Bhasha`;
    const fill = h('div', { class: 'progress__fill' });
    const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Lesson progress', 'aria-valuemin': 0, 'aria-valuemax': total }, fill);
    const count = h('span', { class: 'lesson__count' });
    const body = h('div', { class: 'lesson__body' });
    const footer = h('footer', { class: 'lesson__footer' });
    const announcer = h('p', { class: 'sr-only', 'aria-live': 'assertive' });
    screen.replaceChildren(
      h(
        'header',
        { class: 'lesson__top' },
        h('a', { class: 'lesson__quit', href: '#/home', 'aria-label': 'Quit lesson' }, icon('close', { size: 26, strokeWidth: 2.4 })),
        bar,
        count,
      ),
      body,
      footer,
      announcer,
    );

    const ctx = {
      slug,
      showRoman: settings.showRoman,
      lang: settings.meaningLanguage,
      speak,
      onChange: () => updateCheck(),
      onDone: (result) => showFeedback(exercises[index], result),
    };

    function setProgress(answered) {
      fill.style.width = `${Math.round((answered / total) * 100)}%`;
      bar.setAttribute('aria-valuenow', String(answered));
      count.textContent = `${Math.min(index + 1, total)}/${total}`;
    }

    function updateCheck() {
      if (checkButton) checkButton.disabled = checking || !current.ready();
    }

    function showExercise() {
      const ex = exercises[index];
      current = EXERCISES[ex.type].create(ex, ctx);
      const prompt = h('h1', { class: 'lesson__prompt', tabindex: '-1' }, ex.prompt);
      body.replaceChildren(h('div', { class: 'lesson__head' }, h('span', { class: 'lesson__kind' }, ex.kind), prompt), current.el);
      footer.className = 'lesson__footer';
      if (current.info) {
        // A new-word card: nothing to answer.
        checkButton = null;
        footer.replaceChildren(h('button', { class: 'btn btn--primary', type: 'button', onClick: advance }, 'Continue'));
      } else if (current.selfChecking) {
        checkButton = null;
        footer.replaceChildren(h('p', { class: 'lesson__hint' }, current.hint));
      } else {
        checkButton = h('button', { class: 'btn btn--primary', type: 'button', onClick: onCheck }, 'Check');
        footer.replaceChildren(checkButton);
        updateCheck();
      }
      setProgress(index);
      prompt.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      current.start?.();
    }

    async function onCheck() {
      if (checking || !current.ready()) return;
      checking = true;
      updateCheck();
      try {
        showFeedback(exercises[index], await current.check());
      } catch (err) {
        footer.replaceChildren(h('p', { class: 'banner banner--error' }, err.message), checkButton);
      } finally {
        checking = false;
        updateCheck();
      }
    }

    function showFeedback(ex, result) {
      for (const { wordId, correct } of result.results) {
        wordResults.set(wordId, (wordResults.get(wordId) ?? true) && correct);
      }
      mistakes += result.mistakes ?? (result.correct ? 0 : 1);
      setProgress(index + 1);
      if (result.say) speak(result.say.text, { audioUrl: result.say.audioUrl });

      const ok = result.correct;
      const expected = result.answer ? withRoman(result.answer, settings.showRoman) : null;
      const note = result.note ?? (ok ? 'Nice, keep going.' : 'No problem. This one comes back in your review queue.');
      // A sentence answer: each word can be tapped for its meaning.
      const tappable = result.answerTokens
        ? h(
            'span',
            { class: 'feedback__answer feedback__answer--hints' },
            ok ? 'Tap a word for its meaning: ' : 'Correct answer: ',
            hintText(result.answerTokens, { ...ctx, above: true }),
          )
        : null;
      const next = h('button', { class: `btn ${ok ? 'btn--primary' : 'btn--danger'}`, type: 'button', onClick: advance }, 'Continue');
      footer.className = `lesson__footer lesson__footer--${ok ? 'ok' : 'wrong'}`;
      footer.replaceChildren(
        h(
          'div',
          { class: 'feedback' },
          h('span', { class: `feedback__title feedback__title--${ok ? 'ok' : 'wrong'}` }, ok ? 'Correct!' : 'Not quite'),
          tappable ?? (!ok && expected ? h('span', { class: 'feedback__answer' }, 'Correct answer: ', h('strong', { lang: 'bn' }, expected)) : null),
          h('span', { class: 'feedback__note' }, note),
        ),
        next,
      );
      announcer.textContent = ok ? `Correct! ${note}` : `Not quite. ${expected ? `Correct answer: ${expected}.` : ''}`;
      next.focus();
    }

    function advance() {
      stopSpeech();
      index += 1;
      if (index < total) showExercise();
      else finish();
    }

    async function finish() {
      setProgress(total);
      body.replaceChildren(h('p', { class: 'home__loading' }, 'Saving your progress…'));
      footer.className = 'lesson__footer';
      footer.replaceChildren();
      const results = [...wordResults].map(([wordId, correct]) => ({ wordId, correct }));
      try {
        const outcome = await api.post(`/lessons/${slug}/complete`, { results, mistakes });
        if (stopped) return;
        body.replaceChildren(doneView(lesson, outcome, settings.showRoman));
        footer.replaceChildren(
          h('a', { class: 'btn btn--primary', href: '#/home' }, 'Continue'),
          h('button', { class: 'btn btn--text', type: 'button', onClick: load }, 'Practice again'),
        );
        body.querySelector('h1').focus();
      } catch (err) {
        if (stopped) return;
        body.replaceChildren(h('p', { class: 'banner banner--error' }, `Your result wasn't saved: ${err.message}`));
        footer.replaceChildren(h('button', { class: 'btn btn--primary', type: 'button', onClick: finish }, 'Try again'));
      }
    }

    if (total === 0) {
      body.replaceChildren(h('p', { class: 'banner banner--soft' }, 'This lesson has no exercises yet. Check the course files in data/course.'));
      footer.replaceChildren(h('a', { class: 'btn btn--primary', href: '#/home' }, 'Back to Learn'));
      return;
    }
    showExercise();
  }

  load();
  return () => {
    stopped = true;
    stopSpeech();
  };
}
