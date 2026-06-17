import qrcode from 'qrcode-generator';

import {
  state,
  escapeHtml,
  lucide,
  toast,
} from '../core.js';

import {
  openShareModal as openLiveShareModal,
  stopSharing as stopLiveSharing,
} from '../sharing.js';

import {
  createOrGetPublicShare,
  publishPublicShareNow,
  publicShareStateForNote,
  stopPublicShare,
} from './public-share-publisher.js';

import {
  makePublicShareUrl,
} from './public-share-crypto.js';

import {
  openYantaCloudSetup,
} from '../sync2/yanta-cloud-setup-ui.js';

import {
  yantaConfirm,
} from '../dialogs.js';

let modal = null;

function renderQrSvg(text, size = 220) {
  const qr = qrcode(0, 'Q');
  qr.addData(text);
  qr.make();

  const n = qr.getModuleCount();
  const ns = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(ns, 'svg');

  svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('shape-rendering', 'crispEdges');

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', n);
  bg.setAttribute('height', n);
  bg.setAttribute('fill', 'white');
  svg.append(bg);

  let path = '';

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.isDark(y, x)) {
        path += `M${x} ${y}h1v1h-1z`;
      }
    }
  }

  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'black');
  svg.append(p);

  return svg;
}

function ensureCss() {
  if (document.getElementById('yanta-public-share-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-public-share-css';
  style.textContent = `
.yanta-public-share-card {
  width: min(620px, 94vw);
}

.yanta-share-tabs {
  display: flex;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev-2);
  margin-bottom: 14px;
}

.yanta-share-tabs button {
  flex: 1;
  min-height: 34px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  font-weight: 750;
}

.yanta-share-tabs button.active {
  background: var(--bg-elev-3);
  color: var(--accent);
}

.yanta-public-share-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.yanta-public-share-info {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev-2);
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.5;
}

.yanta-public-share-status {
  padding: 9px 10px;
  border-radius: 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 12px;
}

.yanta-public-share-status.good {
  color: var(--green);
  border-color: color-mix(in srgb, var(--green) 38%, var(--border));
}

.yanta-public-share-status.warn {
  color: var(--yellow);
  border-color: color-mix(in srgb, var(--yellow) 38%, var(--border));
}

.yanta-public-share-status.error {
  color: var(--red);
  border-color: color-mix(in srgb, var(--red) 45%, var(--border));
}

.yanta-public-share-link-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}

.yanta-public-share-link-row input {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
}

.yanta-public-share-qr {
  display: flex;
  justify-content: center;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: white;
}

.yanta-public-share-danger {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

/* Optimierter Copy-Button mit flüssigem Übergang */
.yanta-public-share-link-row .btn[data-copy-public-share] {
  transition: background-color 200ms ease, border-color 200ms ease, color 200ms ease, transform 150ms ease;
}

.yanta-public-share-link-row .btn.success {
  color: white !important;
  background: var(--green) !important;
  border-color: var(--green) !important;
  animation: yanta-public-share-btn-bounce 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.yanta-public-share-link-row .btn.success svg {
  animation: yanta-public-share-copy-pop 350ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

/* Sanfter Bounce für den ganzen Button beim Klicken */
@keyframes yanta-public-share-btn-bounce {
  0% { transform: scale(1); }
  40% { transform: scale(0.96); }
  100% { transform: scale(1); }
}

/* Knackiges Aufpoppen des neuen Hakens */
@keyframes yanta-public-share-copy-pop {
  0% {
    transform: scale(0.4) rotate(-15deg);
    opacity: 0;
  }
  70% {
    transform: scale(1.15) rotate(5deg);
    opacity: 1;
  }
  100% {
    transform: scale(1) rotate(0);
    opacity: 1;
  }
}
  `;
  document.head.append(style);
}

function ensureModal() {
  if (modal) return modal;

  ensureCss();

  modal = document.createElement('div');
  modal.className = 'modal yanta-public-share-modal';
  modal.hidden = true;

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeUnifiedShareModal();
    if (e.target.closest?.('[data-public-share-close]')) closeUnifiedShareModal();
  });

  document.body.append(modal);

  return modal;
}

export function closeUnifiedShareModal() {
  if (modal) modal.hidden = true;
}

