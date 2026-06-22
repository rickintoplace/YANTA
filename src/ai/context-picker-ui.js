// ============================================================
// YANTA AI — Add Context Picker
// ============================================================

import {
  el,
  state,
  escapeHtml,
  lucide,
  toast,
} from '../core.js';

import {
  registerOverlayRoute,
  pushOverlayState,
  closeTopOverlay,
  overlayIdFromState,
} from '../overlay-history.js';

let modal = null;

const AI_CONTEXT_PICKER_OVERLAY_ID = 'ai-context-picker';

let overlayRegistered = false;
let lastPickerOptions = null;

let pickerInteractionController = null;

function cleanupPickerInteractions() {
  pickerInteractionController?.abort();
  pickerInteractionController = null;
}

function aiContextPickerIsOpen() {
  return !!modal && modal.hidden === false;
}

function registerAiContextPickerOverlayRoute() {
  if (overlayRegistered) return;

  overlayRegistered = true;

  registerOverlayRoute(AI_CONTEXT_PICKER_OVERLAY_ID, {
    open: async () => {
      if (!lastPickerOptions) return;

      await openAiContextPicker({
        ...lastPickerOptions,
        fromHistory: true,
      });
    },

    close: () => {
      closeAiContextPicker({
        fromHistory: true,
      });
    },

    isOpen: aiContextPickerIsOpen,
  });
}

function ensureCss() {
  if (document.getElementById('yanta-ai-context-picker-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-ai-context-picker-css';
  style.textContent = `
.yanta-ai-context-picker-card {
  width: min(720px, 94vw);
}

.yanta-ai-context-picker-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.yanta-ai-context-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev-2);
}

.yanta-ai-context-tabs button {
  flex: 1;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 12px;
  font-weight: 750;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
}

.yanta-ai-context-tabs button.active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.yanta-ai-context-list {
  max-height: min(50vh, 430px);
  overflow: auto;
  display: flex;
  flex-direction: row;
  gap: 6px;
}

.yanta-ai-context-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 9px;
  align-items: center;

  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev-2);
  color: var(--text);
  cursor: pointer;
  text-align: left;
  max-width: 18em;
}

.yanta-ai-context-row:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-elev-2));
}

.yanta-ai-context-row-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.yanta-ai-context-row-main strong {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
}

.yanta-ai-context-row-main small {
  color: var(--text-faint);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.yanta-ai-context-upload-box {
  padding: 18px;
  border: 1px dashed var(--border-strong);
  border-radius: 12px;
  background: var(--bg-elev-2);
  text-align: center;
  color: var(--text-dim);
}

.yanta-ai-context-upload-box strong {
  display: block;
  color: var(--text);
  margin-bottom: 4px;
}

@media (max-width: 760px) {

.yanta-ai-context-list {
    max-height: 100vh;
    display: flex;
    flex-direction: row;
}

}
`;
  document.head.append(style);
}

function ensureModal() {
  if (modal) return modal;

  ensureCss();

  modal = el('div', {
    class: 'modal yanta-ai-context-picker-modal',
    hidden: true,
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeAiContextPicker();
    if (e.target.closest?.('[data-ai-context-close]')) closeAiContextPicker();
  });

  document.body.append(modal);

  return modal;
}

function closeAiContextPicker({
  fromHistory = false,
} = {}) {
  const hide = () => {
    cleanupPickerInteractions();

    if (modal) {
      modal.hidden = true;
    }
  };

  if (
    !fromHistory &&
    overlayIdFromState() === AI_CONTEXT_PICKER_OVERLAY_ID
  ) {
    closeTopOverlay(hide);
    return;
  }

  hide();
}

function folderPath(folderId) {
  if (!folderId) return '';

  const parts = [];
  const seen = new Set();
  let f = state.folders.get(folderId);

  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    parts.unshift(f.name || 'Folder');
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }

  return parts.join(' / ');
}

async function eventRows() {
  try {
    const calendar = await import('../calendar.js');

    calendar.hydrateCalendarStateFromVault?.({
      silent: true,
    });
  } catch {}

  return [...state.calendarEvents.values()]
    .filter((ev) => ev.status !== 'cancelled')
    .sort((a, b) =>
      new Date(a.start || 0).getTime() - new Date(b.start || 0).getTime()
    )
    .slice(0, 200);
}

function normalizeSearchText(values = []) {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => value !== undefined && value !== null)
    .join(' ')
    .toLowerCase();
}

function matchesAiContextQuery(values, query) {
  return !query || normalizeSearchText(values).includes(query);
}

