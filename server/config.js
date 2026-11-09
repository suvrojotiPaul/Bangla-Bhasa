import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Same values as .env.example, so the app still starts without a .env file.
const DEFAULTS = {
  PORT: '3000',
  HOST: '127.0.0.1',
  DB_PATH: './data/bhasha.sqlite',
  CURRICULUM_PATH: './data/course',
  AUDIO_DIR: './data/audio',
  LIVE_RELOAD: '',
  ADMIN_USERNAME: '',
  ADMIN_PASSWORD: '',
  CLIENT_IP_HEADER: '',
};

const MIN_ADMIN_PASSWORD = 8;

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

/**
 * Reads .env (if present) and validates it.
 * `problems` lists every bad variable by name so the setup screen can say which one to fix.
 * Only fatal problems stop the server; a bad CURRICULUM_PATH just fails the lessons step.
 */
export function loadConfig() {
  const envFile = path.join(ROOT, '.env');
  const envFound = fs.existsSync(envFile);
  if (envFound) process.loadEnvFile(envFile);

  const problems = [];
  const problem = (variable, message, fatal = false) => problems.push({ variable, message, fatal });
  const get = (name) => {
    const value = process.env[name];
    return value === undefined || value.trim() === '' ? DEFAULTS[name] : value.trim();
  };

  if (!envFound) problem('.env', 'No .env file found, using built-in defaults. Copy .env.example to .env to change them.');

  const port = Number(get('PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problem('PORT', `PORT must be a whole number from 1 to 65535 (got "${get('PORT')}").`, true);
  }

  const curriculumPath = resolvePath(get('CURRICULUM_PATH'));
  if (!fs.existsSync(curriculumPath) || !fs.statSync(curriculumPath).isDirectory()) {
    problem('CURRICULUM_PATH', `CURRICULUM_PATH must be the course folder, e.g. ./data/course (got ${curriculumPath}).`);
  }

  // The admin account: created or updated from these on every start.
  let admin = null;
  const adminUsername = get('ADMIN_USERNAME');
  const adminPassword = get('ADMIN_PASSWORD');
  if (!adminUsername || !adminPassword) {
    problem('ADMIN_USERNAME', 'Set ADMIN_USERNAME and ADMIN_PASSWORD in .env to have an admin account. Until then nobody can see the People dashboard.');
  } else if (adminPassword.length < MIN_ADMIN_PASSWORD) {
    problem('ADMIN_PASSWORD', `ADMIN_PASSWORD needs at least ${MIN_ADMIN_PASSWORD} characters.`);
  } else {
    admin = { username: adminUsername, password: adminPassword };
  }

  const clientIpHeader = get('CLIENT_IP_HEADER');
  if (clientIpHeader && !/^[A-Za-z0-9-]+$/.test(clientIpHeader)) {
    problem('CLIENT_IP_HEADER', `CLIENT_IP_HEADER must be a header name such as X-Real-IP (got "${clientIpHeader}").`, true);
  }

  return {
    envFound,
    problems,
    port,
    host: get('HOST'),
    dbPath: resolvePath(get('DB_PATH')),
    dbPathSetting: get('DB_PATH'),
    audioDir: resolvePath(get('AUDIO_DIR')),
    curriculumPath,
    liveReload: get('LIVE_RELOAD') === '1',
    admin,
    clientIpHeader,
  };
}
