// ============================================================
// YANTA — Note / folder CRUD, openNote, preview rendering,
// tag chips, welcome note.
//
// In the new architecture, note CONTENTS live in a per-note Y.Doc
// (see src/yjs.js). This module handles metadata + the open/save lifecycle:
//   - mount the editor onto the current note's Y.Doc
//   - subscribe to Y.Doc updates to re-render preview/title/sync mirror
//   - update metadata (title, tags, pin, folder) on user actions
// ============================================================

import { $, el, uid, state, store, lucide, fmtDate, debounce, toast } from './core.js';
import { t } from './i18n/index.js';
import {
  getNoteDoc,
  getMarkdownText,
  migrateBodyIfNeeded,
  destroyNoteDoc,
  onDocChange,
  noteMarkdown,
  drawingsTextForNote,
  citationsTextForNote,
  setDrawing,
} from './yjs.js';
import { mountEditor, destroyEditor, currentMarkdown, focusEditor, getView, setEditorReadOnly } from './editor.js';
import { renderPreview, setMarkdownRerenderHook } from './markdown.js';
import { wikilinkIndex } from './features-state.js';
import { renderTree, renderTagCloud } from './tree.js';
import { renderBacklinks, renderOutline } from './features.js';
import { renderShareIndicator } from './sharing.js';
import { syncWriteNote, syncDeleteNoteFile, markNoteSyncStatus, refreshGlobalSyncStatus } from './sync.js';
import {
  getVaultDoc,
  vaultNotesMap,
  vaultFoldersMap,
  vaultTombstonesMap,
} from './sync2/vault-doc.js';
import {
  pushNoteHistory,
  currentHistorySurface,
} from './navigation.js';

import {
  moveNoteToTrash,
} from './trash.js';

import { putImageObjectUrl } from './media/object-url-cache.js';

let _navSuppress = false;
let _unsubDoc = null;

// ------------------------------------------------------------
// Built-in Welcome Vault
//
// Important:
// These IDs are intentionally stable.
// If Welcome content is generated in a fresh browser and the user then
// imports a Sync Capsule, we can detect and remove the untouched local
// Welcome Vault before merging the capsule. This prevents duplicate
// Welcome folders/notes without touching real user content.
// ------------------------------------------------------------

export const WELCOME_VERSION = 3;

export const WELCOME_IDS = Object.freeze({
  folders: Object.freeze({
    welcome: 'welcome_folder_start',

    // Legacy IDs from older Welcome Vaults.
    // Kept so untouched old Welcome Vaults can still be detected/pruned.
    guides: 'welcome_folder_guides',
    examples: 'welcome_folder_examples',
  }),

  notes: Object.freeze({
    welcome: 'welcome_note_welcome',
    shopping: 'welcome_note_tasks_workflows',

    // Legacy IDs from older Welcome Vaults.
    // Kept for pristine-welcome cleanup compatibility.
    basics: 'welcome_note_feature_map',
    canvas: 'welcome_note_drawings_visual_thinking',
    sharing: 'welcome_note_sync_live_sharing',
    markdown: 'welcome_note_markdown_essentials',
    graph: 'welcome_note_graph_wikilinks',
    media: 'welcome_note_images_icons_media',
    research: 'welcome_note_research_notes',
  }),

  drawing: 'welcome-drawing-feature-map',
});

const WELCOME_NOTE_IDS = new Set(Object.values(WELCOME_IDS.notes));
const WELCOME_FOLDER_IDS = new Set(Object.values(WELCOME_IDS.folders));

function isWelcomeNoteId(id) {
  return WELCOME_NOTE_IDS.has(String(id));
}

function isWelcomeFolderId(id) {
  return WELCOME_FOLDER_IDS.has(String(id));
}

function nearlySameTimestamp(a, b, toleranceMs = 1500) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= toleranceMs;
}

function isPristineWelcomeNote(note) {
  if (!note || !isWelcomeNoteId(note.id)) return false;

  // createWelcomeNote() creates built-in notes with created === updated.
  // Real edits update note.updated in the normal app flow.
  return nearlySameTimestamp(note.created, note.updated);
}

function isPristineWelcomeFolder(folder) {
  if (!folder || !isWelcomeFolderId(folder.id)) return false;

  return nearlySameTimestamp(
    folder.created,
    folder.updated || folder.created
  );
}

async function rawDeleteFromYantaStore(storeName, key) {
  // Bypass core.store wrappers intentionally.
  // We are deleting the auto-generated local Welcome cache, not creating
  // a user-visible deletion/tombstone.
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open('yanta');

    openReq.onerror = () => reject(openReq.error);

    openReq.onsuccess = () => {
      const db = openReq.result;

      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);

        tx.oncomplete = () => {
          db.close();
          resolve();
        };

        tx.onerror = () => {
          const err = tx.error;
          db.close();
          reject(err);
        };

        tx.onabort = () => {
          const err = tx.error || new Error('IndexedDB transaction aborted');
          db.close();
          reject(err);
        };
      } catch (err) {
        try {
          db.close();
        } catch {}

        reject(err);
      }
    };
  });
}

/**
 * Remove the untouched auto-generated Welcome Vault.
 *
 * This is used before importing a Sync Capsule so a fresh browser's
 * generated Welcome content does not duplicate the Welcome content from
 * the capsule.
 *
 * It only removes when the local vault contains exclusively pristine
 * built-in Welcome notes/folders and no images.
 */
