import path from 'node:path';
import express from 'express';
import { requireAdmin, requireUser, sameOriginOnly } from './auth.js';
import { loadConfig, ROOT } from './config.js';
import { closeDb, openDb } from './db/db.js';
import { mountFrontend } from './frontend.js';
import { mountLiveReload } from './livereload.js';
import activityRoutes from './routes/activity.js';
import adminRoutes from './routes/admin.js';
import audioRoutes from './routes/audio.js';
import authRoutes from './routes/auth.js';
import backupRoutes from './routes/backup.js';
import lessonsRoutes from './routes/lessons.js';
import remindersRoutes from './routes/reminders.js';
import reviewRoutes from './routes/review.js';
import settingsRoutes from './routes/settings.js';
import setupRoutes from './routes/setup.js';
import unitsRoutes from './routes/units.js';
import verbsRoutes from './routes/verbs.js';
import wordsRoutes from './routes/words.js';
import { initAudio } from './services/audio.js';
import { startReminders } from './services/reminders.js';
import { createSetup } from './services/setup.js';
import { ensureAdmin } from './services/users.js';

const config = loadConfig();
for (const p of config.problems) console[p.fatal ? 'error' : 'warn'](`[config] ${p.variable}: ${p.message}`);
if (config.problems.some((p) => p.fatal)) process.exit(1);

openDb(config.dbPath);
try {
  const admin = await ensureAdmin(config.admin);
  if (admin) console.log(`[admin] ${admin.username} is the admin`);
} catch (err) {
  console.warn(`[admin] ADMIN_USERNAME: ${err.message}`);
}
initAudio(config);
const setup = createSetup(config);
const ctx = { config, setup };

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use('/api', sameOriginOnly);

// Signing in and out. Every other API route needs a signed-in user.
app.use('/api/auth', authRoutes(ctx));
app.use('/api', requireUser);

// Available while the course is still importing.
app.use('/api/setup', setupRoutes(ctx));
app.use('/api/activity', activityRoutes(ctx));
app.use('/api/admin', requireAdmin, adminRoutes(ctx));
app.use('/api/settings', settingsRoutes(ctx));
app.use('/api/reminders', remindersRoutes(ctx));

// Everything below needs the units and lessons to exist.
app.use('/api', (req, res, next) => {
  if (setup.isReady()) return next();
  res.status(503).json({ error: 'The course is still being set up.', setup: true });
});
app.use('/api/units', unitsRoutes(ctx));
app.use('/api/lessons', lessonsRoutes(ctx));
app.use('/api/review', reviewRoutes(ctx));
app.use('/api/words', wordsRoutes(ctx));
app.use('/api/verbs', verbsRoutes(ctx));
app.use('/api/backup', backupRoutes(ctx));
app.use('/api/audio', audioRoutes(ctx));
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}.` });
});

mountLiveReload(app, config.liveReload);
mountFrontend(app, path.join(ROOT, 'public'));

app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong on the server.' });
});

const server = app.listen(config.port, config.host, () => {
  const host = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`Bhasha is running at http://${host}:${config.port}`);
});

const reasons = setup.startIfNeeded();
if (reasons.length) console.log(`[setup] Importing (${reasons.join('; ')})`);
startReminders();

function shutdown() {
  server.close();
  closeDb();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
