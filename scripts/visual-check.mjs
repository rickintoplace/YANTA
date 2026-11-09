#!/usr/bin/env node
// ============================================================
// Visual check: screenshots of the main surfaces, compared pixel by
// pixel with the last accepted set. Deterministic on purpose — no
// model judges anything: same data, same clock, same random numbers,
// no network, no animations; then pixelmatch.
//
//   npm run visual            compare with .visual/baseline (exit 1 on change)
//   npm run visual -- --update   accept the current screenshots as baseline
//   npm run visual -- --only calendar   just the scenes matching a pattern
//
// Run it before a release, look at .visual/report/index.html for what
// changed, and --update once the changes are the intended ones.
//
// Needs Chromium (CHROMIUM_PATH, default /usr/bin/chromium). Starts its
// own Vite dev server unless VISUAL_BASE_URL points at one; the scenes
// seed data through the app's modules, so it has to be a dev server.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import pixelmatch from 'pixelmatch';
import pngjs from 'pngjs';

const { PNG } = pngjs;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.visual');
const BASE = path.join(OUT, 'baseline');
const CUR = path.join(OUT, 'current');
const DIFF = path.join(OUT, 'diff');

const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const ONLY = args.includes('--only') ? new RegExp(args[args.indexOf('--only') + 1], 'i') : null;
const LANG = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'de';
// Share of pixels that may differ before a scene counts as changed
// (anti-aliasing noise stays well below it).
const TOLERANCE = 0.0005;

const NOW = '2026-11-07T10:00:00+01:00';
const LOCALES = { de: 'de-DE', en: 'en-US', es: 'es-ES', fr: 'fr-FR', ja: 'ja-JP' };

const VIEWPORTS = {
  desk: { viewport: { width: 1366, height: 860 } },
  phone: { viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
};

// ---------------- the app's data for every run ------------------------

async function seed(page) {
  return page.evaluate(async () => {
    const cal = await import('/src/calendar.js');
    const at = (days, h, m = 0) => { const x = new Date(); x.setDate(x.getDate() + days); x.setHours(h, m, 0, 0); return x.toISOString(); };
    const day = (k) => new Date(`${k}T00:00:00`).toISOString();
    cal.putCalendarEvent({ title: 'Team-Meeting', start: at(0, 14), end: at(0, 15), location: 'Raum 2' });
    cal.putCalendarEvent({ title: 'Zahnarzt', start: at(1, 10), end: at(1, 11) });
    cal.putCalendarEvent({ title: 'Elternabend', start: at(5, 19), end: at(5, 21) });
    cal.putCalendarEvent({ title: 'Wochenende am See', start: day('2026-11-20'), end: day('2026-11-22'), allDay: true });
    const cyc = cal.putCalendarCategory({ name: 'Zyklus', color: '#d6336c', visible: true, cycle: {} });
    for (const [s, e] of [['2026-08-20', '2026-08-24'], ['2026-09-17', '2026-09-21'], ['2026-10-15', '2026-10-19']]) {
      cal.putCalendarEvent({ title: 'Periode', start: day(s), end: day(e), allDay: true, categoryId: cyc.id, cycle: { kind: 'period' }, reminders: [] });
    }
    return { cycle: cyc.id };
  });
}

// ---------------- scenes ----------------------------------------------
//
// Each one starts from a freshly loaded app (seeded data persists in
// IndexedDB), so a scene never depends on what the previous one left.

const SCENES = [
  { name: 'dashboard', run: async () => {} },
  { name: 'calendar-month', run: async (page) => {
    await page.evaluate(async () => (await import('/src/calendar.js')).openCalendar({ push: true }));
  } },
  { name: 'calendar-week', run: async (page) => {
    await page.evaluate(async () => (await import('/src/calendar.js')).openCalendar({ push: true }));
    await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector('[data-cal-view-btn="timeGridWeek"]')?.click());
  } },
  { name: 'event-editor', run: async (page) => {
    await page.evaluate(async () => {
      const cal = await import('/src/calendar.js');
      await cal.openCalendar({ push: true });
      cal.openNewCalendarEvent({});
    });
  } },
  { name: 'cycle-panel', run: async (page, data) => {
    await page.evaluate(async (id) => {
      const cal = await import('/src/calendar.js');
      await cal.openCalendar({ push: true });
      await cal.openCyclePanel(id);
    }, data.cycle);
  } },
  { name: 'settings', run: async (page) => {
    await page.evaluate(async () => (await import('/src/settings.js')).openSettings());
  } },
  { name: 'assistant', run: async (page) => {
    await page.evaluate(async () => (await import('/src/ai/assistant-ui.js')).openAssistant());
  } },
  // Last: opening a note opens its folder in the sidebar, and that is
  // remembered — it would differ between runs for every scene after it.
  { name: 'note', run: async (page) => {
    await page.evaluate(async () => (await import('/src/notes.js')).createWelcomeNote({ open: true }));
  } },
];

