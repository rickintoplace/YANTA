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
  escapeHtml,
  escapeAttr,
  lucide,
  safeCssColor,
} from '../core.js';

function shareIdFromPath(pathname = location.pathname) {
  const m = String(pathname || '').match(/^\/share\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function addPublicSharePageClasses() {
  document.documentElement.classList.add('yanta-public-share-page');
  document.body.classList.add('yanta-public-share-page');
}

function applyPublicAccent(color) {
  const safe = safeCssColor(color) || '#6ea8fe';

  document.documentElement.style.setProperty('--accent', safe);
  document.documentElement.style.setProperty('--note-color', safe);

  const metaTheme = document.querySelector('meta[name="theme-color"]');

  if (metaTheme) {
    metaTheme.setAttribute('content', '#141414');
  }

  return safe;
}

function injectCss() {
  if (document.getElementById('yanta-public-viewer-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-public-viewer-css';

  style.textContent = `
html.yanta-public-share-page,
body.yanta-public-share-page {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden !important;

  background: #141414;
  color: #e8e6e3;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Inter",
    "Segoe UI",
    Roboto,
    Helvetica,
    Arial,
    sans-serif;

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
  --font:
    -apple-system,
    BlinkMacSystemFont,
    "Inter",
    "Segoe UI",
    Roboto,
    Helvetica,
    Arial,
    sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

/*
  Important:
  The normal app keeps body non-scrollable.
  Public share therefore scrolls inside its own shell, just like YANTA panes.
*/
.yps-shell {
  position: fixed;
  inset: 0;

  min-width: 0;
  min-height: 0;

  display: flex;
  flex-direction: column;

  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;

  background:
    radial-gradient(
      circle at 18% 10%,
      color-mix(in srgb, var(--accent) 18%, transparent),
      transparent 32%
    ),
    radial-gradient(
      circle at 90% 18%,
      color-mix(in srgb, var(--accent-2) 12%, transparent),
      transparent 30%
    ),
    var(--bg);
}

.yps-top {
  position: sticky;
  top: 0;
  z-index: 10;

  flex: 0 0 auto;

  display: flex;
  align-items: center;
  gap: 12px;

  min-height: 58px;
  padding:
    max(10px, env(safe-area-inset-top))
    max(18px, env(safe-area-inset-right))
    10px
    max(18px, env(safe-area-inset-left));

  border-bottom: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
  background: color-mix(in srgb, var(--bg-elev) 88%, transparent);

  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.yps-brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;

  min-width: 0;

  color: var(--text);
  font-weight: 900;
  letter-spacing: -0.02em;
}

.yps-brand-mark {
  width: 30px;
  height: 30px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 10px;

  color: white;
  background: var(--accent);

  box-shadow: 0 10px 32px color-mix(in srgb, var(--accent) 28%, transparent);
}

.yps-brand small {
  color: var(--text-faint);
  font-weight: 650;
  letter-spacing: 0;
}

.yps-top-spacer {
  flex: 1;
}

.yps-top-link {
  min-height: 34px;
  padding: 0 12px;

  display: inline-flex;
  align-items: center;
  gap: 7px;

  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  border-radius: 999px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);

  text-decoration: none;
  font-size: 12px;
  font-weight: 850;

  transition:
    transform 120ms ease,
    background-color 120ms ease,
    border-color 120ms ease;
}

.yps-top-link:hover {
  transform: translateY(-1px);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.yps-main {
  width: min(900px, calc(100vw - 28px));
  margin: 0 auto;
  padding: clamp(26px, 5vw, 54px) 0 90px;
}

.yps-note-card {
  padding: clamp(18px, 4vw, 34px);

  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
  border-radius: 24px;

  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 8%, var(--bg-elev)),
      var(--bg-elev)
    );

  box-shadow:
    0 24px 90px rgba(0,0,0,0.26),
    0 1px 0 rgba(255,255,255,0.04) inset;
}

.yps-note-head {
  margin-bottom: clamp(24px, 4vw, 36px);
}

.yps-note-icon {
  width: 54px;
  height: 54px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 36%, transparent);

  margin-bottom: 14px;
}

.yps-note-head h1 {
  max-width: 780px;

  margin: 0;

  color: var(--text);

  font-size: clamp(32px, 7vw, 64px);
  line-height: 1.02;
  letter-spacing: -0.055em;
}

.yps-note-subline {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;

  margin-top: 13px;
}

.yps-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;

  min-height: 25px;
  padding: 3px 9px;

  border-radius: 999px;

  color: var(--text-dim);
  background: var(--bg-elev-2);
  border: 1px solid var(--border);

  font-size: 11px;
  font-weight: 750;
}

.yps-pill.accent {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
}

.yps-content.preview {
  max-width: none;
  margin: 0;

  color: var(--text);

  font-size: 17px;
  line-height: 1.74;
}

.yps-content.preview .pv-line {
  min-height: 1.25em;
}

.yps-content.preview h1,
.yps-content.preview h2,
.yps-content.preview h3 {
  line-height: 1.18;
  margin: 1.35em 0 0.45em;
  letter-spacing: -0.025em;
}

.yps-content.preview h1 {
  font-size: 2.1em;
}

.yps-content.preview h2 {
  font-size: 1.55em;
}

.yps-content.preview h3 {
  font-size: 1.25em;
}

.yps-content.preview a {
  color: var(--accent);
}

.yps-content.preview img {
  max-width: 100%;
  height: auto;

  border-radius: 16px;
  border: 1px solid var(--border);

  box-shadow: 0 16px 54px rgba(0,0,0,0.22);
}

.yps-content.preview code {
  font-family: var(--font-mono);
  font-size: 0.92em;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0.08em 0.32em;
}

.yps-content.preview pre {
  overflow: auto;

  padding: 14px 16px;

  border-radius: 14px;
  border: 1px solid var(--border);

  background: var(--bg);
}

.yps-content.preview blockquote {
  margin: 0.75em 0;
  padding: 0.7em 1em;

  border-left: 3px solid var(--accent);
  border-radius: 0 12px 12px 0;

  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--text-dim);
}

.yps-content.preview .task input {
  accent-color: var(--accent);
}

/* Public Drawing Embed — compact, more like the normal YANTA embed */
.yps-public-draw {
  margin: 16px 0;

  border: 1px solid var(--border);
  border-radius: 14px;

  overflow: hidden;

  background: var(--bg-elev);

  box-shadow:
    0 10px 38px rgba(0,0,0,0.20),
    0 1px 0 rgba(255,255,255,0.03) inset;
}

.yps-public-draw-head {
  min-height: 38px;
  padding: 6px 8px 6px 10px;

  display: flex;
  align-items: center;
  gap: 8px;

  color: var(--text);

  background: var(--bg-elev-2);
  border-bottom: 1px solid var(--border);
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
  flex: 1;
  min-width: 0;

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  color: var(--text);
  font-size: 13px;
  font-weight: 800;
}

.yps-public-draw-meta {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-size: 11px;
}

.yps-public-draw-body {
  min-height: 180px;
  padding: 12px;

  overflow: auto;

  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, white 2%, var(--bg)),
      var(--bg)
    );
}

.yps-public-draw-body svg {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;

  border-radius: 10px;
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

.yps-cta-card {
  margin-top: 26px;
  padding: clamp(18px, 4vw, 28px);

  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: 22px;

  background:
    radial-gradient(
      circle at 0% 0%,
      color-mix(in srgb, var(--accent) 18%, transparent),
      transparent 38%
    ),
    var(--bg-elev);

  box-shadow:
    0 18px 64px rgba(0,0,0,0.24),
    0 1px 0 rgba(255,255,255,0.04) inset;
}

.yps-cta-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: center;
}

.yps-cta-card h2 {
  margin: 0 0 7px;

  color: var(--text);

  font-size: clamp(22px, 4vw, 34px);
  letter-spacing: -0.035em;
  line-height: 1.12;
}

.yps-cta-card p {
  max-width: 620px;
  margin: 0;

  color: var(--text-dim);
  font-size: 14px;
  line-height: 1.55;
}

.yps-cta-features {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;

  margin-top: 14px;
}

.yps-cta-features span {
  display: inline-flex;
  align-items: center;
  gap: 5px;

  padding: 5px 9px;

  border: 1px solid var(--border);
  border-radius: 999px;

  background: var(--bg-elev-2);
  color: var(--text-dim);

  font-size: 12px;
  font-weight: 720;
}

.yps-cta-features svg {
  color: var(--accent);
}

.yps-cta-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yps-btn {
  min-height: 40px;
  padding: 0 14px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  border-radius: 999px;
  border: 1px solid var(--border);

  background: var(--bg-elev-2);
  color: var(--text);

  text-decoration: none;
  font-size: 13px;
  font-weight: 850;

  white-space: nowrap;
}

.yps-btn.primary {
  color: white;
  background: var(--accent);
  border-color: var(--accent);

  box-shadow: 0 12px 32px color-mix(in srgb, var(--accent) 25%, transparent);
}

.yps-btn:hover {
  transform: translateY(-1px);
}

.yps-footer {
  margin-top: 24px;

  display: flex;
  justify-content: center;

  color: var(--text-faint);
  font-size: 12px;
}

.yps-state {
  max-width: 520px;
  margin: auto;
  padding: 24px;

  border: 1px solid var(--border);
  border-radius: 16px;

  background: var(--bg-elev);
  text-align: center;
}

.yps-state-wrap {
  position: fixed;
  inset: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  padding: 18px;

  overflow: auto;
}

.yps-state h1 {
  margin: 0 0 8px;
}

.yps-state p {
  color: var(--text-dim);
}

@media (max-width: 760px) {
  .yps-top {
    min-height: 54px;
  }

  .yps-brand small {
    display: none;
  }

  .yps-top-link span {
    display: none;
  }

  .yps-main {
    width: min(100vw - 20px, 900px);
    padding-top: 20px;
  }

  .yps-note-card {
    border-radius: 20px;
  }

  .yps-content.preview {
    font-size: 16px;
  }

  .yps-cta-grid {
    grid-template-columns: 1fr;
  }

  .yps-cta-actions {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .yps-btn {
    flex: 1 1 auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .yps-btn,
  .yps-top-link {
    transition: none !important;
  }
}
  `;

  document.head.append(style);
}

async function resolveImageUrlFactory(shareId, shareKey, assets) {
  const byLogicalId = new Map(assets.map((a) => [a.logicalId, a]));
  const cache = new Map();

  return {
    cache,

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
      viewBackgroundColor: '#ffffff',
    },
    files: drawing.files || {},
  });

  svg.setAttribute('width', '100%');
  svg.setAttribute('height', 'auto');

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

function renderCtaCard() {
  return `
    <section class="yps-cta-card">
      <div class="yps-cta-grid">
        <div>
          <h2>Make notes like this with YANTA</h2>
          <p>
            YANTA combines Markdown notes, tasks, drawings, images, sources,
            calendar context and encrypted sync in one practical local-first workspace.
          </p>

          <div class="yps-cta-features">
            <span>${lucide('check-square', 13)} Tasks</span>
            <span>${lucide('line-squiggle', 13)} Drawings</span>
            <span>${lucide('image', 13)} Images</span>
            <span>${lucide('link', 13)} Wikilinks</span>
            <span>${lucide('shield-check', 13)} Encrypted sync</span>
          </div>
        </div>

        <div class="yps-cta-actions">
          <a class="yps-btn primary" href="${escapeAttr(location.origin)}">
            ${lucide('sparkles', 15)}
            <span>Open YANTA</span>
          </a>
          <a class="yps-btn" href="${escapeAttr(location.origin)}">
            ${lucide('file-plus', 15)}
            <span>Create your own</span>
          </a>
        </div>
      </div>
    </section>
  `;
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

      /*
        Use pv-inline-icon placeholder so markdown.js hydrates the Lucide SVG
        after DOMPurify, exactly like normal preview inline icons.
      */
      return `
        <section class="yps-public-draw" data-public-draw-id="${escapeAttr(id)}" contenteditable="false">
          <div class="yps-public-draw-head">
            <span class="yps-public-draw-icon pv-inline-icon"
              data-lucide-icon="line-squiggle"
              data-lucide-size="13"
              aria-hidden="true"></span>

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
      <header class="yps-top">
        <div class="yps-brand">
          <span class="yps-brand-mark">${lucide('file-text', 17)}</span>
          <span>YANTA <small>Public Share</small></span>
        </div>

        <span class="yps-top-spacer"></span>

        <a class="yps-top-link" href="${escapeAttr(location.origin)}">
          ${lucide('sparkles', 14)}
          <span>Make your own</span>
        </a>
      </header>

      <main class="yps-main">
        <section class="yps-note-card">
          <header class="yps-note-head" style="--note-color:${escapeHtml(color)}">
            <div class="yps-note-icon">${lucide(note.icon || 'file-text', 25)}</div>
            <h1>${escapeHtml(note.title || 'Untitled')}</h1>

            <div class="yps-note-subline">
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
        </section>

        ${renderCtaCard()}

        <footer class="yps-footer">
          Shared zero-knowledge through YANTA Cloud · the private key stayed in the link fragment.
        </footer>
      </main>
    </div>
  `;
}

export async function mountPublicShareViewer() {
  addPublicSharePageClasses();
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