function statusText(status) {
  const map = {
    pending: 'Shared · changes pending',
    publishing: 'Shared · publishing…',
    'up-to-date': 'Shared · up to date',
    failed: 'Shared · publish failed',
    revoked: 'Sharing stopped',
  };

  return map[status] || 'Not shared yet';
}

function statusClass(status) {
  if (status === 'up-to-date') return 'good';
  if (status === 'failed') return 'error';
  if (status === 'pending' || status === 'publishing') return 'warn';
  return '';
}

async function renderPublicTab(noteId) {
  const note = state.notes.get(noteId);
  const share = publicShareStateForNote(noteId);
  const hasShare = !!share?.shareId && !!share?.shareKey && share.status !== 'revoked';

  const url = hasShare
    ? share.url || makePublicShareUrl(share.shareId, share.shareKey)
    : '';

  const body = modal.querySelector('[data-share-body]');
  if (!body) return;

  body.innerHTML = `
    <div class="yanta-public-share-box">
      <div class="yanta-public-share-info">
        <strong>Public link</strong><br>
        Anyone with the full link can read the latest published version.
        The private key is after <code>#k=</code> and is not sent to the server.
      </div>

      ${
        hasShare
          ? `
            <div class="yanta-public-share-status ${statusClass(share.status)}">
              ${escapeHtml(statusText(share.status))}
              ${
                share.lastError
                  ? `<br>${escapeHtml(share.lastError)}`
                  : ''
              }
            </div>

            <div class="yanta-public-share-link-row">
              <input class="text-input" data-public-share-link readonly value="${escapeHtml(url)}">
              <button class="btn primary" data-copy-public-share>${lucide('copy', 14)} Copy</button>
            </div>

            <div class="yanta-public-share-qr" data-public-share-qr></div>

            ${
              Array.isArray(share.missingAssets) && share.missingAssets.length
                ? `
                  <div class="yanta-public-share-status warn">
                    ${share.missingAssets.length} asset${share.missingAssets.length === 1 ? '' : 's'} missing and not included.
                  </div>
                `
                : ''
            }

            <div class="compress-actions">
              <button class="btn" data-publish-public-share>
                ${lucide('refresh-cw', 14)}
                ${share.status === 'failed' ? 'Retry publish' : 'Publish pending changes'}
              </button>
              <span class="grow"></span>
              <button class="btn danger" data-stop-public-share>
                ${lucide('trash', 14)}
                Stop sharing
              </button>
            </div>

            <div class="yanta-public-share-danger">
              <small style="color:var(--text-faint)">
                Stopping sharing prevents future access through this link. It cannot remove copies already downloaded.
              </small>
            </div>
          `
          : `
            <label>
              Expires
              <select class="text-input" data-public-share-expiry>
                <option value="2592000000">30 days</option>
                <option value="86400000">1 day</option>
                <option value="0">Until revoked</option>
              </select>
            </label>

            <div class="compress-actions">
              <button class="btn primary" data-create-public-share>
                ${lucide('link', 14)}
                Create public link
              </button>
              <button class="btn" data-open-cloud-setup>
                ${lucide('cloud', 14)}
                Set up YANTA Cloud
              </button>
            </div>
          `
      }
    </div>
  `;

  if (hasShare) {
    body.querySelector('[data-public-share-qr]')?.append(renderQrSvg(url, 220));
  }

  body.querySelector('[data-copy-public-share]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const originalHtml = btn.dataset.originalHtml || btn.innerHTML;
    btn.dataset.originalHtml = originalHtml;

    const width = Math.ceil(btn.getBoundingClientRect().width || 0);
    const previousMinWidth = btn.style.minWidth;

    if (width) btn.style.minWidth = `${width}px`;

    try {
      await navigator.clipboard.writeText(url);

      // Entfernt temporär das 'primary'-Styling, damit das Success-Grün greift
      btn.classList.remove('primary');
      btn.classList.add('success');
      btn.innerHTML = `${lucide('check', 14)} Copied`;

      window.setTimeout(() => {
        btn.classList.remove('success');
        btn.classList.add('primary');
        btn.innerHTML = originalHtml;
        btn.style.minWidth = previousMinWidth;
      }, 1300);
    } catch {
      toast('Copy failed', 'error');
      btn.style.minWidth = previousMinWidth;
    }
  });

  body.querySelector('[data-create-public-share]')?.addEventListener('click', async () => {
    try {
      const ttl = Number(body.querySelector('[data-public-share-expiry]')?.value || 0);
      const expiresAt = ttl > 0 ? Date.now() + ttl : null;

      body.querySelector('[data-create-public-share]').disabled = true;

      await createOrGetPublicShare(noteId, {
        expiresAt,
      });

      await publishPublicShareNow(noteId, {
        force: true,
        expiresAt,
      });

      await renderPublicTab(noteId);
      toast('Public link created', 'success');
    } catch (err) {
      console.error(err);
      toast(err?.message || 'Could not create public link', 'error');
      await renderPublicTab(noteId);
    }
  });

  body.querySelector('[data-publish-public-share]')?.addEventListener('click', async () => {
    try {
      await publishPublicShareNow(noteId, {
        force: true,
      });

      await renderPublicTab(noteId);
      toast('Public share published', 'success');
    } catch (err) {
      console.error(err);
      toast(err?.message || 'Publish failed', 'error');
      await renderPublicTab(noteId);
    }
  });

  body.querySelector('[data-stop-public-share]')?.addEventListener('click', async () => {
    const ok = await yantaConfirm({
    title: 'Stop public sharing?',
    message: [
        'Stop public sharing for this note?',
        '',
        'Future access through this public link will be blocked.',
        'Copies already downloaded cannot be removed.'
    ].join('\n'),
    confirmLabel: 'Stop sharing',
    cancelLabel: 'Cancel',
    danger: true,
    icon: 'trash',
    });

    if (!ok) return;

    try {
      await stopPublicShare(noteId);
      await renderPublicTab(noteId);
    } catch (err) {
      console.error(err);
      toast(err?.message || 'Could not stop sharing', 'error');
    }
  });

  body.querySelector('[data-open-cloud-setup]')?.addEventListener('click', async () => {
    await openYantaCloudSetup();
  });
}

