// Practice reminders through web push: this device's side. Works in Chrome on Android (the app
// installed or not). On iPhone, push only works for an app added to the home screen from Safari.
import { api } from './api.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Registers public/sw.js, which makes the app installable and shows the reminders. */
export function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// The server's VAPID key arrives as base64url; subscribe() wants the bytes.
function keyBytes(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

async function saveSubscription(subscription) {
  await api.post('/reminders/subscription', {
    subscription: subscription.toJSON(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

/** This device: 'on', 'off' (can be turned on), 'blocked' (the learner said no) or 'unsupported'. */
export async function reminderState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  return (await currentSubscription()) ? 'on' : 'off';
}

/** Asks for permission (only works from a tap) and signs this device up. Returns the new state. */
export async function enableReminders() {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const { publicKey } = await api.get('/reminders/key');
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  }
  await saveSubscription(subscription);
  return 'on';
}

export async function disableReminders() {
  if (!pushSupported()) return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  await api.post('/reminders/unsubscribe', { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

/**
 * On each start: matches this device to the learner's setting without asking anything (only a
 * device that already has permission). Keeps the server's copy current (time zone, which account
 * is signed in), signs the device up again if its subscription lapsed, or turns it off.
 */
export async function syncReminders(settings) {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  if (settings.reminders) await enableReminders();
  else await disableReminders();
}
