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
import { getNoteDoc, getMarkdownText, migrateBodyIfNeeded, destroyNoteDoc, onDocChange, noteMarkdown } from './yjs.js';
import { mountEditor, destroyEditor, currentMarkdown, focusEditor } from './editor.js';
import { renderPreview, setMarkdownRerenderHook } from './markdown.js';
import { wikilinkIndex } from './features-state.js';
import { renderTree, renderTagCloud } from './tree.js';
import { renderBacklinks, renderOutline } from './features.js';
import { renderShareIndicator } from './sharing.js';
import { syncWriteNote, syncDeleteNoteFile, markNoteSyncStatus, refreshGlobalSyncStatus } from './sync.js';

let _navSuppress = false;
let _unsubDoc = null;

setMarkdownRerenderHook(() => { schedulePreview(); });

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

  // Subscribe to Y.Doc updates → re-render preview, persist mirror.
  _unsubDoc = onDocChange(id, () => {
    markDirty();
    note.updated = Date.now();
    store.notes.put(note);
    schedulePreview();
    scheduleMirror(note);
    markNoteSyncStatus(id, 'local');
    refreshGlobalSyncStatus();
  });

  preloadImagesFor(noteMarkdown(id));
}

function videoSrcIn(el) {
  return el
    ?.querySelector?.('.pv-embed-video iframe[src]')
    ?.getAttribute('src') || '';
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

  // Kein altes Video vorhanden → normaler schneller Pfad.
  if (!previewEl.querySelector('.pv-embed-video iframe[src]')) {
    previewEl.innerHTML = html;
    return;
  }

  // Backlinks werden danach sowieso neu gerendert.
  previewEl.querySelector('.backlinks')?.remove();

  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  const oldLines = [...previewEl.children].filter((el) =>
    el.classList?.contains('pv-line')
  );

  const newLines = [...tmp.children];

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

    // Wichtig: Wenn dieselbe Video-URL an derselben Source-Line steht,
    // die alte DOM-Node behalten. Dadurch bleibt das iframe erhalten.
    if (oldVideoSrc && oldVideoSrc === newVideoSrc) {
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
    renderChips();
    renderTagCloud();
  }
}
export function removeTag(tag) {
  const n = state.notes.get(state.currentNoteId);
  n.tags = (n.tags || []).filter((t) => t !== tag);
  n.updated = Date.now();
  store.notes.put(n);
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

const scheduleMirror = debounce((note) => {
  syncWriteNote(note).catch(() => {});
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
  const body = `# Welcome to YANTA

A **local-first** Markdown notes app with built-in live collaboration.

## What's different

- **Real editor**: CodeMirror 6 — fast, robust, with proper undo, autocomplete and slash commands
- **Yjs under the hood**: every note has its own conflict-free shared document, so collaboration "just works"
- **Local-first**: everything runs in your browser. No cloud, no account
- **Sync between your devices** with a folder + [Syncthing](https://syncthing.net) (or Dropbox / iCloud / SMB / whatever)
- **Share a note live**: click **Share** in the toolbar, send the link or QR code, edit together — end-to-end encrypted

## Try it now

Type \`/\` to open the slash-command menu.
Type \`[[\` to link to another note.
Type \`#\` to add a tag.

> [!TIP]
> Press **Ctrl/⌘+P** for the command palette, **Ctrl/⌘+O** for quick switcher, **Ctrl/⌘+G** for the graph view.

### Tasks

- [ ] Write your first note
- [ ] Set up sync (sidebar bottom-right)
- [ ] Share a note live with someone

### Wikilinks

Try [[My next idea]] — click a missing link to create the note.

### Footnotes & math

A scientific paper[^1] often uses DOI links like doi:10.1038/nature12373.
Inline math \`$E=mc^2$\` and display math \`$$...$$\` are supported.

[^1]: This is a footnote.

\`\`\`js
console.log("Welcome to YANTA");
\`\`\`

Happy writing!
`;
  const id = uid();
  const note = { id, title: 'Welcome to YANTA', type: 'markdown', folderId: null, tags: ['welcome'], pinned: true, created: Date.now(), updated: Date.now() };
  state.notes.set(id, note);
  await store.notes.put(note);
  // Seed the Y.Doc with the welcome body
  const entry = getNoteDoc(id);
  await entry.ready;
  entry.doc.getText('markdown').insert(0, body);
  rebuildWikilinkIndex();
  await openNote(id);
  renderTree();
}

export function setNavSuppress(v) { _navSuppress = v; }

// Used by wikilink follow when target doesn't exist.
export async function createNoteWithTitle(title) {
  const id = uid();
  const note = { id, title: title.trim() || 'Untitled', type: 'markdown', folderId: state.notes.get(state.currentNoteId)?.folderId || null, tags: [], pinned: false, created: Date.now(), updated: Date.now() };
  state.notes.set(id, note);
  await store.notes.put(note);
  rebuildWikilinkIndex();
  await openNote(id);
  renderTree();
}