export async function removePristineWelcomeVaultIfPresent({ reason = 'unknown' } = {}) {
  const noteIds = [...state.notes.keys()];
  const folderIds = [...state.folders.keys()];

  if (!noteIds.length && !folderIds.length) return false;

  const onlyWelcomeNotes = noteIds.every(isWelcomeNoteId);
  const onlyWelcomeFolders = folderIds.every(isWelcomeFolderId);

  if (!onlyWelcomeNotes || !onlyWelcomeFolders) return false;

  // Welcome vault has no images. If images exist, user has likely done
  // something real; do not prune.
  if (state.imagesMeta.size > 0) return false;

  for (const noteId of noteIds) {
    const note = state.notes.get(noteId);

    if (!isPristineWelcomeNote(note)) {
      return false;
    }
  }

  for (const folderId of folderIds) {
    const folder = state.folders.get(folderId);

    if (!isPristineWelcomeFolder(folder)) {
      return false;
    }
  }

  const currentWasWelcome =
    state.currentNoteId && isWelcomeNoteId(state.currentNoteId);

  if (currentWasWelcome) {
    clearEditor();
  }

  // Remove local app state + raw IndexedDB cache.
  // Do NOT use store.notes.del / store.folders.del here because the
  // store bridge would create tombstones for the built-in Welcome content.
  for (const noteId of noteIds) {
    state.notes.delete(noteId);
    state.searchIndex.delete(noteId);

    try {
      await rawDeleteFromYantaStore('notes', noteId);
    } catch {}

    try {
      await destroyNoteDoc(noteId);
    } catch {}
  }

  for (const folderId of folderIds) {
    state.folders.delete(folderId);
    state.expandedFolders.delete(folderId);

    try {
      await rawDeleteFromYantaStore('folders', folderId);
    } catch {}
  }

  // Remove Welcome metadata from VaultDoc without tombstones.
  // If the incoming capsule contains Welcome with the same stable IDs,
  // it can now merge cleanly. If it doesn't, Welcome stays gone.
  try {
    const doc = getVaultDoc();

    doc.transact(() => {
      for (const noteId of Object.values(WELCOME_IDS.notes)) {
        vaultNotesMap().delete(noteId);
        vaultTombstonesMap().delete(noteId);
      }

      for (const folderId of Object.values(WELCOME_IDS.folders)) {
        vaultFoldersMap().delete(folderId);
        vaultTombstonesMap().delete(folderId);
      }
    }, 'welcome-prune-before-' + reason);
  } catch {}

  renderTree();

  console.info('[YANTA] Pruned pristine built-in Welcome Vault before', reason);

  return true;
}

setMarkdownRerenderHook(() => { schedulePreview(); });

export function searchHaystack(note, body = '') {
  return [
    note?.title || '',
    (note?.tags || []).join(' '),
    body || '',
    note?.id ? drawingsTextForNote(note.id) : '',
    note?.id ? citationsTextForNote(note.id) : '',
  ].join(' ').toLowerCase();
}

function updateSearchIndexFor(note) {
  if (!note) return;

  let body = '';
  try {
    body = noteMarkdown(note.id);
  } catch {}

  state.searchIndex.set(note.id, searchHaystack(note, body));
}

function renderCalendarAttachmentsSoon(noteId = state.currentNoteId) {
  requestAnimationFrame(() => {
    import('./calendar.js')
      .then((calendar) => {
        /*
          renderCalendarNoteAttachments() hydratisiert Calendar-State jetzt
          selbst aus VaultDoc, falls nötig.
        */
        calendar.renderCalendarNoteAttachments?.(noteId);
      })
      .catch((err) => {
        console.warn('[YANTA Notes] Could not render calendar attachments', err);
      });
  });
}

// ---------------- factories -----------------------------------
export async function newNote(folderId = null, type = 'markdown') {
  const id = uid();

  const note = {
    id,
    title: type === 'list' ? 'List' : 'Note',
    type,
    folderId,
    tags: [],
    pinned: false,
    created: Date.now(),
    updated: Date.now(),
  };

  state.notes.set(id, note);
  await store.notes.put(note);

  try {
    await window.yantaSync2?.engine?.observeNote?.(id);
  } catch {}

  updateSearchIndexFor(note);
  rebuildWikilinkIndex();

  await openNote(id);

  renderTree();

  $('noteTitle').focus();
  $('noteTitle').select();

  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: {
      noteId: id,
      reason: 'note-created',
      source: 'notes',
    },
  }));
}

