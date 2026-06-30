import {
  state,
  store,
  toast,
  lucide,
  escapeHtml,
  escapeAttr,
} from '../core.js';

import {
  renderBrandedQrSvg,
} from '../qr.js';

import {
  BRAND_LOGO_SVG,
} from '../brand-logo.js';

import {
  getDrawing,
  setDrawing,
} from '../yjs.js';

import {
  normalizeSlides,
} from '../slides/slides-model.js';

import {
  createPresentationSession,
  publishPresentationSessionPayload,
  deletePresentationSession,
} from './presentation-api.js';

import {
  generatePresentationKeyString,
  encryptPresentationPayload,
  makePresentationUrl,
} from './presentation-crypto.js';

import {
  packPresentationSession,
} from './presentation-pack.js';

import {
  yantaConfirm,
} from '../dialogs.js';

const SIGNALING_URL =
  import.meta.env.VITE_YANTA_SIGNALING_URL ||
  'wss://yanta-signaling-932960946294.europe-west1.run.app';

let modal = null;
let ownerSocket = null;
let activeSession = null;
let latestDraft = null;
let ownerIndex = 0;

function ensureCss() {
  if (document.getElementById('yanta-presentation-ui-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-presentation-ui-css';
  style.textContent = `
.yanta-presentation-card {
  width: min(620px, 94vw);
}

.yanta-presentation-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.yanta-presentation-info {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev-2);
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.45;
}

.yanta-presentation-link-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.yanta-presentation-link-row input {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
}

.yanta-presentation-qr {
  display: flex;
  justify-content: center;
  padding: 16px;
  border-radius: 16px;
  background: white;
}

.yanta-presentation-remote {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.yanta-presentation-notes {
  min-height: 120px;
  max-height: 260px;
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text-dim);
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.5;
}

.yanta-presentation-draft {
  border-color: color-mix(in srgb, var(--yellow) 42%, var(--border));
  background: color-mix(in srgb, var(--yellow) 8%, var(--bg-elev));
}

@media (max-width: 680px) {
  .yanta-presentation-link-row {
    grid-template-columns: 1fr;
  }
}

.yanta-presentation-owner-preview {
  position: relative;
  min-height: 220px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg);
  overflow: hidden;
  touch-action: none;

  display: flex;
  align-items: center;
  justify-content: center;
}

.yanta-presentation-owner-preview svg {
  display: block;
  max-width: 100%;
  max-height: 100%;
}

.yanta-presentation-owner-laser-dot {
  position: absolute;
  width: 18px;
  height: 18px;
  margin-left: -9px;
  margin-top: -9px;

  border-radius: 999px;
  background: #ff3b30;

  box-shadow:
    0 0 0 4px rgba(255,59,48,.18),
    0 0 24px rgba(255,59,48,.72);

  opacity: 0;
  transform: scale(.8);

  pointer-events: none;

  transition:
    opacity 80ms ease,
    transform 80ms ease;
}

.yanta-presentation-owner-laser-dot.visible {
  opacity: 1;
  transform: scale(1);
}
  `;

  document.head.append(style);
}

function ensureModal() {
  ensureCss();

  if (modal) return modal;

  modal = document.createElement('div');
  modal.className = 'modal yanta-presentation-modal';
  modal.hidden = true;

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closePresentationSessionModal();
    if (e.target.closest?.('[data-presentation-close]')) {
      closePresentationSessionModal();
    }
  });

  document.body.append(modal);
  return modal;
}

function getConfiguredVaultId() {
  return store.settings.get('sync2.yantaCloud.vaultId', '');
}

function closeOwnerSocket() {
  if (!ownerSocket) return;

  try {
    ownerSocket.close();
  } catch {}

  ownerSocket = null;
}

function sendOwnerMessage(data = {}) {
  if (!ownerSocket || ownerSocket.readyState !== WebSocket.OPEN) return;
  if (!activeSession?.signalingTopic || !activeSession?.signalingToken) return;

  ownerSocket.send(JSON.stringify({
    type: 'publish',
    topic: activeSession.signalingTopic,
    data: {
      ...data,
      token: activeSession.signalingToken,
    },
  }));
}

function currentSlide() {
  const slides = normalizeSlides(activeSession?.drawing?.slides || []).filter((s) => !s.hidden);
  return slides[ownerIndex] || null;
}

function currentNotesText() {
  const slide = currentSlide();
  if (!slide) return '';

  return String(slide.notes?.markdown || slide.presenterNotes || '');
}

