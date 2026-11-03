// Service worker: makes the app installable and shows practice reminders. It caches nothing:
// the app always loads from the server (server/frontend.js handles caching).
// A reminder push carries its message (server/services/push.js); an empty one asks the server.

const FALLBACK = { title: 'Time to practise Bengali', body: 'A quick lesson keeps your Bengali going.', url: '/#/home' };

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let message = FALLBACK;
    try {
      const sent = event.data?.json();
      if (sent?.title) message = { ...FALLBACK, ...sent };
      else {
        const res = await fetch('/api/reminders/message', { credentials: 'same-origin' });
        if (res.ok) message = { ...FALLBACK, ...(await res.json()) };
      }
    } catch {
      // Offline or signed out: the general reminder still shows.
    }
    await self.registration.showNotification(message.title, {
      body: message.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: 'practice-reminder',
      renotify: true,
      data: { url: message.url },
    });
  })());
});

// Tapping the reminder opens the app (or brings it to the front) on Review or Home.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/#/home', self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (app) {
      await app.focus();
      return app.navigate(url);
    }
    return self.clients.openWindow(url);
  })());
});
