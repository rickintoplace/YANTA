import {
  decryptSharePayload,
  parseShareKeyFromLocationHash,
  unwrapAssetKeyForShare,
} from './public-share-crypto.js';

import {
  getPublicShare,
  getPublicShareAssetBytes,
} from './public-share-api.js';

import {
  decryptAssetBlobWithRawKey,
} from '../sync2/assets.js';

import {
  renderPreviewWithContext,
} from '../markdown.js';

import {
  openDB,
  store,
  uid,
  escapeHtml,
  escapeAttr,
  lucide,
  safeCssColor,
} from '../core.js';

import {
  getNoteDoc,
  setDrawing,
  setCitation,
} from '../yjs.js';

import {
  yantaAlert,
} from '../dialogs.js';

import {
  setupPublicShareAppearance,
  togglePublicShareAppearance,
  updatePublicShareThemeButtons,
  sharePublicPage,
  renderPublicShareCalendarSectionHtml,
  bindPublicShareCalendarActions,
  bindThemeToggleEvents,
} from './public-share-viewer-enhancements.js';


let currentPayload = null;
let currentImageResolver = null;
let currentShareState = null;
let menuEl = null;

function shareIdFromPath(pathname = location.pathname) {
  const m = String(pathname || '').match(/^\/share\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function brandLogoSvg() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="478 462.5 272 272" style="fill: var(--text);">
      <path d="M489.3 496.7c-6.2.2-11.3.7-11.3 1.1 0 1.8 7.4 17.2 32.3 67.3l26.8 53.9-1.7 3.2c-.9 1.8-5.9 10.6-11 19.5l-9.4 16.2 10.2 20.6c5.7 11.3 10.7 20.5 11.3 20.5.5 0 2.3-2.4 3.9-5.3 1.7-2.8 22.5-38.5 46.5-79.2 23.9-40.7 43.4-74.8 43.3-75.7-.1-2.7-19.6-41.3-20.7-41.2-.5.1-9.5 14.9-20.1 33-10.5 18-19.6 33-20.2 33.2s-8.6-14.9-17.9-33.5l-16.8-33.8h-17c-9.3-.1-22.1.1-28.2.2"></path>
      <path d="M623 497.5c0 .2 4.3 9.3 9.5 20.1 5.2 10.9 9.5 20.3 9.5 21 0 1.7-14.2 26.5-58.3 101.9-19 32.4-34.3 59.4-34 59.9.8 1.2 29.6-.1 34.5-1.6 5.9-1.8 10.3-7.3 24.2-31l13.1-22.3 4.5-.7c2.5-.3 15-.7 27.8-.7 17.9-.1 23.2-.4 23.2-1.4 0-.6-2.8-6.8-6.3-13.7l-6.2-12.5-12.2-.3c-6.8-.1-12.3-.7-12.3-1.1 0-1 16.6-30 17.9-31.4 1.2-1.2 2.4.8 8.4 13.8 3 6.6 10.3 22.3 16.2 35 5.9 12.6 13.5 29.5 17 37.5 9.9 22.7 12.2 27.5 13.9 28.9 1.2 1 5.5 1.1 19.1.6 9.6-.4 17.5-.9 17.5-1.2 0-.2-3.3-7.6-7.4-16.6-12.2-26.8-44.8-98.8-54.2-119.7-4.8-10.7-13.3-29.6-18.9-42l-10.2-22.5-18.1-.3c-10-.1-18.2 0-18.2.3"></path>
      <path d="M629.8 654.7c-1.5 1.8-9.8 16.1-9.8 16.9 0 .2 16 .4 35.5.4 24.5 0 35.5-.3 35.5-1.1 0-1.8-7-16.3-8.3-17.1-.7-.4-12.5-.8-26.3-.8-22.7 0-25.2.2-26.6 1.7"></path>
    </svg>
  `;
}

function addPublicSharePageClasses() {
  document.documentElement.classList.add('yanta-public-share-page');
  document.body.classList.add('yanta-public-share-page');
}

function readPublicTheme() {
  return document.documentElement.dataset.theme || 'dark';
}

function applyPublicTheme() {
  return document.documentElement.dataset.theme || 'dark';
}

async function togglePublicTheme() {
  await togglePublicShareAppearance();
}

function applyPublicAccent(color) {
  const safe = safeCssColor(color) || '#6ea8fe';

  document.documentElement.style.setProperty('--note-color', safe);
  document.documentElement.style.setProperty('--accent', safe);

  const metaTheme = document.querySelector('meta[name="theme-color"]');

  if (metaTheme) {
    metaTheme.setAttribute(
      'content',
      document.documentElement.dataset.publicShareTheme === 'light'
        ? '#fdfcfa'
        : '#141414'
    );
  }

  return safe;
}

function updateThemeButtons() {
  updatePublicShareThemeButtons(document);
}

function injectCss() {
  if (document.getElementById('yanta-public-viewer-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-public-viewer-css';

  style.textContent = `
/* ============================================================
   Public Share App Shell
   Mirrors normal YANTA app behavior:
   - body stays non-scrollable
   - shell owns scrolling
   ============================================================ */

html.yanta-public-share-page,
body.yanta-public-share-page {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden !important;

  color: var(--text);
  background: var(--bg);

  font-family: var(--font);
}

html.yanta-public-share-page {
  color-scheme: dark;

  --bg: #141414;
  --bg-elev: #1c1c1c;
  --bg-elev-2: #242424;
  --bg-elev-3: #2e2e2e;
  --border: #333333;
  --border-strong: #454545;
  --text: #e8e6e3;
  --text-dim: #9a9794;
  --text-faint: #6b6864;
  --accent: var(--note-color, #6ea8fe);
  --accent-2: #a78bfa;
  --green: #4ade80;
  --yellow: #fbbf24;
  --red: #f87171;
  --selection: rgba(148, 163, 184, 0.30);
  --selection-text: #f8fafc;

  --font:
    -apple-system,
    BlinkMacSystemFont,
    "Inter",
    "Segoe UI",
    Roboto,
    Helvetica,
    Arial,
    sans-serif;

  --font-mono:
    ui-monospace,
    SFMono-Regular,
    "Cascadia Code",
    Menlo,
    Consolas,
    monospace;

  --fs-base: 15px;
  --lh-base: 1.7;
}

html.yanta-public-share-page[data-public-share-theme="light"] {
  color-scheme: light;

  --bg: #fdfcfa;
  --bg-elev: #f5f4f1;
  --bg-elev-2: #ecebe7;
  --bg-elev-3: #e2e0dc;
  --border: #d6d4ce;
  --border-strong: #b5b2ab;
  --text: #1f1e1c;
  --text-dim: #5a5854;
  --text-faint: #8a8884;
  --accent-2: #7c3aed;
  --green: #16a34a;
  --yellow: #d97706;
  --red: #dc2626;
  --selection: rgba(31, 30, 28, 0.14);
  --selection-text: #111827;
}

.yps-shell {
  position: fixed;
  inset: 0;

  display: flex;
  flex-direction: column;

  min-width: 0;
  min-height: 0;

  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;

  color: var(--text);
  background: var(--bg);
}

.yps-top {
  position: sticky;
  top: 0;
  z-index: 20;

  min-height: 54px;

  display: flex;
  align-items: center;
  gap: 10px;

  padding:
    max(2px, env(safe-area-inset-top))
    max(12px, env(safe-area-inset-right))
    2px
    max(2px, env(safe-area-inset-left));

  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elev) 94%, transparent);

  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.yps-brand-link {
  display: inline-flex;
  align-items: center;

  min-width: 0;

  color: var(--text);
  text-decoration: none;
}

.yps-brand-title {
  min-width: 0;

  display: flex;
  align-items: baseline;
  gap: 7px;

  white-space: nowrap;
}

.yps-brand-title strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 850;
  letter-spacing: -0.015em;
}

.yps-brand-title span {
  color: var(--text-faint);
  font-size: 12px;
  font-weight: 650;
}

.yps-top-spacer {
  flex: 1;
}

.yps-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.yps-btn,
.yps-icon-btn,
.yps-menu button {
  font-family: var(--font);
}

.yps-btn {
  min-height: 34px;
  padding: 0 11px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;

  border: 1px solid var(--border);
  border-radius: 9px;

  background: var(--bg-elev-2);
  color: var(--text);

  text-decoration: none;

  font-size: 12px;
  font-weight: 750;

  cursor: pointer;
}

.yps-btn:hover {
  border-color: var(--border-strong);
  background: var(--bg-elev-3);
}

.yps-btn.primary {
  color: white;
  background: var(--accent);
  border-color: var(--accent);
}

.yps-btn.accent {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
  background: color-mix(in srgb, var(--accent) 9%, transparent);
}

.yps-icon-btn {
  width: 34px;
  height: 34px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border: 1px solid var(--border);
  border-radius: 9px;

  background: var(--bg-elev-2);
  color: var(--text-dim);

  cursor: pointer;
}

.yps-icon-btn:hover {
  color: var(--text);
  border-color: var(--border-strong);
  background: var(--bg-elev-3);
}

.yps-menu {
  position: fixed;
  right: max(10px, env(safe-area-inset-right));
  top: calc(max(8px, env(safe-area-inset-top)) + 48px);
  z-index: 50;

  min-width: 220px;
  padding: 5px;

  border: 1px solid var(--border);
  border-radius: 11px;

  background: var(--bg-elev-3);
  color: var(--text);

  box-shadow: 0 16px 48px rgba(0,0,0,0.28);
}

.yps-menu[hidden] {
  display: none !important;
}

.yps-menu button,
.yps-menu a {
  width: 100%;
  min-height: 35px;

  display: flex;
  align-items: center;
  gap: 8px;

  padding: 7px 9px;

  border: 0;
  border-radius: 8px;

  background: transparent;
  color: var(--text);

  text-align: left;
  text-decoration: none;
  font-size: 13px;

  cursor: pointer;
}

.yps-menu button:hover,
.yps-menu a:hover {
  background: var(--bg-elev-2);
}

.yps-menu hr {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 5px 4px;
}

.yps-main {
  width: min(760px, calc(100vw - 28px));
  margin: 0 auto;
  padding: clamp(28px, 5vw, 48px) 0 84px;
}

/* ============================================================
   Note heading: app-like, not card-like
   ============================================================ */

.yps-note-head {
  margin-bottom: 26px;
}

.yps-title-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 13px;
}

