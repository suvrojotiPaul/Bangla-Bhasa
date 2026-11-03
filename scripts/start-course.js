// Runs the app on the A1–B2 course in data/course with its own database, so the original
// curriculum.json course and its learners' progress in data/bhasha.sqlite stay untouched.
// Variables set in the environment still win; .env never overrides them.
process.env.CURRICULUM_PATH ||= './data/course';
process.env.DB_PATH ||= './data/bhasha-course.sqlite';
// npm run course:dev: the open page reloads itself after each restart (server/livereload.js).
if (process.argv.includes('--live-reload')) process.env.LIVE_RELOAD = '1';

await import('../server/index.js');
