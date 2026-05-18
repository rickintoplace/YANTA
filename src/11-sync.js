/* ============================================================
   YANTA — Sync folder
   Bidirectional sync between IndexedDB and a real folder on disk.
   Each note is a .md file with a stable id in the YAML front-matter,
   so cross-device renames / re-orders don't duplicate notes.
   Syncthing's `.sync-conflict-*.md` files are detected on pull and
   surfaced through a conflict modal.

   This module knows nothing about Git or Syncthing — it just keeps
   the folder honest. Use whatever sync tool you like on top.

   File System Access requires a secure context (HTTPS or localhost);
   file:// loads degrade gracefully (indicator stays hidden, ZIP
   export remains the recommended path).
   ============================================================ */
'use strict';

const sync = {
  handle: null,                 // FileSystemDirectoryHandle
  isAvailable: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
  fileMtimes: new Map(),        // path → last seen mtime
  knownFiles: new Map(),        // note id → path of its .md
  tombstones: new Map(),        // deleted note id → { at }
};

const TOMBSTONE_KEY = 'syncTombstones';
const TOMBSTONE_TTL_MS = 30 * 24 * 3600 * 1000;

/* ----------------------------------------------------------------
   Restore / connect / disconnect
---------------------------------------------------------------- */
async function syncRestore() {
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

async function syncConnect() {
  if (!sync.isAvailable) {
    toast('Sync needs HTTPS or localhost — file:// can\'t pick folders', 'error');
    return;
  }
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

function syncDisconnect() {
  sync.handle = null;
  sync.fileMtimes.clear();
  sync.knownFiles.clear();
  store.settings.set('syncFolderHandle', null);
  updateSyncIndicator();
  toast('Sync folder disconnected');
}

/* ----------------------------------------------------------------
   Tombstones — remember deleted IDs so re-sync doesn't resurrect
---------------------------------------------------------------- */
function syncRememberDeletion(id) {
  sync.tombstones.set(id, { at: Date.now() });
  persistTombstones();
}
function persistTombstones() {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  for (const [id, t] of sync.tombstones) if (t.at < cutoff) sync.tombstones.delete(id);
  store.settings.set(TOMBSTONE_KEY, [...sync.tombstones]);
}

/* ----------------------------------------------------------------
   Filesystem helpers
---------------------------------------------------------------- */
async function _ensureDir(root, segs) {
  let dir = root;
  for (const seg of segs) dir = await dir.getDirectoryHandle(seg, { create: true });
  return dir;
}
async function _getDir(root, segs) {
  let dir = root;
  for (const seg of segs) dir = await dir.getDirectoryHandle(seg);
  return dir;
}

function noteFilePath(note) {
  const segs = folderPathSegments(note.folderId);
  return [...segs, safeFilename(note.title) + '.md'].join('/');
}

/* ----------------------------------------------------------------
   Write / delete one note
---------------------------------------------------------------- */
async function syncWriteNote(note) {
  if (!sync.handle) return;
  try {
    const segs = folderPathSegments(note.folderId);
    const dir = await _ensureDir(sync.handle, segs);
    const filename = safeFilename(note.title) + '.md';
    const newPath = [...segs, filename].join('/');
    // Note moved / renamed → delete the old file
    const prevPath = sync.knownFiles.get(note.id);
    if (prevPath && prevPath !== newPath) {
      await syncDeleteFileAtPath(prevPath);
      sync.fileMtimes.delete(prevPath);
    }
    // Rewrite image refs to relative paths so the .md renders in any external viewer
    let body = (note.body || '').replace(/yanta-img:\/\/([a-z0-9]+)/gi, (full, id) => {
      const meta = state.imagesMeta.get(id);
      if (!meta) return full;
      return (segs.length ? '../'.repeat(segs.length) : '') + '_images/' + id + '.' + imageExt(meta);
    });
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const w = await fileHandle.createWritable();
    await w.write(noteToFrontmatter(note) + body);
    await w.close();
    try { sync.fileMtimes.set(newPath, (await fileHandle.getFile()).lastModified); } catch {}
    sync.knownFiles.set(note.id, newPath);
    await syncEnsureImagesFor(note);
  } catch (e) {
    console.warn('syncWriteNote failed for', note.title, e);
  }
}

async function syncEnsureImagesFor(note) {
  if (!sync.handle) return;
  const used = new Set();
  const re = /yanta-img:\/\/([a-z0-9]+)/gi;
  let m;
  while ((m = re.exec(note.body || '')) !== null) used.add(m[1]);
  if (!used.size) return;
  const imgDir = await sync.handle.getDirectoryHandle('_images', { create: true });
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

async function syncDeleteNoteFile(note) {
  if (!sync.handle) return;
  const path = sync.knownFiles.get(note.id) || noteFilePath(note);
  await syncDeleteFileAtPath(path);
  sync.knownFiles.delete(note.id);
  sync.fileMtimes.delete(path);
  syncRememberDeletion(note.id);
}
async function syncDeleteFileAtPath(path) {
  if (!sync.handle) return;
  try {
    const parts = path.split('/');
    const name = parts.pop();
    const dir = parts.length ? await _getDir(sync.handle, parts) : sync.handle;
    await dir.removeEntry(name);
  } catch { /* already gone */ }
}

/* ----------------------------------------------------------------
   Pull: walk folder, reconcile each file with state
---------------------------------------------------------------- */
async function syncFull(verbose = false) {
  if (!sync.handle) return;
  const res = await syncPull();
  // Push any notes that don't have a file yet (first sync after connect)
  let pushed = 0;
  for (const note of state.notes.values()) {
    if (!sync.knownFiles.has(note.id)) {
      await syncWriteNote(note);
      pushed++;
    }
  }
  // Detect notes whose file disappeared
  const externallyDeleted = [];
  for (const [id, path] of [...sync.knownFiles]) {
    if (!res.seenPaths.has(path)) externallyDeleted.push({ id, path });
  }
  if (externallyDeleted.length && verbose) {
    if (confirm(`${externallyDeleted.length} note file(s) were removed from the sync folder.\nDelete the matching notes in YANTA too?`)) {
      for (const { id } of externallyDeleted) {
        if (state.notes.has(id)) {
          state.notes.delete(id);
          await store.notes.del(id);
          syncRememberDeletion(id);
          sync.knownFiles.delete(id);
        }
      }
      renderTree();
      rebuildWikilinkIndex();
      if (!state.notes.has(state.currentNoteId)) {
        const recent = [...state.notes.values()].sort((a, b) => b.updated - a.updated)[0];
        if (recent) openNote(recent.id);
        else if (typeof clearEditor === 'function') clearEditor();
      }
    }
  }
  if (verbose || res.imported || res.updated || res.conflicts) {
    toast(`Sync: ${res.imported} new · ${res.updated} updated · ${res.conflicts} conflict${res.conflicts === 1 ? '' : 's'}${pushed ? ` · ${pushed} pushed` : ''}`, res.conflicts ? 'error' : 'success');
  }
  if (res.conflictItems.length) showSyncConflictsModal(res.conflictItems);
}

async function syncPull() {
  const result = { imported: 0, updated: 0, conflicts: 0, seenPaths: new Set(), conflictItems: [] };
  if (!sync.handle) return result;
  try {
    const imgDir = await sync.handle.getDirectoryHandle('_images').catch(() => null);
    if (imgDir) await syncImportImages(imgDir);
  } catch {}
  await syncWalk(sync.handle, [], result);
  return result;
}

async function syncWalk(dirHandle, segs, result) {
  for await (const [name, h] of dirHandle.entries()) {
    if (name.startsWith('.')) continue;
    if (h.kind === 'directory') {
      if (name === '_images') continue;
      await syncWalk(h, [...segs, name], result);
    } else if (h.kind === 'file' && /\.(md|markdown)$/i.test(name)) {
      const path = [...segs, name].join('/');
      const file = await h.getFile();
      if (/\.sync-conflict-/.test(name)) {
        result.conflicts++;
        result.conflictItems.push({ path, dirHandle, name, file, segs });
        continue;
      }
      result.seenPaths.add(path);
      await syncIngestFile(file, path, segs, name, result);
    }
  }
}

async function syncIngestFile(file, path, segs, filename, result) {
  const lastMtime = sync.fileMtimes.get(path);
  if (lastMtime && file.lastModified === lastMtime) return;
  let text; try { text = await file.text(); } catch { return; }
  const { meta, body } = parseFrontmatter(text);
  const resolvedBody = body.replace(/(?:\.\.\/)*_images\/([a-z0-9]+)(?:\.[a-z0-9]+)?/gi, (_, id) => 'yanta-img://' + id);
  const folderId = segs.length ? await ensureFolderPath(segs) : null;
  const fileTime = file.lastModified || Date.now();
  const title = filename.replace(/\.(md|markdown)$/i, '');

  // Tombstone — honor deletion if the file is older than the tombstone
  if (meta.id && sync.tombstones.has(meta.id)) {
    const t = sync.tombstones.get(meta.id);
    if (fileTime <= t.at + 1000) {
      try {
        const parts = path.split('/');
        const dir = parts.length > 1 ? await _getDir(sync.handle, parts.slice(0, -1)) : sync.handle;
        await dir.removeEntry(parts[parts.length - 1]);
      } catch {}
      return;
    }
    sync.tombstones.delete(meta.id);
    persistTombstones();
  }

  if (meta.id && state.notes.has(meta.id)) {
    const existing = state.notes.get(meta.id);
    const incomingTime = meta.updated ? Date.parse(meta.updated) || fileTime : fileTime;
    if (incomingTime > existing.updated + 1000) {
      existing.title = title;
      existing.body = resolvedBody;
      existing.folderId = folderId;
      existing.tags = Array.isArray(meta.tags) ? meta.tags : existing.tags || [];
      existing.pinned = !!meta.pinned;
      existing.updated = incomingTime;
      await store.notes.put(existing);
      sync.knownFiles.set(existing.id, path);
      result.updated++;
      if (state.currentNoteId === existing.id) {
        lastMarkdown = existing.body;
        $('noteTitle').value = existing.title;
        renderEditor(lastMarkdown);
        $('preview').innerHTML = renderPreview(lastMarkdown);
        if (typeof renderOutline === 'function') renderOutline();
        if (typeof renderBacklinks === 'function') renderBacklinks();
      }
    } else {
      sync.knownFiles.set(existing.id, path);
    }
    sync.fileMtimes.set(path, fileTime);
    return;
  }

  const note = {
    id: meta.id || uid(),
    title,
    body: resolvedBody,
    folderId,
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    pinned: !!meta.pinned,
    created: meta.created ? Date.parse(meta.created) || fileTime : fileTime,
    updated: meta.updated ? Date.parse(meta.updated) || fileTime : fileTime,
  };
  state.notes.set(note.id, note);
  await store.notes.put(note);
  sync.knownFiles.set(note.id, path);
  sync.fileMtimes.set(path, fileTime);
  result.imported++;
  if (!meta.id) await syncWriteNote(note);   // back-fill id
  rebuildWikilinkIndex();
}

async function syncImportImages(imgDir) {
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

/* ----------------------------------------------------------------
   Conflict modal — surface .sync-conflict-*.md files cleanly
---------------------------------------------------------------- */
function showSyncConflictsModal(conflicts) {
  const modal = $('conflictModal');
  if (!modal) return;
  const list = $('conflictList');
  list.replaceChildren();
  if (!conflicts.length) {
    list.append(el('div', { class: 'palette-empty' }, 'No conflicts'));
  } else {
    for (const c of conflicts) {
      const card = el('div', { class: 'conflict-card' });
      const head = el('div', { class: 'conflict-head' }, c.path);
      card.append(head);
      const btnRow = el('div', { class: 'conflict-actions' });
      btnRow.append(el('button', { class: 'btn', onclick: () => viewConflictFile(c) }, 'View'));
      btnRow.append(el('button', { class: 'btn', onclick: async () => { await keepLocalDeleteConflict(c); card.remove(); if (!list.children.length) closeConflictModal(); } }, 'Keep mine'));
      btnRow.append(el('button', { class: 'btn primary', onclick: async () => { await adoptConflict(c); card.remove(); if (!list.children.length) closeConflictModal(); } }, 'Take theirs (new note)'));
      card.append(btnRow);
      list.append(card);
    }
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
  } else {
    alert(text.slice(0, 4000));
  }
}
async function keepLocalDeleteConflict(c) {
  try { await c.dirHandle.removeEntry(c.name); } catch {}
  toast('Kept your version', 'success');
}
async function adoptConflict(c) {
  const text = await c.file.text();
  const { meta, body } = parseFrontmatter(text);
  const resolvedBody = body.replace(/(?:\.\.\/)*_images\/([a-z0-9]+)(?:\.[a-z0-9]+)?/gi, (_, id) => 'yanta-img://' + id);
  const folderId = c.segs.length ? await ensureFolderPath(c.segs) : null;
  const baseTitle = c.name.replace(/\.sync-conflict-[^.]+\.(md|markdown)$/i, '');
  const note = {
    id: uid(),
    title: baseTitle + ' (from other device)',
    body: resolvedBody,
    folderId,
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    pinned: !!meta.pinned,
    created: Date.now(),
    updated: Date.now(),
  };
  state.notes.set(note.id, note);
  await store.notes.put(note);
  await syncWriteNote(note);
  try { await c.dirHandle.removeEntry(c.name); } catch {}
  rebuildWikilinkIndex();
  renderTree();
  toast('Adopted as new note', 'success');
}
function closeConflictModal() { const m = $('conflictModal'); if (m) m.hidden = true; }

/* ----------------------------------------------------------------
   UI: indicator + menu + setup wizard
---------------------------------------------------------------- */
function updateSyncIndicator() {
  const e = $('vaultIndicator');
  if (!e) return;
  if (sync.handle) {
    e.innerHTML = lucide('refresh', 12) + '<span>' + escapeHtml(sync.handle.name) + '</span>';
    e.classList.add('connected');
    e.title = `Sync folder: ${sync.handle.name}`;
    e.hidden = false;
  } else if (sync.isAvailable) {
    e.innerHTML = lucide('refresh', 12) + '<span>set up sync</span>';
    e.classList.remove('connected');
    e.title = 'Set up sync (works great with Syncthing)';
    e.hidden = false;
  } else {
    e.hidden = true;
  }
}

function syncMenu(anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  const items = [];
  if (sync.handle) {
    items.push({ label: 'Sync now (pull + push)', action: () => syncFull(true) });
    items.push({ label: 'Pick a different folder…', action: syncConnect });
    items.push('hr');
    items.push({ label: 'Find unused images…', action: cleanupUnusedImages });
    items.push('hr');
    items.push({ label: 'Disconnect', danger: true, action: syncDisconnect });
  } else {
    items.push({ label: 'Set up sync…', action: openSyncSetup });
    if (!sync.isAvailable) items.push({ label: '(needs HTTPS or localhost)', action: () => {} });
  }
  showMenu(r.left, r.top - 4, items);
}

function openSyncSetup() {
  const m = $('syncSetupModal');
  if (!m) { syncConnect(); return; }
  m.hidden = false;
}
function closeSyncSetup() { const m = $('syncSetupModal'); if (m) m.hidden = true; }

/* ----------------------------------------------------------------
   Unused-images cleanup
---------------------------------------------------------------- */
async function cleanupUnusedImages() {
  const used = new Set();
  const re = /yanta-img:\/\/([a-z0-9]+)/gi;
  for (const note of state.notes.values()) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(note.body || '')) !== null) used.add(m[1]);
  }
  const unused = [...state.imagesMeta.values()].filter((meta) => !used.has(meta.id));
  if (!unused.length) { toast('No unused images', 'success'); return; }
  const totalBytes = unused.reduce((s, m) => s + (m.size || 0), 0);
  if (!confirm(`Delete ${unused.length} unused image${unused.length === 1 ? '' : 's'} (${fmtBytes(totalBytes)})?`)) return;
  for (const meta of unused) {
    await store.images.del(meta.id);
    state.imagesMeta.delete(meta.id);
    if (state.imageBlobs.has(meta.id)) {
      URL.revokeObjectURL(state.imageBlobs.get(meta.id));
      state.imageBlobs.delete(meta.id);
    }
    if (sync.handle) {
      try {
        const imgDir = await sync.handle.getDirectoryHandle('_images');
        await imgDir.removeEntry(meta.id + '.' + imageExt(meta));
      } catch {}
    }
  }
  toast(`Cleaned up ${unused.length} image${unused.length === 1 ? '' : 's'}`, 'success');
}