.yps-note-icon {
  width: 44px;
  height: 44px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--border));
}

.yps-title-row h1 {
  margin: 0;

  min-width: 0;

  color: var(--text);

  font-size: clamp(15px, 5vw, 42px)
  line-height: 1.06;
  letter-spacing: -0.045em;
}

.yps-subline {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;

  margin-top: 12px;
  margin-left: 57px;
}

.yps-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;

  min-height: 23px;
  padding: 2px 8px;

  border: 1px solid var(--border);
  border-radius: 999px;

  color: var(--text-dim);
  background: var(--bg-elev-2);

  font-size: 11px;
  font-weight: 700;
}

.yps-pill.accent {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 9%, transparent);
  border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
}

/* ============================================================
   Preview: intentionally reuse normal YANTA classes.
   This only adapts container sizing.
   ============================================================ */

.yps-content.preview {
  max-width: none;
  margin: 0;

  color: var(--text);

  font-size: var(--fs-base);
  line-height: var(--lh-base);
}

.yps-content.preview .pv-line {
  min-height: 1.25em;
}

.yps-content.preview h1,
.yps-content.preview h2,
.yps-content.preview h3,
.yps-content.preview h4 {
  color: var(--text);
}

.yps-content.preview a {
  color: var(--accent);
}

.yps-content.preview .task input {
  accent-color: var(--accent);
}

