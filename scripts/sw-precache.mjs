#!/usr/bin/env node
/*
  Injects the boot-critical asset list into dist/sw.js.

  Why this exists: the service worker cannot precache hashed filenames it does
  not know, and index.html only names two of them (the entry chunk and its
  CSS) — main.js hangs behind a dynamic import from src/entry.js and would be
  missing offline. Runtime caching does fill the gap eventually, but only on a
  page load under the new worker, which is exactly the round trip a user who
  updates and then goes offline never makes.

  So: walk Vite's manifest from the boot roots along STATIC imports only,
  collect their files and CSS, and write the result into the worker. Dynamic
  imports (Excalidraw, the semantic worker, chat) stay out on purpose — they
  are large, rarely all needed, and runtime caching handles them.
*/
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const manifestPath = join(distDir, '.vite', 'manifest.json');
const swPath = join(distDir, 'sw.js');
const MARKER = '/* __YANTA_PRECACHE__ */';

if (!existsSync(manifestPath)) {
  console.error('✗ sw-precache: dist/.vite/manifest.json missing (is build.manifest enabled?)');
  process.exit(1);
}

if (!existsSync(swPath)) {
  console.error('✗ sw-precache: dist/sw.js missing');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

/*
  Roots:
   - index.html, the Vite entry (src/entry.js is bundled into it)
   - the entry's own dynamic imports, which by construction are just the app
     module: src/entry.js exists solely to import ./main.js conditionally
   - every locale catalogue; each is ~17 KB and which one a visitor needs is
     only known at runtime, so all of them ship
*/
const entry = manifest['index.html'];

if (!entry) {
  console.error('✗ sw-precache: no index.html entry in the manifest — did the entry move?');
  process.exit(1);
}

const roots = [
  'index.html',
  ...(entry.dynamicImports || []),
  ...Object.keys(manifest).filter((key) => /^src\/i18n\/locales\/[^/]+\.js$/.test(key)),
];

const files = new Set();
const seen = new Set();

const walk = (key) => {
  if (seen.has(key)) return;
  seen.add(key);

  const chunk = manifest[key];
  if (!chunk) return;

  if (chunk.file) files.add(`/${chunk.file}`);
  for (const css of chunk.css || []) files.add(`/${css}`);

  // Static imports only — dynamicImports are intentionally not followed.
  for (const imported of chunk.imports || []) walk(imported);
};

roots.forEach(walk);

const list = [...files].sort();

const bytes = list.reduce((total, file) => {
  const path = join(distDir, file.replace(/^\//, ''));
  return total + (existsSync(path) ? readFileSync(path).length : 0);
}, 0);

const sw = readFileSync(swPath, 'utf8');

if (!sw.includes(MARKER)) {
  console.error(`✗ sw-precache: marker ${MARKER} not found in dist/sw.js`);
  process.exit(1);
}

writeFileSync(
  swPath,
  sw.replace(MARKER, list.map((file) => `\n  ${JSON.stringify(file)},`).join('') + '\n')
);

console.log(
  `✓ sw-precache: ${list.length} boot assets (${(bytes / 1024 / 1024).toFixed(2)} MB uncompressed) injected into dist/sw.js`
);
