import {
  state,
  escapeHtml,
  escapeAttr,
  lucide,
  toast,
} from '../core.js';

import {
  listAllDrawings,
} from '../yjs.js';

import {
  normalizeSlides,
} from '../slides/slides-model.js';

import {
  createPresentationSessionForDrawing,
  openPresentationControllerForExistingSession,
} from './presentation-ui.js';

import {
  openYantaCloudSetup,
} from '../sync2/yanta-cloud-setup-ui.js';

const SIGNALING_URL =
  import.meta.env.VITE_YANTA_SIGNALING_URL ||
  'wss://yanta-signaling-932960946294.europe-west1.run.app';

let modal = null;
let socket = null;
let pairingPayload = null;

function base64UrlDecodeString(value) {
  let b64 = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  while (b64.length % 4) b64 += '=';

  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);

  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }

  return new TextDecoder().decode(bytes);
}

export function parsePresentationPairingPayload(encoded) {
  const json = JSON.parse(base64UrlDecodeString(encoded));

  if (json?.kind !== 'yanta-presentation-display-pairing') {
    throw new Error('Invalid YANTA presentation pairing code.');
  }

  if (!json.topic || !json.token) {
    throw new Error('Presentation pairing code is incomplete.');
  }

  return {
    v: 1,
    ...json,
  };
}

function ensureCss() {
  if (document.getElementById('yanta-presentation-pair-owner-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-presentation-pair-owner-css';
  style.textContent = `
.yanta-presentation-pair-owner-card {
  width: min(640px, 94vw);
}

.yanta-presentation-pair-owner-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.yanta-presentation-pair-owner-info {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev-2);
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.45;
}

.yanta-presentation-pair-drawing-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yanta-presentation-pair-drawing-row {
  width: 100%;
  min-height: 58px;

  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;

  padding: 10px 11px;

  border: 1px solid var(--border);
  border-radius: 12px;

  background: var(--bg-elev-2);
  color: var(--text);

  cursor: pointer;
  text-align: left;
}

.yanta-presentation-pair-drawing-row:hover,
.yanta-presentation-pair-drawing-row.selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 9%, var(--bg-elev-2));
}

.yanta-presentation-pair-drawing-icon {
  width: 34px;
  height: 34px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
}

.yanta-presentation-pair-drawing-main {
  min-width: 0;
}

.yanta-presentation-pair-drawing-main strong {
  display: block;
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yanta-presentation-pair-drawing-main small {
  display: block;
  margin-top: 3px;
  color: var(--text-faint);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yanta-presentation-pair-status {
  min-height: 18px;
  white-space: pre-wrap;
  color: var(--text-faint);
  font-size: 12px;
}

.yanta-presentation-pair-status.error {
  color: var(--red);
}

.yanta-presentation-pair-status.success {
  color: var(--green);
}

.yanta-presentation-pair-empty {
  padding: 16px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  color: var(--text-faint);
  text-align: center;
  font-size: 13px;
}
  `;

  document.head.append(style);
}

function ensureModal() {
  ensureCss();

  if (modal) return modal;

  modal = document.createElement('div');
  modal.className = 'modal yanta-presentation-pair-owner-modal';
  modal.hidden = true;

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closePairingModal();
    if (e.target.closest?.('[data-presentation-pair-close]')) {
      closePairingModal();
    }
  });

  document.body.append(modal);

  return modal;
}

function closeSocket() {
  if (!socket) return;

  try {
    socket.close();
  } catch {}

  socket = null;
}

function closePairingModal() {
  closeSocket();

  if (modal) {
    modal.hidden = true;
  }

  pairingPayload = null;
}

function setStatus(message, type = '') {
  const node = modal?.querySelector('[data-pair-status]');
  if (!node) return;

  node.textContent = message || '';
  node.className = `yanta-presentation-pair-status ${type}`.trim();
}

function sendToDisplay(data = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (!pairingPayload?.topic || !pairingPayload?.token) return;

  socket.send(JSON.stringify({
    type: 'publish',
    topic: pairingPayload.topic,
    data: {
      ...data,
      token: pairingPayload.token,
    },
  }));
}

function connectPairingSocket() {
  closeSocket();

  socket = new WebSocket(SIGNALING_URL);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({
      type: 'subscribe',
      topics: [pairingPayload.topic],
    }));
  });

  socket.addEventListener('error', () => {
    setStatus('Could not connect to the target display.', 'error');
  });

  socket.addEventListener('close', () => {
    // Do not overwrite success state after sending link.
  });
}