/* Compact Public Drawing Embed */
.yps-public-draw {
  margin: 12px 0;

  border: 1px solid var(--border);
  border-radius: 12px;

  overflow: hidden;

  background: var(--bg-elev);
  box-shadow: 0 1px 0 rgba(255,255,255,0.02) inset;
}

.yps-public-draw-head {
  min-height: 38px;
  padding: 6px 8px 6px 10px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-bottom: 1px solid var(--border);
  background: var(--bg-elev-2);
}

.yps-public-draw-icon {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.yps-public-draw-title {
  min-width: 0;
  flex: 1;

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  color: var(--text);
  font-size: 13px;
  font-weight: 700;
}

.yps-public-draw-meta {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-size: 11px;
}

.yps-public-draw-body {
  min-height: 180px;
  padding: 10px;

  overflow: auto;
  background: var(--bg);
}

.yps-public-draw-body svg {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
  border-radius: 8px;
}

.yps-public-draw-loading,
.yps-public-draw-error {
  min-height: 180px;

  display: flex;
  align-items: center;
  justify-content: center;

  color: var(--text-faint);
  font-size: 13px;
  font-style: italic;
}

.yps-footer {
  margin-top: 34px;
  padding-top: 14px;

  border-top: 1px solid var(--border);

  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.45;
}

.yps-footer a {
  color: var(--accent);
}

.yps-state-wrap {
  position: fixed;
  inset: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  overflow: auto;
  padding: 18px;

  background: var(--bg);
}

.yps-state {
  max-width: 520px;

  padding: 24px;

  border: 1px solid var(--border);
  border-radius: 14px;

  background: var(--bg-elev);
  text-align: center;
}

.yps-state h1 {
  margin: 0 0 8px;
}

.yps-state p {
  color: var(--text-dim);
}

@media (max-width: 760px) {
  .yps-brand-title span {
    display: none;
  }

  .yps-header-actions .desktop-only {
    display: none !important;
  }

  .yps-main {
    width: min(760px, calc(100vw - 22px));
    padding-top: 24px;
  }

  .yps-title-row {
    gap: 10px;
  }

  .yps-note-icon {
    width: 38px;
    height: 38px;
  }

  .yps-subline {
    margin-left: 48px;
  }
}

@media (min-width: 761px) {
  .mobile-only {
    display: none !important;
  }
}
  `;

  document.head.append(style);
}

async function resolveImageUrlFactory(shareId, shareKey, assets) {
  const byLogicalId = new Map(assets.map((a) => [a.logicalId, a]));
  const cache = new Map();
  const blobCache = new Map();

  return {
    cache,
    blobCache,

    async load(logicalId) {
      if (cache.has(logicalId)) return cache.get(logicalId);

      const asset = byLogicalId.get(logicalId);
      if (!asset) return '';

      const encryptedBytes = await getPublicShareAssetBytes(shareId, asset.objectId);

      const assetKeyBytes = await unwrapAssetKeyForShare(
        shareKey,
        asset.logicalId,
        asset.encryptedAssetKeyForShare
      );

      const plain = await decryptAssetBlobWithRawKey(
        assetKeyBytes,
        encryptedBytes,
        asset.objectPath || ''
      );

      const blob = new Blob([plain], {
        type: asset.mime || 'application/octet-stream',
      });

      const url = URL.createObjectURL(blob);

      blobCache.set(logicalId, {
        blob,
        asset,
      });

      cache.set(logicalId, url);

      return url;
    },
  };
}

async function publicDrawingSvg(drawing) {
  const mod = await import('@excalidraw/excalidraw');

  if (typeof mod.exportToSvg !== 'function') {
    throw new Error('Excalidraw SVG export unavailable.');
  }

  const elements = Array.isArray(drawing.elements)
    ? drawing.elements.filter((el) => el && !el.isDeleted)
    : [];

  if (!elements.length) {
    return null;
  }

  const svg = await mod.exportToSvg({
    elements,
    appState: {
      ...(drawing.appState || {}),
      exportBackground: true,
      viewBackgroundColor:
        document.documentElement.dataset.publicShareTheme === 'light'
          ? '#ffffff'
          : '#121212',
    },
    files: drawing.files || {},
  });

  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');

  return svg;
}

async function hydratePublicDrawings(drawingsById) {
  const nodes = [...document.querySelectorAll('[data-public-draw-id]')];

  for (const node of nodes) {
    const id = node.dataset.publicDrawId || '';
    const drawing = drawingsById.get(id);

    const body = node.querySelector('[data-public-draw-body]');
    const meta = node.querySelector('[data-public-draw-meta]');

    if (!body) continue;

    if (!drawing) {
      body.innerHTML = `<div class="yps-public-draw-error">Drawing unavailable: ${escapeHtml(id)}</div>`;
      continue;
    }

    try {
      body.innerHTML = `<div class="yps-public-draw-loading">Rendering drawing…</div>`;

      const svg = await publicDrawingSvg(drawing);

      if (!svg) {
        body.innerHTML = `<div class="yps-public-draw-error">Empty drawing</div>`;
      } else {
        body.replaceChildren(svg);
      }

      if (meta) {
        const count = Array.isArray(drawing.elements)
          ? drawing.elements.filter((el) => el && !el.isDeleted).length
          : 0;

        meta.textContent = `${count} element${count === 1 ? '' : 's'}`;
      }
    } catch (err) {
      console.warn('[YANTA Public Share] drawing render failed', err);

      body.innerHTML = `
        <div class="yps-public-draw-error">
          Drawing preview unavailable
        </div>
      `;
    }
  }
}

function renderState(title, message) {
  document.body.innerHTML = `
    <div class="yps-state-wrap">
      <main class="yps-state">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
      </main>
    </div>
  `;
}

function imageIdsFromMarkdown(markdown = '') {
  return [...String(markdown || '').matchAll(/yanta-img:\/\/([a-z0-9_:-]+)/gi)]
    .map((m) => m[1])
    .filter(Boolean);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function savePublicShareAsLocalNote() {
  if (!currentPayload || !currentImageResolver) return;

  const noteData = currentPayload.note || {};
  const noteId = uid();
  const created = Date.now();

  await openDB();

  let markdown = String(noteData.markdown || '');

  /*
    Persist shared assets into this visitor's local YANTA library.
    We remap asset ids to avoid collisions with existing local assets.
  */
  const imageIds = [...new Set(imageIdsFromMarkdown(markdown))];

  for (const oldId of imageIds) {
    await currentImageResolver.load(oldId);

    const rec = currentImageResolver.blobCache.get(oldId);
    if (!rec?.blob) continue;

    const newId = uid();
    const meta = {
      id: newId,
      name: rec.asset?.logicalId || oldId,
      size: rec.blob.size,
      type: rec.blob.type || rec.asset?.mime || 'application/octet-stream',
      ts: created,
      updated: created,
    };

    await store.images.put({
      ...meta,
      blob: rec.blob,
    });

    markdown = markdown.replace(
      new RegExp(`yanta-img://${escapeRegExp(oldId)}`, 'g'),
      `yanta-img://${newId}`
    );
  }

  const note = {
    id: noteId,
    title: noteData.title || 'Shared note',
    type: 'markdown',
    folderId: null,
    tags: Array.isArray(noteData.tags) ? noteData.tags : [],
    pinned: false,
    icon: noteData.icon || 'file-text',
    color: noteData.color || undefined,
    created,
    updated: created,
  };

  await store.notes.put(note);

  const entry = getNoteDoc(noteId);
  await entry.ready;

  const ytext = entry.doc.getText('markdown');

  if (ytext.length === 0) {
    ytext.insert(0, markdown);
  }

  for (const drawing of currentPayload.drawings || []) {
    setDrawing(noteId, drawing.id || uid(), drawing, 'public-share-save');
  }

  for (const citation of currentPayload.citations || []) {
    const key = citation.key || citation.id || uid();

    setCitation(noteId, key, citation, 'public-share-save');
  }

  try {
    sessionStorage.setItem('yanta.publicShare.savedNoteId', noteId);
  } catch {}

  location.assign(`${location.origin}/#dashboard`);
}

