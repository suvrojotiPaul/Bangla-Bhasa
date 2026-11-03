import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

// The frontend is served under /v/<version>/, where the version is a hash of every file in
// public/. A changed file therefore always has a new URL, so browsers (and any caching proxy in
// front) can keep files for a year and still never run an old copy after an update. index.html
// itself is never cached, and points at the current version.
const YEAR = 365 * 24 * 60 * 60 * 1000;

function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesIn(full) : [full];
  });
}

function versionOf(dir) {
  const hash = crypto.createHash('sha1');
  for (const file of filesIn(dir).sort()) hash.update(path.relative(dir, file)).update(fs.readFileSync(file));
  return hash.digest('hex').slice(0, 10);
}

export function mountFrontend(app, publicDir) {
  const version = versionOf(publicDir);
  const index = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
    .replace(/(href|src)="\/(css|js)\//g, `$1="/v/${version}/$2/`);

  app.get(['/', '/index.html'], (req, res) => {
    res.set('Cache-Control', 'no-store').type('html').send(index);
  });
  app.use(`/v/${version}`, express.static(publicDir, { index: false, immutable: true, maxAge: YEAR }));
  // A page opened before an update may still ask for the old version's files: give it today's,
  // uncached, rather than a 404 halfway through.
  app.use('/v/:old', express.static(publicDir, { index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
  app.use(express.static(publicDir, { index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
  return version;
}
