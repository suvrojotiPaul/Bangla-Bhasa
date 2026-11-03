import { getDb } from '../db/db.js';
import { wordAudioUrl } from './audio.js';
import { normalizeAnswer, stemCandidates } from './text.js';

function translationsOf(row) {
  try {
    return JSON.parse(row.translations || '{}');
  } catch {
    return {};
  }
}

// "Hello ." -> "Hello": no stray space or trailing punctuation in a meaning.
export const tidy = (text) => text.replace(/\s+([.,;:!?])/g, '$1').replace(/[.,;:]+$/, '').trim();

/** A word's or sentence's meaning in `lang`, else English: { text, lang }. */
export function meaningIn(row, lang) {
  const text = lang === 'en' ? null : translationsOf(row)[lang];
  return text ? { text, lang } : { text: tidy(row.en ?? ''), lang: 'en' };
}

/**
 * Bengali text split into words, each with a hint when the course knows it:
 * [{ text: "জলের", hint: { wordId, bn: "জল", ro, meaning: { text, lang }, formOf: true, audioUrl } }, { text: " " }, …].
 * A word the course doesn't have is looked up again without its ending (জলের -> জল).
 */
export function hintTokens(text, lang) {
  const find = getDb().prepare(
    'SELECT id, bn, ro, en, translations FROM words WHERE bn = ? AND en IS NOT NULL',
  );
  return text.split(/(\s+)/).filter(Boolean).map((part) => {
    const key = normalizeAnswer(part);
    if (!key) return { text: part };
    let word = find.get(key);
    let formOf = false;
    for (const stem of word ? [] : stemCandidates(key)) {
      word = find.get(stem);
      if (word) {
        formOf = true;
        break;
      }
    }
    if (!word) return { text: part };
    return {
      text: part,
      hint: { wordId: word.id, bn: word.bn, ro: word.ro, meaning: meaningIn(word, lang), formOf, audioUrl: wordAudioUrl(word) },
    };
  });
}

/** An example sentence ready to show: Bengali with hints, its meaning, and its audio. */
export function exampleWithHints(sentence, lang, audioUrl) {
  return { bn: sentence.bn, tokens: hintTokens(sentence.bn, lang), meaning: meaningIn(sentence, lang), ro: sentence.ro, audioUrl };
}