function renderLiveTab() {
  const body = modal.querySelector('[data-share-body]');
  if (!body) return;

  body.innerHTML = `
    <div class="yanta-public-share-box">
      <div class="yanta-public-share-info">
        <strong>Live collaboration</strong><br>
        Real-time WebRTC/Yjs editing with people who have the link.
        This is separate from public read-only links.
      </div>

      <div class="compress-actions">
        <button class="btn primary" data-open-live-share>${lucide('users', 14)} Open live share</button>
        <button class="btn danger" data-stop-live-share>${lucide('x', 14)} Stop live share</button>
      </div>
    </div>
  `;

  body.querySelector('[data-open-live-share]')?.addEventListener('click', async () => {
    closeUnifiedShareModal();
    await openLiveShareModal();
  });

  body.querySelector('[data-stop-live-share]')?.addEventListener('click', async () => {
    await stopLiveSharing(state.currentNoteId);
  });
}

export async function openUnifiedShareModal() {
  const noteId = state.currentNoteId;

  if (!noteId || !state.notes.has(noteId)) {
    toast('Open a note first', 'error');
    return;
  }

  const note = state.notes.get(noteId);
  const m = ensureModal();

  m.innerHTML = `
    <div class="modal-card yanta-public-share-card">
      <header class="modal-head">
        <h3>Share note: ${escapeHtml(note.title || 'Untitled')}</h3>
        <button class="icon-btn" data-public-share-close>&times;</button>
      </header>

      <div class="modal-body">
        <div class="yanta-share-tabs">
          <button data-share-tab="public" class="active">Public link</button>
          <button data-share-tab="live">Live collaboration</button>
        </div>

        <div data-share-body></div>
      </div>
    </div>
  `;

  m.querySelector('[data-share-tab="public"]')?.addEventListener('click', async () => {
    m.querySelectorAll('[data-share-tab]').forEach((b) => b.classList.remove('active'));
    m.querySelector('[data-share-tab="public"]').classList.add('active');
    await renderPublicTab(noteId);
  });

  m.querySelector('[data-share-tab="live"]')?.addEventListener('click', () => {
    m.querySelectorAll('[data-share-tab]').forEach((b) => b.classList.remove('active'));
    m.querySelector('[data-share-tab="live"]').classList.add('active');
    renderLiveTab();
  });

  m.hidden = false;
  await renderPublicTab(noteId);
}