export async function newFolder(parentId = null, {
  name = 'New folder',
  focusRename = true,
  source = 'unknown',
} = {}) {
  const now = Date.now();

  const f = {
    id: uid(),
    name: String(name || '').trim() || 'New folder',
    parentId: parentId || null,
    created: now,
    updated: now,
  };

  state.folders.set(f.id, f);
  await store.folders.put(f);

  if (parentId) {
    state.expandedFolders.add(parentId);
  }

  state.expandedFolders.add(f.id);

  renderTree();

  window.dispatchEvent(new CustomEvent('yanta-folder-updated', {
    detail: {
      folderId: f.id,
      parentId: f.parentId,
      reason: 'folder-created',
      source,
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-folder-created', {
    detail: {
      folderId: f.id,
      parentId: f.parentId,
      focusRename,
      source,
    },
  }));

  try {
    window.yantaSync2Now?.();
  } catch {}

  return f;
}

// ---------------- open / save / delete ------------------------
export async function openNote(id) {
  const note = state.notes.get(id);
  if (!note) return;

  const previousNoteId = state.currentNoteId;

  if (previousNoteId && previousNoteId !== id) {
    window.dispatchEvent(new CustomEvent('yanta-note-closing', {
      detail: {
        noteId: previousNoteId,
        nextNoteId: id,
        reason: 'open-note',
      },
    }));
  }

  /*
    Auch wenn dieselbe Note schon im Speicher currentNoteId ist,
    kann die aktuelle Surface "dashboard" sein.

    Beispiel:
    - App startet mit Dashboard
    - currentNoteId ist noch Welcome/LastNote
    - User öffnet genau diese Note vom Dashboard
    -> Früher return; kein Note-History-State; Back verlässt App.
    -> Jetzt wird trotzdem ein Note-State erzeugt.
  */
  if (state.currentNoteId === id) {
    state.surface = 'note';

    if (!_navSuppress && currentHistorySurface() !== 'note') {
      pushNoteHistory(id);
    }

    window.dispatchEvent(new CustomEvent('yanta-note-opened', {
      detail: { noteId: id },
    }));

    return;
  }

  // Tear down previous subscription / editor
  if (_unsubDoc) {
    _unsubDoc();
    _unsubDoc = null;
  }

  state.currentNoteId = id;
  state.surface = 'note';

  store.settings.set('lastNoteId', id);

  if (!_navSuppress) {
    pushNoteHistory(id);
  }

  // Ensure Y.Doc + migration done before mount
  await migrateBodyIfNeeded(note);

  const entry = getNoteDoc(id);
  await entry.ready;

  const titleInput = $('noteTitle');

  if (titleInput) {
    titleInput.value = note.title || '';
    titleInput.readOnly = note.spaceRole === 'read';
  }

  // Mount editor (replaces previous instance)
  const host = $('editor');
  host.replaceChildren();

  mountEditor(host, { noteId: id });

  // Notes mounted from a shared space with a read role are hard
  // read-only: the server rejects their writes anyway, this keeps
  // the UI honest about it.
  setEditorReadOnly(note.spaceRole === 'read');

  renderChips();
  updatePinIcon();
  renderShareIndicator();
  renderTree();
  schedulePreview();
  renderCalendarAttachmentsSoon(id);
  scrollCurrentNoteToTop();

  // Subscribe to Y.Doc updates → re-render preview, persist mirror.
  _unsubDoc = onDocChange(id, (_update, origin) => {
    const isDrawUpdate =
      typeof origin === 'string' &&
      origin.startsWith('draw');

    if (origin === 'sync-folder' || origin === 'sync2-remote' || origin === 'space-remote') {
      schedulePreview();
      updateSearchIndexFor(note);
      markNoteSyncStatus(id, 'synced');
      refreshGlobalSyncStatus();
      markSaved();
      return;
    }

    if (isDrawUpdate) {
      window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
        detail: { noteId: id },
      }));
    
      updateSearchIndexFor(note);
    
      note.updated = Date.now();
      store.notes.put(note);
    
      window.dispatchEvent(new CustomEvent('yanta-note-updated', {
        detail: {
          noteId: id,
          reason: 'drawing-change',
        },
      }));
    
      scheduleMirror(note);
    
      return;
    }

    schedulePreview();
    updateSearchIndexFor(note);
    
    markDirty();
    
    note.updated = Date.now();
    store.notes.put(note);
    
    window.dispatchEvent(new CustomEvent('yanta-note-updated', {
      detail: {
        noteId: id,
        reason: 'body-change',
      },
    }));
    
    scheduleMirror(note);
    
    markNoteSyncStatus(id, 'local');
    refreshGlobalSyncStatus();
  });

  preloadImagesFor(noteMarkdown(id));

  window.dispatchEvent(new CustomEvent('yanta-note-opened', {
    detail: { noteId: id },
  }));
}

function scrollCurrentNoteToTop() {
  const run = () => {
    const editorScroller = getView()?.scrollDOM;
    const previewPane = $('panePreview');

    if (editorScroller) editorScroller.scrollTop = 0;
    if (previewPane) previewPane.scrollTop = 0;
  };

  requestAnimationFrame(() => {
    run();
    requestAnimationFrame(run);
  });
}

function videoSrcIn(el) {
  const src = el
    ?.querySelector?.('.pv-embed-video iframe[src]')
    ?.getAttribute('src') || '';

  if (!src) return '';

  // URLs normalisieren, damit relative/absolute Varianten gleich verglichen werden.
  try {
    return new URL(src, location.href).href;
  } catch {
    return src;
  }
}

function syncAttrs(target, source) {
  for (const attr of [...target.attributes]) {
    if (!source.hasAttribute(attr.name)) {
      target.removeAttribute(attr.name);
    }
  }

  for (const attr of [...source.attributes]) {
    target.setAttribute(attr.name, attr.value);
  }
}

function setPreviewHtmlPreservingVideos(previewEl, html) {
  if (!previewEl) return;

  const hasOldVideo = !!previewEl.querySelector('.pv-embed-video iframe[src]');

  // Kein Video im alten Preview: schneller Normalpfad.
  if (!hasOldVideo) {
    previewEl.innerHTML = html;
    return;
  }

  // Backlinks werden nachher wieder von renderBacklinks() erzeugt.
  previewEl.querySelector('.backlinks')?.remove();

  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  const oldLines = [...previewEl.children].filter((el) =>
    el.classList?.contains('pv-line')
  );

  const newLines = [...tmp.children].filter((el) =>
    el.classList?.contains('pv-line')
  );

  const max = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < max; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (!newLine) {
      oldLine?.remove();
      continue;
    }

    if (!oldLine) {
      previewEl.append(newLine);
      continue;
    }

    const oldVideoSrc = videoSrcIn(oldLine);
    const newVideoSrc = videoSrcIn(newLine);

    const sameSourceLine =
      oldLine.dataset.line === newLine.dataset.line;

    const sameVideo =
      oldVideoSrc &&
      newVideoSrc &&
      oldVideoSrc === newVideoSrc;

    // Wichtig:
    // Wenn auf derselben Source-Line derselbe Video-Embed steht,
    // behalten wir die ALTE DOM-Node komplett.
    // Dadurch bleibt das iframe leben und YouTube lädt nicht neu.
    if (sameSourceLine && sameVideo) {
      syncAttrs(oldLine, newLine);
      continue;
    }

    oldLine.replaceWith(newLine);
  }
}

export function clearEditor() {
  if (_unsubDoc) { _unsubDoc(); _unsubDoc = null; }
  state.currentNoteId = null;
  const titleInput = $('noteTitle');

  if (titleInput) {
    titleInput.value = '';
  }
  destroyEditor();
  $('editor').replaceChildren();
  $('preview').innerHTML = '';
  $('paneEdit')
    ?.querySelectorAll(':scope > .yanta-event-note-card')
    ?.forEach((n) => n.remove());

  $('panePreview')
    ?.querySelectorAll(':scope > .yanta-event-note-card')
    ?.forEach((n) => n.remove());
  renderChips();
  markSaved();
}

