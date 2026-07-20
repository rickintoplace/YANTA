#!/usr/bin/env node
// ============================================================
// CSP inline-script hash guard.
//
// vercel.json pins a `script-src` allowlist of sha256 hashes, one per inline
// <script> in the built index.html. Editing or adding an inline script changes
// its hash — and a stale allowlist silently CSP-blocks the boot scripts in
// production (infinite loader). This script recomputes the hashes from the
// built HTML and checks them against vercel.json.
//
//   node scripts/csp-hashes.mjs          # check; exit 1 if any are missing
//   node scripts/csp-hashes.mjs --print  # just print the current hashes
//
// Run after `npm run build`. Paste any missing hash into the script-src list
// in vercel.json.
// ============================================================

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(root, 'dist', 'index.html');
const vercelPath = join(root, 'vercel.json');

let html;
try {
  html = readFileSync(htmlPath, 'utf8');
} catch {
  console.error(`✗ ${htmlPath} not found — run "npm run build" first.`);
  process.exit(1);
}

// Inline scripts only (those without a src=). Hash the exact bytes between the
// tags — that is what the browser hashes for CSP.
const hashes = [];
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html)) !== null) {
  const body = m[1];
  const digest = createHash('sha256').update(body, 'utf8').digest('base64');
  hashes.push(`sha256-${digest}`);
}

const printMode = process.argv.includes('--print');

if (printMode) {
  console.log(`Inline scripts in dist/index.html: ${hashes.length}`);
  for (const h of hashes) console.log(`  '${h}'`);
  process.exit(0);
}

const vercel = readFileSync(vercelPath, 'utf8');
const missing = [...new Set(hashes)].filter((h) => !vercel.includes(h));

if (missing.length) {
  console.error(`✗ vercel.json script-src is missing ${missing.length} inline-script hash(es):\n`);
  for (const h of missing) console.error(`    '${h}'`);
  console.error('\nAdd them to the Content-Security-Policy script-src in vercel.json.');
  process.exit(1);
}

console.log(`✓ vercel.json covers all ${hashes.length} inline script(s).`);
