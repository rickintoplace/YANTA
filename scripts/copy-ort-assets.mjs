// ============================================================
// Copy the onnxruntime-web WASM runtimes into public/ort/.
//
// Warum: ORT lädt seinen Loader (.mjs) sonst zur Laufzeit von
// cdn.jsdelivr.net — die Produktions-CSP blockt das (zu Recht:
// YANTA ist self-contained). Alle Varianten werden kopiert, der
// Browser lädt genau eine (asyncify für WASM, jsep für WebGPU).
// public/ort/ ist gitignored; dieser Skript läuft via predev/
// prebuild, auch auf Vercel.
// ============================================================

import {
  existsSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
} from 'node:fs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const ortDist = path.join(projectRoot, 'node_modules', 'onnxruntime-web', 'dist');
const target = path.join(projectRoot, 'public', 'ort');

if (!existsSync(ortDist)) {
  console.warn('[copy-ort-assets] onnxruntime-web not installed — skipping');
  process.exit(0);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

const files = readdirSync(ortDist)
  .filter((f) => f.startsWith('ort-wasm-simd-threaded.') && (f.endsWith('.mjs') || f.endsWith('.wasm')));

for (const f of files) {
  copyFileSync(path.join(ortDist, f), path.join(target, f));
}

console.log(`[copy-ort-assets] copied ${files.length} files to public/ort/`);
