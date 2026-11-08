#!/usr/bin/env node
// Every literal key passed to t()/i18n() in src/ must exist in the English
// catalog — a missing one shows up in the UI as the bare key.
// Keys built at runtime (template strings) are not checked.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const en = (await import(pathToFileURL(join(ROOT, 'src/i18n/locales/en.js')).href)).default;

const has = (key) => {
  let cur = en;
  for (const part of key.split('.')) {
    if (!cur || typeof cur !== 'object' || !(part in cur)) return false;
    cur = cur[part];
  }
  return true;
};

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'i18n' && name !== 'node_modules') walk(p);
    } else if (name.endsWith('.js')) files.push(p);
  }
};
walk(join(ROOT, 'src'));

const missing = [];
const CALL = /\b(?:t|i18n|tt)\(\s*(['"])([a-zA-Z][\w-]*(?:\.[\w-]+)+)\1/g;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(CALL)) {
    if (!has(m[2])) missing.push(`${file.slice(ROOT.length + 1)}: ${m[2]}`);
  }
}

if (missing.length) {
  console.error(`✗ ${missing.length} i18n key(s) used in src/ but missing from en.js:`);
  for (const line of [...new Set(missing)]) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`✓ all literal i18n keys used in src/ exist (${files.length} files).`);
