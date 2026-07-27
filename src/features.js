// ============================================================
// YANTA — Backlinks, outline, wikilink hover preview,
// wikilink click handler.
//
// The palette that used to live here now has its own module: src/palette/.
// ============================================================

import { $, el, state, escapeHtml, lucide } from './core.js';
import { wikilinkIndex } from './features-state.js';
import { openNote, createNoteWithTitle } from './notes.js';
import { renderBlocksInline, classifyLine, headingSlug } from './markdown.js';
import { noteMarkdown, drawingWikilinksForNote } from './yjs.js';
import { inlineConfirm } from './inline-ui.js';

const WIKILINK_RE = /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g;

// -------- Backlinks --------------------------------------------
export function getBacklinks(noteId) {
  const note = state.notes.get(noteId);
  if (!note) return [];

  const target = (note.title || '').trim().toLowerCase();
  const out = [];

  for (const n of state.notes.values()) {
    if (n.id === noteId) continue;

    let found = null;

    let body = '';
    try {
      body = noteMarkdown(n.id);
    } catch {}

    WIKILINK_RE.lastIndex = 0;

    let m;
    while ((m = WIKILINK_RE.exec(body)) !== null) {
      if (m[1].trim().toLowerCase() === target) {
        const before = body.slice(0, m.index);
        const lineIdx = before.split('\n').length - 1;
        found = (body.split('\n')[lineIdx] || '').trim();
        break;
      }
    }

    if (found == null) {
      try {
        const drawLinks = drawingWikilinksForNote(n.id);
        if (drawLinks.some((x) => x.trim().toLowerCase() === target)) {
          found = `Referenced inside drawing: [[${note.title || 'Untitled'}]]`;
        }
      } catch {}
    }

    if (found != null) {
      out.push({ note: n, line: found });
    }
  }

  return out.sort((a, b) => b.note.updated - a.note.updated);
}

export function renderBacklinks(noteId) {
  const pv = $('preview');
  if (!pv) return;

  const old = pv.querySelector('.backlinks');
  if (old) old.remove();

  if (!noteId) return;

  const back = getBacklinks(noteId);
  const wrap = el('div', { class: 'backlinks', contenteditable: 'false' });

  wrap.append(
    el('div', { class: 'backlinks-title' },
      'Linked from',
      el('span', { class: 'badge' }, String(back.length))
    )
  );

  if (!back.length) {
    wrap.append(el('div', { class: 'backlinks-empty' }, 'No backlinks yet.'));
  } else {
    for (const { note, line } of back) {
      const item = el('div', {
        class: 'backlink',
        onclick: () => openNote(note.id),
      });

      item.append(el('div', { class: 'bl-title' }, note.title || 'Untitled'));

      const ctxDiv = el('div', { class: 'bl-context' });
      ctxDiv.textContent = line.length > 200 ? line.slice(0, 200) + '…' : line;

      item.append(ctxDiv);
      wrap.append(item);
    }
  }

  pv.append(wrap);
}
// -------- Outline ----------------------------------------------
export function renderOutline(md) {
  const pv = $('preview');
  const pane = $('panePreview');
  if (!pv || !pane) return;

  // Alte TOCs entfernen — auch falls vorher einer ins article.preview gerutscht ist.
  pane.querySelector(':scope > .pv-outline')?.remove();
  pv.querySelector(':scope > .pv-outline')?.remove();

  const lines = md.split('\n');
  const headings = [];
  const ctx = { inFence: false };

  for (const line of lines) {
    const info = classifyLine(line, ctx);
    if (info.type === 'fence') {
      ctx.inFence = !!info.opens;
      continue;
    }

    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      headings.push({
        level: m[1].length,
        text: m[2].trim(),
        slug: headingSlug(m[2].trim()),
      });
    }
  }

  if (headings.length < 2) return;

  const minLvl = Math.min(...headings.map((h) => h.level));
  const wrap = el('div', { class: 'pv-outline', contenteditable: 'false' });

  const head = el('div', {
    class: 'pv-outline-head',
    onclick: () => wrap.classList.toggle('collapsed'),
  });

  const chev = el('span', { class: 'pv-outline-chev' });
  chev.innerHTML = lucide('chevron-down', 12);

  head.append(chev, el('span', {}, `Outline · ${headings.length} headings`));
  wrap.append(head);

  const list = el('div', { class: 'pv-outline-list' });

  for (const h of headings) {
    list.append(el('a', {
      class: 'pv-outline-item',
      style: { paddingLeft: (8 + (h.level - minLvl) * 14) + 'px' },
      onclick: (e) => {
        e.preventDefault();
        const t = pv.querySelector(`#h-${CSS.escape(h.slug)}`);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    }, h.text));
  }

  wrap.append(list);

  pane.insertBefore(wrap, pv);
}

