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

export function extractPresentationPairingEncodedPayload(text = '') {
  const raw = String(text || '').trim();

  if (!raw) return '';

  // Full URL:
  // https://yanta.page/#present-pair=...
  try {
    const url = new URL(raw);
    const hash = String(url.hash || '').replace(/^#/, '');

    if (hash.startsWith('present-pair=')) {
      return decodeURIComponent(hash.slice('present-pair='.length));
    }
  } catch {}

  // Current hash or copied hash:
  // #present-pair=...
  // present-pair=...
  const noHash = raw.replace(/^#/, '');

  if (noHash.startsWith('present-pair=')) {
    return decodeURIComponent(noHash.slice('present-pair='.length));
  }

  // Raw encoded payload fallback.
  // Useful if user copies only the payload.
  return raw;
}

async function scanPresentationQrWithCamera() {
  if (!('BarcodeDetector' in window)) {
    throw new Error('QR scanning is not supported in this browser. Paste the pairing link instead.');
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera access is not available. Paste the pairing link instead.');
  }

  const detector = new BarcodeDetector({
    formats: ['qr_code'],
  });

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'environment',
    },
  });

  const scanner = document.createElement('div');
  scanner.className = 'modal';
  scanner.style.zIndex = '680';

  scanner.innerHTML = `
    <div class="modal-card" style="width:min(460px,94vw)">
      <header class="modal-head">
        <h3>Scan meeting display</h3>
        <button class="icon-btn" data-scan-close>&times;</button>
      </header>

      <div class="modal-body">
        <video
          autoplay
          playsinline
          muted
          style="width:100%;border-radius:14px;background:#000;aspect-ratio:1/1;object-fit:cover">
        </video>

        <p style="margin:12px 0 0;color:var(--text-dim);font-size:13px;line-height:1.45">
          Point your camera at the QR code shown on the target device.
        </p>
      </div>
    </div>
  `;

  document.body.append(scanner);

  const video = scanner.querySelector('video');
  video.srcObject = stream;

  await video.play();

  return new Promise((resolve, reject) => {
    let stopped = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;

      try {
        stream.getTracks().forEach((track) => track.stop());
      } catch {}

      scanner.remove();
    };

    scanner.querySelector('[data-scan-close]')?.addEventListener('click', () => {
      stop();
      reject(new Error('QR scan cancelled'));
    });

    scanner.addEventListener('click', (e) => {
      if (e.target === scanner) {
        stop();
        reject(new Error('QR scan cancelled'));
      }
    });

    const tick = async () => {
      if (stopped) return;

      try {
        const codes = await detector.detect(video);

        if (codes?.length) {
          const value = codes[0].rawValue || '';

          stop();
          resolve(value);
          return;
        }
      } catch (err) {
        stop();
        reject(err);
        return;
      }

      requestAnimationFrame(tick);
    };

    tick();
  });
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

.yanta-presentation-pair-methods {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.yanta-presentation-pair-method {
  min-height: 96px;
  padding: 14px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;

  border: 1px solid var(--border);
  border-radius: 14px;

  background: var(--bg-elev-2);
  color: var(--text);

  cursor: pointer;
  text-align: left;
}

.yanta-presentation-pair-method:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 9%, var(--bg-elev-2));
}

.yanta-presentation-pair-method svg {
  color: var(--accent);
}

.yanta-presentation-pair-method strong {
  font-size: 13px;
}

.yanta-presentation-pair-method small {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.35;
}

.yanta-presentation-pair-paste-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yanta-presentation-pair-paste-box textarea {
  min-height: 120px;
  font-family: var(--font-mono);
  font-size: 12px;
}

@media (max-width: 680px) {
  .yanta-presentation-pair-methods {
    grid-template-columns: 1fr;
  }
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

async function connectFromRawPairingInput(rawText) {
  const encoded = extractPresentationPairingEncodedPayload(rawText);

  if (!encoded) {
    setStatus('Paste or scan a presentation pairing link.', 'error');
    return;
  }

  await handlePresentationPairingPayload(encoded);
}

export function openPresentationPairingInputModal() {
  const m = ensureModal();

  m.hidden = false;

  m.innerHTML = `
    <div class="modal-card yanta-presentation-pair-owner-card">
      <header class="modal-head">
        <h3>Connect to meeting display</h3>
        <button class="icon-btn" data-presentation-pair-close>&times;</button>
      </header>

      <div class="modal-body yanta-presentation-pair-owner-body">
        <div class="yanta-presentation-pair-owner-info">
          <strong>Open <code>yanta.page/present</code> on the target device.</strong><br>
          Then scan the QR code shown on that device, or paste the pairing link here.
        </div>

        <section class="yanta-presentation-pair-methods">
          <button class="yanta-presentation-pair-method" type="button" data-scan-display-qr>
            ${lucide('camera', 22)}
            <strong>Scan display QR</strong>
            <small>Best option inside the YANTA app or installed PWA.</small>
          </button>

          <button class="yanta-presentation-pair-method" type="button" data-paste-from-clipboard>
            ${lucide('clipboard', 22)}
            <strong>Paste from clipboard</strong>
            <small>Use this if the camera is unavailable or blocked.</small>
          </button>
        </section>

        <section class="yanta-presentation-pair-paste-box">
          <label style="font-size:12px;color:var(--text-dim)">
            Pairing link
          </label>

          <textarea
            class="text-input"
            data-pairing-link-input
            placeholder="Paste https://yanta.page/#present-pair=..."></textarea>

          <div class="compress-actions">
            <button class="btn" data-presentation-pair-close>Cancel</button>
            <span class="grow"></span>
            <button class="btn primary" data-connect-pairing-link>
              ${lucide('screen-share', 14)}
              Connect display
            </button>
          </div>
        </section>

        <div class="yanta-presentation-pair-status" data-pair-status></div>
      </div>
    </div>
  `;

  m.querySelector('[data-scan-display-qr]')?.addEventListener('click', async () => {
    try {
      setStatus('Opening camera…');

      const scanned = await scanPresentationQrWithCamera();

      setStatus('QR code scanned. Connecting…');

      await connectFromRawPairingInput(scanned);
    } catch (err) {
      console.warn('[YANTA Presentation] QR scan failed', err);
      setStatus(err?.message || 'QR scan failed. Paste the pairing link instead.', 'error');
    }
  });

  m.querySelector('[data-paste-from-clipboard]')?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const input = m.querySelector('[data-pairing-link-input]');

      if (input) {
        input.value = text || '';
      }

      setStatus('Pairing link pasted.', 'success');
    } catch {
      setStatus('Clipboard paste failed. Paste manually.', 'error');
    }
  });

  m.querySelector('[data-connect-pairing-link]')?.addEventListener('click', async () => {
    const raw = m.querySelector('[data-pairing-link-input]')?.value || '';

    try {
      setStatus('Connecting to display…');

      await connectFromRawPairingInput(raw);
    } catch (err) {
      console.error('[YANTA Presentation] pairing link failed', err);
      setStatus(err?.message || 'Could not connect display', 'error');
    }
  });

  requestAnimationFrame(() => {
    m.querySelector('[data-scan-display-qr]')?.focus?.();
  });
}

export async function handlePresentationPairingPayload(encodedPayload) {
  pairingPayload = parsePresentationPairingPayload(encodedPayload);

  connectPairingSocket();
  renderPairingModal();

  return true;
}