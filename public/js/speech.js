// Plays a recorded or generated clip when the server has one, otherwise the browser's Bengali voice.
// An Indian Bengali (bn-IN) voice is preferred when the device has one.

let clip = null;

// Browsers load their voice list asynchronously.
const voicesLoaded = new Promise((resolve) => {
  if (!('speechSynthesis' in window)) {
    resolve();
    return;
  }
  if (speechSynthesis.getVoices().length) resolve();
  speechSynthesis.addEventListener('voiceschanged', () => resolve(), { once: true });
  setTimeout(resolve, 1500);
});

const langOf = (voice) => voice.lang.toLowerCase().replace('_', '-');

function bengaliVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices().filter((v) => langOf(v).startsWith('bn'));
  return voices.find((v) => langOf(v) === 'bn-in') ?? voices[0] ?? null;
}

/** True when this device has a Bengali text-to-speech voice. */
export async function hasBengaliVoice() {
  await voicesLoaded;
  return bengaliVoice() !== null;
}

export function stop() {
  clip?.pause();
  clip = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function speakWithVoice(text, rate) {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = bengaliVoice();
  utterance.lang = voice?.lang ?? 'bn-IN';
  if (voice) utterance.voice = voice;
  utterance.rate = rate;
  speechSynthesis.speak(utterance);
}

/** rate below 0.8 counts as "slower" (recorded clips play at 0.75×). */
export function speak(text, { rate = 0.9, audioUrl = null } = {}) {
  stop();
  if (audioUrl) {
    clip = new Audio(audioUrl);
    clip.playbackRate = rate < 0.8 ? 0.75 : 1;
    clip.play().catch(() => speakWithVoice(text, rate));
    return;
  }
  speakWithVoice(text, rate);
}
