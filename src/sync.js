// ============================================================
// YANTA — Sync folder (Syncthing-compatible).
//
// Layout on disk:
//   <root>/
//     notes/                     ← human-readable Markdown mirror
//       Note title.md
//       Sub/Folder/Other.md
//     assets/                    ← image blobs
//       <id>.<ext>
//     .yanta/                    ← internal sync data
//       manifest.json            ← root manifest (device list, counts)
//       snapshots/<id>.ysnap     ← Yjs encoded state snapshots
//       updates/<id>/<seq>.yupdate (reserved for incremental sync)
//
// Markdown files round-trip through `id` in their frontmatter so cross-
// device renames don't duplicate notes. The .yanta/ snapshots make the
// sync robust against simultaneous external edits — when both .md and
// .ysnap disagree we prefer the .ysnap (CRDT) and treat the .md as the
// loser of a conflict (user is offered "Both", "Keep mine", "Take theirs").
// ============================================================

import { $, el, state, store, toast, lucide, uid, safeFilename, escapeHtml } from './core.js';
import { getNoteDoc, encodeNoteState, applyNoteUpdate, noteMarkdown } from './yjs.js';
import * as Y from 'yjs';
import { folderPathSegments, ensureFolderPath, parseFrontmatter, noteToFrontmatter, imageExt } from './io.js';

export const sync = {
  handle: null,
  isAvailable: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
  fileMtimes: new Map(),
  knownFiles: new Map(),     // noteId → relative path
  tombstones: new Map(),
  pulling: false,
};

const TOMBSTONE_KEY = 'syncTombstones';
const TOMBSTONE_TTL_MS = 30 * 24 * 3600 * 1000;

const _imageExtToMime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

// ---------------- restore / connect / disconnect ----------------
export async function syncRestore() {
  if (!sync.isAvailable) { updateSyncIndicator(); return; }
  try {
    const handle = await store.settings.get('syncFolderHandle', null);
    const tomb = await store.settings.get(TOMBSTONE_KEY, []);
    sync.tombstones = new Map(tomb);
    if (handle) {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') sync.handle = handle;
    }
  } catch {}
  updateSyncIndicator();
}

export async function syncConnect() {
  if (!sync.isAvailable) { toast("Sync needs HTTPS or localhost — file:// can't pick folders", 'error'); return; }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'yanta-sync', startIn: 'documents' });
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') { toast('Sync: permission denied', 'error'); return; }
    sync.handle = handle;
    sync.fileMtimes.clear();
    sync.knownFiles.clear();
    await store.settings.set('syncFolderHandle', handle);
    updateSyncIndicator();
    toast('Folder linked: ' + handle.name, 'success');
    await syncFull(true);
  } catch (e) {
    if (e.name !== 'AbortError') toast('Sync connect failed: ' + e.message, 'error');
  }
}

export function syncDisconnect() {
  sync.handle = null;
  sync.fileMtimes.clear();
  sync.knownFiles.clear();
  store.settings.set('syncFolderHandle', null);
  updateSyncIndicator();
  toast('Sync folder disconnected');
}

function rememberDeletion(id) {
  sync.tombstones.set(id, { at: Date.now() });
  persistTombstones();
}
function persistTombstones() {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  for (const [id, t] of sync.tombstones) if (t.at < cutoff) sync.tombstones.delete(id);
  store.settings.set(TOMBSTONE_KEY, [...sync.tombstones]);
}

// ---------------- helpers ---------------------------------------
async function ensureDir(root, segs) {
  let dir = root;
  for (const seg of segs) dir = await dir.getDirectoryHandle(seg, { create: true });
  return dir;
}
async function getDir(root, segs) {
  let dir = root;
  for (const seg of segs) dir = await dir.getDirectoryHandle(seg);
  return dir;
}

function notePath(note) {
  const segs = ['notes', ...folderPathSegments(note.folderId)];
  return [...segs, safeFilename(note.title) + '.md'].join('/');
}