function aiContextRowsHtml(rows) {
  if (!rows.length) {
    return `<div class="tree-empty">No results.</div>`;
  }

  return rows.map((row) => `
    <button
      type="button"
      class="yanta-ai-context-row"
      data-kind="${escapeHtml(row.kind)}"
      data-id="${escapeHtml(row.id)}"
    >
      <span>${lucide(row.icon, 16)}</span>
      <span class="yanta-ai-context-row-main">
        <strong>${escapeHtml(row.title)}</strong>
        <small>${escapeHtml(row.subtitle || '')}</small>
      </span>
      <span>${lucide('plus', 15)}</span>
    </button>
  `).join('');
}

function aiContextSearchPanelHtml(query) {
  return `
    <input
      class="text-input"
      data-ai-context-search
      value="${escapeHtml(query)}"
      placeholder="Search…"
      autocomplete="off"
      spellcheck="false"
      aria-label="Search AI context"
    />

    <div class="yanta-ai-context-list" data-ai-context-list></div>
  `;
}

function aiContextUploadPanelHtml() {
  return `
    <div class="yanta-ai-context-upload-box" data-upload-box>
      <strong>Upload files as AI context</strong>
      <p>Text, Markdown, JSON, CSV, PDF, DOCX and images are supported. Images are compressed to WEBP.</p>

      <button type="button" class="btn primary" data-upload-pick>
        ${lucide('upload', 14)} Pick files
      </button>

      <input
        type="file"
        data-upload-input
        hidden
        multiple
        accept=".txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.log,.js,.jsx,.ts,.tsx,.css,.sql,.py,.yaml,.yml,.pdf,.docx,image/*"
      />
    </div>
  `;
}