async function shareCurrentPage() {
  const url = location.href;
  const title = currentPayload?.note?.title || 'YANTA Public Share';

  await sharePublicPage({
    url,
    title,
    text: title,
  });
}

async function showAboutYanta() {
  await yantaAlert({
    title: 'About YANTA',
    icon: 'sparkles',
    confirmLabel: 'Close',
    message: [
      'YANTA is a local-first workspace for practical notes, drawings, tasks, images, sources, calendar context and encrypted sync.',
      '',
      'This page is a public read-only share. The note was decrypted in your browser using the private key in the link fragment.',
      '',
      'You can save this note into your own local YANTA workspace with “Save as note”.'
    ].join('\n'),
  });
}

function closeMenu() {
  if (menuEl) {
    menuEl.hidden = true;
  }
}

function toggleMenu() {
  if (!menuEl) return;
  menuEl.hidden = !menuEl.hidden;
}

function renderMenu() {
  return `
    <div class="yps-menu" data-yps-menu hidden>
        <button type="button" data-yps-save-menu>${lucide('file-plus', 15)} Save as note</button>
        <button type="button" data-yps-share-menu>${lucide('share-2', 15)} Share</button>
        <button type="button" data-yps-theme-toggle>
            ${lucide('sun', 15)}
            <span data-yps-theme-label>Light mode</span>
        </button>
        <hr>
        <a href="${escapeAttr(location.origin)}">${lucide('external-link', 15)} Open your YANTA</a>
        <button type="button" data-yps-about>${lucide('info', 15)} About YANTA</button>
    </div>
  `;
}