// ---------------- write one note --------------------------------
export async function syncWriteNote(note) {
  if (!sync.handle) return;
  try {
    const segs = ['notes', ...folderPathSegments(note.folderId)];
    const dir = await ensureDir(sync.handle, segs);
    const filename = safeFilename(note.title) + '.md';
    const newPath = [...segs, filename].join('/');
    const prevPath = sync.knownFiles.get(note.id);
    if (prevPath && prevPath !== newPath) {
      await syncDeleteFileAtPath(prevPath);
      sync.fileMtimes.delete(prevPath);
    }
    let body = '';
    try { body = noteMarkdown(note.id); } catch {}
    // Rewrite image refs to relative paths so the .md is portable.
    body = body.replace(/yanta-img:\/\/([a-z0-9]+)/gi, (full, id) => {
      const meta = state.imagesMeta.get(id);
      if (!meta) return full;
      return (segs.length ? '../'.repeat(segs.length) : '') + 'assets/' + id + '.' + imageExt(meta);
    });
    // .md mirror
    const fh = await dir.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(noteToFrontmatter(note) + body);
    await w.close();
    try { sync.fileMtimes.set(newPath, (await fh.getFile()).lastModified); } catch {}
    sync.knownFiles.set(note.id, newPath);
    // Yjs snapshot in .yanta/snapshots/<id>.ysnap
    await writeSnapshot(note.id);
    await ensureImagesFor(note);
    await writeManifest();
    markNoteSyncStatus(note.id, 'synced');
    refreshGlobalSyncStatus();
  } catch (e) {
    console.warn('syncWriteNote failed', e);
    markNoteSyncStatus(note.id, 'local');
  }
}

async function writeSnapshot(noteId) {
  const yantaDir = await ensureDir(sync.handle, ['.yanta', 'snapshots']);
  const fh = await yantaDir.getFileHandle(noteId + '.ysnap', { create: true });
  const w = await fh.createWritable();
  await w.write(encodeNoteState(noteId));
  await w.close();
}

async function ensureImagesFor(note) {
  const used = new Set();
  let body = ''; try { body = noteMarkdown(note.id); } catch {}
  const re = /yanta-img:\/\/([a-z0-9]+)/gi; let m;
  while ((m = re.exec(body)) !== null) used.add(m[1]);
  if (!used.size) return;
  const imgDir = await ensureDir(sync.handle, ['assets']);
  for (const id of used) {
    const meta = state.imagesMeta.get(id);
    if (!meta) continue;
    const name = id + '.' + imageExt(meta);
    try { await imgDir.getFileHandle(name); continue; } catch {}
    const rec = await store.images.get(id);
    if (!rec || !rec.blob) continue;
    const fh = await imgDir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(rec.blob);
    await w.close();
  }
}