// ---------------- running ---------------------------------------------

const FREEZE_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important; animation-delay: 0s !important;
  transition-duration: 0s !important; transition-delay: 0s !important;
  caret-color: transparent !important;
}
::-webkit-scrollbar { display: none !important; }
`;

async function startVite() {
  if (process.env.VISUAL_BASE_URL) return { url: process.env.VISUAL_BASE_URL, stop() {} };
  const port = 5199;
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), ROOT, '--port', String(port), '--strictPort'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${url}/?app`)).ok) return { url, stop: () => child.kill() }; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error('Vite did not start');
}

async function shoot(browser, url, vpName, theme) {
  const shots = [];
  const ctx = await browser.newContext({
    ...VIEWPORTS[vpName],
    locale: LOCALES[LANG] || LANG,
    timezoneId: 'Europe/Berlin',
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  // No network beyond the dev server: nothing remote can change a picture.
  await ctx.route('**/*', (route) => (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(route.request().url()) ? route.continue() : route.abort()));
  await ctx.addInitScript(({ lang, theme }) => {
    localStorage.setItem('yanta.lang', lang);
    // Same random numbers every run (greetings, ids that show up as order).
    let a = 0x9e3779b9;
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    window.__visualTheme = theme;
  }, { lang: LANG, theme });

  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  page.on('pageerror', (e) => console.log(`  [${vpName}/${theme}] page error: ${e.message}`));
  // Leaving a page with unsaved edits asks first; a dismissed question
  // would cancel the reload between scenes.
  page.on('dialog', (d) => (d.type() === 'beforeunload' ? d.accept() : d.dismiss()));

  const boot = async () => {
    await page.goto(`${url}/?app`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('.dashboard:not([hidden]), #noteTitle'), null, { timeout: 30000 }).catch(() => {});
    await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), theme);
    await page.addStyleTag({ content: FREEZE_CSS });
    await page.waitForTimeout(2500);
  };

  await boot();
  // A fresh vault gets its welcome notes a few seconds after the first
  // start; wait for them, or some runs picture the start page before and
  // others after.
  await page.waitForFunction(() => /\bWelcome\b/.test(document.querySelector('#tree')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const data = await seed(page);
  // Writes reach IndexedDB a little after put*() returns; a reload before
  // that would drop an event from some runs and not others.
  await page.waitForTimeout(2500);
  await boot();
  const stored = await page.evaluate(async () => (await import('/src/calendar.js'))
    .expandedCalendarRawEventsForRange(new Date('2026-08-01'), new Date('2027-01-01'), { includeSources: false, includeMarkdownDerived: false }).length);
  if (stored < 7) throw new Error(`seed incomplete: ${stored} of 7 calendar events after reload`);

  for (const scene of SCENES) {
    const id = `${scene.name}--${vpName}-${theme}`;
    if (ONLY && !ONLY.test(id)) continue;
    const file = path.join(CUR, `${id}.png`);
    const attempt = async () => {
      await boot();
      await scene.run(page, data);
      await page.waitForTimeout(1500);
      // Things that differ between runs for reasons that are not the UI.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('body *')) {
          if (el.children.length === 0 && /^\s*\d+(?:[.,]\d+)?\s*(?:B|KB|MB|GB)\s*$/.test(el.textContent || '')) el.setAttribute('data-visual-mask', '');
        }
      });
      await page.screenshot({ path: file, mask: [page.locator('[data-visual-mask]')], animations: 'disabled' });
    };
    // A reload under way (Vite optimizing a dependency, a file saved
    // during the run) destroys the page's context: start the scene over.
    for (let tries = 1; ; tries++) {
      try {
        await attempt();
        break;
      } catch (err) {
        if (tries >= 3 || !/context was destroyed|navigation|Target closed/i.test(err.message)) throw err;
      }
    }
    shots.push(id);
    process.stdout.write('.');
  }

  await ctx.close();
  return shots;
}