function renderHeader() {
  return `
    <header class="yps-top">
      <a class="yps-brand-link" href="${escapeAttr(location.origin)}" title="Open YANTA">
        <span class="brand-mark">${brandLogoSvg()}</span>
        <span class="yps-brand-title">
          <strong>YANTA</strong>
          <span>Public Share</span>
        </span>
      </a>

      <span class="yps-top-spacer"></span>

      <div class="yps-header-actions">
        <button class="yps-btn accent desktop-only" type="button" data-yps-save>
          ${lucide('file-plus', 15)}
          <span>Save as note</span>
        </button>

        <button class="yps-btn desktop-only" type="button" data-yps-share>
          ${lucide('share-2', 15)}
          <span>Share</span>
        </button>

        <button class="yps-icon-btn" type="button" data-yps-theme-toggle>
          ${lucide('sun', 15)}
        </button>

        <button class="yps-icon-btn" type="button" data-yps-menu-button title="Menu">
          ${lucide('menu', 18)}
        </button>
      </div>
    </header>
  `;
}

function bindHeaderActions() {
  document.querySelector('[data-yps-save]')?.addEventListener('click', async () => {
    const btn = document.querySelector('[data-yps-save]');
    btn.disabled = true;
    btn.innerHTML = `${lucide('loader-circle', 15)} <span>Saving…</span>`;

    try {
      await savePublicShareAsLocalNote();
    } catch (err) {
      console.error(err);

      btn.disabled = false;
      btn.innerHTML = `${lucide('file-plus', 15)} <span>Save as note</span>`;

      await yantaAlert({
        title: 'Could not save note',
        message: err?.message || String(err),
        icon: 'triangle-alert',
      });
    }
  });

  document.querySelector('[data-yps-share]')?.addEventListener('click', shareCurrentPage);
  document.querySelector('[data-yps-menu-button]')?.addEventListener('click', toggleMenu);

  bindThemeToggleEvents(document);

  menuEl = document.querySelector('[data-yps-menu]');

  document.querySelector('[data-yps-save-menu]')?.addEventListener('click', async () => {
    closeMenu();
    await savePublicShareAsLocalNote();
  });

  document.querySelector('[data-yps-share-menu]')?.addEventListener('click', async () => {
    closeMenu();
    await shareCurrentPage();
  });

  document.querySelector('[data-yps-about]')?.addEventListener('click', async () => {
    closeMenu();
    await showAboutYanta();
  });

  document.addEventListener('pointerdown', (e) => {
    if (!menuEl || menuEl.hidden) return;

    if (menuEl.contains(e.target)) return;
    if (e.target.closest?.('[data-yps-menu-button]')) return;

    closeMenu();
  }, true);

  updateThemeButtons();
}

