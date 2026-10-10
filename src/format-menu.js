// ============================================================
// YANTA — Floating format toolbar.
// Appears whenever there is a non-empty selection in the editor.
//
// This module owns only *which* actions fit the current selection and
// where the bubble sits. What each action is — command, icon, label,
// shortcut — comes from editor/format-actions.js, so the toolbar, the
// note-header menu and the keyboard can never disagree.
// ============================================================

import { $ } from './core.js';
import { getView } from './editor.js';
import { applyFormatAction, formatToolbarButton } from './editor/format-actions.js';
import { parseLine } from './editor/markdown-lines.js';

let tb;
let raf = 0;
let applying = false;

export function setupFormatToolbar() {
  tb = $('formatToolbar');
  if (!tb) return;

  // Do not let toolbar clicks (or taps) steal the CodeMirror selection.
  tb.addEventListener('mousedown', (e) => e.preventDefault());
  tb.addEventListener('pointerdown', (e) => e.preventDefault());

  // The docked toolbar follows the on-screen keyboard.
  window.visualViewport?.addEventListener('resize', () => {
    if (!tb.hidden) refreshSoon();
  });
  window.visualViewport?.addEventListener('scroll', () => {
    if (!tb.hidden) refreshSoon();
  });

  tb.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-fmt]');
    if (!btn) return;

    applying = true;

    applyFormatAction(btn.dataset.fmt);

    hide();

    // Avoid immediate re-open from the selectionchange fired by CM/browser.
    setTimeout(() => {
      applying = false;
      refreshSoon();
    }, 120);
  });

  window.addEventListener('yanta-selection-change', refreshSoon);
  document.addEventListener('selectionchange', refreshSoon);
  window.addEventListener('scroll', () => {
    if (!tb.hidden) refreshSoon();
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (!tb || tb.hidden) return;
    if (tb.contains(e.target)) return;

    const v = getView();
    if (!v) {
      hide();
      return;
    }

    if (!v.dom.contains(e.target)) hide();
  }, true);
}

function refreshSoon() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(refresh);
}

/**
 * Actions that make sense for the selected text. A list offers the
 * conversions it is not already, a paragraph gets the full inline set.
 */
function actionsForSelection(text) {
  const lines = text.split('\n');
  const everyLineIs = (kind) => lines.every((l) => !l.trim() || parseLine(l).kind === kind);

  if (everyLineIs('task')) return ['tasks-toggle', 'to-bullets', 'to-numbered'];
  if (everyLineIs('bullet')) return ['to-tasks', 'to-numbered'];
  if (everyLineIs('ordered')) return ['to-tasks', 'to-bullets'];

  if (lines.length > 1) {
    return ['to-tasks', 'to-bullets', 'to-numbered', 'quote', 'code-block'];
  }

  return [
    'bold', 'italic', 'code', 'strike', 'highlight', 'hr',
    'h1', 'h2', 'h3', 'clear-heading', 'hr',
    'quote', 'to-bullets', 'to-tasks', 'link',
  ];
}

function refresh() {
  if (applying) return;

  const v = getView();
  if (!v || !tb) {
    hide();
    return;
  }

  // If the editor is not focused, do not keep a stale toolbar open.
  if (!v.hasFocus && !tb.matches(':hover')) {
    hide();
    return;
  }

  const sel = v.state.selection.main;
  if (sel.empty) {
    hide();
    return;
  }

  tb.innerHTML = actionsForSelection(v.state.sliceDoc(sel.from, sel.to))
    .map((id) => (id === 'hr' ? '<span class="sep"></span>' : formatToolbarButton(id)))
    .join('');

  tb.hidden = false;

  const coordsFrom = v.coordsAtPos(sel.from);
  const coordsTo = v.coordsAtPos(sel.to);
  if (!coordsFrom || !coordsTo) {
    hide();
    return;
  }

  /*
    On touch screens the system draws its own selection menu (Cut, Copy,
    Paste …) right next to the selection — above it on Android and iOS —
    and it always wins. Instead of fighting it for that spot, the toolbar
    docks to the bottom of the visible area, just above the keyboard,
    where formatting bars live in most mobile editors.
  */
  const docked = isTouchScreen();
  tb.classList.toggle('is-docked', docked);

  requestAnimationFrame(() => {
    if (!tb || tb.hidden) return;

    if (docked) {
      const vv = window.visualViewport;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const left = vv ? vv.offsetLeft : 0;
      const width = vv ? vv.width : window.innerWidth;

      tb.style.left = `${Math.round(left + 8)}px`;
      tb.style.width = `${Math.round(width - 16)}px`;
      tb.style.top = `${Math.round(bottom - tb.offsetHeight - 8)}px`;
      return;
    }

    tb.style.width = '';

    const tw = tb.offsetWidth;
    const th = tb.offsetHeight;
    const cx = (coordsFrom.left + coordsTo.right) / 2;

    const x = Math.max(8, Math.min(window.innerWidth - tw - 8, cx - tw / 2));
    let y = coordsFrom.top - th - 8;

    if (y < 8) y = coordsTo.bottom + 8;

    tb.style.left = x + 'px';
    tb.style.top = y + 'px';
  });
}

function isTouchScreen() {
  return !!window.matchMedia?.('(pointer: coarse)').matches;
}

function hide() {
  if (tb) tb.hidden = true;
}