function compare(id) {
  const basePath = path.join(BASE, `${id}.png`);
  const curPath = path.join(CUR, `${id}.png`);
  if (!fs.existsSync(basePath)) return { id, status: 'new' };
  const a = PNG.sync.read(fs.readFileSync(basePath));
  const b = PNG.sync.read(fs.readFileSync(curPath));
  if (a.width !== b.width || a.height !== b.height) return { id, status: 'changed', ratio: 1, note: 'size differs' };
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.2 });
  const ratio = n / (a.width * a.height);
  if (ratio <= TOLERANCE) return { id, status: 'same', ratio };
  fs.writeFileSync(path.join(DIFF, `${id}.png`), PNG.sync.write(diff));
  return { id, status: 'changed', ratio };
}

function report(results) {
  const rows = results.map((r) => `
    <section class="${r.status}">
      <h2>${r.id} <small>${r.status}${r.ratio != null ? ` · ${(r.ratio * 100).toFixed(2)} %` : ''}${r.note ? ` · ${r.note}` : ''}</small></h2>
      <div class="imgs">
        ${r.status === 'new' ? '' : `<figure><img src="../baseline/${r.id}.png"><figcaption>before</figcaption></figure>`}
        <figure><img src="../current/${r.id}.png"><figcaption>now</figcaption></figure>
        ${r.status === 'changed' && !r.note ? `<figure><img src="../diff/${r.id}.png"><figcaption>difference</figcaption></figure>` : ''}
      </div>
    </section>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><title>Visual check</title>
<style>body{font:14px system-ui;margin:24px;background:#f6f6f4;color:#222}h2{font-size:15px;margin:28px 0 8px}small{color:#777;font-weight:400}
.imgs{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}figure{margin:0}img{max-width:440px;border:1px solid #ddd;background:#fff}
section.same{display:none}body.all section.same{display:block}figcaption{font-size:12px;color:#777}</style>
<p>${results.filter((r) => r.status === 'changed').length} changed · ${results.filter((r) => r.status === 'new').length} new · ${results.filter((r) => r.status === 'same').length} unchanged
<label><input type="checkbox" onchange="document.body.classList.toggle('all',this.checked)"> show unchanged</label></p>${rows}`;
  fs.mkdirSync(path.join(OUT, 'report'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report', 'index.html'), html);
}

// ---------------- main ------------------------------------------------

fs.rmSync(CUR, { recursive: true, force: true });
fs.rmSync(DIFF, { recursive: true, force: true });
for (const dir of [BASE, CUR, DIFF]) fs.mkdirSync(dir, { recursive: true });

const vite = await startVite();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--font-render-hinting=none'] });
let ids = [];
try {
  for (const vp of Object.keys(VIEWPORTS)) {
    for (const theme of ['light', 'dark']) {
      ids = ids.concat(await shoot(browser, vite.url, vp, theme));
    }
  }
} finally {
  await browser.close();
  vite.stop();
}
process.stdout.write('\n');

if (UPDATE) {
  for (const id of ids) fs.copyFileSync(path.join(CUR, `${id}.png`), path.join(BASE, `${id}.png`));
  console.log(`Baseline updated: ${ids.length} screenshots in ${path.relative(ROOT, BASE)}/`);
  process.exit(0);
}

const results = ids.map(compare);
report(results);
const changed = results.filter((r) => r.status === 'changed');
const fresh = results.filter((r) => r.status === 'new');
for (const r of changed) console.log(`changed  ${r.id}  ${(r.ratio * 100).toFixed(2)} %${r.note ? ` (${r.note})` : ''}`);
for (const r of fresh) console.log(`new      ${r.id}`);
console.log(`${changed.length} changed, ${fresh.length} new, ${results.length - changed.length - fresh.length} unchanged — ${path.relative(ROOT, path.join(OUT, 'report', 'index.html'))}`);
process.exit(changed.length ? 1 : 0);