function setAiContextTabState(root, tab) {
  root.querySelectorAll('[data-tab]').forEach((btn) => {
    const active = btn.dataset.tab === tab;

    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
}

function focusAiContextSearch(root) {
  requestAnimationFrame(() => {
    root.querySelector('[data-ai-context-search]')?.focus({
      preventScroll: true,
    });
  });
}

export async function openAiContextPicker({
  onPickRefs = null,
  onPickFiles = null,
  fromHistory = false,
} = {}) {
  const m = ensureModal();

  registerAiContextPickerOverlayRoute();

  lastPickerOptions = {
    onPickRefs,
    onPickFiles,
  };

  if (
    !fromHistory &&
    overlayIdFromState() !== AI_CONTEXT_PICKER_OVERLAY_ID
  ) {
    pushOverlayState(AI_CONTEXT_PICKER_OVERLAY_ID);
  }

  cleanupPickerInteractions();

  const interactionController = new AbortController();
  pickerInteractionController = interactionController;

  const { signal } = interactionController;

  let tab = 'notes';
  let query = '';
  let renderSeq = 0;
  let cachedEvents = null;

  const folderPathCache = new Map();

  function getCachedFolderPath(folderId) {
    if (!folderId) return '';

    if (!folderPathCache.has(folderId)) {
      folderPathCache.set(folderId, folderPath(folderId));
    }

    return folderPathCache.get(folderId) || '';
  }

  async function getRows() {
    const q = query.trim().toLowerCase();

    if (tab === 'notes') {
      return [...state.notes.values()]
        .filter((n) => !n.trashed)
        .map((n) => ({
          note: n,
          path: getCachedFolderPath(n.folderId),
        }))
        .filter(({ note, path }) =>
          matchesAiContextQuery(
            [note.title, note.id, path, note.tags || []],
            q
          )
        )
        .sort((a, b) => (b.note.updated || 0) - (a.note.updated || 0))
        .slice(0, 120)
        .map(({ note, path }) => ({
          kind: 'note',
          id: note.id,
          title: note.title || 'Untitled',
          subtitle: path || 'Home',
          icon: note.icon || 'file-text',
        }));
    }

    if (tab === 'folders') {
      return [...state.folders.values()]
        .filter((f) => !f.trashed)
        .map((f) => ({
          folder: f,
          path: getCachedFolderPath(f.id),
        }))
        .filter(({ folder, path }) =>
          matchesAiContextQuery(
            [folder.name, folder.id, path],
            q
          )
        )
        .sort((a, b) => a.path.localeCompare(b.path))
        .slice(0, 120)
        .map(({ folder, path }) => ({
          kind: 'folder',
          id: folder.id,
          title: folder.name || 'Folder',
          subtitle: path || 'Home',
          icon: folder.icon || 'folder',
        }));
    }

    if (tab === 'events') {
      cachedEvents ??= await eventRows();

      return cachedEvents
        .filter((ev) =>
          matchesAiContextQuery(
            [ev.title, ev.id, ev.description, ev.location],
            q
          )
        )
        .map((ev) => ({
          kind: 'event',
          id: ev.id,
          title: ev.title || 'Untitled event',
          subtitle: [ev.start, ev.location].filter(Boolean).join(' · '),
          icon: ev.icon || 'calendar-days',
        }));
    }

    return [];
  }

  async function renderResults() {
    const seq = ++renderSeq;
    const rows = await getRows();

    if (
      signal.aborted ||
      seq !== renderSeq ||
      tab === 'upload'
    ) {
      return;
    }

    const list = m.querySelector('[data-ai-context-list]');

    if (list) {
      list.innerHTML = aiContextRowsHtml(rows);
    }
  }

  async function renderPanel({
    focusSearch = false,
  } = {}) {
    setAiContextTabState(m, tab);

    const panel = m.querySelector('[data-ai-context-panel]');
    if (!panel) return;

    if (tab === 'upload') {
      renderSeq++;
      panel.dataset.panel = 'upload';
      panel.innerHTML = aiContextUploadPanelHtml();
      return;
    }

    if (panel.dataset.panel !== 'search') {
      panel.dataset.panel = 'search';
      panel.innerHTML = aiContextSearchPanelHtml(query);
    } else {
      const input = panel.querySelector('[data-ai-context-search]');

      if (input && input.value !== query) {
        input.value = query;
      }
    }

    await renderResults();

    if (focusSearch) {
      focusAiContextSearch(m);
    }
  }

  m.innerHTML = `
    <div class="modal-card yanta-ai-context-picker-card">
      <header class="modal-head">
        <h3>Add to AI Context</h3>
        <button type="button" class="icon-btn" data-ai-context-close>&times;</button>
      </header>

      <div class="modal-body yanta-ai-context-picker-body">
        <div
          class="yanta-ai-context-tabs"
          role="tablist"
          aria-label="AI context source"
        >
          <button type="button" class="active" data-tab="notes" role="tab" aria-selected="true">
            ${lucide('file-text', 14)} Notes
          </button>

          <button type="button" data-tab="folders" role="tab" aria-selected="false">
            ${lucide('folder', 14)} Folders
          </button>

          <button type="button" data-tab="events" role="tab" aria-selected="false">
            ${lucide('calendar-days', 14)} Events
          </button>

          <button type="button" data-tab="upload" role="tab" aria-selected="false">
            ${lucide('upload', 14)} Upload
          </button>
        </div>

        <div data-ai-context-panel></div>
      </div>
    </div>
  `;

  m.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    const tabButton = target.closest('[data-tab]');

    if (tabButton && m.contains(tabButton)) {
      e.preventDefault();

      const nextTab = tabButton.dataset.tab || 'notes';

      if (nextTab === tab) return;

      tab = nextTab;
      query = '';

      await renderPanel({
        focusSearch: tab !== 'upload',
      });

      return;
    }

    const uploadPickButton = target.closest('[data-upload-pick]');

    if (uploadPickButton && m.contains(uploadPickButton)) {
      e.preventDefault();

      m.querySelector('[data-upload-input]')?.click();
      return;
    }

    const rowButton = target.closest('[data-kind][data-id]');

    if (rowButton && m.contains(rowButton)) {
      e.preventDefault();

      const ref = {
        kind: rowButton.dataset.kind,
        id: rowButton.dataset.id,
      };

      await onPickRefs?.([ref]);

      toast('Added AI context', 'success');
      closeAiContextPicker();
    }
  }, {
    signal,
  });

  m.addEventListener('input', async (e) => {
    const input = e.target instanceof HTMLInputElement ? e.target : null;

    if (!input?.matches('[data-ai-context-search]')) {
      return;
    }

    query = input.value || '';

    await renderResults();
  }, {
    signal,
  });

  m.addEventListener('change', async (e) => {
    const input = e.target instanceof HTMLInputElement ? e.target : null;

    if (!input?.matches('[data-upload-input]')) {
      return;
    }

    const files = [...(input.files || [])];

    if (!files.length) return;

    await onPickFiles?.(files);

    toast(
      `Added ${files.length} upload${files.length === 1 ? '' : 's'} to AI context`,
      'success'
    );

    closeAiContextPicker();
  }, {
    signal,
  });

  m.hidden = false;

  await renderPanel({
    focusSearch: true,
  });
}