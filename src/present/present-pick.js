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
import { openSurface } from '../ui/surface.js';
import { presentationSlidesFor } from '../slides/slides-model.js';

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
  const picker = openSurface({
    kind: 'dialog',
    title: screenKey ? t('present.pick.titleScreen') : t('present.pick.title'),
    width: 480,
    className: 'ypc',
    historyId: 'present-pick',
  });

  picker.body.innerHTML = `<div class="ypc-list" data-list><p class="ys-dim">${escapeHtml(t('present.pick.loading'))}</p></div>`;

  const list = picker.body.querySelector('[data-list]');
  const drawings = await drawingsInVault();

  if (picker.closed) return;

  if (!drawings.length) {
    list.innerHTML = `<p class="ys-dim">${escapeHtml(t('present.pick.none'))}</p>`;
    return;
  }

  list.innerHTML = drawings.map((d, i) => `
    <button type="button" class="ypc-row" data-pick="${i}">
      ${lucide('presentation', 18)}
      <span class="ypc-name">
        ${escapeHtml(d.title)}
        <small>${escapeHtml([d.noteTitle, d.slideCount ? t('present.pick.slides', { count: d.slideCount }) : t('present.pick.board')].filter(Boolean).join(' · '))}</small>
      </span>
      ${lucide('chevron-right', 16)}
    </button>
  `).join('');

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn || picker.closed) return;
    const picked = drawings[Number(btn.dataset.pick)];

    // The drawing pushes its own history entry: only after ours is gone.
    await picker.closeThen();

    try {
      const { presentDrawingOnScreen } = await import('../slides/slides-ui.js');
      await presentDrawingOnScreen({ ...picked, screenKey });
    } catch (err) {
      console.error('[YANTA Present] could not present', err);
      toast(t('present.connect.noScreen'), 'error');
    }
  });
}
