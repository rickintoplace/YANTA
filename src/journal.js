// ============================================================
// YANTA — Journal (the "Today" axis)
//
// Daily notes live in a "Journal" folder and are plain markdown
// notes titled YYYY-MM-DD — nothing proprietary, they sync and
// export like any other note.
//
// Important: a daily note is only created on the first capture
// (or when explicitly opened) — never eagerly. No empty note spam
// in the vault, in sync, or in search.
// ============================================================

import {
  uid,
  state,
  store,
  toast,
  el,
  lucide,
  escapeHtml,
} from './core.js';

import {
  getNoteDoc,
} from './yjs.js';

import { openBoundOverlay } from './overlay-history.js';
import { countFirstNoteIfActivation } from './metrics/funnel.js';

import {
  newFolder,
  openNote,
  searchHaystack,
  rebuildWikilinkIndex,
} from './notes.js';

import {
  renderTree,
} from './tree.js';

const SETTING_KEY = 'journal.v1';
const JOURNAL_FOLDER_NAME = 'Journal';
const DAILY_NOTE_ICON = 'notebook-pen';

// ---------------- date helpers -----------------------------------

/** Local-date key, sortable and unambiguous: "2026-07-16". */
export function dailyKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  return `${y}-${m}-${day}`;
}

/** Human date for headers: "Wednesday, July 16". */
export function friendlyDayLabel(d = new Date()) {
  return d.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function timeChip(d = new Date()) {
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------- journal folder ----------------------------------

async function getJournalConfig() {
  const raw = await store.settings.get(SETTING_KEY, {});

  return {
    folderId: raw?.folderId || null,
  };
}

function usableFolder(folder) {
  return folder && folder.trashed !== true && !folder.spaceId
    ? folder
    : null;
}

/** Resolve the journal folder without creating it. */
export async function findJournalFolder() {
  const config = await getJournalConfig();

  const configured = usableFolder(
    config.folderId ? state.folders.get(config.folderId) : null
  );

  if (configured) return configured;

  // Adopt an existing top-level "Journal" folder (e.g. created on
  // another device before this one saved a folderId).
  return [...state.folders.values()].find((f) =>
    usableFolder(f) && !f.parentId && f.name === JOURNAL_FOLDER_NAME
  ) || null;
}

async function ensureJournalFolder() {
  let folder = await findJournalFolder();

  if (!folder) {
    folder = await newFolder(null, {
      name: JOURNAL_FOLDER_NAME,
      focusRename: false,
      source: 'journal',
    });
  }

  const config = await getJournalConfig();

  if (config.folderId !== folder.id) {
    await store.settings.set(SETTING_KEY, {
      ...config,
      folderId: folder.id,
    });
  }

  return folder;
}

// ---------------- daily note ---------------------------------------

function findDailyNoteIn(folderId, key) {
  if (!folderId) return null;

  for (const note of state.notes.values()) {
    if (
      note.folderId === folderId &&
      note.title === key &&
      note.trashed !== true &&
      !note.spaceId
    ) {
      return note;
    }
  }

  return null;
}

/** Today's daily note, or null — never creates. */
export async function findTodayNote() {
  const folder = await findJournalFolder();
  return findDailyNoteIn(folder?.id || null, dailyKey());
}

export async function getOrCreateTodayNote() {
  const folder = await ensureJournalFolder();
  const key = dailyKey();

  const existing = findDailyNoteIn(folder.id, key);
  if (existing) return existing;

  const id = uid();

  const note = {
    id,
    title: key,
    type: 'markdown',
    folderId: folder.id,
    tags: [],
    pinned: false,
    icon: DAILY_NOTE_ICON,
    created: Date.now(),
    updated: Date.now(),
  };

  state.notes.set(id, note);
  await store.notes.put(note);

  try {
    await window.yantaSync2?.engine?.observeNote?.(id);
  } catch {}

  const entry = getNoteDoc(id);
  await entry.ready;

  state.searchIndex.set(id, searchHaystack(note, ''));
  rebuildWikilinkIndex();
  renderTree();

  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: {
      noteId: id,
      reason: 'note-created',
      source: 'journal',
    },
  }));

  return note;
}

export async function openTodayNote() {
  const note = await getOrCreateTodayNote();
  await openNote(note.id);
}

// ---------------- capture ------------------------------------------

/**
 * Append a timestamped bullet to today's note. Multi-line input keeps
 * following lines indented so markdown treats them as one list item.
 */
