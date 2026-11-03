// Dev only (npm run course:dev, which sets LIVE_RELOAD=1): node --watch restarts the server when a
// file changes, which drops this event stream; the page reloads as soon as it reconnects.
const CLIENT = `
const source = new EventSource('/livereload');
let lost = false;
source.onerror = () => { lost = true; };
source.onopen = () => { if (lost) location.reload(); };
`;

export function mountLiveReload(app, enabled) {
  // Always answers, so index.html can load it everywhere; without LIVE_RELOAD it does nothing.
  app.get('/livereload.js', (req, res) => {
    res.type('js').set('Cache-Control', 'no-store').send(enabled ? CLIENT : '');
  });
  if (!enabled) return;
  app.get('/livereload', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.flushHeaders();
    // Reconnect quickly after a restart instead of the browser's default of a few seconds.
    res.write('retry: 500\n\n');
  });
}
