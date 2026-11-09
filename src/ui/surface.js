// ============================================================
// YANTA — one way to put something above the page
//
// Three kinds, one behaviour:
//   dialog   centered card for a task (settings of a thing, a form)
//   popover  small card next to what was tapped (a look at an entry)
//   sheet    from the bottom edge — what both become on a phone
//
// Every surface closes the same way (×, Escape, the back gesture, a tap
// on the scrim or, for a popover, anywhere outside), animates the same
// way, traps nothing but returns focus to where it came from, and looks
// the same: the tokens and `.ys-*` rules live in styles.css, not here.
//
//   const s = openSurface({ kind: 'dialog', title, label, className,
//                           anchor, width, onClose, historyId, footer });
//   s.body.innerHTML = …;  s.setTitle('…');  s.close();
//   s.closeThen(() => openSomethingElse());
// ============================================================

import { escapeAttr, escapeHtml, lucide } from '../core.js';
import { t } from '../i18n/index.js';
import { openBoundOverlay, overlayIdFromState } from '../overlay-history.js';

const PHONE = '(max-width: 640px)';
const open = new Set();

/*
  Closing a surface goes back in history, and that popstate lands a moment
  later. Anything that pushes an entry before then is undone by it — the
  overlay router sees "back to the page" and closes what just opened. So
  a closing surface leaves `settling` behind until its popstate is in,
  and the next surface (or closeThen) waits for it before touching history.
*/
let settling = null;

function goBack(release, historyId) {
  const ours = overlayIdFromState() === historyId;
  release();
  if (!ours) return;

  const landed = new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('popstate', done);
      resolve();
    };
    window.addEventListener('popstate', done);
    setTimeout(done, 350);
  });
  const mine = landed.then(() => {
    if (settling === mine) settling = null;
  });
  settling = mine;
}

export function isPhoneLayout() {
  return window.matchMedia(PHONE).matches;
}

/**
 * @param kind       'dialog' | 'popover' (both become a sheet on phones) | 'sheet'
 * @param title      header text; omit for a headless surface
 * @param label      accessible name when there is no visible title
 * @param anchor     element a popover sits next to
 * @param width      dialog/popover width in px (default 440 / 320)
 * @param className  extra class on the root, for content styles
 * @param historyId  overlay-history id (Back closes the surface)
 * @param onClose    called once, after the surface started closing
 * @param headerExtra HTML placed between title and close button
 * @param footer     true: a row under the body that does not scroll away
 *                   (`s.foot`), for the buttons that finish the task
 * @param adoptHistory the history entry is already there (swapOverlay
 *                   moved it over); bind to it instead of pushing one
 */
export function openSurface({
  kind = 'dialog',
  title = '',
  label = '',
  anchor = null,
  width = null,
  className = '',
  historyId = 'surface',
  onClose = null,
  headerExtra = '',
  footer = false,
  adoptHistory = false,
} = {}) {
  const phone = isPhoneLayout();
  const shape = phone || kind === 'sheet' ? 'sheet' : kind;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const root = document.createElement('div');
  root.className = `ys ys-${shape}${className ? ` ${className}` : ''}`;
  root.setAttribute('role', 'dialog');
  if (shape !== 'popover') root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', title || label || '');
  root.innerHTML = `
    ${shape === 'popover' ? '' : '<div class="ys-scrim" data-ys-close></div>'}
    <div class="ys-surface"${width ? ` style="--ys-w:${Number(width)}px"` : ''}>
      ${shape === 'sheet' ? '<div class="ys-grip" aria-hidden="true"></div>' : ''}
      <header class="ys-head"${title || headerExtra ? '' : ' hidden'}>
        <h2 class="ys-title">${escapeHtml(title)}</h2>
        ${headerExtra}
        <button type="button" class="icon-btn ys-x" data-ys-close aria-label="${escapeAttr(t('common.close'))}">${lucide('x', 16)}</button>
      </header>
      <div class="ys-body"></div>
      ${footer ? '<footer class="ys-foot"></footer>' : ''}
    </div>`;
  document.body.append(root);

  const surface = root.querySelector('.ys-surface');
  const body = root.querySelector('.ys-body');
  let closed = false;
  let release = null;

  if (shape === 'popover') placePopover(surface, anchor);

  const onKey = (e) => {
    if (e.key !== 'Escape' || !e.isTrusted || closed) return;
    // Only the topmost surface answers.
    if ([...open].at(-1) !== api) return;
    e.stopPropagation();
    api.close();
  };

  const onOutside = (e) => {
    // The anchor is not "outside": tapping it again is its own toggle.
    if (closed || surface.contains(e.target) || anchor?.contains?.(e.target)) return;
    if ([...open].at(-1) !== api) return;
    api.close();
  };

  const api = {
    root,
    body,
    surface,
    foot: root.querySelector('.ys-foot'),
    shape,
    setTitle(text) {
      root.querySelector('.ys-title').textContent = text;
      root.querySelector('.ys-head').hidden = false;
      root.setAttribute('aria-label', text);
    },
    close({ fromHistory = false } = {}) {
      if (closed) return;
      closed = true;
      open.delete(api);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onOutside, true);
      if (!fromHistory && release) goBack(release, historyId);
      release = null;
      root.classList.add('is-leaving');
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => root.remove(), reduce ? 0 : 160);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      onClose?.();
    },
    /*
      Close, then do what comes next once Back has landed: a note, a
      route or anything else that writes history would otherwise be
      undone by it.
    */
    closeThen(next) {
      api.close();
      return (settling || Promise.resolve())
        .then(() => new Promise((resolve) => setTimeout(resolve, 0)))
        .then(() => next?.());
    },
    get closed() {
      return closed;
    },
  };

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-ys-close]')) api.close();
  });
  document.addEventListener('keydown', onKey, true);
  if (shape === 'popover') setTimeout(() => !closed && document.addEventListener('pointerdown', onOutside, true), 0);

  open.add(api);
  const bind = () => {
    if (closed) return;
    release = openBoundOverlay(historyId, {
      close: ({ fromHistory } = {}) => api.close({ fromHistory }),
      isOpen: () => !closed,
      push: !adoptHistory,
    });
  };
  // The surface shows at once; its history entry follows a pending Back.
  if (settling) settling.then(bind);
  else bind();

  // Focus moves into the surface (for keyboards and screen readers)
  // without lighting up a button nobody chose.
  surface.tabIndex = -1;
  requestAnimationFrame(() => {
    if (closed) return;
    (surface.querySelector('[autofocus]') || surface).focus({ preventScroll: true });
  });

  return api;
}

function placePopover(surface, anchor) {
  const w = Number.parseFloat(getComputedStyle(surface).getPropertyValue('--ys-w')) || 320;
  if (!anchor?.isConnected) {
    // Opened without a tap (a notification, a list): near the top, centered.
    surface.style.left = `${Math.round(Math.max(12, (window.innerWidth - w) / 2))}px`;
    surface.style.top = `${Math.round(window.innerHeight * 0.18)}px`;
    return;
  }
  const r = anchor.getBoundingClientRect();
  const left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
  surface.style.left = `${Math.round(left)}px`;
  if (r.bottom + 8 + 280 > window.innerHeight) surface.style.bottom = `${Math.round(window.innerHeight - r.top + 8)}px`;
  else surface.style.top = `${Math.round(r.bottom + 8)}px`;
}
