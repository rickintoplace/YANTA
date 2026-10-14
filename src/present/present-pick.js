// ============================================================
// YANTA Present — "which drawing?"
//
// Reached without a drawing in hand: a phone scanned the QR code on a
// waiting screen (…/?app#present-screen=<key>), or the command palette's
// "Present on another screen". Lists the drawings, newest first; picking
// one connects the screen and starts presenting (the phone turns into the
// remote), or opens the connect panel when no screen is known yet.
// ============================================================

import { escapeHtml, lucide, state, toast } from '../core.js';
import { t } from '../i18n/index.js';
import { getNoteDoc, isNoteDocLoaded, listDrawingsForNote } from '../yjs.js';
import { openBoundOverlay } from '../overlay-history.js';
import { presentationSlidesFor } from '../slides/slides-model.js';
import { injectPresentCss } from './present-styles.js';

/** Notes that may hold drawings: their text mentions draw://, or their doc is loaded. */
async function drawingsInVault() {
  const candidates = [...state.notes.values()].filter((note) => {
    if (!note || note.trashed) return false;
    if (isNoteDocLoaded(note.id)) return true;

    const text = state.searchIndex?.get?.(note.id);
    return typeof text === 'string' ? text.includes('draw://') : true;
  });

  await Promise.all(candidates.map((note) => Promise.race([
    getNoteDoc(note.id).ready,
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ])));

  const out = [];

  for (const note of candidates) {
    for (const drawing of listDrawingsForNote(note.id)) {
      const slides = presentationSlidesFor(drawing);
      if (!slides.length) continue;

      out.push({
        noteId: note.id,
        drawingId: drawing.id,
        title: drawing.title || t('draw.untitled'),
        noteTitle: note.title || '',
        slideCount: (drawing.slides || []).filter((s) => !s.hidden).length,
        updated: drawing.updated || note.updated || 0,
      });
    }
  }

  return out.sort((a, b) => b.updated - a.updated);
}

export async function openPresentPicker({ screenKey = '' } = {}) {
  injectPresentCss();

  const backdrop = document.createElement('div');
  backdrop.className = 'yanta-pc-backdrop';
  backdrop.innerHTML = `
    <div class="yanta-pc" role="dialog" aria-modal="true">
      <div class="yanta-pc-head">
        ${lucide('cast', 18)}
        <h3>${escapeHtml(screenKey ? t('present.pick.titleScreen') : t('present.pick.title'))}</h3>
        <button type="button" class="icon-btn" data-close aria-label="${escapeHtml(t('common.close'))}">${lucide('x', 18)}</button>
      </div>
      <div class="yanta-pc-body">
        <div class="yanta-pc-devices" data-list>
          <div class="yanta-pc-empty">${escapeHtml(t('present.pick.loading'))}</div>
        </div>
      </div>
    </div>
  `;

  document.body.append(backdrop);

  let release = null;

  const close = ({ fromHistory = false } = {}) => {
    if (!backdrop.isConnected) return;

    backdrop.remove();
    if (!fromHistory) release?.();
  };

  release = openBoundOverlay('present-pick', {
    close: ({ fromHistory } = {}) => close({ fromHistory }),
    isOpen: () => backdrop.isConnected,
  });

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  backdrop.querySelector('[data-close]').addEventListener('click', () => close());

  const list = backdrop.querySelector('[data-list]');
  const drawings = await drawingsInVault();

  if (!backdrop.isConnected) return;

  if (!drawings.length) {
    list.innerHTML = `<div class="yanta-pc-empty">${escapeHtml(t('present.pick.none'))}</div>`;
    return;
  }

  list.innerHTML = drawings.map((d, i) => `
    <button type="button" class="yanta-pc-device" data-pick="${i}" style="all:unset;box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:var(--bg-elev-2);cursor:pointer">
      ${lucide('presentation', 18)}
      <span class="yanta-pc-device-name">
        ${escapeHtml(d.title)}
        <small>${escapeHtml([d.noteTitle, d.slideCount ? t('present.pick.slides', { count: d.slideCount }) : t('present.pick.board')].filter(Boolean).join(' · '))}</small>
      </span>
      ${lucide('chevron-right', 16)}
    </button>
  `).join('');

  list.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const picked = drawings[Number(btn.dataset.pick)];

      // Closing goes through history.back(); the drawing then pushes its own
      // entry. Doing both in one tick lets the late popstate close the
      // drawing again (see overlay-history.js) — wait for it to land.
      const settled = new Promise((resolve) => {
        const done = () => {
          window.removeEventListener('popstate', done);
          setTimeout(resolve, 0);
        };

        window.addEventListener('popstate', done);
        setTimeout(done, 400);
      });

      close();
      await settled;

      try {
        const { presentDrawingOnScreen } = await import('../slides/slides-ui.js');
        await presentDrawingOnScreen({ ...picked, screenKey });
      } catch (err) {
        console.error('[YANTA Present] could not present', err);
        toast(t('present.connect.noScreen'), 'error');
      }
    });
  });
}
