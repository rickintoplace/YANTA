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
import { mountEditor, destroyEditor, currentMarkdown, focusEditor, getView } from './editor.js';
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

export const WELCOME_VERSION = 2;

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
    basics: 'welcome_note_feature_map',
    canvas: 'welcome_note_drawings_visual_thinking',
    shopping: 'welcome_note_tasks_workflows',
    sharing: 'welcome_note_sync_live_sharing',

    // Legacy IDs from older Welcome Vaults.
    // Kept for pristine-welcome cleanup compatibility.
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

function searchHaystack(note, body = '') {
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

// ---------------- factories -----------------------------------
export async function newNote(folderId = null, type = 'markdown') {
  const id = uid();
  const note = {
    id,
    title: type === 'list' ? 'Shopping list' : 'Untitled',
    type,
    folderId,
    tags: [],
    pinned: false,
    created: Date.now(),
    updated: Date.now(),
  };
  state.notes.set(id, note);
  await store.notes.put(note);
  updateSearchIndexFor(note);
  rebuildWikilinkIndex();
  await openNote(id);
  renderTree();
  $('noteTitle').focus();
  $('noteTitle').select();
}

export async function newFolder(parentId = null) {
  const name = prompt('Folder name:');
  if (!name) return;
  const f = { id: uid(), name: name.trim(), parentId, created: Date.now() };
  state.folders.set(f.id, f);
  await store.folders.put(f);
  state.expandedFolders.add(f.id);
  renderTree();
}

// ---------------- open / save / delete ------------------------
export async function openNote(id) {
  if (state.currentNoteId === id) return;
  const note = state.notes.get(id);
  if (!note) return;
  // Tear down previous subscription / editor
  if (_unsubDoc) { _unsubDoc(); _unsubDoc = null; }
  state.currentNoteId = id;
  store.settings.set('lastNoteId', id);
  if (!_navSuppress) history.pushState({ noteId: id }, '', '#' + encodeURIComponent(id));

  // Ensure Y.Doc + migration done before mount
  await migrateBodyIfNeeded(note);
  const entry = getNoteDoc(id);
  await entry.ready;

  $('noteTitle').value = note.title || '';
  // Mount editor (replaces previous instance)
  const host = $('editor');
  host.replaceChildren();
  mountEditor(host, { noteId: id });
  renderChips();
  updatePinIcon();
  renderShareIndicator();
  renderTree();
  schedulePreview();
  scrollCurrentNoteToTop();

  // Subscribe to Y.Doc updates → re-render preview, persist mirror.
  _unsubDoc = onDocChange(id, (_update, origin) => {
    const isDrawUpdate =
      typeof origin === 'string' &&
      origin.startsWith('draw');

    if (origin === 'sync-folder' || origin === 'sync2-remote') {
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

      // Yjs/y-indexeddb persistiert das Drawing sowieso.
      // Optional Sync-Mirror/Snapshot anstoßen, aber Footer nicht dauernd auf dirty setzen.
      scheduleMirror(note);

      return;
    }

    schedulePreview();
    updateSearchIndexFor(note);

    markDirty();

    note.updated = Date.now();
    store.notes.put(note);

    scheduleMirror(note);

    markNoteSyncStatus(id, 'local');
    refreshGlobalSyncStatus();
  });

  preloadImagesFor(noteMarkdown(id));
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
  $('noteTitle').value = '';
  destroyEditor();
  $('editor').replaceChildren();
  $('preview').innerHTML = '';
  renderChips();
  markSaved();
}

export async function saveCurrentNote() {
  if (!state.currentNoteId) return;
  const note = state.notes.get(state.currentNoteId);
  if (!note) return;
  const newTitle = $('noteTitle').value.trim() || 'Untitled';
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
}

export async function deleteCurrentNote() {
  if (!state.currentNoteId) return;
  const note = state.notes.get(state.currentNoteId);
  if (!confirm(`Delete "${note.title}"? This cannot be undone.`)) return;
  await store.notes.del(note.id);
  state.notes.delete(note.id);
  await destroyNoteDoc(note.id);
  syncDeleteNoteFile(note).catch(() => {});
  rebuildWikilinkIndex();
  state.currentNoteId = null;
  const next = [...state.notes.values()].sort((a, b) => b.updated - a.updated)[0];
  if (next) openNote(next.id); else clearEditor();
  renderTree();
  toast('Note deleted');
}

export function togglePin() {
  if (!state.currentNoteId) return;
  const n = state.notes.get(state.currentNoteId);
  n.pinned = !n.pinned;
  n.updated = Date.now();
  store.notes.put(n);
  updatePinIcon();
  renderTree();
}
export function updatePinIcon() {
  const btn = $('btn-pin');
  if (!state.currentNoteId) { btn.classList.remove('active'); return; }
  const n = state.notes.get(state.currentNoteId);
  btn.classList.toggle('active', !!n?.pinned);
}

// ---------------- tags ----------------------------------------
export function renderChips() {
  const c = $('chips');
  c.replaceChildren();
  if (!state.currentNoteId) return;
  const n = state.notes.get(state.currentNoteId);
  for (const tag of n.tags || []) {
    const chip = el('span', { class: 'chip' }, '#' + tag,
      el('button', { title: 'Remove tag', onclick: () => removeTag(tag) }, '×'));
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

  requestAnimationFrame(() => {
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
    if (rec && rec.blob) { state.imageBlobs.set(id, URL.createObjectURL(rec.blob)); needsRerender = true; }
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
    basics: WELCOME_IDS.notes.basics,
    canvas: WELCOME_IDS.notes.canvas,
    shopping: WELCOME_IDS.notes.shopping,
    sharing: WELCOME_IDS.notes.sharing,
  };

  const drawingId = WELCOME_IDS.drawing;

  const notes = [
    {
      id: ids.welcome,
      title: 'Start here',
      type: 'markdown',
      folderId,
      tags: ['welcome', 'start'],
      pinned: true,
      icon: 'sparkles',
      color: '#2563eb',
      body: `# Start here

Welcome to **YANTA** — a calm, local-first workspace for notes, sketches, tasks and connected ideas.

Start with a thought. Sketch it. Link it when it becomes useful.

draw://${drawingId}

## Try this

- [ ] Click into the canvas above
- [ ] Move one element
- [ ] Open [[Shopping List]]
- [ ] Press Ctrl/⌘+G to see the graph

## A small map

- [[First Canvas]] shows visual thinking
- [[YANTA Basics]] shows the simplest commands
- [[Shopping List]] is a practical checklist example
- [[Sync & Sharing]] explains backup and collaboration briefly

Your notes stay on this device unless you choose to sync, export or share them.`,
    },
    {
      id: ids.canvas,
      title: 'First Canvas',
      type: 'markdown',
      folderId,
      tags: ['drawing', 'canvas', 'visual'],
      pinned: false,
      icon: 'pencil',
      color: '#16a34a',
      body: `# First Canvas

Sketch before you organize.

YANTA embeds Excalidraw directly inside Markdown notes, so visual thinking and writing can live together.

draw://${drawingId}

## Try this

- Click into the drawing
- Add a box, arrow or text label
- Drag a note from the sidebar into the canvas
- Use linked text like [[Shopping List]] or [[Sync & Sharing]]

A useful drawing does not need to explain everything. It should make the next step obvious.`,
    },
    {
      id: ids.basics,
      title: 'YANTA Basics',
      type: 'markdown',
      folderId,
      tags: ['basics', 'markdown', 'links'],
      pinned: false,
      icon: 'file-text',
      color: '#0891b2',
      body: `# YANTA Basics

YANTA is built around three simple actions:

1. Write notes
2. Draw ideas
3. Connect related things

## Useful gestures

- Type \`/\` for commands
- Type \`[[\` to link notes
- Press Ctrl/⌘+G for the graph
- Press Ctrl/⌘+I to insert images
- Use the Share button when someone should edit with you

## Links

A Wikilink connects one note to another:

[[First Canvas]]

Use links when they help you navigate, explain or continue an idea.

## Local-first

YANTA works offline. Your notes are stored locally in this browser unless you choose to sync, export or share them.

For the short version, see [[Sync & Sharing]].`,
    },
    {
      id: ids.shopping,
      title: 'Shopping List',
      type: 'markdown',
      folderId,
      tags: ['tasks', 'example', 'sharing'],
      pinned: false,
      icon: 'shopping-cart',
      color: '#059669',
      body: `# Shopping List

A tiny checklist example.

- [ ] Apples
- [ ] Coffee
- [ ] Pasta
- [ ] Olive oil
- [ ] Something for dinner
- [ ] Check what is already at home

## Hint

Use **Share** to turn this into a live collaborative list.

That is useful when someone else should add or check off items from their own device.

For backup and collaboration basics, see [[Sync & Sharing]].`,
    },
    {
      id: ids.sharing,
      title: 'Sync & Sharing',
      type: 'markdown',
      folderId,
      tags: ['sync', 'sharing', 'backup'],
      pinned: false,
      icon: 'refresh-cw',
      color: '#d97706',
      body: `# Sync & Sharing

YANTA is local-first.

That means your workspace works offline and stays on this device by default.

## Backup

Use **Export** to create a backup.

For an encrypted portable backup, choose:

**Export → Back up YANTA (.yanta, encrypted)**

Keep the sync key private.

## Folder sync

Advanced users can connect a sync folder and mirror it with tools like Syncthing, Dropbox, iCloud Drive or an external drive.

You do not need to set this up immediately.

## Live sharing

Use the **Share** button in a note when someone should edit with you in real time.

A good first test is [[Shopping List]].

## Simple rule

Write first. Organize later. Sync when you are ready.`,
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

  const parseCssColorToRgb = (color) => {
    const s = String(color || '').trim();

    if (/^#[0-9a-f]{3}$/i.test(s)) {
      return {
        r: parseInt(s[1] + s[1], 16),
        g: parseInt(s[2] + s[2], 16),
        b: parseInt(s[3] + s[3], 16),
      };
    }

    if (/^#[0-9a-f]{6}$/i.test(s)) {
      return {
        r: parseInt(s.slice(1, 3), 16),
        g: parseInt(s.slice(3, 5), 16),
        b: parseInt(s.slice(5, 7), 16),
      };
    }

    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
    if (rgb) {
      return {
        r: parseInt(rgb[1], 10),
        g: parseInt(rgb[2], 10),
        b: parseInt(rgb[3], 10),
      };
    }

    return null;
  };

  const relativeLuminance = (color) => {
    const rgb = parseCssColorToRgb(color);
    if (!rgb) return 0;

    const channel = (v) => {
      const x = v / 255;
      return x <= 0.03928
        ? x / 12.92
        : Math.pow((x + 0.055) / 1.055, 2.4);
    };

    return (
      0.2126 * channel(rgb.r) +
      0.7152 * channel(rgb.g) +
      0.0722 * channel(rgb.b)
    );
  };

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
    startBox,
    endBox,
    start,
    end,
    strokeColor = XCOL.muted,
  }) => {
    const width = end.x - start.x;
    const height = end.y - start.y;

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
        roughness: 1,
        points: [
          [0, 0],
          [width, height],
        ],
        startBinding: {
          elementId: startBox.id,
          focus: 0,
          gap: WELCOME_ARROW_GAP,
        },
        endBinding: {
          elementId: endBox.id,
          focus: 0,
          gap: WELCOME_ARROW_GAP,
        },
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

    return {
      groupId,
      box,
      elements: [box, titleText, subtitleText],
      cx: x + width / 2,
      cy: y + height / 2,
      left: x,
      right: x + width,
      top: y,
      bottom: y + height,
    };
  };

  const centerGroupId = uid();

  const centerBox = makeRect({
    id: uid(),
    groupIds: [centerGroupId],
    x: 350,
    y: 210,
    width: 260,
    height: 120,
    strokeColor: XCOL.violetStroke,
    backgroundColor: XCOL.violetBg,
    boundElements: [],
  });

  const centerTitlePos = centeredTextBox({
    text: 'YANTA',
    boxX: centerBox.x,
    boxY: centerBox.y,
    boxW: centerBox.width,
    yOffset: 24,
    fontSize: 40,
    maxInset: 20,
  });

  const centerSubtitlePos = centeredTextBox({
    text: 'write · draw · connect',
    boxX: centerBox.x,
    boxY: centerBox.y,
    boxW: centerBox.width,
    yOffset: 78,
    fontSize: 17,
    maxInset: 20,
  });

  const centerTitle = makeText({
    groupIds: [centerGroupId],
    text: 'YANTA',
    x: centerTitlePos.x,
    y: centerTitlePos.y,
    width: centerTitlePos.width,
    fontSize: 40,
    strokeColor: XCOL.violetStroke,
    textAlign: 'center',
  });

  const centerSubtitle = makeText({
    groupIds: [centerGroupId],
    text: 'write · draw · connect',
    x: centerSubtitlePos.x,
    y: centerSubtitlePos.y,
    width: centerSubtitlePos.width,
    fontSize: 17,
    strokeColor: XCOL.muted,
    textAlign: 'center',
  });

  const canvasCard = makeCard({
    x: 72,
    y: 70,
    title: 'First Canvas',
    subtitle: 'Sketch an idea',
    noteId: ids.canvas,
    strokeColor: XCOL.greenStroke,
    backgroundColor: XCOL.greenBg,
  });

  const basicsCard = makeCard({
    x: 648,
    y: 70,
    title: 'YANTA Basics',
    subtitle: 'Slash, links, graph',
    noteId: ids.basics,
    strokeColor: XCOL.cyanStroke,
    backgroundColor: XCOL.cyanBg,
  });

  const shoppingCard = makeCard({
    x: 92,
    y: 404,
    title: 'Shopping List',
    subtitle: 'Tasks + sharing',
    noteId: ids.shopping,
    strokeColor: XCOL.blueStroke,
    backgroundColor: XCOL.blueBg,
  });

  const sharingCard = makeCard({
    x: 628,
    y: 404,
    title: 'Sync & Sharing',
    subtitle: 'Backup when ready',
    noteId: ids.sharing,
    strokeColor: XCOL.orangeStroke,
    backgroundColor: XCOL.orangeBg,
  });

  const arrows = [
    makeArrow({
      startBox: canvasCard.box,
      endBox: centerBox,
      start: {
        x: canvasCard.right + WELCOME_ARROW_GAP,
        y: canvasCard.cy,
      },
      end: {
        x: centerBox.x - WELCOME_ARROW_GAP,
        y: centerBox.y + 44,
      },
    }),

    makeArrow({
      startBox: basicsCard.box,
      endBox: centerBox,
      start: {
        x: basicsCard.left - WELCOME_ARROW_GAP,
        y: basicsCard.cy,
      },
      end: {
        x: centerBox.x + centerBox.width + WELCOME_ARROW_GAP,
        y: centerBox.y + 44,
      },
    }),

    makeArrow({
      startBox: shoppingCard.box,
      endBox: centerBox,
      start: {
        x: shoppingCard.right + WELCOME_ARROW_GAP,
        y: shoppingCard.cy,
      },
      end: {
        x: centerBox.x + 44,
        y: centerBox.y + centerBox.height + WELCOME_ARROW_GAP,
      },
    }),

    makeArrow({
      startBox: sharingCard.box,
      endBox: centerBox,
      start: {
        x: sharingCard.left - WELCOME_ARROW_GAP,
        y: sharingCard.cy,
      },
      end: {
        x: centerBox.x + centerBox.width - 44,
        y: centerBox.y + centerBox.height + WELCOME_ARROW_GAP,
      },
    }),
  ];

  const attachArrowToBox = (box, arrow) => {
    if (!box.boundElements) box.boundElements = [];

    if (!box.boundElements.some((x) => x.id === arrow.id)) {
      box.boundElements.push({
        id: arrow.id,
        type: 'arrow',
      });
    }
  };

  for (const arrow of arrows) {
    const startCard = [
      canvasCard,
      basicsCard,
      shoppingCard,
      sharingCard,
    ].find((card) => card.box.id === arrow.startBinding?.elementId);

    if (startCard) attachArrowToBox(startCard.box, arrow);
    attachArrowToBox(centerBox, arrow);
  }

  const hintText = 'Excalidraw is fully integrated!';

  const hint = makeText({
    text: hintText,
    x: 190,
    y: 528,
    width: 580,
    fontSize: 17,
    strokeColor: XCOL.muted,
    textAlign: 'center',
  });

  setDrawing(ids.welcome, drawingId, {
    id: drawingId,
    title: 'YANTA Welcome Canvas',
    canvas: {
      width: 960,
      height: 610,
    },
    elements: [
      ...arrows,

      centerBox,
      centerTitle,
      centerSubtitle,

      ...canvasCard.elements,
      ...basicsCard.elements,
      ...shoppingCard.elements,
      ...sharingCard.elements,

      hint,
    ],

    // Kein theme, kein viewBackgroundColor.
    // Excalidraw/draw.js steuert das aktuelle Theme.
    appState: {
      zoom: {
        value: 0.82,
      },
      scrollX: -20,
      scrollY: 80,
    },

    files: {},
  }, 'welcome-draw');

  updateSearchIndexFor(state.notes.get(ids.welcome));

  rebuildWikilinkIndex();

  await openNote(ids.welcome);

  renderTree();

  toast('Welcome vault created', 'success');
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