// -------- Wikilink click + hover preview -----------------------
export function handleWikilinkClick(e) {
  const a = e.target.closest('a.wiki-link');
  if (!a) return;

  e.preventDefault();
  e.stopPropagation();

  const target = a.dataset.wiki;
  const id = a.dataset.noteId;

  /*
    Peek UX:
    Alt/Option-Klick öffnet nur die Vorschau und erzeugt keinen History-Eintrag.
    Das ist ideal für "nur kurz reinschauen".
  */
  if (e.altKey && id && state.notes.get(id)) {
    showHoverPreview(a);
    return;
  }

  // Normaler Klick navigiert.
  hideHoverPreview();

  if (id && state.notes.get(id)) {
    openNote(id);
    return;
  }

  inlineConfirm(a, {
    message: `Create "${target}"?`,
    confirmLabel: 'Create',
    cancelLabel: 'Cancel',
    danger: false,
    onConfirm: async () => {
      await createNoteWithTitle(target);
    },
  });
}

let _hoverShowTimer = 0;
let _hoverHideTimer = 0;

function clearHoverTimers() {
  clearTimeout(_hoverShowTimer);
  clearTimeout(_hoverHideTimer);
  _hoverShowTimer = 0;
  _hoverHideTimer = 0;
}

export function setupWikilinkHover() {
  const hp = $('hoverPreview');
  if (!hp) return;

  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest?.('a.wiki-link');

    if (!a || a.classList.contains('missing')) return;
    if (!a.isConnected) return;

    clearTimeout(_hoverHideTimer);
    clearTimeout(_hoverShowTimer);

    _hoverShowTimer = setTimeout(() => {
      showHoverPreview(a);
    }, 280);
  });

  document.addEventListener('mouseout', (e) => {
    const a = e.target.closest?.('a.wiki-link');
    const related = e.relatedTarget;

    // Innerhalb desselben Links bewegen: nicht schließen.
    if (a && related && a.contains(related)) return;

    // Vom Link in den Tooltip bewegen: Tooltip offen lassen.
    const toHp = related && hp.contains(related);

    if (!a && !toHp) return;

    clearTimeout(_hoverShowTimer);

    _hoverHideTimer = setTimeout(() => {
      hideHoverPreview();
    }, 250);
  });

  // Kritisch: Wenn ein Wikilink geklickt wird, Tooltip sofort schließen.
  // Capture=true sorgt dafür, dass der Tooltip verschwindet, bevor openNote()
  // Preview/DOM neu rendert.
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a.wiki-link');
    if (!a) return;

    hideHoverPreview();
  }, true);

  hp.addEventListener('mouseenter', () => {
    clearTimeout(_hoverHideTimer);
  });

  hp.addEventListener('mouseleave', () => {
    hideHoverPreview();
  });
}

export function showHoverPreview(a) {
  if (!a || !a.isConnected) return;

  const id = a.dataset.noteId;
  if (!id) return;

  const note = state.notes.get(id);
  if (!note) return;

  const hp = $('hoverPreview');
  if (!hp) return;

  let body = '';

  try {
    body = noteMarkdown(id);
  } catch {}

  const snippet = body.slice(0, 600);

  hp.innerHTML =
    `<div class="hp-title">${escapeHtml(note.title || 'Untitled')}</div>` +
    `<div class="hp-body">${renderBlocksInline(snippet)}</div>` +
    (body.length > 600 ? '<div class="hp-more">…click to open</div>' : '');

  hp.hidden = false;

  const r = a.getBoundingClientRect();
  const hw = hp.offsetWidth || 380;
  const hh = hp.offsetHeight || 120;

  let x = r.left;
  let y = r.bottom + 6;

  if (x + hw > window.innerWidth - 8) {
    x = window.innerWidth - hw - 8;
  }

  if (y + hh > window.innerHeight - 8) {
    y = r.top - hh - 6;
  }

  hp.style.left = Math.max(8, x) + 'px';
  hp.style.top = Math.max(8, y) + 'px';
}

export function hideHoverPreview() {
  clearHoverTimers();

  const hp = $('hoverPreview');
  if (!hp) return;

  hp.hidden = true;
}
