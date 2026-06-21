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
  if (
    !fromHistory &&
    overlayIdFromState() === AI_CONTEXT_PICKER_OVERLAY_ID
  ) {
    closeTopOverlay(() => {
      if (modal) modal.hidden = true;
    });

    return;
  }

  if (modal) modal.hidden = true;
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

  let tab = 'notes';
  let query = '';

  async function render() {
    const q = query.trim().toLowerCase();

    let rows = [];

    if (tab === 'notes') {
      rows = [...state.notes.values()]
        .filter((n) => !n.trashed)
        .filter((n) =>
          !q ||
          [n.title, n.id, folderPath(n.folderId), (n.tags || []).join(' ')]
            .join(' ')
            .toLowerCase()
            .includes(q)
        )
        .sort((a, b) => (b.updated || 0) - (a.updated || 0))
        .slice(0, 120)
        .map((n) => ({
          kind: 'note',
          id: n.id,
          title: n.title || 'Untitled',
          subtitle: folderPath(n.folderId) || 'Home',
          icon: n.icon || 'file-text',
        }));
    }

    if (tab === 'folders') {
      rows = [...state.folders.values()]
        .filter((f) => !f.trashed)
        .filter((f) =>
          !q ||
          [f.name, f.id, folderPath(f.id)]
            .join(' ')
            .toLowerCase()
            .includes(q)
        )
        .sort((a, b) => folderPath(a.id).localeCompare(folderPath(b.id)))
        .slice(0, 120)
        .map((f) => ({
          kind: 'folder',
          id: f.id,
          title: f.name || 'Folder',
          subtitle: folderPath(f.id) || 'Home',
          icon: f.icon || 'folder',
        }));
    }

    if (tab === 'events') {
      const evs = await eventRows();

      rows = evs
        .filter((ev) =>
          !q ||
          [ev.title, ev.id, ev.description, ev.location]
            .join(' ')
            .toLowerCase()
            .includes(q)
        )
        .map((ev) => ({
          kind: 'event',
          id: ev.id,
          title: ev.title || 'Untitled event',
          subtitle: [ev.start, ev.location].filter(Boolean).join(' · '),
          icon: ev.icon || 'calendar-days',
        }));
    }

    m.innerHTML = `
      <div class="modal-card yanta-ai-context-picker-card">
        <header class="modal-head">
          <h3>Add to AI Context</h3>
          <button class="icon-btn" data-ai-context-close>&times;</button>
        </header>

        <div class="modal-body yanta-ai-context-picker-body">
          <div class="yanta-ai-context-tabs">
            <button class="${tab === 'notes' ? 'active' : ''}" data-tab="notes">${lucide('file-text', 14)} Notes</button>
            <button class="${tab === 'folders' ? 'active' : ''}" data-tab="folders">${lucide('folder', 14)} Folders</button>
            <button class="${tab === 'events' ? 'active' : ''}" data-tab="events">${lucide('calendar-days', 14)} Events</button>
            <button class="${tab === 'upload' ? 'active' : ''}" data-tab="upload">${lucide('upload', 14)} Upload</button>
          </div>

          ${
            tab !== 'upload'
              ? `
                <input class="text-input" data-ai-context-search value="${escapeHtml(query)}" placeholder="Search…" autocomplete="off" spellcheck="false" />

                <div class="yanta-ai-context-list">
                  ${
                    rows.length
                      ? rows.map((row) => `
                        <button class="yanta-ai-context-row" data-kind="${escapeHtml(row.kind)}" data-id="${escapeHtml(row.id)}">
                          <span>${lucide(row.icon, 16)}</span>
                          <span class="yanta-ai-context-row-main">
                            <strong>${escapeHtml(row.title)}</strong>
                            <small>${escapeHtml(row.subtitle || '')}</small>
                          </span>
                          <span>${lucide('plus', 15)}</span>
                        </button>
                      `).join('')
                      : `<div class="tree-empty">No results.</div>`
                  }
                </div>
              `
              : `
                <div class="yanta-ai-context-upload-box" data-upload-box>
                  <strong>Upload files as AI context</strong>
                  <p>Text, Markdown, JSON, CSV, PDF, DOCX and images are supported. Images are compressed to WEBP.</p>
                  <button class="btn primary" data-upload-pick>${lucide('upload', 14)} Pick files</button>
                  <input type="file" data-upload-input hidden multiple
                    accept=".txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.log,.js,.jsx,.ts,.tsx,.css,.sql,.py,.yaml,.yml,.pdf,.docx,image/*" />
                </div>
              `
          }
        </div>
      </div>
    `;

    m.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        tab = btn.dataset.tab || 'notes';
        query = '';
        await render();
      });
    });

    m.querySelector('[data-ai-context-search]')?.addEventListener('input', async (e) => {
      query = e.target.value || '';
      await render();
    });

    m.querySelectorAll('[data-kind][data-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ref = {
          kind: btn.dataset.kind,
          id: btn.dataset.id,
        };

        await onPickRefs?.([ref]);

        toast('Added AI context', 'success');
        closeAiContextPicker();
      });
    });

    const input = m.querySelector('[data-upload-input]');

    m.querySelector('[data-upload-pick]')?.addEventListener('click', () => {
      input?.click();
    });

    input?.addEventListener('change', async () => {
      const files = [...(input.files || [])];

      if (!files.length) return;

      await onPickFiles?.(files);

      toast(`Added ${files.length} upload${files.length === 1 ? '' : 's'} to AI context`, 'success');
      closeAiContextPicker();
    });
  }

  m.hidden = false;
  await render();

  setTimeout(() => {
    m.querySelector('[data-ai-context-search]')?.focus();
  }, 0);
}