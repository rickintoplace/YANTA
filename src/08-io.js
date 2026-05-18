/* ============================================================
   YANTA — import / export
   .md (with front-matter), .json bundle, .zip with folder mirror
   ============================================================ */
'use strict';

/* ----------------------------------------------------------------
   import / export
---------------------------------------------------------------- */
function safeFilename(s) {
  return (s || 'untitled').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
}
function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function noteToFrontmatter(n) {
  const meta = {};
  if (n.tags?.length) meta.tags = n.tags;
  if (n.pinned) meta.pinned = true;
  if (n.folderId) {
    const folder = state.folders.get(n.folderId);
    if (folder) meta.folder = folder.name;
  }
  meta.created = new Date(n.created).toISOString();
  meta.updated = new Date(n.updated).toISOString();
  if (Object.keys(meta).length === 0) return '';
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`);
    else lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function parseFrontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const mm = /^(\w+):\s*(.*)$/.exec(line);
    if (!mm) continue;
    let v = mm[2].trim();
    if (/^\[.*\]$/.test(v)) { try { meta[mm[1]] = JSON.parse(v); continue; } catch {} }
    if (v === 'true') meta[mm[1]] = true;
    else if (v === 'false') meta[mm[1]] = false;
    else { try { meta[mm[1]] = JSON.parse(v); } catch { meta[mm[1]] = v; } }
  }
  return { meta, body: md.slice(m[0].length) };
}

// Export a single note as a .md file
async function exportNoteAsMd(note) {
  if (!note) return;
  const md = noteToFrontmatter(note) + (note.body || '');
  const blob = new Blob([md], { type: 'text/markdown' });
  downloadBlob(blob, safeFilename(note.title) + '.md');
  toast('Exported "' + (note.title || 'note') + '.md"', 'success');
}

// Export every note as a separate .md file, batched into a single download:
// produces a .json "archive" you can later re-import. For raw .md export of
// individual notes use the per-note button or context-menu.
async function exportAllMarkdown() {
  // We use a single text "ZIP-like" archive: each file is delimited.
  // Simpler: emit a .json bundle (already supported), or trigger N downloads.
  // We'll pick: ask the user.
  exportBundle();
}

async function exportBundle() {
  // Bundles notes + folders + images as one portable JSON
  const images = [];
  for (const meta of state.imagesMeta.values()) {
    const rec = await store.images.get(meta.id);
    if (rec) {
      const dataUrl = await blobToDataURL(rec.blob);
      images.push({ ...meta, data: dataUrl });
    }
  }
  const bundle = {
    yanta: 1,
    exported: new Date().toISOString(),
    notes: [...state.notes.values()],
    folders: [...state.folders.values()],
    images,
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `yanta-${new Date().toISOString().slice(0, 10)}.json`);
  toast('Exported full bundle', 'success');
}

// Export every note as individual .md files (triggers one download per note;
// browsers usually let you allow multi-download once)
async function exportEveryNoteMd() {
  const notes = [...state.notes.values()];
  if (!notes.length) { toast('Nothing to export', 'error'); return; }
  if (!confirm(`Download ${notes.length} .md file(s)? Your browser may ask to allow multiple downloads.`)) return;
  for (const n of notes) {
    const md = noteToFrontmatter(n) + (n.body || '');
    const blob = new Blob([md], { type: 'text/markdown' });
    downloadBlob(blob, safeFilename(n.title) + '.md');
    await new Promise((r) => setTimeout(r, 80));
  }
  toast('Exported ' + notes.length + ' note(s)', 'success');
}

// Open the Export menu anchored to a button
function openExportMenu(anchorBtn) {
  const r = anchorBtn.getBoundingClientRect();
  const note = state.currentNoteId ? state.notes.get(state.currentNoteId) : null;
  showMenu(r.left, r.bottom + 4, [
    { label: 'Export as folder ZIP (recommended)', action: exportAsZip },
    'hr',
    { label: note ? `Export current note (.md)` : 'Export current note (.md)', action: () => note && exportNoteAsMd(note) },
    { label: 'Export every note as .md files', action: exportEveryNoteMd },
    { label: 'Export full bundle (.json + base64 images)', action: exportBundle },
  ]);
}

// Ensure a folder path (array of segment names) exists, return its id (or null).
const _folderCache = new Map();
async function ensureFolderPath(pathArr) {
  if (!pathArr || pathArr.length === 0) return null;
  const key = pathArr.join('/');
  if (_folderCache.has(key)) return _folderCache.get(key);
  let parentId = null;
  let cum = '';
  for (const seg of pathArr) {
    cum += (cum ? '/' : '') + seg;
    if (_folderCache.has(cum)) { parentId = _folderCache.get(cum); continue; }
    const existing = [...state.folders.values()].find((f) => f.name === seg && f.parentId === parentId);
    if (existing) { _folderCache.set(cum, existing.id); parentId = existing.id; continue; }
    const f = { id: uid(), name: seg, parentId, created: Date.now() };
    state.folders.set(f.id, f);
    await store.folders.put(f);
    state.expandedFolders.add(f.id);
    _folderCache.set(cum, f.id);
    parentId = f.id;
  }
  return parentId;
}

async function importBundleFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data.yanta) throw new Error('Not a YANTA bundle');
  for (const f of data.folders || []) { state.folders.set(f.id, f); await store.folders.put(f); }
  for (const n of data.notes || []) { state.notes.set(n.id, n); await store.notes.put(n); }
  for (const im of data.images || []) {
    const blob = await (await fetch(im.data)).blob();
    const { data: _, ...meta } = im;
    await store.images.put({ ...meta, blob });
    state.imagesMeta.set(meta.id, meta);
  }
}

// Import items with optional folder path; pathArr is the folder hierarchy
// (folder names only, NOT including the file). Notes land in their folder;
// JSON bundles merge globally; unknown files are skipped.
async function importItems(items) {
  _folderCache.clear();
  let noteCount = 0, bundleCount = 0, zipCount = 0, failed = 0, skipped = 0;
  for (const { file, pathArr } of items) {
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.zip')) {
        await importZipBlob(file);
        zipCount++;
      } else if (lower.endsWith('.json')) {
        await importBundleFile(file);
        bundleCount++;
      } else if (/\.(md|markdown|txt)$/i.test(file.name)) {
        const text = await file.text();
        const { meta, body } = parseFrontmatter(text);
        let folderId = await ensureFolderPath(pathArr);
        if (!folderId && meta.folder) folderId = await ensureFolderPath([meta.folder]);
        const title = file.name.replace(/\.(md|markdown|txt)$/i, '');
        const note = {
          id: uid(),
          title,
          body,
          folderId,
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          pinned: !!meta.pinned,
          created: meta.created ? Date.parse(meta.created) || Date.now() : Date.now(),
          updated: Date.now(),
        };
        state.notes.set(note.id, note);
        await store.notes.put(note);
        noteCount++;
      } else {
        skipped++;
      }
    } catch (e) {
      console.error('Import failed for', file.name, e);
      failed++;
    }
  }
  rebuildWikilinkIndex();
  renderTree();
  const parts = [];
  if (noteCount) parts.push(`${noteCount} note${noteCount === 1 ? '' : 's'}`);
  if (bundleCount) parts.push(`${bundleCount} bundle${bundleCount === 1 ? '' : 's'}`);
  if (zipCount) parts.push(`${zipCount} ZIP${zipCount === 1 ? '' : 's'}`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (failed) parts.push(`${failed} failed`);
  // importZipBlob already emits its own toast; suppress the summary if zip-only
  if (!(zipCount && !noteCount && !bundleCount)) {
    toast('Imported ' + (parts.join(', ') || 'nothing'), failed ? 'error' : 'success');
  }
}

// Back-compat: flat list of files with no folder context
async function importFiles(files) {
  return importItems(files.map((f) => ({ file: f, pathArr: [] })));
}

/* ================================================================
   Minimal ZIP writer + reader (STORED + DEFLATE)
   Used for portable "folder-mirror" exports / imports.
================================================================ */
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const _enc = new TextEncoder();
const _dec = new TextDecoder();

// entries: [{ path, data: Uint8Array }] — paths may contain '/' for folders
function makeZip(entries) {
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  const chunks = [];
  const cd = [];
  let offset = 0;
  for (const e of entries) {
    const name = _enc.encode(e.path);
    const data = e.data;
    const c = crc32(data);
    const lfh = new Uint8Array(30 + name.length);
    const dv = new DataView(lfh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true); // UTF-8 names
    dv.setUint16(8, 0, true);      // method: stored
    dv.setUint16(10, dosTime, true);
    dv.setUint16(12, dosDate, true);
    dv.setUint32(14, c, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, name.length, true);
    dv.setUint16(28, 0, true);
    lfh.set(name, 30);
    chunks.push(lfh, data);
    cd.push({ name, dataLen: data.length, crc: c, offset });
    offset += lfh.length + data.length;
  }
  const cdStart = offset;
  for (const ent of cd) {
    const h = new Uint8Array(46 + ent.name.length);
    const dv = new DataView(h.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, dosTime, true);
    dv.setUint16(14, dosDate, true);
    dv.setUint32(16, ent.crc, true);
    dv.setUint32(20, ent.dataLen, true);
    dv.setUint32(24, ent.dataLen, true);
    dv.setUint16(28, ent.name.length, true);
    dv.setUint32(42, ent.offset, true);
    h.set(ent.name, 46);
    chunks.push(h);
    offset += h.length;
  }
  const eocd = new Uint8Array(22);
  const dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, cd.length, true);
  dv.setUint16(10, cd.length, true);
  dv.setUint32(12, offset - cdStart, true);
  dv.setUint32(16, cdStart, true);
  chunks.push(eocd);
  return new Blob(chunks, { type: 'application/zip' });
}

async function inflateRaw(bytes) {
  // DecompressionStream is available in Chromium-based + Firefox + Safari ≥17
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const chunks = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function readZip(blob) {
  const buf = await blob.arrayBuffer();
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  // Locate EOCD by scanning backward
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP');
  const numEntries = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < numEntries; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Bad CD entry');
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const lfhOffset = dv.getUint32(p + 42, true);
    const name = _dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (dv.getUint32(lfhOffset, true) !== 0x04034b50) throw new Error('Bad LFH');
    const lfhNameLen = dv.getUint16(lfhOffset + 26, true);
    const lfhExtraLen = dv.getUint16(lfhOffset + 28, true);
    const dataStart = lfhOffset + 30 + lfhNameLen + lfhExtraLen;
    const raw = u8.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = await inflateRaw(raw);
    else throw new Error('Unsupported method ' + method);
    entries.push({ path: name, data, isDir: name.endsWith('/') });
  }
  return entries;
}

/* ================================================================
   Folder-mirror ZIP export
   The ZIP layout mirrors the in-app folder hierarchy:
       Top-level note.md
       Some folder/Sub-folder/Nested note.md
       _images/<id>.<ext>          (only images actually used)
       _yanta-manifest.json         (versioning / round-trip aid)
================================================================ */
function folderPathSegments(folderId) {
  if (!folderId) return [];
  const parts = [];
  let f = state.folders.get(folderId);
  const seen = new Set();
  while (f && !seen.has(f.id)) {
    parts.unshift(f.name);
    seen.add(f.id);
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }
  return parts;
}

function imageExt(meta) {
  const t = (meta?.type || '').split('/')[1] || '';
  if (t === 'jpeg') return 'jpg';
  if (t === 'svg+xml') return 'svg';
  return t || 'bin';
}

async function exportAsZip() {
  // 1. Collect images that any note actually references
  const used = new Set();
  for (const note of state.notes.values()) {
    const re = /yanta-img:\/\/([a-z0-9]+)/gi;
    let m;
    while ((m = re.exec(note.body || '')) !== null) used.add(m[1]);
  }

  // 2. Build entries
  const entries = [];
  const usedPaths = new Set();
  function pickPath(folderSegs, baseName) {
    let path = [...folderSegs, baseName].join('/');
    if (!usedPaths.has(path)) { usedPaths.add(path); return path; }
    // Disambiguate with a suffix
    const dot = baseName.lastIndexOf('.');
    const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
    const ext = dot > 0 ? baseName.slice(dot) : '';
    for (let i = 2; i < 1000; i++) {
      const p = [...folderSegs, `${stem} (${i})${ext}`].join('/');
      if (!usedPaths.has(p)) { usedPaths.add(p); return p; }
    }
    return path;
  }

  for (const note of state.notes.values()) {
    const segs = folderPathSegments(note.folderId);
    const fname = safeFilename(note.title) + '.md';
    const path = pickPath(segs, fname);
    let body = note.body || '';
    // Rewrite yanta-img://X → _images/X.ext (relative, resolves from any depth via "/")
    body = body.replace(/yanta-img:\/\/([a-z0-9]+)/gi, (full, id) => {
      const meta = state.imagesMeta.get(id);
      if (!meta) return full;
      const rel = '_images/' + id + '.' + imageExt(meta);
      // Add ../ for nested folders
      return (segs.length ? '../'.repeat(segs.length) : '') + rel;
    });
    const fm = noteToFrontmatter(note);
    entries.push({ path, data: _enc.encode(fm + body) });
  }

  for (const id of used) {
    const rec = await store.images.get(id);
    if (!rec || !rec.blob) continue;
    const meta = state.imagesMeta.get(id) || { type: rec.type };
    const buf = new Uint8Array(await rec.blob.arrayBuffer());
    entries.push({ path: '_images/' + id + '.' + imageExt(meta), data: buf });
  }

  const manifest = {
    yanta: 1,
    exported: new Date().toISOString(),
    counts: { notes: state.notes.size, folders: state.folders.size, images: used.size },
  };
  entries.push({ path: '_yanta-manifest.json', data: _enc.encode(JSON.stringify(manifest, null, 2)) });

  const zip = makeZip(entries);
  downloadBlob(zip, `yanta-${new Date().toISOString().slice(0, 10)}.zip`);
  toast(`Exported ${entries.length} files`, 'success');
}

/* ================================================================
   ZIP import — accepts files we exported, or any folder-of-md ZIP
================================================================ */
const _imageExtToMime = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', bin: 'application/octet-stream',
};
async function importZipBlob(blob) {
  let entries;
  try { entries = await readZip(blob); }
  catch (e) { toast('ZIP read failed: ' + e.message, 'error'); return; }

  _folderCache.clear();
  const imageIdRemap = new Map(); // original id (from filename) -> new id

  // First pass: images
  for (const ent of entries) {
    if (ent.isDir) continue;
    if (!ent.path.startsWith('_images/')) continue;
    const filename = ent.path.slice('_images/'.length);
    const dot = filename.lastIndexOf('.');
    const origId = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = (dot > 0 ? filename.slice(dot + 1) : 'bin').toLowerCase();
    const mime = _imageExtToMime[ext] || 'application/octet-stream';
    const blob2 = new Blob([ent.data], { type: mime });
    const newId = state.imagesMeta.has(origId) ? uid() : origId;
    const meta = { id: newId, name: filename, size: blob2.size, type: mime, ts: Date.now() };
    await store.images.put({ ...meta, blob: blob2 });
    state.imagesMeta.set(newId, meta);
    imageIdRemap.set(origId, newId);
  }

  // Second pass: notes
  let noteCount = 0;
  for (const ent of entries) {
    if (ent.isDir) continue;
    if (ent.path.startsWith('_images/')) continue;
    if (ent.path.startsWith('_yanta-')) continue;
    if (!/\.(md|markdown|txt)$/i.test(ent.path)) continue;
    const parts = ent.path.split('/');
    const filename = parts.pop();
    const folderId = await ensureFolderPath(parts);
    const text = _dec.decode(ent.data);
    const { meta, body: rawBody } = parseFrontmatter(text);
    // Resolve ../_images/X.ext → yanta-img://(remapped)X
    const body = rawBody.replace(/(?:\.\.\/)*_images\/([a-z0-9]+)(?:\.[a-z0-9]+)?/gi, (_full, id) => {
      const newId = imageIdRemap.get(id) || id;
      return 'yanta-img://' + newId;
    });
    const title = filename.replace(/\.(md|markdown|txt)$/i, '');
    const note = {
      id: uid(),
      title,
      body,
      folderId,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      pinned: !!meta.pinned,
      created: meta.created ? Date.parse(meta.created) || Date.now() : Date.now(),
      updated: Date.now(),
    };
    state.notes.set(note.id, note);
    await store.notes.put(note);
    noteCount++;
  }

  rebuildWikilinkIndex();
  renderTree();
  toast(`Imported ${noteCount} note${noteCount === 1 ? '' : 's'}${imageIdRemap.size ? ` + ${imageIdRemap.size} image${imageIdRemap.size === 1 ? '' : 's'}` : ''} from ZIP`, 'success');
}

/* Walk a webkitGetAsEntry tree (supports nested directories) */
async function walkEntry(entry, pathArr = []) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    return [{ file, pathArr }];
  }
  // Directory: include its own name in the path of its children
  const childPath = [...pathArr, entry.name];
  const reader = entry.createReader();
  const all = [];
  // readEntries returns at most 100 at a time; keep calling until empty
  while (true) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    for (const e of batch) {
      all.push(...(await walkEntry(e, childPath)));
    }
  }
  return all;
}

/* ----------------------------------------------------------------
   storage meter
---------------------------------------------------------------- */
async function updateStorageMeter() {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) {
      $('storageMeter').textContent = fmtBytes(est.usage || 0);
      $('storageMeter').title = `Used ${fmtBytes(est.usage || 0)} of ~${fmtBytes(est.quota || 0)}`;
    }
  } catch {}
}
