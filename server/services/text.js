// Bengali dari (।), double dari (॥) and common Latin punctuation.
const PUNCTUATION = /[।॥.,!?;:"'“”‘’«»()[\]{}…\-–—/\\]/g;

/** Same Bengali text can be typed with different code point orders; NFC makes them equal. */
export function normalizeBn(text) {
  return (text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** For comparing answers: NFC, no punctuation, single spaces, lower case (for English). */
export function normalizeAnswer(text) {
  return (text ?? '').normalize('NFC').replace(PUNCTUATION, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Endings that make জল into জলের, জলে… Longest first, so a word is stripped back as far as it goes.
export const ENDINGS = ['টুকু', 'দের', 'য়ে', 'ের', 'এর', 'কে', 'তে', 'রা', 'টা', 'টি', 'র', 'য়', 'ে', 'ও', 'ই']
  .map((e) => e.normalize('NFC'));

/** The word with each known ending removed: "জলের" -> ["জল"]. Only stems of 2+ characters. */
export function stemCandidates(token) {
  return ENDINGS.filter((e) => token.endsWith(e) && token.length - e.length >= 2).map((e) => token.slice(0, -e.length));
}

export function tokenize(text) {
  const clean = normalizeAnswer(text);
  return clean ? clean.split(' ') : [];
}

export function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Local calendar day as YYYY-MM-DD (the server runs on the learner's own computer). */
export function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function previousDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d - 1));
}
