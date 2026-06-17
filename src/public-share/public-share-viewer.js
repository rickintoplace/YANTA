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
  renderPublicShareMarkdown,
} from './public-share-renderer.js';

import {
  escapeHtml,
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

  border-bottom: 1px solid #333;
  background: rgba(28,28,28,0.88);
  backdrop-filter: blur(12px);
}

.yps-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #6ea8fe;
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
  color: var(--note-color, #6ea8fe);
  background: color-mix(in srgb, var(--note-color, #6ea8fe) 15%, transparent);
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
  color: #9a9794;
  font-size: 13px;
}

.yps-content {
  font-size: 17px;
  line-height: 1.72;
}

.yps-content h1,
.yps-content h2,
.yps-content h3 {
  line-height: 1.18;
  margin: 1.35em 0 0.45em;
}

.yps-content p {
  margin: 0.7em 0;
}

.yps-content a {
  color: #6ea8fe;
}

.yps-content code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92em;
  background: #242424;
  border: 1px solid #333;
  border-radius: 5px;
  padding: 0.08em 0.32em;
}

.yps-content pre {
  overflow: auto;
  padding: 14px;
  border-radius: 12px;
  background: #1c1c1c;
  border: 1px solid #333;
}

.yps-content figure {
  margin: 1em 0;
}

.yps-content img {
  max-width: 100%;
  height: auto;
  border-radius: 14px;
  border: 1px solid #333;
}

.yps-task {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0.35em 0;
}

.yps-task input {
  margin-top: 5px;
  accent-color: #6ea8fe;
}

.yps-task.checked span {
  color: #9a9794;
  text-decoration: line-through;
}

.yps-list {
  margin: 0.25em 0 0.25em 1.1em;
}

.yps-wiki-missing {
  color: #9a9794;
  border-bottom: 1px dotted #9a9794;
}

.yps-inline-icon {
  display: inline-flex;
  vertical-align: -0.18em;
}

.yps-missing {
  padding: 10px 12px;
  border: 1px dashed #454545;
  border-radius: 10px;
  color: #9a9794;
  background: #1c1c1c;
}

.yps-drawing {
  margin: 1em 0;
  border: 1px solid #333;
  border-radius: 14px;
  overflow: hidden;
  background: #1c1c1c;
}

.yps-drawing-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #333;
  background: #242424;
  color: #6ea8fe;
}

.yps-state {
  max-width: 520px;
  margin: 20vh auto;
  padding: 24px;
  border: 1px solid #333;
  border-radius: 16px;
  background: #1c1c1c;
  text-align: center;
}

.yps-state h1 {
  margin: 0 0 8px;
}

.yps-state p {
  color: #9a9794;
}
  `;
  document.head.append(style);
}

async function resolveImageUrlFactory(shareId, shareKey, assets) {
  const byLogicalId = new Map(assets.map((a) => [a.logicalId, a]));
  const cache = new Map();

  return async function resolveImageUrl(logicalId) {
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
  };
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

    const resolveImageUrlAsync = await resolveImageUrlFactory(shareId, shareKey, assets);
    const imageUrlCache = new Map();

    const render = () => {
      const note = payload.note || {};
      const color = note.color || '#6ea8fe';

      const html = renderPublicShareMarkdown(note.markdown || '', {
        drawingsById,
        resolveImageUrl(id) {
          return imageUrlCache.get(id) || '';
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

            <article class="yps-content">
              ${html}
            </article>
          </main>
        </div>
      `;
    };

    render();

    // Lazy decrypt all assets referenced in markdown, then rerender.
    const imageIds = [...String(payload.note?.markdown || '').matchAll(/yanta-img:\/\/([a-z0-9_:-]+)/gi)]
      .map((m) => m[1]);

    await Promise.allSettled(
      [...new Set(imageIds)].map(async (id) => {
        const url = await resolveImageUrlAsync(id);
        if (url) imageUrlCache.set(id, url);
      })
    );

    render();
  } catch (err) {
    console.error('[YANTA Public Share] viewer failed', err);
    renderState('Could not open shared note', err?.message || String(err));
  }
}