async function renderOwnerSlideSvgString(drawing, slide) {
  const mod = await import('@excalidraw/excalidraw');

  if (typeof mod.exportToSvg !== 'function') {
    throw new Error('Excalidraw SVG export unavailable');
  }

  const content = visibleElementsInSlide(drawing.elements || [], slide);
  const virtual = makeVirtualElementForSlide(slide);

  const svg = await mod.exportToSvg({
    elements: [
      ...content,
      virtual,
    ],
    appState: {
      ...(drawing.appState || {}),
      exportBackground: true,
      viewBackgroundColor:
        document.documentElement.dataset.theme === 'dark'
          ? '#121212'
          : '#ffffff',
    },
    files: drawing.files || {},
  });

  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  return new XMLSerializer().serializeToString(svg);
}

function showOwnerLaserDot(host, x, y) {
  const dot = host?.querySelector('[data-owner-laser-dot]');
  const preview = host?.querySelector('[data-owner-slide-preview] svg') ||
    host?.querySelector('[data-owner-slide-preview]');

  if (!dot || !preview) return;

  const wrapRect = host.getBoundingClientRect();
  const svgRect = preview.getBoundingClientRect();

  dot.style.left = `${svgRect.left - wrapRect.left + Math.max(0, Math.min(1, x)) * svgRect.width}px`;
  dot.style.top = `${svgRect.top - wrapRect.top + Math.max(0, Math.min(1, y)) * svgRect.height}px`;
  dot.classList.add('visible');

  clearTimeout(dot._hideTimer);

  dot._hideTimer = window.setTimeout(() => {
    dot.classList.remove('visible');
  }, 850);
}

async function hydrateOwnerSlidePreview() {
  const host = modal?.querySelector('[data-owner-preview-host]');
  const preview = modal?.querySelector('[data-owner-slide-preview]');

  if (!host || !preview || !activeSession) return;

  const slides = normalizeSlides(activeSession.drawing?.slides || []).filter((s) => !s.hidden);
  const slide = slides[ownerIndex] || null;

  if (!slide) {
    preview.innerHTML = '<div style="color:var(--text-faint);font-size:13px">No slide preview</div>';
    return;
  }

  preview.innerHTML = '<div style="color:var(--text-faint);font-size:13px">Rendering slide…</div>';

  try {
    const svg = await renderOwnerSlideSvgString(activeSession.drawing, slide);

    if (!preview.isConnected) return;

    preview.innerHTML = svg;
  } catch (err) {
    console.warn('[YANTA Presentation] owner preview failed', err);

    if (!preview.isConnected) return;

    preview.innerHTML = '<div style="color:var(--text-faint);font-size:13px">Preview unavailable</div>';
  }
}

