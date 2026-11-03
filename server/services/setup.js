import fs from 'node:fs';
import { getDb, getMeta, setMeta, SCHEMA_VERSION } from '../db/db.js';
import { buildLessons, curriculumHash } from '../importers/buildLessons.js';
import { readCourse } from '../importers/course.js';
import { indexGeneratedAudio } from '../importers/generated.js';

const SCHEMA_CHANGED = 'database schema changed';

// Everything comes from the course files; audio is the generated clips, if any were made.
const STEPS = [
  { id: 'config', title: 'Read configuration', env: '.env' },
  { id: 'lessons', title: 'Build units & lessons', env: 'CURRICULUM_PATH', run: buildLessons },
  { id: 'generated', title: 'Audio clips (optional)', env: 'AUDIO_DIR', run: indexGeneratedAudio, optional: true },
];

/**
 * Builds the course from its files in the background and keeps live status for the setup screen.
 * A failed optional step (generated audio) doesn't stop the app.
 */
export function createSetup(config) {
  const steps = new Map();
  let running = false;
  let startedAt = null;
  let finishedAt = null;

  // Steps that no longer exist (the old Wiktionary and Tatoeba imports) leave no status behind.
  const ids = STEPS.map((s) => s.id);
  getDb().prepare(`DELETE FROM sources WHERE id NOT IN (${ids.map(() => '?').join(',')})`).run(...ids);
  for (const row of getDb().prepare('SELECT * FROM sources').all()) {
    // A step still marked running was cut off when the server last stopped.
    const interrupted = row.status === 'running';
    steps.set(row.id, {
      status: interrupted ? 'error' : row.status,
      detail: interrupted ? 'Interrupted, will run again' : row.detail,
      count: row.item_count,
      updatedAt: row.updated_at,
    });
  }

  // Progress messages: memory only. Final results: also saved to the sources table.
  const update = (id, patch) => steps.set(id, { ...steps.get(id), ...patch });
  const save = (id, patch) => {
    const updatedAt = new Date().toISOString();
    update(id, { ...patch, updatedAt });
    const s = steps.get(id);
    getDb()
      .prepare(`
        INSERT INTO sources (id, status, detail, item_count, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, detail = excluded.detail,
          item_count = excluded.item_count, updated_at = excluded.updated_at`)
      .run(id, s.status, s.detail ?? null, s.count ?? null, updatedAt);
  };

  function isReady() {
    return getDb().prepare('SELECT COUNT(*) FROM lessons').pluck().get() > 0;
  }

  function configStep() {
    const { problems } = config;
    return {
      status: problems.some((p) => p.fatal) ? 'error' : 'done',
      detail: problems.length ? problems.map((p) => p.message).join(' ') : 'All settings look good',
    };
  }

  function status() {
    const list = STEPS.map((step) => {
      const s = step.id === 'config' ? configStep() : (steps.get(step.id) ?? { status: 'pending' });
      return {
        id: step.id,
        title: step.title,
        env: step.env,
        optional: !!step.optional,
        status: s.status,
        detail: s.detail ?? null,
        count: s.count ?? null,
        updatedAt: s.updatedAt ?? null,
      };
    });
    const finished = list.filter((s) => ['done', 'skipped', 'error'].includes(s.status)).length;
    const inProgress = list.some((s) => s.status === 'running') ? 0.5 : 0;
    return {
      running,
      ready: isReady(),
      startedAt,
      finishedAt,
      progress: running ? Math.round(((finished + inProgress) / list.length) * 100) : 100,
      dbPath: config.dbPathSetting,
      problems: config.problems,
      steps: list,
    };
  }

  // A course file that doesn't parse counts as changed, so the lessons step runs and shows the error.
  function courseHash() {
    try {
      return curriculumHash(readCourse(config.curriculumPath).raw);
    } catch {
      return null;
    }
  }

  /** Why the server should import on start; empty when everything is up to date. */
  function reasonsToImport() {
    const reasons = [];
    if (!isReady()) reasons.push('no lessons yet');
    if (getMeta('schema_version') !== String(SCHEMA_VERSION)) reasons.push(SCHEMA_CHANGED);
    if (fs.existsSync(config.curriculumPath) && getMeta('curriculum_hash') !== courseHash()) reasons.push('course changed');
    if (!['done', 'skipped'].includes(steps.get('lessons')?.status)) reasons.push('lessons not built');
    return reasons;
  }

  /** Runs every step: building the lessons takes seconds, so there is nothing to skip. */
  async function run() {
    if (running) return false;
    running = true;
    startedAt = new Date().toISOString();
    finishedAt = null;
    const toRun = STEPS.filter((s) => s.run);
    // Show what's still ahead as waiting, not the previous run's result.
    for (const step of toRun) update(step.id, { status: 'pending', detail: null });
    try {
      for (const step of toRun) {
        save(step.id, { status: 'running', detail: 'Starting…', count: null });
        try {
          const report = (detail) => update(step.id, { detail });
          const result = await step.run({ config, report });
          save(step.id, { status: result.skipped ? 'skipped' : 'done', detail: result.detail, count: result.count ?? null });
          console.log(`[setup] ${step.title}: ${result.detail}`);
        } catch (err) {
          save(step.id, { status: 'error', detail: err.message, count: null });
          console.error(`[setup] ${step.title} failed: ${err.message}`);
        }
      }
      setMeta('schema_version', SCHEMA_VERSION);
    } finally {
      running = false;
      finishedAt = new Date().toISOString();
    }
    return true;
  }

  /** On server start: rebuild the course when anything it depends on changed. */
  function startIfNeeded() {
    const reasons = reasonsToImport();
    if (reasons.length) run().catch((err) => console.error('[setup]', err));
    return reasons;
  }

  return { status, run, startIfNeeded, isReady, reasonsToImport, isRunning: () => running };
}