async function writeManifest() {
  const dir = await ensureDir(sync.handle, ['.yanta']);
  const manifest = {
    yanta: 2,
    updated: new Date().toISOString(),
    deviceId: await getOrCreateDeviceId(),
    counts: { notes: state.notes.size, folders: state.folders.size },
  };
  const fh = await dir.getFileHandle('manifest.json', { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(manifest, null, 2));
  await w.close();
}
async function getOrCreateDeviceId() {
  let id = await store.settings.get('deviceId', null);
  if (!id) { id = 'dev_' + uid(); await store.settings.set('deviceId', id); }
  return id;
}

export async function syncDeleteNoteFile(note) {
  if (!sync.handle) return;
  const path = sync.knownFiles.get(note.id) || notePath(note);
  await syncDeleteFileAtPath(path);
  sync.knownFiles.delete(note.id);
  sync.fileMtimes.delete(path);
  rememberDeletion(note.id);
  // Remove snapshot too
  try {
    const dir = await getDir(sync.handle, ['.yanta', 'snapshots']);
    await dir.removeEntry(note.id + '.ysnap');
  } catch {}
}

async function syncDeleteFileAtPath(path) {
  if (!sync.handle) return;
  try {
    const parts = path.split('/');
    const name = parts.pop();
    const dir = parts.length ? await getDir(sync.handle, parts) : sync.handle;
    await dir.removeEntry(name);
  } catch {}
}

// ---------------- pull ------------------------------------------
export async function syncFull(verbose = false) {
  if (!sync.handle || sync.pulling) return;
  sync.pulling = true;
  state.globalSyncStatus = 'syncing';
  updateSyncIndicator();
  try {
    const res = await syncPull();
    let pushed = 0;
    for (const note of state.notes.values()) {
      if (!sync.knownFiles.has(note.id)) {
        await syncWriteNote(note);
        pushed++;
      }
    }
    const externallyDeleted = [];
    for (const [id, path] of [...sync.knownFiles]) {
      if (!res.seenPaths.has(path)) externallyDeleted.push({ id, path });
    }
    if (externallyDeleted.length && verbose) {
      if (confirm(`${externallyDeleted.length} note file(s) were removed from the sync folder.\nDelete the matching notes in YANTA too?`)) {
        const { renderTree } = await import('./tree.js');
        const { clearEditor, rebuildWikilinkIndex } = await import('./notes.js');
        const { destroyNoteDoc } = await import('./yjs.js');
        for (const { id } of externallyDeleted) {
          if (state.notes.has(id)) {
            state.notes.delete(id);
            await store.notes.del(id);
            await destroyNoteDoc(id);
            rememberDeletion(id);
            sync.knownFiles.delete(id);
          }
        }
        renderTree();
        rebuildWikilinkIndex();
        if (!state.notes.has(state.currentNoteId)) {
          const recent = [...state.notes.values()].sort((a, b) => b.updated - a.updated)[0];
          if (recent) { const { openNote } = await import('./notes.js'); openNote(recent.id); }
          else clearEditor();
        }
      }
    }
    if (verbose || res.imported || res.updated || res.conflicts) {
      toast(`Sync: ${res.imported} new · ${res.updated} updated · ${res.conflicts} conflict${res.conflicts === 1 ? '' : 's'}${pushed ? ` · ${pushed} pushed` : ''}`, res.conflicts ? 'error' : 'success');
    }
    if (res.conflictItems.length) showSyncConflictsModal(res.conflictItems);
  } finally {
    sync.pulling = false;
    refreshGlobalSyncStatus();
  }
}

async function syncPull() {
  const result = { imported: 0, updated: 0, conflicts: 0, seenPaths: new Set(), conflictItems: [] };
  if (!sync.handle) return result;
  // 1. Ingest Yjs snapshots — these are authoritative for note content.
  try {
    const snapDir = await getDir(sync.handle, ['.yanta', 'snapshots']);
    for await (const [name, h] of snapDir.entries()) {
      if (h.kind !== 'file' || !name.endsWith('.ysnap')) continue;
      const id = name.replace(/\.ysnap$/, '');
      const file = await h.getFile();
      const buf = new Uint8Array(await file.arrayBuffer());
      try { applyNoteUpdate(id, buf); } catch {}
    }
  } catch {}
  // 2. Ingest assets folder.
  try {
    const imgDir = await sync.handle.getDirectoryHandle('assets').catch(() => null);
    if (imgDir) await importImages(imgDir);
  } catch {}
  // 3. Walk notes/ folder for .md mirrors.
  try {
    const notesDir = await sync.handle.getDirectoryHandle('notes').catch(() => null);
    if (notesDir) await walkNotes(notesDir, [], result);
  } catch {}
  return result;
}

async function walkNotes(dir, segs, result) {
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.')) continue;
    if (h.kind === 'directory') {
      await walkNotes(h, [...segs, name], result);
    } else if (h.kind === 'file' && /\.(md|markdown)$/i.test(name)) {
      const fullSegs = ['notes', ...segs];
      const path = [...fullSegs, name].join('/');
      const file = await h.getFile();
      if (/\.sync-conflict-/.test(name)) {
        result.conflicts++;
        result.conflictItems.push({ path, dirHandle: dir, name, file, segs });
        continue;
      }
      result.seenPaths.add(path);
      await ingestMdFile(file, path, segs, name, result);
    }
  }
}