function renderPage(payload, imageResolver) {
  const note = payload.note || {};
  const color = applyPublicAccent(note.color || '#6ea8fe');

  const drawings = Array.isArray(payload.drawings) ? payload.drawings : [];
  const drawingsById = new Map(drawings.map((d) => [d.id, d]));

  const html = renderPreviewWithContext(note.markdown || '', {
    resolveImageUrl(url) {
      if (String(url || '').startsWith('yanta-img://')) {
        const id = String(url).slice('yanta-img://'.length);
        return imageResolver.cache.get(id) || '';
      }

      return url;
    },

    renderDrawEmbedHtml(id, label = 'Drawing') {
      const drawing = drawingsById.get(id);
      const title = drawing?.title || label || 'Drawing';

      return `
        <section class="yps-public-draw" data-public-draw-id="${escapeAttr(id)}" contenteditable="false">
          <div class="yps-public-draw-head">
            <span class="yps-public-draw-icon">${lucide('line-squiggle', 13)}</span>
            <span class="yps-public-draw-title">${escapeHtml(title)}</span>
            <span class="yps-public-draw-meta" data-public-draw-meta>Drawing</span>
          </div>

          <div class="yps-public-draw-body" data-public-draw-body>
            <div class="yps-public-draw-loading">Drawing loading…</div>
          </div>
        </section>
      `;
    },
  });

  const updated = note.updated
    ? new Date(note.updated).toLocaleString()
    : '';

  const tagHtml = Array.isArray(note.tags) && note.tags.length
    ? note.tags.slice(0, 8).map((tag) =>
        `<span class="yps-pill">#${escapeHtml(tag)}</span>`
      ).join('')
    : '';

  document.body.innerHTML = `
    <div class="yps-shell">
      ${renderHeader()}

      <main class="yps-main">
        <header class="yps-note-head" style="--note-color:${escapeHtml(color)}">
          <div class="yps-title-row">
            <div class="yps-note-icon">${lucide(note.icon || 'file-text', 23)}</div>
            <h1>${escapeHtml(note.title || 'Untitled')}</h1>
          </div>

          <div class="yps-subline">
            <span class="yps-pill accent">${lucide('share-2', 12)} Public read-only share</span>
            ${
              updated
                ? `<span class="yps-pill">${lucide('clock', 12)} Updated ${escapeHtml(updated)}</span>`
                : ''
            }
            ${tagHtml}
          </div>
        </header>

        <article class="yps-content preview">
          ${html}
        </article>

        ${renderPublicShareCalendarSectionHtml(payload)}

        <footer class="yps-footer">
          Shared through <a href="${escapeAttr(location.origin)}">YANTA</a>.
          The private decryption key stayed in the link fragment and was not sent to the server.
        </footer>
      </main>

      ${renderMenu()}
    </div>
  `;

  bindHeaderActions();
  bindPublicShareCalendarActions(document, payload);
}