function bindOwnerLaserPad() {
  const host = modal?.querySelector('[data-owner-preview-host]');
  const preview = modal?.querySelector('[data-owner-slide-preview]');

  if (!host || !preview || host.dataset.laserBound === '1') return;

  host.dataset.laserBound = '1';

  const pointerToUnit = (e) => {
    const svg = preview.querySelector('svg') || preview;
    const rect = svg.getBoundingClientRect();

    if (!rect.width || !rect.height) return null;

    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const sendLaser = (e) => {
    const unit = pointerToUnit(e);

    if (!unit) return;

    showOwnerLaserDot(host, unit.x, unit.y);

    sendOwnerMessage({
      kind: 'laser',
      unit: 'slide',
      x: unit.x,
      y: unit.y,
      ts: Date.now(),
    });
  };

  host.addEventListener('pointerdown', (e) => {
    e.preventDefault();

    try {
      host.setPointerCapture?.(e.pointerId);
    } catch {}

    sendLaser(e);
  });

  host.addEventListener('pointermove', (e) => {
    if (!(e.buttons & 1)) return;
    e.preventDefault();
    sendLaser(e);
  });
}

function publishOwnerState() {
  const slides = normalizeSlides(activeSession?.drawing?.slides || []).filter((s) => !s.hidden);
  const slide = slides[ownerIndex] || null;

  sendOwnerMessage({
    kind: 'state',
    index: ownerIndex,
    total: slides.length,
    title: slide?.title || '',
    notes: currentNotesText(),
    slideId: slide?.id || '',
  });
}

function renderOwnerRemotePanel() {
  const host = modal?.querySelector('[data-presentation-remote]');
  if (!host || !activeSession) return;

  const slides = normalizeSlides(activeSession.drawing?.slides || []).filter((s) => !s.hidden);
  const slide = slides[ownerIndex] || null;

  host.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      ${lucide('presentation', 16)}
      <strong style="flex:1;min-width:0">
        ${escapeHtml(slide?.title || 'Slide')}
      </strong>
      <span style="color:var(--text-dim);font-size:12px">
        ${slides.length ? `${ownerIndex + 1} / ${slides.length}` : 'No slides'}
      </span>
    </div>

    <div class="yanta-presentation-owner-preview" data-owner-preview-host>
      <div data-owner-slide-preview style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">
        <div style="color:var(--text-faint);font-size:13px">Rendering slide…</div>
      </div>
      <div class="yanta-presentation-owner-laser-dot" data-owner-laser-dot></div>
    </div>

    <div class="compress-actions" style="justify-content:center">
      <button class="btn" data-presentation-prev>${lucide('chevron-left', 14)} Prev</button>
      <button class="btn primary" data-presentation-next>Next ${lucide('chevron-right', 14)}</button>
    </div>

    <div class="yanta-presentation-notes">
      ${escapeHtml(currentNotesText() || 'No presenter notes for this slide.')}
    </div>

    <div class="yanta-presentation-info ${latestDraft ? 'yanta-presentation-draft' : ''}">
      ${
        latestDraft
          ? `
            <strong>Scoped edits received.</strong><br>
            The target device changed the session copy.
            Apply them to your original drawing or discard them.
          `
          : `
            Waiting for scoped edits from the target device.
          `
      }
    </div>

    <div class="compress-actions">
      <button class="btn primary" data-presentation-apply ${latestDraft ? '' : 'disabled'}>
        ${lucide('check', 14)}
        Apply to original
      </button>

      <button class="btn" data-presentation-discard ${latestDraft ? '' : 'disabled'}>
        ${lucide('rotate-ccw', 14)}
        Discard draft
      </button>

      <span class="grow"></span>

      <button class="btn danger" data-presentation-end>
        ${lucide('x', 14)}
        End session
      </button>
    </div>
  `;

  host.querySelector('[data-presentation-prev]')?.addEventListener('click', () => {
    ownerIndex = Math.max(0, ownerIndex - 1);
    sendOwnerMessage({
      kind: 'go',
      index: ownerIndex,
    });
    publishOwnerState();
    renderOwnerRemotePanel();
  });

  host.querySelector('[data-presentation-next]')?.addEventListener('click', () => {
    ownerIndex = Math.min(Math.max(0, slides.length - 1), ownerIndex + 1);
    sendOwnerMessage({
      kind: 'go',
      index: ownerIndex,
    });
    publishOwnerState();
    renderOwnerRemotePanel();
  });

  host.querySelector('[data-presentation-apply]')?.addEventListener('click', async () => {
    await applyLatestDraft();
  });

  host.querySelector('[data-presentation-discard]')?.addEventListener('click', () => {
    latestDraft = null;
    sendOwnerMessage({
      kind: 'discard-draft',
    });
    renderOwnerRemotePanel();
    toast('Presentation draft discarded', 'success');
  });

  host.querySelector('[data-presentation-end]')?.addEventListener('click', async () => {
    await endActivePresentationSession();
  });

  hydrateOwnerSlidePreview().then(() => {
    bindOwnerLaserPad();
  }).catch(() => {});
}

function openOwnerSocket() {
  closeOwnerSocket();

  ownerSocket = new WebSocket(SIGNALING_URL);

  ownerSocket.addEventListener('open', () => {
    ownerSocket.send(JSON.stringify({
      type: 'subscribe',
      topics: [activeSession.signalingTopic],
    }));

    publishOwnerState();
  });

  ownerSocket.addEventListener('message', (event) => {
    let msg = null;

    try {
      msg = JSON.parse(event.data);
    } catch {}

    const data = msg?.data;
    if (!data || data.token !== activeSession.signalingToken) return;

    if (data.kind === 'hello') {
      publishOwnerState();
      return;
    }

    if (data.kind === 'slide') {
      const slides = normalizeSlides(activeSession.drawing?.slides || []).filter((s) => !s.hidden);
      ownerIndex = Math.max(0, Math.min(slides.length - 1, Number(data.index || 0)));
      publishOwnerState();
      renderOwnerRemotePanel();
      return;
    }

    if (data.kind === 'draft') {
      latestDraft = data.draft || null;
      renderOwnerRemotePanel();
    }
  });
}

async function applyLatestDraft() {
  if (!activeSession || !latestDraft) return;

  const ok = await yantaConfirm({
    title: 'Apply scoped edits?',
    message: [
      'Apply the meeting-room edits to the original drawing?',
      '',
      'This will replace the original drawing scene with the current session draft.',
      'Slides and presenter notes stay private and are preserved.',
    ].join('\n'),
    confirmLabel: 'Apply edits',
    cancelLabel: 'Cancel',
    icon: 'check',
  });

  if (!ok) return;

  const current = getDrawing(activeSession.noteId, activeSession.drawingId);

  if (!current) {
    toast('Original drawing not found', 'error');
    return;
  }

  const draftContentElements = (latestDraft.elements || [])
    .filter((el) => el && !isSlideFrameElement(el));

  const originalSlideFrameElements = (current.elements || [])
    .filter((el) => el && isSlideFrameElement(el));

  setDrawing(activeSession.noteId, activeSession.drawingId, {
    ...current,

    /*
      Scoped Edit Apply:
      - session content edits come from the target device (e.g. meeting-room laptop)
      - original slide-frame authoring elements stay private/local
      - slide metadata + presenter notes are preserved
    */
    elements: [
      ...draftContentElements,
      ...originalSlideFrameElements,
    ],

    appState: latestDraft.appState || {},
    files: latestDraft.files || {},

    slides: current.slides || [],
    slideDecks: current.slideDecks || [],
    defaultSlideDeckId: current.defaultSlideDeckId || null,
    presentationSettings: current.presentationSettings || null,
  }, 'presentation-apply');

  window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
    detail: {
      noteId: activeSession.noteId,
      drawingId: activeSession.drawingId,
      reason: 'presentation-apply',
    },
  }));

  latestDraft = null;

  sendOwnerMessage({
    kind: 'draft-applied',
  });

  renderOwnerRemotePanel();
  toast('Scoped edits applied to original', 'success');
}

async function endActivePresentationSession() {
  if (!activeSession) return;

  const ok = await yantaConfirm({
    title: 'End presentation session?',
    message: 'The meeting-room display will lose access to this session.',
    confirmLabel: 'End session',
    cancelLabel: 'Cancel',
    danger: true,
    icon: 'x',
  });

  if (!ok) return;

  sendOwnerMessage({
    kind: 'end',
  });

  try {
    await deletePresentationSession(activeSession.sessionId);
  } catch {}

  closePresentationSessionModal();
  toast('Presentation session ended', 'success');
}

export function closePresentationSessionModal() {
  closeOwnerSocket();

  if (modal) {
    modal.hidden = true;
  }

  activeSession = null;
  latestDraft = null;
  ownerIndex = 0;
}

export async function createPresentationSessionForDrawing({
  noteId = state.currentNoteId,
  drawingId,
  ttlMs = 2 * 60 * 60 * 1000,
} = {}) {
  if (!noteId || !drawingId) {
    throw new Error('noteId and drawingId required');
  }

  const drawing = getDrawing(noteId, drawingId);

  if (!drawing) {
    throw new Error('Drawing not found');
  }

  const vaultId = await getConfiguredVaultId();
  const key = generatePresentationKeyString();

  const created = await createPresentationSession({
    vaultId,
    sourceType: 'drawing',
    sourceId: drawingId,
    ttlMs,
  });

  const session = created.session;

  const packed = await packPresentationSession({
    noteId,
    drawingId,
    session,
  });

  const encryptedPayload = await encryptPresentationPayload(
    key,
    packed.payload
  );

  await publishPresentationSessionPayload(session.sessionId, {
    encryptedPayload,
    etag: packed.payloadHash,
  });

  const url = makePresentationUrl(session.sessionId, key);

  return {
    session,
    key,
    url,
    drawing,
    noteId,
    drawingId,
  };
}

export function openPresentationControllerForExistingSession({
  noteId = state.currentNoteId,
  drawingId,
  drawing,
  session,
  url,
} = {}) {
  if (!session?.sessionId || !session?.signalingTopic || !session?.signalingToken) {
    throw new Error('Invalid presentation session.');
  }

  const m = ensureModal();

  m.hidden = false;

  activeSession = {
    ...session,
    displayUrl: url,
    noteId,
    drawingId,
    drawing,
  };

  latestDraft = null;
  ownerIndex = 0;

  m.innerHTML = `
    <div class="modal-card yanta-presentation-card">
      <header class="modal-head">
        <h3>Meeting Room Presentation</h3>
        <button class="icon-btn" data-presentation-close>&times;</button>
      </header>

      <div class="modal-body">
        <div class="yanta-presentation-box">
          <div class="yanta-presentation-info">
            <strong>Display connected</strong><br>
            The target device can edit only a temporary session copy.
            You decide whether to apply or discard edits.
          </div>

          <div class="yanta-presentation-link-row">
            <input class="text-input" readonly value="${escapeAttr(url || '')}" data-presentation-link>
            <button class="btn primary" data-copy-presentation-link>${lucide('copy', 14)} Copy</button>
          </div>

          <div class="yanta-presentation-qr" data-presentation-qr></div>

          <section class="yanta-presentation-remote" data-presentation-remote></section>
        </div>
      </div>
    </div>
  `;

  if (url) {
    m.querySelector('[data-presentation-qr]')?.append(renderBrandedQrSvg(url, {
      size: 230,
      logo: BRAND_LOGO_SVG,
    }));
  }

  m.querySelector('[data-copy-presentation-link]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url || '');
      toast('Presentation link copied', 'success');
    } catch {
      toast('Copy failed', 'error');
    }
  });

  openOwnerSocket();
  renderOwnerRemotePanel();

  return activeSession;
}

export async function openPresentationSessionModal({
  noteId = state.currentNoteId,
  drawingId,
} = {}) {
  if (!noteId || !drawingId) {
    toast('Open a drawing first', 'error');
    return;
  }

  const drawing = getDrawing(noteId, drawingId);

  if (!drawing) {
    toast('Drawing not found', 'error');
    return;
  }

  const m = ensureModal();

  m.hidden = false;
  m.innerHTML = `
    <div class="modal-card yanta-presentation-card">
      <header class="modal-head">
        <h3>Meeting Room Presentation</h3>
        <button class="icon-btn" data-presentation-close>&times;</button>
      </header>

      <div class="modal-body">
        <div class="yanta-presentation-box">
          <div class="yanta-presentation-info">
            Creating a temporary encrypted presentation session…
          </div>
        </div>
      </div>
    </div>
  `;

  try {
    const vaultId = await getConfiguredVaultId();
    const key = generatePresentationKeyString();

    const created = await createPresentationSession({
      vaultId,
      sourceType: 'drawing',
      sourceId: drawingId,
      ttlMs: 2 * 60 * 60 * 1000,
    });

    const session = created.session;

    const packed = await packPresentationSession({
      noteId,
      drawingId,
      session,
    });

    const encryptedPayload = await encryptPresentationPayload(
      key,
      packed.payload
    );

    await publishPresentationSessionPayload(session.sessionId, {
      encryptedPayload,
      etag: packed.payloadHash,
    });

    const url = makePresentationUrl(session.sessionId, key);

    activeSession = {
      ...session,
      displayUrl: url,
      noteId,
      drawingId,
      drawing,
    };

    latestDraft = null;
    ownerIndex = 0;

    m.innerHTML = `
      <div class="modal-card yanta-presentation-card">
        <header class="modal-head">
          <h3>Meeting Room Presentation</h3>
          <button class="icon-btn" data-presentation-close>&times;</button>
        </header>

        <div class="modal-body">
          <div class="yanta-presentation-box">
            <div class="yanta-presentation-info">
              <strong>Display link</strong><br>
              Open this on the target device. It can edit only a temporary session copy.
              You decide whether to apply or discard edits.
            </div>

            <div class="yanta-presentation-link-row">
              <input class="text-input" readonly value="${escapeAttr(url)}" data-presentation-link>
              <button class="btn primary" data-copy-presentation-link>${lucide('copy', 14)} Copy</button>
            </div>

            <div class="yanta-presentation-qr" data-presentation-qr></div>

            <section class="yanta-presentation-remote" data-presentation-remote></section>
          </div>
        </div>
      </div>
    `;

    m.querySelector('[data-presentation-qr]')?.append(renderBrandedQrSvg(url, {
      size: 230,
      logo: BRAND_LOGO_SVG,
    }));

    m.querySelector('[data-copy-presentation-link]')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        toast('Presentation link copied', 'success');
      } catch {
        toast('Copy failed', 'error');
      }
    });

    openOwnerSocket();
    renderOwnerRemotePanel();
    toast('Presentation session ready', 'success');
  } catch (err) {
    console.error('[YANTA Presentation] session creation failed', err);

    m.innerHTML = `
      <div class="modal-card yanta-presentation-card">
        <header class="modal-head">
          <h3>Meeting Room Presentation</h3>
          <button class="icon-btn" data-presentation-close>&times;</button>
        </header>

        <div class="modal-body">
          <div class="yanta-presentation-info">
            <strong>Could not create presentation session.</strong><br>
            ${escapeHtml(err?.message || String(err))}
          </div>
        </div>
      </div>
    `;

    toast(err?.message || 'Could not create presentation session', 'error');
  }
}