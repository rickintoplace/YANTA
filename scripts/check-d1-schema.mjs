#!/usr/bin/env node
// ============================================================
// Before a worker deploy: does the production database have every table
// schema.sql declares? A table added to schema.sql is not created by a
// deploy, and a handler that touches it fails with "no such table" — the
// way removing a share broke in November 2026. Reads only; it reports,
// it does not migrate (do that deliberately, or create the table lazily
// in the worker as space_link_stats / withdrawal_requests do).
//
//   node scripts/check-d1-schema.mjs --dir yanta-cloud-worker
// ============================================================

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const dirArg = process.argv.indexOf('--dir');
const dir = dirArg > 0 ? process.argv[dirArg + 1] : 'yanta-cloud-worker';

const declared = [...readFileSync(join(dir, 'schema.sql'), 'utf8').matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_0-9]+)/gi)].map((m) => m[1]);

let remote;
try {
  const out = execFileSync('npx', ['-y', 'wrangler@4', 'd1', 'execute', 'yanta-cloud-db', '--remote', '--json',
    '--command', "SELECT name FROM sqlite_master WHERE type='table'"], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  remote = new Set(JSON.parse(out)[0].results.map((r) => r.name));
} catch (err) {
  console.log(`  ? could not read the production tables (${String(err.message || err).split('\n')[0]}) — skipped`);
  process.exit(0);
}

const missing = declared.filter((name) => !remote.has(name));
if (!missing.length) {
  console.log(`  ✓ production database has all ${declared.length} tables from schema.sql`);
} else {
  console.log(`  ! in schema.sql but not in production: ${missing.join(', ')}`);
  console.log('    Handlers touching them fail unless they create the table on first use.');
}
