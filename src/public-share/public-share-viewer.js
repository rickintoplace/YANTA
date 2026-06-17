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
} from '../core.js';

function shareIdFromPath(pathname = location.pathname) {
  const m = String(pathname || '').match(/^\/share\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function injectCss() {
  if (document.getElementById('yanta-public-viewer-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-public-viewer-css';

  style.textContent = `
html, body {
  min-height: 100%;
  margin: 0;
  background: #141414;
  color: #e8e6e3;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;

  --bg: #141414;
  --bg-elev: #1c1c1c;
  --bg-elev-2: #242424;
  --bg-elev-3: #2e2e2e;
  --border: #333333;
  --border-strong: #454545;
  --text: #e8e6e3;
  --text-dim: #9a9794;
  --text-faint: #6b6864;
  --accent: #6ea8fe;
  --accent-2: #a78bfa;
  --green: #4ade80;
  --yellow: #fbbf24;
  --red: #f87171;
  --font: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.yps-shell {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

.yps-top {
  position: sticky;
  top: 0;
  z-index: 3;

  display: flex;
  align-items: center;
  gap: 10px;

  min-height: 54px;
  padding: 10px 18px;

  border-bottom: 1px solid var(--border);
  background: rgba(28,28,28,0.88);
  backdrop-filter: blur(12px);
}

.yps-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--accent);
  font-weight: 850;
}

.yps-main {
  width: min(860px, calc(100vw - 28px));
  margin: 0 auto;
  padding: 34px 0 80px;
}

.yps-note-head {
  margin-bottom: 26px;
}

.yps-note-icon {
  width: 48px;
  height: 48px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;

  color: var(--note-color, var(--accent));
  background: color-mix(in srgb, var(--note-color, var(--accent)) 15%, transparent);

  margin-bottom: 12px;
}

.yps-note-head h1 {
  margin: 0;
  font-size: clamp(30px, 6vw, 54px);
  line-height: 1.06;
  letter-spacing: -0.04em;
}

.yps-updated {
  margin-top: 9px;
  color: var(--text-dim);
  font-size: 13px;
}

.yps-content.preview {
  max-width: none;
  margin: 0;
  font-size: 17px;
  line-height: 1.72;
}

.yps-content.preview .pv-line {
  min-height: 1.25em;
}

.yps-content.preview h1,
.yps-content.preview h2,
.yps-content.preview h3 {
  line-height: 1.18;
  margin: 1.35em 0 0.45em;
}

.yps-content.preview a {
  color: var(--accent);
}

.yps-content.preview img {
  max-width: 100%;
  height: auto;
  border-radius: 14px;
  border: 1px solid var(--border);
}

.yps-content.preview code {
  font-family: var(--font-mono);
  font-size: 0.92em;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0.08em 0.32em;
}

.yps-public-draw {
  margin: 12px 0;
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  background: var(--bg-elev);
}

.yps-public-draw-head {
  min-height: 40px;
  padding: 9px 11px;

  display: flex;
  align-items: center;
  gap: 8px;

  color: var(--accent);
  background: var(--bg-elev-2);
  border-bottom: 1px solid var(--border);
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
}

.yps-state {
  max-width: 520px;
  margin: 20vh auto;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--bg-elev);
  text-align: center;
}

.yps-state h1 {
  margin: 0 0 8px;
}

.yps-state p {
  color: var(--text-dim);
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

  const svg = await mod.exportToSvg({
    elements: Array.isArray(drawing.elements)
      ? drawing.elements.filter((el) => el && !el.isDeleted)
      : [],
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
    if (!body) continue;

    if (!drawing) {
      body.textContent = `Drawing unavailable: ${id}`;
      continue;
    }

    try {
      body.textContent = 'Rendering drawing…';

      const svg = await publicDrawingSvg(drawing);

      body.replaceChildren(svg);
    } catch (err) {
      console.warn('[YANTA Public Share] drawing render failed', err);
      body.innerHTML = `<pre>${escapeHtml(JSON.stringify(drawing.elements || [], null, 2)).slice(0, 4000)}</pre>`;
    }
  }
}

function renderState(title, message) {
  document.body.innerHTML = `
    <div class="yps-shell">
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

export async function mountPublicShareViewer() {
  injectCss();

  document.body.innerHTML = `
    <div class="yps-shell">
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
    const drawings = Array.isArray(payload.drawings) ? payload.drawings : [];
    const drawingsById = new Map(drawings.map((d) => [d.id, d]));

    const imageResolver = await resolveImageUrlFactory(shareId, shareKey, assets);

    const render = () => {
      const note = payload.note || {};
      const color = note.color || '#6ea8fe';

      const html = renderPreviewWithContext(note.markdown || '', {
        resolveImageUrl(url) {
          if (String(url || '').startsWith('yanta-img://')) {
            const id = String(url).slice('yanta-img://'.length);
            return imageResolver.cache.get(id) || '';
          }

          return url;
        },

        renderDrawEmbedHtml(id, label = 'Drawing') {
          return `
            <section class="yps-public-draw" data-public-draw-id="${escapeAttr(id)}" contenteditable="false">
              <div class="yps-public-draw-head">
                ${lucide('line-squiggle', 15)}
                <strong>${escapeHtml(label || drawingsById.get(id)?.title || 'Drawing')}</strong>
              </div>
              <div class="yps-public-draw-body" data-public-draw-body>
                Drawing loading…
              </div>
            </section>
          `;
        },
      });

      document.body.innerHTML = `
        <div class="yps-shell">
          <header class="yps-top">
            <div class="yps-brand">${lucide('share-2', 18)} YANTA Share</div>
          </header>

          <main class="yps-main">
            <header class="yps-note-head" style="--note-color:${escapeHtml(color)}">
              <div class="yps-note-icon">${lucide(note.icon || 'file-text', 24)}</div>
              <h1>${escapeHtml(note.title || 'Untitled')}</h1>
              ${
                note.updated
                  ? `<div class="yps-updated">Updated ${escapeHtml(new Date(note.updated).toLocaleString())}</div>`
                  : ''
              }
            </header>

            <article class="yps-content preview">
              ${html}
            </article>
          </main>
        </div>
      `;
    };

    render();

    await Promise.allSettled(
      [...new Set(imageIdsFromMarkdown(payload.note?.markdown || ''))].map((id) =>
        imageResolver.load(id)
      )
    );

    render();
    await hydratePublicDrawings(drawingsById);
  } catch (err) {
    console.error('[YANTA Public Share] viewer failed', err);
    renderState('Could not open shared note', err?.message || String(err));
  }
}