export async function captureToJournal(text, {
  source = 'unknown',
} = {}) {
  const trimmed = String(text || '').trim();

  if (!trimmed) return null;

  const notesBefore = state.notes.size;
  const note = await getOrCreateTodayNote();

  // Activation, counted as an anonymous daily total. See metrics/funnel.js.
  countFirstNoteIfActivation(notesBefore, state.notes.size);

  const entry = getNoteDoc(note.id);
  await entry.ready;

  const ytext = entry.doc.getText('markdown');

  const lines = trimmed.split('\n');
  const bullet = [
    `- **${timeChip()}** ${lines[0]}`,
    ...lines.slice(1).map((line) => `  ${line}`),
  ].join('\n');

  const body = ytext.toString();
  const prefix = body.length > 0 && !body.endsWith('\n') ? '\n' : '';

  ytext.insert(ytext.length, prefix + bullet + '\n');

  note.updated = Date.now();
  await store.notes.put(note);

  state.searchIndex.set(note.id, searchHaystack(note, ytext.toString()));

  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: {
      noteId: note.id,
      reason: 'journal-capture',
      source,
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh'));

  return note;
}

/**
 * Parse today's note into displayable entries. Timestamped bullets get
 * a time chip; plain bullets (user edits) render without one. Anything
 * that isn't a bullet is left to the real note view.
 */
export async function listTodayEntries() {
  const note = await findTodayNote();

  if (!note) return [];

  const entry = getNoteDoc(note.id);
  await entry.ready;

  const body = entry.doc.getText('markdown').toString();
  const out = [];

  for (const line of body.split('\n')) {
    const timed = line.match(/^-\s+\*\*([^*\n]{1,12})\*\*\s*(.*)$/);

    if (timed) {
      out.push({ time: timed[1], text: timed[2] });
      continue;
    }

    const plain = line.match(/^-\s+(?!\[[ xX]\])(.+)$/);

    if (plain) {
      out.push({ time: null, text: plain[1] });
      continue;
    }

    // Indented continuation belongs to the previous entry.
    if (/^\s{2,}\S/.test(line) && out.length) {
      out[out.length - 1].text += ' ' + line.trim();
    }
  }

  return out;
}

// ---------------- quick capture overlay ----------------------------

function injectCaptureCss() {
  if (document.getElementById('yanta-quick-capture-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-quick-capture-css';
  style.textContent = `
.yanta-qcapture {
  position: fixed;
  inset: 0;
  z-index: 260;

  display: flex;
  justify-content: center;
  align-items: flex-start;

  padding: max(10vh, 48px) 16px 16px;

  background: color-mix(in srgb, var(--bg) 42%, transparent);
  backdrop-filter: blur(2px);
}

.yanta-qcapture[hidden] { display: none !important; }

.yanta-qcapture-card {
  width: min(560px, 100%);

  display: flex;
  flex-direction: column;
  gap: 10px;

  padding: 14px;

  border: 1px solid var(--border);
  border-radius: 14px;

  background: var(--bg-elev);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
}

.yanta-qcapture-head {
  display: flex;
  align-items: center;
  gap: 8px;

  color: var(--text-dim);
  font-size: 12.5px;
  font-weight: 650;
}

.yanta-qcapture-head svg { color: var(--accent); }

.yanta-qcapture-head .date {
  color: var(--text-faint);
  font-weight: 500;
}

.yanta-qcapture textarea {
  min-height: 72px;
  resize: vertical;

  padding: 10px 12px;

  border: 1px solid var(--border);
  border-radius: 10px;

  background: var(--bg);
  color: var(--text);

  font: inherit;
  font-size: 14px;
  line-height: 1.5;
}

.yanta-qcapture textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.yanta-qcapture-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.yanta-qcapture-hint {
  flex: 1;
  color: var(--text-faint);
  font-size: 11.5px;
}

@media (max-width: 600px) {
  .yanta-qcapture-hint { display: none; }
  .yanta-qcapture-foot { justify-content: flex-end; }
}
`;

  document.head.append(style);
}

let captureOverlay = null;
let releaseQuickCapture = null;

export function closeQuickCapture() {
  captureOverlay?.remove();
  captureOverlay = null;

  const release = releaseQuickCapture;
  releaseQuickCapture = null;
  release?.();
}

/**
 * Frictionless capture from anywhere in the app: Ctrl/Cmd+Shift+Space,
 * command palette, or the create menus. Enter saves, the overlay closes
 * — one thought in, back to whatever you were doing.
 */
export function openQuickCapture({
  source = 'unknown',
} = {}) {
  injectCaptureCss();
  closeQuickCapture();

  const overlay = el('div', { class: 'yanta-qcapture' });
  captureOverlay = overlay;

  const card = el('div', { class: 'yanta-qcapture-card' });

  const head = el('div', { class: 'yanta-qcapture-head' });
  head.innerHTML = `
    ${lucide('zap', 14)}
    <span>Quick capture</span>
    <span class="date">· ${escapeHtml(friendlyDayLabel())}</span>
  `;

  const input = el('textarea', {
    placeholder: 'What’s on your mind?',
    rows: '3',
  });

  const hint = el('div', { class: 'yanta-qcapture-hint' },
    'Enter to capture · Shift+Enter for a new line · Esc to close');

  const openBtn = el('button', { class: 'btn', type: 'button' }, 'Open today’s note');
  const saveBtn = el('button', { class: 'btn primary', type: 'button' }, 'Capture');

  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;

    saveBtn.disabled = true;

    try {
      await captureToJournal(text, { source });
      closeQuickCapture();
      toast('Captured to today’s note', 'success');
    } catch (err) {
      console.error('[YANTA Journal] capture failed', err);
      saveBtn.disabled = false;
      toast('Capture failed', 'error');
    }
  };

  saveBtn.addEventListener('click', submit);

  openBtn.addEventListener('click', async () => {
    closeQuickCapture();

    try {
      await openTodayNote();
    } catch (err) {
      console.error('[YANTA Journal] open today failed', err);
      toast('Could not open today’s note', 'error');
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeQuickCapture();
    }
  });

  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) closeQuickCapture();
  });

  // Esc closes even when focus wandered off the textarea (e.g. onto a
  // button); stopPropagation keeps the global Esc handling untouched.
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeQuickCapture();
    }
  });

  const foot = el('div', { class: 'yanta-qcapture-foot' });
  foot.append(hint, openBtn, saveBtn);

  card.append(head, input, foot);
  overlay.append(card);
  document.body.append(overlay);

  // Device-back closes the capture sheet instead of the app.
  releaseQuickCapture = openBoundOverlay('quick-capture', {
    close: closeQuickCapture,
    isOpen: () => !!captureOverlay?.isConnected,
  });

  input.focus();
}
