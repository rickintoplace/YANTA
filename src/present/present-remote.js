// ============================================================
// YANTA Present — the remote
//
// A phone (or any device) that controls the presentation: what the audience
// sees right now, what comes next, the presenter notes, a timer, and two big
// buttons. Swipe the slide to move, hold a finger on it for the laser.
//
// Driven through a small adapter, so the same remote works for a device
// that joined over the network and for the presenting phone itself
// ("presenter view", when the slides are on another screen).
// ============================================================

import { escapeHtml, lucide } from '../core.js';
import { t } from '../i18n/index.js';
import { loadExcalidraw } from '../draw-runtime.js';
import { hiddenIdsAt } from '../slides/slides-animation.js';
import { makeVirtualElementForSlide, visibleElementsInSlide } from '../slides/slides-model.js';
import { nextPosition, progressOf } from './present-protocol.js';
import { createLaser } from './present-laser.js';

const LASER_EVERY_MS = 60;

/** Renders "what the audience sees" at one position: the slide, its builds so far. */
const previewCache = new Map();

async function renderPosition(deck, position, { maxSize = 900 } = {}) {
  const slide = deck?.slides?.[position.index];
  if (!slide) return '';

  const key = `${deck.version}:${position.index}:${position.step}:${maxSize}`;
  if (previewCache.has(key)) return previewCache.get(key);

  const job = (async () => {
    const { exportToBlob } = await loadExcalidraw();
    const hidden = hiddenIdsAt(deck.slides, position.index, position.step);
    const elements = visibleElementsInSlide(deck.elements || [], slide).filter((el) => !hidden.has(el.id));

    const blob = await exportToBlob({
      elements: [...elements, makeVirtualElementForSlide(slide)],
      appState: {
        exportBackground: true,
        viewBackgroundColor: deck.appState?.viewBackgroundColor || '#ffffff',
        exportWithDarkMode: deck.appState?.theme === 'dark',
      },
      files: deck.files || {},
      mimeType: 'image/webp',
      quality: 0.85,
      exportPadding: 0,
      maxWidthOrHeight: maxSize,
    });

    return URL.createObjectURL(blob);
  })();

  previewCache.set(key, job);

  // A handful of renders is plenty; drop the oldest.
  if (previewCache.size > 24) {
    const [oldKey, oldJob] = previewCache.entries().next().value;
    previewCache.delete(oldKey);
    oldJob.then((url) => url && setTimeout(() => URL.revokeObjectURL(url), 5000)).catch(() => {});
  }

  return job.catch(() => '');
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);

  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/**
 * adapter: {
 *   command(op, extra)   next | prev | goto | blank | start
 *   laser(point)         { x, y, on }
 *   leave()              optional: "Disconnect"
 *   editNotes(id, text)  optional: save a presenter note
 *   notesPending(id)     optional: an edit is still on its way
 *   switchToScreen()     optional: "Show slides on this device"
 *   connect()            optional: open "Connect devices" (presenter view)
 *   closeLabel           optional label for leave (presenter view: "Exit")
 * }
 */