async function ingestMdFile(file, path, segs, filename, result) {
  const lastMtime = sync.fileMtimes.get(path);
  if (lastMtime && file.lastModified === lastMtime) return;
  let text; try { text = await file.text(); } catch { return; }
  const { meta, body } = parseFrontmatter(text);
  const resolvedBody = body.replace(/(?:\.\.\/)*assets\/([a-z0-9]+)(?:\.[a-z0-9]+)?/gi, (_, id) => 'yanta-img://' + id);
  const folderId = segs.length ? await ensureFolderPath(segs) : null;
  const fileTime = file.lastModified || Date.now();
  const title = filename.replace(/\.(md|markdown)$/i, '');

  if (meta.id && sync.tombstones.has(meta.id)) {
    const t = sync.tombstones.get(meta.id);
    if (fileTime <= t.at + 1000) {
      try { await syncDeleteFileAtPath(path); } catch {}
      return;
    }
    sync.tombstones.delete(meta.id);
    persistTombstones();
  }

  const id = meta.id || uid();
  const existing = state.notes.get(id);
  if (existing) {
    // The snapshot pass has already applied Y.Doc content; we only refresh
    // metadata (title/folder/tags/pin) from the .md frontmatter.
    existing.title = title;
    existing.folderId = folderId;
    existing.tags = Array.isArray(meta.tags) ? meta.tags : existing.tags || [];
    existing.pinned = !!meta.pinned;
    existing.type = meta.type || existing.type || 'markdown';
    existing.updated = Math.max(existing.updated || 0, meta.updated ? Date.parse(meta.updated) || fileTime : fileTime);
    await store.notes.put(existing);
    // If no Y.Doc snapshot existed for this note, seed from the .md body.
    const { getNoteDoc } = await import('./yjs.js');
    const entry = getNoteDoc(id);
    await entry.ready;
    const ytext = entry.doc.getText('markdown');
    if (ytext.length === 0 && resolvedBody) ytext.insert(0, resolvedBody);
    sync.knownFiles.set(id, path);
    sync.fileMtimes.set(path, fileTime);
    result.updated++;
    if (state.currentNoteId === id) {
      const titleEl = $('noteTitle'); if (titleEl) titleEl.value = existing.title;
    }
    return;
  }

  const note = {
    id,
    title,
    type: meta.type || 'markdown',
    folderId,
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    pinned: !!meta.pinned,
    created: meta.created ? Date.parse(meta.created) || fileTime : fileTime,
    updated: meta.updated ? Date.parse(meta.updated) || fileTime : fileTime,
  };
  state.notes.set(id, note);
  await store.notes.put(note);
  const { getNoteDoc } = await import('./yjs.js');
  const entry = getNoteDoc(id);
  await entry.ready;
  const ytext = entry.doc.getText('markdown');
  if (ytext.length === 0 && resolvedBody) ytext.insert(0, resolvedBody);
  sync.knownFiles.set(id, path);
  sync.fileMtimes.set(path, fileTime);
  result.imported++;
  const { rebuildWikilinkIndex } = await import('./notes.js');
  rebuildWikilinkIndex();
}

async function importImages(imgDir) {
  for await (const [name, h] of imgDir.entries()) {
    if (h.kind !== 'file') continue;
    const dot = name.lastIndexOf('.');
    const id = dot > 0 ? name.slice(0, dot) : name;
    if (state.imagesMeta.has(id)) continue;
    const file = await h.getFile();
    const ext = (dot > 0 ? name.slice(dot + 1) : 'bin').toLowerCase();
    const mime = _imageExtToMime[ext] || file.type || 'application/octet-stream';
    const blob = new Blob([await file.arrayBuffer()], { type: mime });
    const meta = { id, name, size: blob.size, type: mime, ts: file.lastModified || Date.now() };
    await store.images.put({ ...meta, blob });
    state.imagesMeta.set(id, meta);
  }
}