export async function saveCurrentNote() {
  const noteId = state.currentNoteId;
  if (!noteId) return;

  const note = state.notes.get(noteId);
  if (!note) return;

  const titleInput = $('noteTitle');
  const newTitle = titleInput?.value?.trim() || note.title || 'Untitled';

  /*
    If a debounced title save fires after navigation, never write the old
    title input into the newly opened note or vice versa.
  */
  if (state.currentNoteId !== noteId) return;
  const titleChanged = note.title !== newTitle;
  note.title = newTitle;
  note.updated = Date.now();
  await store.notes.put(note);
  updateSearchIndexFor(note);
  if (titleChanged) {
    rebuildWikilinkIndex();
    schedulePreview();
  }
  syncWriteNote(note).catch(() => {});
  markSaved();
  renderTree();
  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: {
      noteId: note.id,
      reason: titleChanged ? 'title-change' : 'metadata-save',
      source: 'notes',
    },
  }));
}

export async function deleteCurrentNote() {
  if (!state.currentNoteId) return;

  const note = state.notes.get(state.currentNoteId);
  if (!note) return;

  let calendar = null;
  let linkedEvent = null;

  try {
    calendar = await import('./calendar.js');
    linkedEvent = calendar.calendarEventForNoteId?.(note.id) || null;
  } catch {}

  if (linkedEvent && calendar?.calendarChoiceDialog) {
    const choice = await calendar.calendarChoiceDialog({
      title: 'Delete note',
      message: `This note is linked to the calendar event "${linkedEvent.title || 'Untitled event'}".`,
      choices: [
        { id: 'note-only', label: 'Delete note only', primary: true, danger: true },
        { id: 'note-and-event', label: 'Delete note and event', danger: true },
        { id: 'cancel', label: 'Cancel' },
      ],
    });

    if (choice === 'cancel') return;

    if (choice === 'note-and-event') {
      calendar.deleteCalendarEvent?.(linkedEvent.id);
    } else {
      calendar.unlinkEventNote?.(linkedEvent.id);
    }
  } else if (calendar?.calendarChoiceDialog) {
    const choice = await calendar.calendarChoiceDialog({
      title: 'Delete note',
      message: `Move "${note.title || 'Untitled'}" to Trash?`,
      choices: [
        { id: 'delete', label: 'Move to Trash', primary: true, danger: true, icon: 'trash' },
        { id: 'cancel', label: `No, keep ${note.title || 'Untitled'}`, icon: 'FileText' },
      ],
    });

    if (choice !== 'delete') return;
  } else {
    if (!confirm(`Move "${note.title || 'Untitled'}" to Trash?`)) return;
  }

  await moveNoteToTrash(note.id, {
    source: 'note-delete-button',
    toastMessage: 'Moved note to Trash',
  });

  try {
    window.yantaSync2Now?.();
  } catch {}
}

export function togglePin() {
  if (!state.currentNoteId) return;
  const n = state.notes.get(state.currentNoteId);
  n.pinned = !n.pinned;
  n.updated = Date.now();
  store.notes.put(n);
  updatePinIcon();
  renderTree();
  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: {
      noteId: n.id,
      reason: 'pin-toggle',
      source: 'notes',
    },
  }));
}
export function updatePinIcon() {
  const btn = $('btn-pin');
  if (!btn) return;

  if (!state.currentNoteId) {
    btn.classList.remove('active');
    return;
  }

  const n = state.notes.get(state.currentNoteId);
  btn.classList.toggle('active', !!n?.pinned);
}

// ---------------- tags ----------------------------------------
export function renderChips() {
  const c = $('chips');
  if (!c) return;

  c.replaceChildren();

  if (!state.currentNoteId) return;

  const n = state.notes.get(state.currentNoteId);
  if (!n) return;

  for (const tag of n.tags || []) {
    const chip = el('span', { class: 'chip' }, '#' + tag,
      el('button', {
        title: 'Remove tag',
        onclick: () => removeTag(tag),
      }, '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>')
    );

    c.append(chip);
  }
}
export function addTag(tag) {
  tag = tag.trim().replace(/^#/, '').toLowerCase();
  if (!tag || !state.currentNoteId) return;
  const n = state.notes.get(state.currentNoteId);
  if (!n.tags) n.tags = [];
  if (!n.tags.includes(tag)) {
    n.tags.push(tag);
    n.updated = Date.now();
    store.notes.put(n);
    updateSearchIndexFor(n);
    renderChips();
    renderTagCloud();
    window.dispatchEvent(new CustomEvent('yanta-note-updated', {
      detail: { noteId: n.id },
    }));
  }
}
export function removeTag(tag) {
  const n = state.notes.get(state.currentNoteId);
  n.tags = (n.tags || []).filter((t) => t !== tag);
  n.updated = Date.now();
  store.notes.put(n);
  updateSearchIndexFor(n);
  renderChips();
  renderTagCloud();
  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: { noteId: n.id },
  }));
}

// ---------------- wikilink index ------------------------------
export function rebuildWikilinkIndex() {
  wikilinkIndex.clear();
  for (const n of state.notes.values()) if (n.title) wikilinkIndex.set(n.title.toLowerCase(), n.id);
}

// ---------------- preview + mirror ----------------------------
export const schedulePreview = debounce(() => {
  if (!state.currentNoteId) return;

  const md = noteMarkdown(state.currentNoteId);
  setPreviewHtmlPreservingVideos($('preview'), renderPreview(md));
  renderOutline(md);
  renderBacklinks(state.currentNoteId);
  updateWordCount(md);

  // Semantic "Related notes" below the backlinks (no-op when disabled;
  // renders from cache, refreshes through the worker on a throttle).
  import('./semantic/semantic-related.js')
    .then((m) => m.renderRelatedNotes(state.currentNoteId))
    .catch(() => {});

  requestAnimationFrame(() => {
    renderCalendarAttachmentsSoon(state.currentNoteId);
    window.dispatchEvent(new CustomEvent('yanta-preview-rendered'));
  });
}, 80);

