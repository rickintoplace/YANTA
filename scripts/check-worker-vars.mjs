// ============================================================
// Pre-deploy guard for the Cloud Worker's plain-text vars.
//
// `wrangler deploy` replaces ALL plain-text vars with what the
// config declares — a var that only ever existed in the Cloudflare
// dashboard is wiped without a word. That happened once (Paddle
// billing, the VAPID public key, Matrix admin and RSS limits all
// vanished), so every deploy now diffs the live version against
// wrangler.toml first.
//
// Secrets are a separate mechanism and survive deploys untouched;
// they are only reported, never compared.
//
// Usage: node scripts/check-worker-vars.mjs [--dir yanta-cloud-worker]
// Exit 1 = the deploy would drop or change a var.
// ============================================================

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dirArg = process.argv.indexOf('--dir');
const dir = resolve(dirArg > -1 ? process.argv[dirArg + 1] : 'yanta-cloud-worker');

function wrangler(args) {
  return execFileSync('npx', ['-y', 'wrangler@4', ...args], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
}

/*
  Minimal reader for the [vars] table: keys are simple strings, one
  per line. Enough for this file, and it avoids a TOML dependency.
*/
function configVars() {
  const lines = readFileSync(resolve(dir, 'wrangler.toml'), 'utf8').split('\n');
  const vars = {};
  let inVars = false;

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith('[')) {
      inVars = line === '[vars]';
      continue;
    }

    if (!inVars || !line || line.startsWith('#')) continue;

    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*"(.*)"\s*$/);
    if (match) vars[match[1]] = match[2];
  }

  return vars;
}

function liveVars() {
  const status = JSON.parse(wrangler(['deployments', 'status', '--json']));
  const versionId = status.versions?.[0]?.version_id;
  if (!versionId) throw new Error('no deployed version found');

  const version = JSON.parse(wrangler(['versions', 'view', versionId, '--json']));
  const bindings = version.resources?.bindings || [];

  return {
    versionId,
    vars: Object.fromEntries(
      bindings.filter((b) => b.type === 'plain_text').map((b) => [b.name, b.text])
    ),
    secrets: bindings.filter((b) => b.type === 'secret_text').map((b) => b.name),
  };
}

let live;

try {
  live = liveVars();
} catch (err) {
  // Never block a deploy because the check itself could not run
  // (first deploy, no auth, network hiccup) — just say so.
  console.warn(`⚠ var check skipped: ${err.message.split('\n')[0]}`);
  process.exit(0);
}

const config = configVars();
const problems = [];

for (const [name, value] of Object.entries(live.vars)) {
  if (!(name in config)) {
    problems.push(`  ${name} would be REMOVED (live value: ${JSON.stringify(value)})`);
  } else if (config[name] !== value) {
    problems.push(`  ${name} would change: ${JSON.stringify(value)} → ${JSON.stringify(config[name])}`);
  }
}

const added = Object.keys(config).filter((k) => !(k in live.vars));

console.log(`Live version ${live.versionId}: ${Object.keys(live.vars).length} vars, ${live.secrets.length} secrets (secrets are untouched by a deploy).`);
if (added.length) console.log(`New vars in this deploy: ${added.join(', ')}`);

if (!problems.length) {
  console.log('✓ no live var would be dropped or silently changed.');
  process.exit(0);
}

console.error('\n✘ this deploy would overwrite vars that are not in wrangler.toml:\n');
console.error(problems.join('\n'));
console.error('\nAdd them to [vars] in wrangler.toml (or intentionally change them there), then deploy again.');
process.exit(1);