export function mountRemote(container, adapter) {
  container.classList.add('yanta-present-remote');

  container.innerHTML = `
    <header class="yanta-pr-top">
      <span class="yanta-pr-status" data-status title=""></span>
      <div class="yanta-pr-title" data-title></div>
      <span class="yanta-pr-timer" data-timer>0:00</span>
      <button type="button" class="yanta-pr-icon" data-overview aria-label="${escapeHtml(t('present.remote.overview'))}" title="${escapeHtml(t('present.remote.overview'))}">${lucide('layout-grid', 19)}</button>
      <button type="button" class="yanta-pr-icon" data-menu aria-label="${escapeHtml(t('present.remote.more'))}">${lucide('ellipsis', 20)}</button>
    </header>

    <div class="yanta-pr-banner" data-banner hidden></div>

    <main class="yanta-pr-main">
      <div class="yanta-pr-notes-box">
        <textarea class="yanta-pr-notes" data-notes spellcheck="true" aria-label="${escapeHtml(t('present.remote.notesLabel'))}"></textarea>
        <span class="yanta-pr-notes-status" data-notes-status></span>
      </div>
      <div class="yanta-pr-next-row">
        <div class="yanta-pr-next" data-next>
          <img alt="" data-next-img draggable="false">
        </div>
        <div class="yanta-pr-next-meta">
          <span class="yanta-pr-next-label" data-next-label></span>
          <span class="yanta-pr-count" data-count></span>
        </div>
      </div>

      <div class="yanta-pr-now" data-now>
        <img alt="" data-now-img draggable="false">
        <div class="yanta-pr-paused" data-paused hidden>
          <p>${escapeHtml(t('present.remote.notPresenting'))}</p>
          <button type="button" class="yanta-pr-start" data-start>${lucide('play', 18)} ${escapeHtml(t('present.remote.start'))}</button>
        </div>
      </div>

    </main>

    <footer class="yanta-pr-controls">
      <button type="button" class="yanta-pr-btn" data-prev aria-label="${escapeHtml(t('present.remote.previous'))}">${lucide('chevron-left', 30)}</button>
      <button type="button" class="yanta-pr-btn is-tool" data-laser-btn aria-pressed="false" aria-label="${escapeHtml(t('present.remote.laser'))}" title="${escapeHtml(t('present.remote.laser'))}">${lucide('mouse-pointer-2', 20)}</button>
      <button type="button" class="yanta-pr-btn is-tool" data-blank aria-label="${escapeHtml(t('present.remote.blank'))}" title="${escapeHtml(t('present.remote.blank'))}">${lucide('monitor-off', 20)}</button>
      <button type="button" class="yanta-pr-btn is-next" data-next-btn aria-label="${escapeHtml(t('present.remote.next'))}">${lucide('chevron-right', 34)}</button>
    </footer>

    <div class="yanta-pr-progress"><i data-progress></i></div>
  `;

  const $ = (sel) => container.querySelector(sel);
  const nowImg = $('[data-now-img]');
  const nextImg = $('[data-next-img]');
  const now = $('[data-now]');
  const laserDot = createLaser(now);

  let deck = null;
  let state = null;
  let status = 'online';
  let renderToken = 0;
  let laserMode = false;

  const laserBtn = $('[data-laser-btn]');

  // The laser button: while on, a finger on the slide is the laser pointer.
  laserBtn.addEventListener('click', () => {
    laserMode = !laserMode;
    laserBtn.setAttribute('aria-pressed', laserMode ? 'true' : 'false');
    laserBtn.classList.toggle('is-on', laserMode);
    now.classList.toggle('is-laser', laserMode);

    if (!laserMode) {
      laserDot.hide();
      adapter.laser({ on: false });
    }
  });

  // A long press must not open the browser's context menu (it cancels the touch).
  now.addEventListener('contextmenu', (e) => e.preventDefault());

  const press = (op, extra) => {
    navigator.vibrate?.(8);
    adapter.command(op, extra);
  };

  $('[data-prev]').addEventListener('click', () => press('prev'));
  $('[data-next-btn]').addEventListener('click', () => press('next'));
  $('[data-blank]').addEventListener('click', () => press('blank'));
  $('[data-start]').addEventListener('click', () => press('start'));

  $('[data-menu]').addEventListener('click', async (e) => {
    const items = [];

    if (adapter.connect) {
      items.push({ label: t('present.connect.menu'), icon: 'cast', action: adapter.connect });
    }

    if (adapter.edit) {
      items.push({ label: t('present.edit.button'), icon: 'pencil', action: adapter.edit });
    }

    if (adapter.switchToScreen) {
      items.push({ label: t('present.remote.showHere'), icon: 'monitor', action: adapter.switchToScreen });
    }

    items.push({ label: t('present.remote.fullscreen'), icon: 'maximize', action: () => document.documentElement.requestFullscreen?.().catch(() => {}) });

    if (adapter.leave) {
      items.push('hr', { label: adapter.closeLabel || t('present.remote.disconnect'), icon: 'log-out', danger: true, action: adapter.leave });
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const { showMenu } = await import('../tree.js');
    showMenu(rect.right, rect.bottom + 6, items, { align: 'end' });
  });

  // Keyboard and presentation clickers on a laptop used as the remote.
  const onKey = (e) => {
    if (e.target?.closest?.('input, textarea, [contenteditable="true"]')) return;

    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) {
      e.preventDefault();
      press('next');
    } else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) {
      e.preventDefault();
      press('prev');
    } else if (e.key === 'b' || e.key === 'B' || e.key === '.') {
      press('blank');
    }
  };

  document.addEventListener('keydown', onKey);

  // ---- Gestures on the current slide: swipe = move, hold = laser.

  let gesture = null;
  let laserSentAt = 0;

  const pointInSlide = (e) => {
    const rect = nowImg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
      rect,
    };
  };

  const showLaser = (p) => {
    const host = now.getBoundingClientRect();
    laserDot.moveTo(p.rect.left - host.left + p.x * p.rect.width, p.rect.top - host.top + p.y * p.rect.height);
  };

  now.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-paused]')) return;

    gesture = { x: e.clientX, y: e.clientY, at: Date.now(), laser: false, id: e.pointerId };

    try {
      now.setPointerCapture(e.pointerId);
    } catch {}

    if (laserMode) {
      gesture.laser = true;

      const p = pointInSlide(e);
      if (p) {
        showLaser(p);
        laserSentAt = Date.now();
        adapter.laser({ x: p.x, y: p.y, on: true });
      }
      return;
    }

    // Without the laser button: holding still for a moment also points.
    gesture.holdTimer = setTimeout(() => {
      if (!gesture) return;
      gesture.laser = true;
      navigator.vibrate?.(12);

      const p = pointInSlide({ clientX: gesture.lastX ?? gesture.x, clientY: gesture.lastY ?? gesture.y });
      if (p) {
        showLaser(p);
        adapter.laser({ x: p.x, y: p.y, on: true });
      }
    }, 280);
  });

  now.addEventListener('pointermove', (e) => {
    if (!gesture || e.pointerId !== gesture.id) return;

    gesture.lastX = e.clientX;
    gesture.lastY = e.clientY;

    if (!gesture.laser) {
      // Moving before the hold kicks in means a swipe, not a laser.
      if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 12) clearTimeout(gesture.holdTimer);
      return;
    }

    e.preventDefault();

    const p = pointInSlide(e);
    if (!p) return;

    showLaser(p);

    if (Date.now() - laserSentAt >= LASER_EVERY_MS) {
      laserSentAt = Date.now();
      adapter.laser({ x: p.x, y: p.y, on: true });
    }
  });

  const endGesture = (e) => {
    if (!gesture || e.pointerId !== gesture.id) return;

    clearTimeout(gesture.holdTimer);

    if (gesture.laser) {
      laserDot.hide();
      adapter.laser({ on: false });
    } else {
      const dx = e.clientX - gesture.x;
      const dy = e.clientY - gesture.y;
      const fast = Date.now() - gesture.at < 600;

      if (fast && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        press(dx < 0 ? 'next' : 'prev');
      } else if (Math.hypot(dx, dy) < 10) {
        // A plain tap on the slide moves on, like a clicker.
        press('next');
      }
    }

    gesture = null;
  };

  now.addEventListener('pointerup', endGesture);
  now.addEventListener('pointercancel', endGesture);

  // ---- All slides at a glance: tap one to go there.

  let overview = null;

  function closeOverview() {
    overview?.remove();
    overview = null;
  }

  function openOverview() {
    if (!deck || !state || overview) return;

    const counts = state.counts || deck.slides.map(() => 0);

    overview = document.createElement('div');
    overview.className = 'yanta-pr-overview';
    overview.innerHTML = `
      <div class="yanta-pr-overview-head">
        <strong>${escapeHtml(t('present.remote.overview'))}</strong>
        <button type="button" class="yanta-pr-icon" data-close aria-label="${escapeHtml(t('common.close'))}">${lucide('x', 20)}</button>
      </div>
      <div class="yanta-pr-overview-grid">
        ${deck.slides.map((slide, i) => `
          <button type="button" class="yanta-pr-overview-item ${i === state.index ? 'is-current' : ''}" data-goto="${i}">
            <span class="yanta-pr-overview-thumb"><img alt="" data-thumb="${i}" draggable="false"></span>
            <span class="yanta-pr-overview-title"><b>${i + 1}</b> ${escapeHtml(slide.title || '')}</span>
          </button>
        `).join('')}
      </div>
    `;

    overview.querySelector('[data-close]').addEventListener('click', closeOverview);
    overview.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => {
        press('goto', { index: Number(btn.dataset.goto) });
        closeOverview();
      });
    });

    container.append(overview);
    overview.querySelector('.is-current')?.scrollIntoView({ block: 'center' });

    // One slide after another: a phone renders a whole deck without stalling.
    (async () => {
      for (let i = 0; i < deck.slides.length; i++) {
        if (!overview) return;

        const url = await renderPosition(deck, { index: i, step: counts[i] || 0 }, { maxSize: 360 });
        const img = overview?.querySelector(`[data-thumb="${i}"]`);
        if (img && url) img.src = url;
      }
    })();
  }

  $('[data-overview]').addEventListener('click', openOverview);

  // ---- Timer

  const timer = setInterval(() => {
    const el = $('[data-timer]');
    if (el) el.textContent = state?.startedAt ? formatElapsed(Date.now() - state.startedAt) : '0:00';
  }, 1000);

  async function renderPreviews() {
    if (!deck || !state) return;

    const token = ++renderToken;
    const counts = state.counts || deck.slides.map(() => 0);
    const position = { index: state.index, step: state.step };
    const next = nextPosition(counts, position);

    const [nowUrl, nextUrl] = await Promise.all([
      renderPosition(deck, position),
      next ? renderPosition(deck, next, { maxSize: 480 }) : Promise.resolve(''),
    ]);

    if (token !== renderToken) return;

    if (nowUrl) nowImg.src = nowUrl;

    if (nextUrl) {
      nextImg.src = nextUrl;
      nextImg.hidden = false;
    } else {
      nextImg.removeAttribute('src');
      nextImg.hidden = true;
    }
  }

  // ---- Presenter notes: readable and, where the presenter allows, editable.

  const notesEl = $('[data-notes]');
  const notesStatus = $('[data-notes-status]');
  let notesSlideId = null;
  let notesTimer = 0;
  let notesDirty = false;
  let statusTimer = 0;

  const setNotesStatus = (text) => {
    clearTimeout(statusTimer);
    notesStatus.textContent = text;
    if (text) statusTimer = setTimeout(() => { notesStatus.textContent = ''; }, 2200);
  };

  const flushNotes = () => {
    clearTimeout(notesTimer);
    notesTimer = 0;
    if (!notesDirty || !notesSlideId) return;

    notesDirty = false;
    adapter.editNotes?.(notesSlideId, notesEl.value);
    setNotesStatus(t('present.remote.notesSaved'));
  };

  notesEl.addEventListener('input', () => {
    notesDirty = true;
    notesStatus.textContent = t('present.remote.notesSaving');
    clearTimeout(notesTimer);
    notesTimer = setTimeout(flushNotes, 600);
  });

  notesEl.addEventListener('blur', flushNotes);

  function renderNotes(slide) {
    const slideId = slide?.id || '';
    const editable = !!adapter.editNotes && !!slideId && slideId !== '__board';
    const incoming = slideId ? deck?.notes?.[slideId] || '' : '';

    notesEl.readOnly = !editable;
    notesEl.placeholder = editable ? t('present.remote.notesPlaceholder') : t('present.remote.noNotes');

    if (slideId !== notesSlideId) {
      flushNotes();
      notesSlideId = slideId;
      notesEl.value = incoming;
      return;
    }

    // Never under the presenter's fingers: their own text wins until saved.
    const busy = document.activeElement === notesEl || notesDirty || adapter.notesPending?.(slideId);
    if (!busy && notesEl.value !== incoming) notesEl.value = incoming;
  }

  function renderText() {
    $('[data-title]').textContent = state?.title || deck?.title || '';

    const statusEl = $('[data-status]');
    statusEl.dataset.state = status;
    statusEl.title = t(`present.status.${status}`);

    const banner = $('[data-banner]');
    const bannerText = status !== 'online'
      ? t(`present.status.${status}`)
      : state?.editing ? t('present.edit.remoteBanner') : '';
    banner.hidden = !bannerText;
    banner.textContent = bannerText;

    if (!state) return;

    const counts = state.counts || [];
    const total = counts.length;
    const position = { index: state.index, step: state.step };
    const next = nextPosition(counts, position);
    const slide = deck?.slides?.[state.index];

    $('[data-count]').textContent = total ? t('present.remote.count', { n: state.index + 1, total }) : '';

    $('[data-next-label]').textContent = !next
      ? t('present.remote.end')
      : next.index === state.index
        ? t('present.remote.nextBuild')
        : t('present.remote.nextSlide', { title: deck?.slides?.[next.index]?.title || String(next.index + 1) });

    renderNotes(slide);

    $('[data-paused]').hidden = !!state.presenting;
    $('[data-blank]').classList.toggle('is-on', !!state.blank);
    $('[data-prev]').disabled = state.index === 0 && state.step === 0;
    $('[data-next-btn]').disabled = !next;
    $('[data-progress]').style.width = `${Math.round(progressOf(counts, position) * 100)}%`;
  }

  return {
    /** A laser point from another device (slide units), shown on the slide here too. */
    laser(point) {
      if (gesture?.laser) return;

      if (point?.on === false) {
        laserDot.hide();
        return;
      }

      const rect = nowImg.getBoundingClientRect();
      if (!rect.width) return;

      showLaser({ x: Number(point.x) || 0, y: Number(point.y) || 0, rect });
    },

    update(next = {}) {
      if ('deck' in next) deck = next.deck;
      if ('state' in next) state = next.state;
      if ('status' in next) status = next.status;

      renderText();
      renderPreviews();
    },

    destroy() {
      flushNotes();
      closeOverview();
      clearInterval(timer);
      document.removeEventListener('keydown', onKey);
      container.replaceChildren();
      container.classList.remove('yanta-present-remote');
    },
  };
}
