#!/usr/bin/env node
// ============================================================
// YANTA — contrast check for the colour presets in src/settings.js
//
// Prints WCAG contrast ratios per preset and fails when one drops below
// the bar the presets were tuned to: body text 11:1, secondary text 5.5:1,
// faint text 3:1, accent 3:1 against the page, selected text 7:1 on its
// selection, and some readable text colour on the accent (4.5:1).
//
//   node scripts/theme-contrast.mjs          table + failures
//   node scripts/theme-contrast.mjs --quiet  failures only
//
// The default light scheme (Marshmallow Meadow) keeps its lighter olive
// accent on purpose; it is listed but not counted.
// ============================================================

import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/settings.js', import.meta.url), 'utf8');
const block = source.match(/export const COLOR_PRESETS = (\{[\s\S]*?\n\});\n/);

if (!block) {
  console.error('COLOR_PRESETS not found in src/settings.js');
  process.exit(2);
}

// The block is a plain object literal of strings.
const PRESETS = Function(`return (${block[1]});`)();
const EXEMPT = new Set(['marshmallow-meadow:accent']);
const quiet = process.argv.includes('--quiet');

function parse(color) {
  const rgba = String(color).match(/rgba?\(([^)]+)\)/);
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1].split(',').map(Number);
    return [r, g, b, a];
  }
  let hex = String(color).replace('#', '');
  if (hex.length === 3) hex = hex.replace(/./g, '$&$&');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1);
}

function luminance([r, g, b]) {
  return [r, g, b]
    .map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function over([r, g, b, a], base) {
  return [r, g, b].map((v, i) => Math.round(v * a + base[i] * (1 - a)));
}

const RULES = [
  ['text', (c) => ratio(c.text, c.bg), 11],
  ['dim', (c) => ratio(c['text-dim'], c.bg), 5.5],
  ['faint', (c) => ratio(c['text-faint'], c.bg), 3],
  ['accent', (c) => ratio(c.accent, c.bg), 3],
  ['selection', (c) => ratio(c['selection-text'], over(c.selection, c.bg)), 7],
  ['onAccent', (c) => Math.max(ratio([255, 255, 255], c.accent), ratio([17, 17, 17], c.accent)), 4.5],
];

let failures = 0;

for (const mode of ['light', 'dark']) {
  if (!quiet) console.log(`\n${mode.padEnd(24)}${RULES.map(([name]) => name.padStart(10)).join('')}`);

  for (const preset of PRESETS[mode]) {
    const c = Object.fromEntries(Object.entries(preset.colors).map(([k, v]) => [k, parse(v)]));
    const cells = [];
    const bad = [];

    for (const [name, measure, min] of RULES) {
      const value = measure(c);
      cells.push(value.toFixed(1).padStart(10));
      if (value < min && !EXEMPT.has(`${preset.id}:${name}`)) bad.push(`${name} ${value.toFixed(2)} < ${min}`);
    }

    if (!quiet) console.log(`${preset.name.padEnd(24)}${cells.join('')}`);
    if (bad.length) {
      failures += bad.length;
      console.log(`  ✗ ${mode}/${preset.id}: ${bad.join(', ')}`);
    }
  }
}

if (failures) process.exit(1);
if (!quiet) console.log('\n✓ all presets pass');
