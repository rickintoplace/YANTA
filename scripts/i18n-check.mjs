#!/usr/bin/env node
// ============================================================
// i18n catalog parity check.
//
// English (src/i18n/locales/en.js) is the source of truth. Every other locale
// must define exactly the same keys — no missing keys (untranslated UI) and no
// extra keys (dead translations). Plural leaves are handled per-language:
// their CLDR categories legitimately differ, so we only require `other`.
//
// Run: node scripts/i18n-check.mjs   (exits non-zero on any drift)
// ============================================================

import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales');
const REFERENCE = 'en';
const CLDR = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

const isPluralLeaf = (o) =>
  o && typeof o === 'object' && !Array.isArray(o) &&
  Object.keys(o).length > 0 && Object.keys(o).every((k) => CLDR.has(k));

// Flatten to Map<path, { kind: 'string'|'plural', cats? }>.
function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (isPluralLeaf(v)) out.set(path, { kind: 'plural', cats: Object.keys(v) });
      else flatten(v, path, out);
    } else {
      out.set(path, { kind: 'string' });
    }
  }
  return out;
}

async function load(code) {
  const mod = await import(pathToFileURL(join(LOCALES_DIR, `${code}.js`)).href);
  return mod.default || {};
}

const codes = readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.js'))
  .map((f) => f.replace(/\.js$/, ''));

if (!codes.includes(REFERENCE)) {
  console.error(`✗ reference locale ${REFERENCE}.js is missing`);
  process.exit(1);
}

const ref = flatten(await load(REFERENCE));
let problems = 0;

const report = (code, msg) => {
  problems++;
  console.error(`✗ [${code}] ${msg}`);
};

for (const code of codes) {
  if (code === REFERENCE) {
    // The reference itself must give every plural an `other`.
    for (const [key, meta] of ref) {
      if (meta.kind === 'plural' && !meta.cats.includes('other')) {
        report(code, `plural "${key}" is missing the required "other" category`);
      }
    }
    continue;
  }

  const loc = flatten(await load(code));

  for (const [key, meta] of ref) {
    const there = loc.get(key);
    if (!there) {
      report(code, `missing key "${key}"`);
    } else if (there.kind !== meta.kind) {
      report(code, `key "${key}" is ${there.kind} but ${REFERENCE} has it as ${meta.kind}`);
    } else if (there.kind === 'plural' && !there.cats.includes('other')) {
      report(code, `plural "${key}" is missing the required "other" category`);
    }
  }

  for (const key of loc.keys()) {
    if (!ref.has(key)) report(code, `extra key "${key}" not present in ${REFERENCE}`);
  }
}

if (problems) {
  console.error(`\ni18n check failed with ${problems} problem(s).`);
  process.exit(1);
}

console.log(`✓ i18n catalogs are in sync (${codes.length} locales, ${ref.size} keys).`);
