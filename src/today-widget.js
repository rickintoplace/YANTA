// ============================================================
// YANTA Journal — "Today" dashboard widget
//
// The dashboard's capture surface: a one-line input that appends
// timestamped entries to today's daily note, plus the entries
// captured so far. The input lives outside the re-rendered region
// so refreshes never steal focus mid-typing.
// ============================================================

import {
  el,
  lucide,
  escapeHtml,
} from './core.js';

import { registerDashboardWidget } from './dashboard-widgets.js';

import {
  friendlyDayLabel,
  findJournalFolder,
  findTodayNote,
  listTodayEntries,
  captureToJournal,
  openTodayNote,
} from './journal.js';

function injectCss() {
  if (document.getElementById('yanta-today-widget-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-today-widget-css';

  /*
    Warum die .yanta-dash-widget-Basisregeln hier nochmal stehen:
    sie werden sonst nur vom RSS-Widget injiziert — ist das Widget
    deaktiviert, verlören die anderen Widgets ihr Grundgerüst.
    Identische Duplikate sind harmlos.
  */
  style.textContent = `
.yanta-dash-widget {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-elev);
  overflow: hidden;
}

.yanta-dash-widget-head {
  display: flex;
  align-items: center;
  gap: 8px;

  min-height: 40px;
  padding: 6px 8px 6px 12px;

  border-bottom: 1px solid var(--border);
}

.yanta-dash-widget-head > svg {
  color: var(--accent);
  flex: 0 0 auto;
}

.yanta-dash-widget-title {
  color: var(--text);
  font-size: 13px;
  font-weight: 750;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yanta-dash-widget-spacer {
  flex: 1;
}

.yanta-dash-widget-head .icon-btn {
  width: 30px;
  height: 30px;
  color: var(--text-dim);
}

.yanta-today-date {
  color: var(--text-faint);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yanta-today-capture {
  display: flex;
  align-items: center;
  gap: 8px;

  padding: 10px 12px 0;
}

.yanta-today-capture input {
  flex: 1;
  min-width: 0;

  padding: 8px 12px;

  border: 1px solid var(--border);
  border-radius: 10px;

  background: var(--bg);
  color: var(--text);

  font: inherit;
  font-size: 13.5px;
}

.yanta-today-capture input:focus {
  outline: none;
  border-color: var(--accent);
}

.yanta-today-capture .icon-btn {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  color: var(--text-dim);
}

.yanta-today-body {
  display: flex;
  flex-direction: column;

  padding: 8px 6px 10px;
}

.yanta-today-empty {
  padding: 8px 8px 4px;

  color: var(--text-faint);
  font-size: 12.5px;
  line-height: 1.5;
}

.yanta-today-row {
  display: flex;
  align-items: baseline;
  gap: 10px;

  padding: 5px 8px;

  border-radius: 8px;

  cursor: pointer;
}

.yanta-today-row:hover {
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}

.yanta-today-time {
  flex: 0 0 auto;

  min-width: 44px;

  color: var(--accent);
  font-size: 11.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.yanta-today-text {
  flex: 1;
  min-width: 0;

  color: var(--text);
  font-size: 13px;
  line-height: 1.45;

  overflow-wrap: anywhere;
}
`;

  document.head.append(style);
}

const MAX_ROWS = 8;

/*
  Warum Modul-State: ein Capture ändert note.updated, das Dashboard
  re-rendert daraufhin ALLE Widgets — der Input wird also gerade dann
  ersetzt, wenn der User weitertippen will. Entwurf + Fokuswunsch
  überleben deshalb außerhalb des DOM.
*/
let captureDraft = '';
let focusPendingAt = 0;

function shouldRestoreFocus() {
  return Date.now() - focusPendingAt < 3000;
}

/**
 * Strip the markdown the capture format itself produces (bold, links,
 * inline code) for the compact preview — the real note keeps it all.
 */
function previewText(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, target, label) => label || target);
}