function availablePresentationDrawings() {
  return listAllDrawings()
    .map((drawing) => {
      const slides = normalizeSlides(drawing.slides || []).filter((s) => !s.hidden);

      return {
        ...drawing,
        slides,
        slideCount: slides.length,
      };
    })
    .filter((drawing) => drawing.slideCount > 0)
    .sort((a, b) =>
      Number(b.updated || 0) - Number(a.updated || 0) ||
      String(a.title || '').localeCompare(String(b.title || ''))
    );
}

async function startPresentationForDrawing(drawing) {
  if (!drawing?.noteId || !drawing?.id) return;

  try {
    setStatus('Creating encrypted presentation session…');

    const created = await createPresentationSessionForDrawing({
      noteId: drawing.noteId,
      drawingId: drawing.id,
    });

    setStatus('Sending presentation to display…');

    sendToDisplay({
      kind: 'presentation-link',
      url: created.url,
      title: drawing.title || 'YANTA Presentation',
      sentAt: Date.now(),
    });

    openPresentationControllerForExistingSession({
      noteId: drawing.noteId,
      drawingId: drawing.id,
      drawing: created.drawing,
      session: created.session,
      url: created.url,
    });

    setStatus('Presentation sent to display.', 'success');
    toast('Presentation sent to target display', 'success');
  } catch (err) {
    console.error('[YANTA Presentation Pairing] failed', err);

    sendToDisplay({
      kind: 'pairing-error',
      message: err?.message || 'Could not start presentation',
    });

    setStatus(err?.message || 'Could not start presentation', 'error');
  }
}

function renderPairingModal() {
  const m = ensureModal();
  const drawings = availablePresentationDrawings();

  m.hidden = false;

  m.innerHTML = `
    <div class="modal-card yanta-presentation-pair-owner-card">
      <header class="modal-head">
        <h3>Send presentation to display</h3>
        <button class="icon-btn" data-presentation-pair-close>&times;</button>
      </header>

      <div class="modal-body yanta-presentation-pair-owner-body">
        <div class="yanta-presentation-pair-owner-info">
          <strong>Meeting-room display paired.</strong><br>
          Choose a slideshow. The device will open an encrypted session and can only edit a temporary copy.
          You decide later whether to apply or discard edits.
        </div>

        ${
          drawings.length
            ? `
              <div class="yanta-presentation-pair-drawing-list">
                ${drawings.map((drawing) => `
                  <button
                    class="yanta-presentation-pair-drawing-row"
                    type="button"
                    data-pair-drawing-id="${escapeAttr(drawing.id)}"
                    data-pair-note-id="${escapeAttr(drawing.noteId)}">
                    <span class="yanta-presentation-pair-drawing-icon">
                      ${lucide('presentation', 17)}
                    </span>

                    <span class="yanta-presentation-pair-drawing-main">
                      <strong>${escapeHtml(drawing.title || 'Drawing')}</strong>
                      <small>
                        ${escapeHtml(drawing.noteTitle || 'Untitled note')}
                        · ${drawing.slideCount} slide${drawing.slideCount === 1 ? '' : 's'}
                      </small>
                    </span>

                    ${lucide('chevron-right', 16)}
                  </button>
                `).join('')}
              </div>
            `
            : `
              <div class="yanta-presentation-pair-empty">
                No drawings with slides found.
                Open a note with a drawing slideshow, create slides, then scan the display QR again.
              </div>
            `
        }

        <div class="compress-actions">
          <button class="btn" data-open-cloud-setup>
            ${lucide('cloud', 14)}
            YANTA Cloud
          </button>
          <span class="grow"></span>
          <button class="btn" data-presentation-pair-close>Cancel</button>
        </div>

        <div class="yanta-presentation-pair-status" data-pair-status></div>
      </div>
    </div>
  `;

  m.querySelectorAll('[data-pair-drawing-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const drawingId = btn.dataset.pairDrawingId || '';
      const noteId = btn.dataset.pairNoteId || '';

      const drawing = availablePresentationDrawings()
        .find((d) => d.id === drawingId && d.noteId === noteId);

      if (!drawing) {
        setStatus('Drawing not found anymore.', 'error');
        return;
      }

      m.querySelectorAll('[data-pair-drawing-id]').forEach((node) => {
        node.disabled = true;
      });

      btn.classList.add('selected');

      await startPresentationForDrawing(drawing);
    });
  });

  m.querySelector('[data-open-cloud-setup]')?.addEventListener('click', async () => {
    await openYantaCloudSetup();
  });
}

export async function handlePresentationPairingPayload(encodedPayload) {
  pairingPayload = parsePresentationPairingPayload(encodedPayload);

  connectPairingSocket();
  renderPairingModal();

  return true;
}