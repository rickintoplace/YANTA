/* ============================================================
   YANTA — Vault folder sync
   Uses the File System Access API (Chromium / Firefox 111+ /
   recent Safari) to write notes as real .md files in a folder you
   pick. Lets you put that folder under Git / Syncthing / Dropbox
   for cross-device sync without any cloud lock-in.

   Important: this API is only available in a *secure context*
   (HTTPS or localhost). When YANTA is opened from file:// it just
   stays silent — IndexedDB remains the source of truth.
   ============================================================ */
'use strict';

const vault = {
  handle: null,       // FileSystemDirectoryHandle
  isAvailable: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
  autoSync: true,
};

async function vaultRestore() {
  if (!vault.isAvailable) return;
  const handle = await store.settings.get('vaultHandle', null);
  if (!handle) { updateVaultIndicator(); return; }
  try {
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      vault.handle = handle;
    } else {
      // Don't auto-prompt on every load; surface a button instead.
    }
  } catch {}
  updateVaultIndicator();
}

async function vaultConnect() {
  if (!vault.isAvailable) {
    toast('File System Access needs HTTPS or localhost — file:// can\'t use it', 'error');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      id: 'yanta-vault',
      startIn: 'documents',
    });
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') { toast('Vault: permission denied', 'error'); return; }
    vault.handle = handle;
    await store.settings.set('vaultHandle', handle);
    updateVaultIndicator();
    toast('Vault connected: ' + handle.name, 'success');
    if (confirm(`Mirror all ${state.notes.size} note(s) to "${handle.name}" now?`)) {
      await vaultSyncAll();
    }
  } catch (e) {
    if (e.name !== 'AbortError') toast('Vault connect failed: ' + e.message, 'error');
  }
}

function vaultDisconnect() {
  vault.handle = null;
  store.settings.set('vaultHandle', null);
  updateVaultIndicator();
  toast('Vault disconnected');
}

/* ----------------------------------------------------------------
   Writing
---------------------------------------------------------------- */
async function _ensureDirPath(root, segs) {
  let dir = root;
  for (const seg of segs) {
    dir = await dir.getDirectoryHandle(seg, { create: true });
  }
  return dir;
}

async function vaultWriteNote(note) {
  if (!vault.handle || !vault.autoSync) return;
  try {
    const segs = (typeof folderPathSegments === 'function')
      ? folderPathSegments(note.folderId) : [];
    const dir = await _ensureDirPath(vault.handle, segs);
    const filename = safeFilename(note.title) + '.md';
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const w = await fileHandle.createWritable();
    // Rewrite image refs to relative paths so the .md renders in any
    // external viewer (same scheme as the ZIP exporter).
    let body = note.body || '';
    body = body.replace(/yanta-img:\/\/([a-z0-9]+)/gi, (full, id) => {
      const meta = state.imagesMeta.get(id);
      if (!meta) return full;
      const ext = imageExt(meta);
      return (segs.length ? '../'.repeat(segs.length) : '') + '_images/' + id + '.' + ext;
    });
    await w.write(noteToFrontmatter(note) + body);
    await w.close();
    // Make sure any referenced images are present in _images/
    const used = new Set();
    const re = /yanta-img:\/\/([a-z0-9]+)/gi;
    let m;
    while ((m = re.exec(note.body || '')) !== null) used.add(m[1]);
    if (used.size) {
      const imgDir = await vault.handle.getDirectoryHandle('_images', { create: true });
      for (const id of used) {
        const meta = state.imagesMeta.get(id);
        if (!meta) continue;
        const name = id + '.' + imageExt(meta);
        try {
          // Skip if already written
          await imgDir.getFileHandle(name);
        } catch {
          const rec = await store.images.get(id);
          if (!rec || !rec.blob) continue;
          const fh = await imgDir.getFileHandle(name, { create: true });
          const ww = await fh.createWritable();
          await ww.write(rec.blob);
          await ww.close();
        }
      }
    }
  } catch (e) {
    console.warn('vault write failed for', note.title, e);
  }
}

async function vaultSyncAll() {
  if (!vault.handle) return;
  let n = 0;
  for (const note of state.notes.values()) {
    await vaultWriteNote(note);
    n++;
  }
  toast(`Mirrored ${n} note${n === 1 ? '' : 's'} to vault`, 'success');
}

/* ----------------------------------------------------------------
   Pulling — bring external .md changes back into the app
---------------------------------------------------------------- */
async function vaultPull() {
  if (!vault.handle) { toast('No vault connected', 'error'); return; }
  const items = [];
  async function walk(dirHandle, pathArr) {
    for await (const [name, handle] of dirHandle.entries()) {
      if (name.startsWith('.')) continue;
      if (handle.kind === 'directory') {
        if (name === '_images') continue;
        await walk(handle, [...pathArr, name]);
      } else if (handle.kind === 'file' && /\.(md|markdown|txt)$/i.test(name)) {
        const file = await handle.getFile();
        items.push({ file, pathArr });
      }
    }
  }
  try { await walk(vault.handle, []); }
  catch (e) { toast('Vault read failed: ' + e.message, 'error'); return; }
  if (!items.length) { toast('Vault is empty'); return; }
  if (!confirm(`Import ${items.length} note(s) from "${vault.handle.name}"?\nNotes are added as new entries; existing notes are not overwritten.`)) return;
  await importItems(items);
}

/* ----------------------------------------------------------------
   Status indicator (rendered in the footer)
---------------------------------------------------------------- */
function updateVaultIndicator() {
  const e = $('vaultIndicator');
  if (!e) return;
  if (vault.handle) {
    e.innerHTML = lucide('git-branch', 12) + '<span>' + escapeHtml(vault.handle.name) + '</span>';
    e.classList.add('connected');
    e.title = `Vault: ${vault.handle.name}\nClick for options`;
    e.hidden = false;
  } else if (vault.isAvailable) {
    e.innerHTML = lucide('git-branch', 12) + '<span>connect vault…</span>';
    e.classList.remove('connected');
    e.title = 'Click to connect a folder on disk for git-style sync';
    e.hidden = false;
  } else {
    e.hidden = true;
  }
}

function vaultMenu(anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  const items = [];
  if (vault.handle) {
    items.push({ label: 'Sync everything to vault now', action: vaultSyncAll });
    items.push({ label: 'Pull from vault…', action: vaultPull });
    items.push('hr');
    items.push({ label: 'Disconnect vault', danger: true, action: vaultDisconnect });
  } else {
    items.push({ label: 'Connect vault folder…', action: vaultConnect });
    if (!vault.isAvailable) {
      items.push('hr');
      items.push({ label: '(Needs HTTPS or localhost)', action: () => {} });
    }
  }
  showMenu(r.left, r.top - 4, items);
}
