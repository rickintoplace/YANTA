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
      <button type="button" class="yanta-pr-icon" data-menu aria-label="${escapeHtml(t('present.remote.more'))}">${lucide('ellipsis', 20)}</button>
    </header>

    <div class="yanta-pr-banner" data-banner hidden></div>

    <main class="yanta-pr-main">
      <div class="yanta-pr-now" data-now>
        <img alt="" data-now-img draggable="false">
        <div class="yanta-pr-laser" data-laser></div>
        <div class="yanta-pr-paused" data-paused hidden>
          <p>${escapeHtml(t('present.remote.notPresenting'))}</p>
          <button type="button" class="yanta-pr-start" data-start>${lucide('play', 18)} ${escapeHtml(t('present.remote.start'))}</button>
        </div>
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

      <div class="yanta-pr-notes" data-notes></div>
    </main>

    <footer class="yanta-pr-controls">
      <button type="button" class="yanta-pr-btn" data-prev aria-label="${escapeHtml(t('present.remote.previous'))}">${lucide('chevron-left', 30)}</button>
      <button type="button" class="yanta-pr-btn is-blank" data-blank aria-label="${escapeHtml(t('present.remote.blank'))}" title="${escapeHtml(t('present.remote.blank'))}">${lucide('monitor-off', 20)}</button>
      <button type="button" class="yanta-pr-btn is-next" data-next-btn aria-label="${escapeHtml(t('present.remote.next'))}">${lucide('chevron-right', 34)}</button>
    </footer>

    <div class="yanta-pr-progress"><i data-progress></i></div>
  `;

  const $ = (sel) => container.querySelector(sel);
  const nowImg = $('[data-now-img]');
  const nextImg = $('[data-next-img]');
  const now = $('[data-now]');
  const laserDot = $('[data-laser]');

  let deck = null;
  let state = null;
  let status = 'online';
  let renderToken = 0;

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
    laserDot.style.transform = `translate(${p.rect.left - host.left + p.x * p.rect.width}px, ${p.rect.top - host.top + p.y * p.rect.height}px)`;
    laserDot.classList.add('is-visible');
  };

  now.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-paused]')) return;

    gesture = { x: e.clientX, y: e.clientY, at: Date.now(), laser: false, id: e.pointerId };

    try {
      now.setPointerCapture(e.pointerId);
    } catch {}

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
      laserDot.classList.remove('is-visible');
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

  function renderText() {
    $('[data-title]').textContent = state?.title || deck?.title || '';

    const statusEl = $('[data-status]');
    statusEl.dataset.state = status;
    statusEl.title = t(`present.status.${status}`);

    const banner = $('[data-banner]');
    const bannerText = status === 'online' ? '' : t(`present.status.${status}`);
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

    const notes = slide ? deck?.notes?.[slide.id] || '' : '';
    const notesEl = $('[data-notes]');
    notesEl.textContent = notes;
    notesEl.classList.toggle('is-empty', !notes);
    notesEl.dataset.empty = t('present.remote.noNotes');

    $('[data-paused]').hidden = !!state.presenting;
    $('[data-blank]').classList.toggle('is-on', !!state.blank);
    $('[data-prev]').disabled = state.index === 0 && state.step === 0;
    $('[data-next-btn]').disabled = !next;
    $('[data-progress]').style.width = `${Math.round(progressOf(counts, position) * 100)}%`;
  }

  return {
    update(next = {}) {
      if ('deck' in next) deck = next.deck;
      if ('state' in next) state = next.state;
      if ('status' in next) status = next.status;

      renderText();
      renderPreviews();
    },

    destroy() {
      clearInterval(timer);
      document.removeEventListener('keydown', onKey);
      container.replaceChildren();
      container.classList.remove('yanta-present-remote');
    },
  };
}