export async function mountPublicShareViewer() {
  addPublicSharePageClasses();
  await setupPublicShareAppearance();
  injectCss();

  document.body.innerHTML = `
    <div class="yps-state-wrap">
      <main class="yps-state">
        <h1>Loading shared note…</h1>
        <p>Decrypting in your browser.</p>
      </main>
    </div>
  `;

  try {
    const shareId = shareIdFromPath();
    const shareKey = parseShareKeyFromLocationHash();

    if (!shareId) {
      throw new Error('Missing share id.');
    }

    const res = await getPublicShare(shareId);
    const payload = await decryptSharePayload(shareKey, res.encryptedPayload);

    const assets = Array.isArray(payload.assets) ? payload.assets : [];
    const imageResolver = await resolveImageUrlFactory(shareId, shareKey, assets);

    currentPayload = payload;
    currentImageResolver = imageResolver;
    currentShareState = {
      shareId,
      shareKey,
      response: res,
    };

    renderPage(payload, imageResolver);

    await Promise.allSettled(
      [...new Set(imageIdsFromMarkdown(payload.note?.markdown || ''))].map((id) =>
        imageResolver.load(id)
      )
    );

    renderPage(payload, imageResolver);

    const drawings = Array.isArray(payload.drawings) ? payload.drawings : [];
    const drawingsById = new Map(drawings.map((d) => [d.id, d]));

    await hydratePublicDrawings(drawingsById);
  } catch (err) {
    console.error('[YANTA Public Share] viewer failed', err);
    renderState('Could not open shared note', err?.message || String(err));
  }
}