const scheduleMirror = debounce(async (note) => {
  try {
    await syncWriteNote(note);
    markSaved();
  } catch {
    // Keep dirty state if writing failed.
  }
}, 700);

function preloadImagesFor(md) {
  const re = /yanta-img:\/\/([a-z0-9]+)/gi;
  const ids = [];
  let m;
  while ((m = re.exec(md || '')) !== null) ids.push(m[1]);
  if (!ids.length) return;
  let needsRerender = false;
  Promise.all(ids.map(async (id) => {
    if (state.imageBlobs.has(id)) return;
    const rec = await store.images.get(id);
    if (rec?.blob) {
      putImageObjectUrl(id, rec.blob);
      needsRerender = true;
    }
  })).then(() => { if (needsRerender) schedulePreview(); });
}

// ---------------- dirty / saved status ------------------------
export function markDirty() {
  state.dirty = true;
  const e = $('statSaved');
  if (e) { e.textContent = 'Saving…'; e.className = 'dirty'; }
}
export function markSaved() {
  state.dirty = false;
  const e = $('statSaved');
  if (e) { e.textContent = 'Saved · ' + fmtDate(Date.now()); e.className = 'saved'; }
}

function updateWordCount(md) {
  const text = md.replace(/```[\s\S]*?```/g, '').replace(/[#*_>`-]/g, '').trim();
  const words = text ? text.split(/\s+/).length : 0;
  $('statWords').textContent = words + ' word' + (words === 1 ? '' : 's');
  $('statChars').textContent = md.length + ' char' + (md.length === 1 ? '' : 's');
}

export async function toggleTaskLineInNote(noteId, lineIndex, checked, {
  source = '',
} = {}) {
  if (!noteId) return false;

  const note = state.notes.get(noteId);
  if (!note) return false;

  const { doc } = getNoteDoc(noteId);
  const ytext = doc.getText('markdown');

  const text = ytext.toString();
  const lines = text.split('\n');

  const line = lines[lineIndex];
  if (line == null) return false;

  const m = /^(\s*[-*+]\s+\[)([ xX])(\])/.exec(line);
  if (!m) return false;

  let lineStart = 0;

  for (let i = 0; i < lineIndex; i++) {
    lineStart += lines[i].length + 1;
  }

  const target = lineStart + m[1].length;
  const newChar = checked ? 'x' : ' ';

  doc.transact(() => {
    ytext.delete(target, 1);
    ytext.insert(target, newChar);
  }, 'task-toggle');

  note.updated = Date.now();
  await store.notes.put(note);

  updateSearchIndexFor(note);

  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: {
      noteId,
      reason: 'task-toggle',
      source,
    },
  }));

  return true;
}