async function renderEntries(body) {
  const entries = await listTodayEntries();

  if (!entries.length) {
    const folder = await findJournalFolder();
    const note = await findTodayNote();

    // First contact vs. quiet day — explain once, then stay out of the way.
    const hint = !folder && !note
      ? 'Captured thoughts land in a daily note inside your Journal folder.'
      : 'Nothing captured yet today.';

    body.replaceChildren(el('div', { class: 'yanta-today-empty' }, hint));
    return;
  }

  const open = () => openTodayNote().catch(() => {});
  const rows = [];

  for (const entry of entries.slice(-MAX_ROWS)) {
    const row = el('div', {
      class: 'yanta-today-row',
      role: 'button',
      tabindex: '0',
      onclick: open,
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      },
    });

    row.append(
      el('span', { class: 'yanta-today-time' }, entry.time || '·'),
      el('span', { class: 'yanta-today-text' }, previewText(entry.text)),
    );

    rows.push(row);
  }

  if (entries.length > MAX_ROWS) {
    const more = el('div', { class: 'yanta-today-empty' },
      `+${entries.length - MAX_ROWS} earlier — open the note for everything.`);

    rows.unshift(more);
  }

  body.replaceChildren(...rows);
}

async function renderTodayWidget() {
  injectCss();

  const section = el('section', {
    class: 'yanta-dash-widget yanta-dash-widget-today',
  });

  const head = el('div', { class: 'yanta-dash-widget-head' });
  head.innerHTML = `
    ${lucide('sun', 15)}
    <span class="yanta-dash-widget-title">Today</span>
    <span class="yanta-today-date">${escapeHtml(friendlyDayLabel())}</span>
    <span class="yanta-dash-widget-spacer"></span>
    <button class="icon-btn" data-widget-open title="Open today’s note">${lucide('arrow-right', 15)}</button>
  `;

  head.querySelector('[data-widget-open]')?.addEventListener('click', () => {
    openTodayNote().catch(() => {});
  });

  const captureRow = el('div', { class: 'yanta-today-capture' });

  const input = el('input', {
    type: 'text',
    placeholder: 'Capture a thought…',
    autocomplete: 'off',
    spellcheck: 'false',
  });

  input.value = captureDraft;
  input.addEventListener('input', () => {
    captureDraft = input.value;
  });

  const sendBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    title: 'Capture',
  });

  sendBtn.innerHTML = lucide('corner-down-left', 15);

  const body = el('div', { class: 'yanta-today-body' });

  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    captureDraft = '';
    focusPendingAt = Date.now();

    try {
      await captureToJournal(text, { source: 'today-widget' });
    } catch (err) {
      console.error('[YANTA Today] capture failed', err);
      input.value = text;
      captureDraft = text;
    }

    input.focus();
  };

  sendBtn.addEventListener('click', submit);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });

  captureRow.append(input, sendBtn);

  // Journal edits (capture, editor typing in the daily note) refresh the
  // entry list; the capture row is untouched, so focus survives.
  let todayNoteId = (await findTodayNote())?.id || null;

  const onNoteUpdated = (e) => {
    if (!section.isConnected) {
      window.removeEventListener('yanta-note-updated', onNoteUpdated);
      return;
    }

    const detail = e.detail || {};
    const relevant = detail.source === 'journal' ||
      detail.reason === 'journal-capture' ||
      (todayNoteId && detail.noteId === todayNoteId);

    if (!relevant) return;

    findTodayNote()
      .then((note) => { todayNoteId = note?.id || todayNoteId; })
      .catch(() => {});

    renderEntries(body).catch(() => {});
  };

  window.addEventListener('yanta-note-updated', onNoteUpdated);

  await renderEntries(body);

  section.append(head, captureRow, body);

  // Re-focus after a dashboard re-render that replaced the input while
  // the user was capturing (rAF: the section is only attached after
  // render() returns).
  // Das Fenster wird bewusst nicht sofort geschlossen: ein Capture kann
  // mehrere Dashboard-Re-Renders hintereinander auslösen, und jedes
  // ersetzt den Input erneut.
  const wasTyping = document.activeElement?.closest?.('.yanta-today-capture');

  if (wasTyping) focusPendingAt = Date.now();

  if (wasTyping || shouldRestoreFocus()) {
    requestAnimationFrame(() => {
      if (input.isConnected) input.focus();
    });
  }

  return section;
}

registerDashboardWidget({
  id: 'today',
  title: 'Today',
  icon: 'sun',
  order: 5,
  render: renderTodayWidget,
});