// ---------------- conflict modal --------------------------------
function showSyncConflictsModal(conflicts) {
  const modal = $('conflictModal');
  if (!modal) return;
  const list = $('conflictList');
  list.replaceChildren();
  for (const c of conflicts) {
    const card = el('div', { class: 'conflict-card' });
    card.append(el('div', { class: 'conflict-head' }, c.path));
    const row = el('div', { class: 'conflict-actions' });
    row.append(el('button', { class: 'btn', onclick: () => viewConflictFile(c) }, 'View'));
    row.append(el('button', { class: 'btn', onclick: async () => { try { await c.dirHandle.removeEntry(c.name); } catch {} card.remove(); if (!list.children.length) closeConflictModal(); toast('Kept your version', 'success'); } }, 'Keep mine'));
    row.append(el('button', { class: 'btn primary', onclick: async () => { await adoptConflict(c); card.remove(); if (!list.children.length) closeConflictModal(); } }, 'Both (keep as new note)'));
    card.append(row);
    list.append(card);
  }
  modal.hidden = false;
}
async function viewConflictFile(c) {
  const text = await c.file.text();
  const win = window.open('', '_blank');
  if (win) {
    win.document.body.style.fontFamily = 'monospace';
    win.document.body.style.whiteSpace = 'pre-wrap';
    win.document.body.style.padding = '20px';
    win.document.body.textContent = text;
  } else alert(text.slice(0, 4000));
}
async function adoptConflict(c) {
  const text = await c.file.text();
  const { meta, body } = parseFrontmatter(text);
  const resolvedBody = body.replace(/(?:\.\.\/)*assets\/([a-z0-9]+)(?:\.[a-z0-9]+)?/gi, (_, id) => 'yanta-img://' + id);
  const folderId = c.segs.length ? await ensureFolderPath(c.segs) : null;
  const baseTitle = c.name.replace(/\.sync-conflict-[^.]+\.(md|markdown)$/i, '');
  const id = uid();
  const note = { id, title: baseTitle + ' (from other device)', type: 'markdown', folderId, tags: Array.isArray(meta.tags) ? meta.tags : [], pinned: !!meta.pinned, created: Date.now(), updated: Date.now() };
  state.notes.set(id, note);
  await store.notes.put(note);
  const entry = getNoteDoc(id);
  await entry.ready;
  entry.doc.getText('markdown').insert(0, resolvedBody);
  await syncWriteNote(note);
  try { await c.dirHandle.removeEntry(c.name); } catch {}
  const { renderTree } = await import('./tree.js');
  const { rebuildWikilinkIndex } = await import('./notes.js');
  rebuildWikilinkIndex();
  renderTree();
  toast('Adopted as new note', 'success');
}
function closeConflictModal() { const m = $('conflictModal'); if (m) m.hidden = true; }
export { closeConflictModal };

// ---------------- per-note + global status ----------------------
export function markNoteSyncStatus(id, s) { state.noteSyncStatus.set(id, s); }
export function refreshGlobalSyncStatus() {
  let status = 'synced';
  if (sync.pulling) status = 'syncing';
  else {
    for (const s of state.noteSyncStatus.values()) {
      if (s === 'conflict') { status = 'conflict'; break; }
      if (s === 'local' || s === 'remote') status = 'local';
      if (s === 'syncing' && status === 'synced') status = 'syncing';
    }
  }
  state.globalSyncStatus = status;
  updateSyncIndicator();
}

// ---------------- indicator & menu ------------------------------
export function updateSyncIndicator() {
  const e = $('vaultIndicator');
  if (!e) return;
  if (sync.handle) {
    const sym = { synced: '✓', local: '●', remote: '↓', syncing: '↻', conflict: '⚠' }[state.globalSyncStatus] || '✓';
    e.innerHTML = `<span class="sync-sym sync-${state.globalSyncStatus}">${sym}</span><span>${escapeHtml(sync.handle.name)}</span>`;
    e.classList.add('connected');
    e.title = `Sync folder: ${sync.handle.name} (${state.globalSyncStatus})`;
    e.hidden = false;
  } else if (sync.isAvailable) {
    e.innerHTML = lucide('refresh', 12) + '<span>set up sync</span>';
    e.classList.remove('connected');
    e.title = 'Set up sync (works great with Syncthing)';
    e.hidden = false;
  } else e.hidden = true;
}

export function syncMenu(anchorEl, showMenuFn) {
  const r = anchorEl.getBoundingClientRect();
  const items = [];
  if (sync.handle) {
    items.push({ label: 'Synchronize now (pull + push)', action: () => syncFull(true) });
    items.push({ label: 'Pick a different folder…', action: syncConnect });
    items.push('hr');
    items.push({ label: 'Disconnect folder', danger: true, action: syncDisconnect });
  } else {
    items.push({ label: 'Set up sync folder…', action: openSyncSetup });
    if (!sync.isAvailable) items.push({ label: '(needs HTTPS or localhost)', action: () => {} });
  }
  showMenuFn(r.left, r.top - 4, items);
}

export function openSyncSetup() {
  const m = $('syncSetupModal');
  if (!m) { syncConnect(); return; }
  m.hidden = false;
}
export function closeSyncSetup() { const m = $('syncSetupModal'); if (m) m.hidden = true; }