// ---------------- welcome -------------------------------------
export async function createWelcomeNote() {
  const now = Date.now();

  // If the stable Welcome Vault already exists, just open it.
  // We intentionally do not overwrite existing Welcome content because
  // the user may already have edited it.
  if (state.notes.has(WELCOME_IDS.notes.welcome)) {
    await openNote(WELCOME_IDS.notes.welcome);
    return;
  }

  const folderId = WELCOME_IDS.folders.welcome;

  const welcomeFolder = {
    id: folderId,
    name: 'Welcome',
    parentId: null,
    created: now,
    updated: now,
    icon: 'sparkles',
    color: '#6ea8fe',
  };

  state.folders.set(welcomeFolder.id, welcomeFolder);
  await store.folders.put(welcomeFolder);
  state.expandedFolders.add(welcomeFolder.id);

  const ids = {
    welcome: WELCOME_IDS.notes.welcome,
    shopping: WELCOME_IDS.notes.shopping,
  };

  const drawingId = WELCOME_IDS.drawing;

  /*
    Warum nur zwei Notes: das alte Welcome-Vault (5 Notes) wurde nicht
    gelesen — zu viel Text, dreimal Sync erklärt, dasselbe Drawing
    doppelt eingebettet. Onboarding passiert jetzt durch TUN (die
    Checkliste unten), nicht durch Lesen.
  */
  const notes = [
    {
      id: ids.welcome,
      title: 'Start here',
      type: 'markdown',
      folderId,
      tags: ['welcome'],
      pinned: false,
      icon: 'sparkles',
      color: '#2563eb',
      body: `# Start here 👋

**YANTA** is your private workspace. Notes, drawings, calendar, chat and AI in one place. Everything stays on your device or your encrypted cloud unless *you* decide to share.

draw://${drawingId}

## Try it — one minute

- [ ] Press **Ctrl/⌘ + Shift + Space** and capture a thought. It lands in today's journal note
- [ ] Type \`/\` in any note. Drawings, images, events and more
- [ ] Type \`[[\` to link notes. Try [[Shopping List]]
- [ ] Press **Ctrl/⌘ + P**. Every command lives there

## Good to know

- **Private by design**. Sync and sharing are end-to-end encrypted; not even the cloud can read your notes.
- **No lock-in**. Plain Markdown under the hood, export everything anytime.
- Calendar, feeds, chat and the AI assistant wait in the bottom-left corner. Explore whenever you're ready.

*Delete this Welcome folder whenever you like.*`,
    },
    {
      id: ids.shopping,
      title: 'Shopping List',
      type: 'markdown',
      folderId,
      tags: ['example'],
      pinned: false,
      icon: 'shopping-cart',
      color: '#059669',
      body: `# Shopping List

A tiny checklist. Check something off!

- [ ] Apples
- [ ] Coffee
- [ ] Pasta
- [ ] Olive oil

**Tip:** hit **Share** (top right) and this becomes a live list. Whoever you invite can tick items off from their phone while you shop.`,
    },
  ];

  for (const note of notes) {
    const { body, ...meta } = note;

    meta.created = now;
    meta.updated = now;

    state.notes.set(meta.id, meta);
    await store.notes.put(meta);

    const entry = getNoteDoc(meta.id);
    await entry.ready;

    const ytext = entry.doc.getText('markdown');

    if (ytext.length === 0) {
      ytext.insert(0, body);
    }

    updateSearchIndexFor(meta);
  }

  // Build the Welcome canvas with normal Excalidraw-style elements.
  //
  // Wichtig:
  // - Keine separate Light/Dark-Palette speichern.
  // - Excalidraw selbst kümmert sich um Theme-Verhalten.
  // - Farben sind normale Excalidraw-Palette-Farben, wie User sie wählen würden.
  // - Nur die Box ist verlinkt, nicht Box + Text doppelt.
  // - Text + Box sind gruppiert.
  // - Arrows sind an Boxen gebunden.
  let convertToExcalidrawElements = null;

  try {
    const excalidrawMod = await import('@excalidraw/excalidraw');
    convertToExcalidrawElements = excalidrawMod.convertToExcalidrawElements;
  } catch {}

  const versionNonce = () => Math.floor(Math.random() * 2 ** 31);
  const yantaNoteLink = (noteId) => `yanta-note://${noteId}`;

  const yantaWikiData = (title, noteId) => ({
    yanta: {
      wikilink: {
        noteId,
        target: title,
        alias: null,
        href: yantaNoteLink(noteId),
        updated: now,
      },
    },
  });

  // Excalidraw light-palette colors.
  // These are intentionally not theme-conditional.
  // Excalidraw's dark mode handles display/filtering like for user-created elements.
  const XCOL = {
    strokeDefault: '#1e1e1e',
    textDefault: '#1e1e1e',
    muted: '#868e96',

    blueStroke: '#1971c2',
    blueBg: '#d0ebff',

    cyanStroke: '#0c8599',
    cyanBg: '#c5f6fa',

    greenStroke: '#2f9e44',
    greenBg: '#d3f9d8',

    orangeStroke: '#e8590c',
    orangeBg: '#ffe8cc',

    yellowStroke: '#f08c00',
    yellowBg: '#fff3bf',

    violetStroke: '#6741d9',
    violetBg: '#e5dbff',
  };

  function estimateTextWidth(text, fontSize, maxWidth) {
    const raw = String(text || '').length * fontSize * 0.58;
    return Math.max(40, Math.min(maxWidth, Math.ceil(raw)));
  }

  function centeredTextBox({ text, boxX, boxY, boxW, yOffset, fontSize, maxInset = 24 }) {
    const maxWidth = Math.max(40, boxW - maxInset * 2);
    const width = estimateTextWidth(text, fontSize, maxWidth);

    return {
      x: boxX + (boxW - width) / 2,
      y: boxY + yOffset,
      width,
    };
  }

  const fallbackExcalidrawElement = (def = {}) => {
    const common = {
      id: def.id || uid(),
      type: def.type,
      x: Number(def.x || 0),
      y: Number(def.y || 0),
      width: Number(def.width || 0),
      height: Number(def.height || 0),
      angle: 0,
      strokeColor: def.strokeColor || XCOL.strokeDefault,
      backgroundColor: def.backgroundColor || 'transparent',
      fillStyle: def.fillStyle || 'solid',
      strokeWidth: Number(def.strokeWidth || 2),
      strokeStyle: def.strokeStyle || 'solid',
      roughness: Number(def.roughness ?? 1),
      opacity: Number(def.opacity ?? 100),
      groupIds: def.groupIds || [],
      frameId: null,
      roundness: def.roundness ?? (def.type === 'rectangle' ? { type: 3 } : null),
      seed: versionNonce(),
      version: 1,
      versionNonce: versionNonce(),
      isDeleted: false,
      boundElements: def.boundElements ?? null,
      updated: now,
      link: def.link ?? null,
      locked: false,
      customData: def.customData || {},
    };

    if (def.type === 'text') {
      const fontSize = Number(def.fontSize || 22);
      const text = String(def.text || '');

      return {
        ...common,
        text,
        rawText: text,
        originalText: text,
        fontSize,
        fontFamily: 5,
        textAlign: def.textAlign || 'center',
        verticalAlign: 'middle',
        baseline: Math.round(fontSize * 1.15),
        containerId: null,
        lineHeight: 1.25,
        height: Math.max(28, Math.round(fontSize * 1.45)),
      };
    }

    if (def.type === 'arrow' || def.type === 'line') {
      return {
        ...common,
        type: 'arrow',
        points: def.points || [
          [0, 0],
          [Number(def.width || 0), Number(def.height || 0)],
        ],
        startBinding: def.startBinding || null,
        endBinding: def.endBinding || null,
        startArrowhead: def.startArrowhead ?? null,
        endArrowhead: def.endArrowhead ?? 'arrow',
        roundness: { type: 2 },
      };
    }

    return common;
  };

  const makeExcalidrawElement = (def = {}, patch = {}) => {
    const {
      id,
      groupIds,
      link,
      customData,
      boundElements,
      startBinding,
      endBinding,
      startArrowhead,
      endArrowhead,
      points,
      roundness,
      ...convertDef
    } = def;

    let el = null;

    if (typeof convertToExcalidrawElements === 'function') {
      try {
        [el] = convertToExcalidrawElements([convertDef]);
      } catch {
        el = null;
      }
    }

    if (!el) {
      el = fallbackExcalidrawElement(def);
    }

    const next = {
      ...el,

      id: id || el.id || uid(),
      groupIds: groupIds || el.groupIds || [],
      link: link ?? el.link ?? null,
      customData: customData ?? el.customData ?? {},
      boundElements: boundElements === undefined
        ? (el.boundElements ?? null)
        : boundElements,

      version: 1,
      versionNonce: versionNonce(),
      updated: now,
      isDeleted: false,
      locked: false,

      ...patch,
    };

    if (roundness !== undefined) next.roundness = roundness;
    if (points !== undefined) next.points = points;

    if (startBinding !== undefined) next.startBinding = startBinding;
    if (endBinding !== undefined) next.endBinding = endBinding;
    if (startArrowhead !== undefined) next.startArrowhead = startArrowhead;
    if (endArrowhead !== undefined) next.endArrowhead = endArrowhead;

    return next;
  };

  const makeText = ({
    id = uid(),
    groupIds = [],
    text,
    x,
    y,
    width,
    fontSize = 22,
    strokeColor = XCOL.textDefault,
    textAlign = 'center',
    noteId = null,
    linkEnabled = false,
  }) => {
    const cleanText = String(text || '');

    return makeExcalidrawElement(
      {
        id,
        type: 'text',
        x,
        y,
        width,
        text: cleanText,
        fontSize,
        textAlign,
        strokeColor,
        groupIds,

        // Usually false for card text to avoid duplicate links.
        link: linkEnabled && noteId ? yantaNoteLink(noteId) : null,
        customData: linkEnabled && noteId ? yantaWikiData(cleanText, noteId) : {},
      },
      {
        x,
        y,
        width,
        strokeColor,
        textAlign,
        fontSize,
        fontFamily: 5,
        verticalAlign: 'middle',
        height: Math.max(28, Math.round(fontSize * 1.45)),
        baseline: Math.round(fontSize * 1.15),
      }
    );
  };

  const makeRect = ({
    id = uid(),
    groupIds = [],
    x,
    y,
    width,
    height,
    strokeColor = XCOL.strokeDefault,
    backgroundColor = 'transparent',
    noteId = null,
    title = '',
    boundElements = null,
  }) => makeExcalidrawElement(
    {
      id,
      type: 'rectangle',
      x,
      y,
      width,
      height,
      strokeColor,
      backgroundColor,
      fillStyle: 'solid',
      strokeWidth: 2,
      roughness: 1,
      groupIds,

      // Only the box carries the note link.
      link: noteId ? yantaNoteLink(noteId) : null,
      customData: noteId ? yantaWikiData(title, noteId) : {},

      boundElements,
      roundness: { type: 3 },
    },
    {
      x,
      y,
      width,
      height,
      strokeColor,
      backgroundColor,
      fillStyle: 'solid',
      strokeWidth: 2,
      roughness: 1,
      roundness: { type: 3 },
    }
  );

  const WELCOME_ARROW_GAP = 10;

  const makeArrow = ({
    id = uid(),
    startBox = null,
    endBox = null,
    start,
    end,
    via = null,
    strokeColor = XCOL.muted,
    strokeStyle = 'solid',
  }) => {
    const width = end.x - start.x;
    const height = end.y - start.y;

    // A "via" waypoint bends the arrow into a gentle arc.
    const points = via
      ? [[0, 0], [via[0], via[1]], [width, height]]
      : [[0, 0], [width, height]];

    return makeExcalidrawElement(
      {
        id,
        type: 'arrow',
        x: start.x,
        y: start.y,
        width,
        height,
        strokeColor,
        strokeWidth: 2,
        strokeStyle,
        roughness: 1,
        points,
        startBinding: startBox
          ? {
            elementId: startBox.id,
            focus: 0,
            gap: WELCOME_ARROW_GAP,
          }
          : null,
        endBinding: endBox
          ? {
            elementId: endBox.id,
            focus: 0,
            gap: WELCOME_ARROW_GAP,
          }
          : null,
        startArrowhead: null,
        endArrowhead: 'arrow',
        roundness: { type: 2 },
      },
      {
        x: start.x,
        y: start.y,
        width,
        height,
        strokeColor,
        strokeStyle,
        strokeWidth: 2,
        opacity: 78,
        roundness: { type: 2 },
      }
    );
  };

  const makeCard = ({
    x,
    y,
    width = 240,
    height = 92,
    title,
    subtitle,
    noteId,
    strokeColor,
    backgroundColor,
    angle = 0,
  }) => {
    const groupId = uid();
    const boxId = uid();

    const box = makeRect({
      id: boxId,
      groupIds: [groupId],
      x,
      y,
      width,
      height,
      strokeColor,
      backgroundColor,
      noteId,
      title,
      boundElements: [],
    });

    const titlePos = centeredTextBox({
      text: title,
      boxX: x,
      boxY: y,
      boxW: width,
      yOffset: 18,
      fontSize: 22,
      maxInset: 20,
    });

    const subtitlePos = centeredTextBox({
      text: subtitle,
      boxX: x,
      boxY: y,
      boxW: width,
      yOffset: 56,
      fontSize: 15,
      maxInset: 22,
    });

    const titleText = makeText({
      groupIds: [groupId],
      text: title,
      x: titlePos.x,
      y: titlePos.y,
      width: titlePos.width,
      fontSize: 22,
      strokeColor,
      textAlign: 'center',
      noteId,
      linkEnabled: false,
    });

    const subtitleText = makeText({
      groupIds: [groupId],
      text: subtitle,
      x: subtitlePos.x,
      y: subtitlePos.y,
      width: subtitlePos.width,
      fontSize: 15,
      strokeColor: XCOL.muted,
      textAlign: 'center',
      noteId: null,
      linkEnabled: false,
    });

    const elements = [box, titleText, subtitleText];

    /*
      Leichte Neigung (±1.5°) für den handgemachten Look. Excalidraw
      rotiert jedes Element um sein eigenes Zentrum — bei so kleinen
      Winkeln ist der Versatz gegenüber echter Gruppenrotation unsichtbar.
    */
    if (angle) {
      for (const el of elements) el.angle = angle;
    }

    return {
      groupId,
      box,
      elements,
      cx: x + width / 2,
      cy: y + height / 2,
      left: x,
      right: x + width,
      top: y,
      bottom: y + height,
    };
  };

  // --- Scene: one idea travels from capture to shared -------------
  // Serpentine: 💭 idea → capture → write ↓ connect → share.
  // Kompakt (~640 breit), damit das Embed in der Notizspalte nichts
  // abschneidet. Slight tilts + arcs keep it hand-made, not stiff.

  const bubbleGroupId = uid();

  const bubble = makeExcalidrawElement(
    {
      id: uid(),
      type: 'ellipse',
      x: 60,
      y: 96,
      width: 200,
      height: 56,
      strokeColor: XCOL.yellowStroke,
      backgroundColor: 'transparent',
      strokeStyle: 'dashed',
      strokeWidth: 2,
      roughness: 1,
      groupIds: [bubbleGroupId],
    },
    {
      x: 60,
      y: 96,
      width: 200,
      height: 56,
      strokeStyle: 'dashed',
      angle: -0.02,
    }
  );

  const bubbleText = makeText({
    groupIds: [bubbleGroupId],
    text: '💭 that shower idea',
    x: 80,
    y: 112,
    width: 160,
    fontSize: 14,
    strokeColor: XCOL.muted,
  });

  bubbleText.angle = -0.02;

  const heading = makeText({
    text: 'Your ideas, connected.',
    x: 150,
    y: 28,
    width: 340,
    fontSize: 26,
    strokeColor: XCOL.strokeDefault,
  });

  const captureCard = makeCard({
    x: 50,
    y: 218,
    width: 200,
    height: 88,
    title: '💡 Capture',
    subtitle: 'one keystroke',
    noteId: null,
    strokeColor: XCOL.yellowStroke,
    backgroundColor: XCOL.yellowBg,
    angle: -0.025,
  });

  const writeCard = makeCard({
    x: 350,
    y: 200,
    width: 200,
    height: 88,
    title: '✍️ Write',
    subtitle: 'notes, draw, embed',
    noteId: null,
    strokeColor: XCOL.blueStroke,
    backgroundColor: XCOL.blueBg,
    angle: 0.02,
  });

  const connectCard = makeCard({
    x: 350,
    y: 390,
    width: 200,
    height: 88,
    title: '🔗 Connect',
    subtitle: 'wikilinks + graph',
    noteId: null,
    strokeColor: XCOL.violetStroke,
    backgroundColor: XCOL.violetBg,
    angle: -0.015,
  });

  const shareCard = makeCard({
    x: 50,
    y: 408,
    width: 200,
    height: 88,
    title: '🤝 Share',
    subtitle: 'live + encrypted',
    noteId: ids.shopping,
    strokeColor: XCOL.greenStroke,
    backgroundColor: XCOL.greenBg,
    angle: 0.02,
  });

  const sparkles = [
    { x: 300, y: 122, fontSize: 18, color: XCOL.violetStroke, angle: 0.3 },
    { x: 588, y: 316, fontSize: 15, color: XCOL.cyanStroke, angle: -0.2 },
    { x: 88, y: 348, fontSize: 20, color: XCOL.yellowStroke, angle: 0.25 },
  ].map((s) => {
    const star = makeText({
      text: '✦',
      x: s.x,
      y: s.y,
      width: 30,
      fontSize: s.fontSize,
      strokeColor: s.color,
    });

    star.angle = s.angle;
    return star;
  });

  const flow = [
    {
      from: captureCard,
      to: writeCard,
      start: { x: 260, y: 262 },
      end: { x: 340, y: 246 },
      via: [40, -14],
    },
    {
      from: writeCard,
      to: connectCard,
      start: { x: 452, y: 298 },
      end: { x: 452, y: 380 },
      via: [22, 41],
    },
    {
      from: connectCard,
      to: shareCard,
      start: { x: 340, y: 436 },
      end: { x: 260, y: 452 },
      via: [-40, 14],
    },
  ];

  const arrows = flow.map((step) => makeArrow({
    startBox: step.from.box,
    endBox: step.to.box,
    start: step.start,
    end: step.end,
    via: step.via,
  }));

  const attachArrowToBox = (box, arrow) => {
    if (!box.boundElements) box.boundElements = [];

    if (!box.boundElements.some((x) => x.id === arrow.id)) {
      box.boundElements.push({
        id: arrow.id,
        type: 'arrow',
      });
    }
  };

  flow.forEach((step, i) => {
    attachArrowToBox(step.from.box, arrows[i]);
    attachArrowToBox(step.to.box, arrows[i]);
  });

  // Unbound on purpose: the doodle arrow from the thought bubble is
  // decoration, not diagram plumbing.
  const bubbleArrow = makeArrow({
    start: { x: 166, y: 160 },
    end: { x: 152, y: 210 },
    via: [-8, 22],
    strokeColor: XCOL.yellowStroke,
    strokeStyle: 'dashed',
  });

  const hint = makeText({
    text: 'A live canvas — drag things around · the green card links to a note',
    x: 40,
    y: 532,
    width: 560,
    fontSize: 14.5,
    strokeColor: XCOL.muted,
    textAlign: 'center',
  });

  setDrawing(ids.welcome, drawingId, {
    id: drawingId,
    title: 'YANTA Welcome Canvas',
    canvas: {
      width: 640,
      height: 580,
    },
    elements: [
      ...arrows,
      bubbleArrow,

      bubble,
      bubbleText,
      heading,

      ...captureCard.elements,
      ...writeCard.elements,
      ...connectCard.elements,
      ...shareCard.elements,

      ...sparkles,
      hint,
    ],

    // Kein theme, kein viewBackgroundColor.
    // Excalidraw/draw.js steuert das aktuelle Theme.
    appState: {
      zoom: {
        value: 0.75,
      },
      scrollX: 8,
      scrollY: 10,
    },

    files: {},
  }, 'welcome-draw');

  updateSearchIndexFor(state.notes.get(ids.welcome));

  rebuildWikilinkIndex();

  await openNote(ids.welcome);

  renderTree();

  toast(t('items.welcomeVault'), 'success');
}

export function setNavSuppress(v) { _navSuppress = v; }

// Used by wikilink follow when target doesn't exist.
export async function createNoteWithTitle(title) {
  const id = uid();
  const note = { id, title: title.trim() || 'Untitled', type: 'markdown', folderId: state.notes.get(state.currentNoteId)?.folderId || null, tags: [], pinned: false, created: Date.now(), updated: Date.now() };
  state.notes.set(id, note);
  await store.notes.put(note);
  updateSearchIndexFor(note);
  rebuildWikilinkIndex();
  await openNote(id);
  renderTree();
}
