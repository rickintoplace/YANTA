// ============================================================
// YANTA — Import / Export.
// Note CONTENTS come from Y.Doc → markdown string for export, and on
// import we seed a new Y.Doc with the imported markdown.
// Supports: single .md, every-note .md, .json bundle, ZIP folder mirror.
// ============================================================

import { $, uid, state, store, toast, safeFilename, downloadBlob } from './core.js';
import { getNoteDoc, noteMarkdown, listDrawingsForNote, listCitationsForNote, setDrawing, normalizeDrawingScene } from './yjs.js';
import { rebuildWikilinkIndex } from './notes.js';
import { renderTree } from './tree.js';
import {
  yantaConfirm,
} from './dialogs.js';
import {
  isNoteInTrash,
  isFolderInTrash,
} from './trash.js';

export function noteToFrontmatter(n) {
  const meta = { id: n.id };
  if (n.icon) meta.icon = n.icon;
  if (n.color) meta.color = n.color;
  if (n.type && n.type !== 'markdown') meta.type = n.type;
  if (n.tags?.length) meta.tags = n.tags;
  if (n.pinned) meta.pinned = true;
  if (n.dashboardOrder != null) meta.dashboardOrder = n.dashboardOrder;
  if (n.dashboardHeight != null) meta.dashboardHeight = n.dashboardHeight;
  if (n.dashboardPinnedOrder != null) meta.dashboardPinnedOrder = n.dashboardPinnedOrder;
  if (n.dashboardHeightPx != null) meta.dashboardHeightPx = n.dashboardHeightPx;
  if (n.hidden) meta.hidden = true;
  if (n.archived) meta.archived = true;
  if (n.system) meta.system = true;
  if (n.aiBrain) meta.aiBrain = true;
  if (n.dashboardHidden) meta.dashboardHidden = true;
  if (n.hiddenFromDashboard) meta.hiddenFromDashboard = true;
  if (n.folderId) {
    const folder = state.folders.get(n.folderId);
    if (folder) meta.folder = folder.name;
  }
  if (n.trashed) meta.trashed = true;
  if (n.deletedAt) meta.deletedAt = n.deletedAt;
  if (n.deletedBy) meta.deletedBy = n.deletedBy;
  if (n.trashOriginalFolderId) meta.trashOriginalFolderId = n.trashOriginalFolderId;
  if (Array.isArray(n.trashOriginalFolderPath)) meta.trashOriginalFolderPath = n.trashOriginalFolderPath;
  meta.created = new Date(n.created).toISOString();
  meta.updated = new Date(n.updated).toISOString();
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`);
    else lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

export function parseFrontmatter(md) {
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

export async function exportNoteAsMd(note) {
  if (!note) return;
  const body = noteMarkdown(note.id);
  const md = noteToFrontmatter(note) + body;
  downloadBlob(new Blob([md], { type: 'text/markdown' }), safeFilename(note.title) + '.md');
  toast('Exported "' + (note.title || 'note') + '.md"', 'success');
}

export async function exportBundle() {
  const images = [];
  for (const meta of state.imagesMeta.values()) {
    const rec = await store.images.get(meta.id);
    if (rec) {
      const dataUrl = await blobToDataURL(rec.blob);
      images.push({ ...meta, data: dataUrl });
    }
  }
  const notes = [];
  for (const n of state.notes.values()) {
    let body = '';
    try { body = noteMarkdown(n.id); } catch {}
    notes.push({ ...n, body });
  }
  const bundle = { yanta: 2, exported: new Date().toISOString(), notes, folders: [...state.folders.values()], images };
  downloadBlob(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }), `yanta-${new Date().toISOString().slice(0, 10)}.json`);
  toast('Exported full bundle', 'success');
}

export async function exportEveryNoteMd() {
  const notes = [...state.notes.values()]
    .filter((n) => !isNoteInTrash(n));

  if (!notes.length) {
    toast('Nothing to export', 'error');
    return;
  }

  const ok = await yantaConfirm({
    title: 'Export all notes?',
    message: `Download ${notes.length} Markdown file${notes.length === 1 ? '' : 's'}?\n\nYour notes are not changed.`,
    confirmLabel: 'Download files',
    icon: 'download',
  });

  if (!ok) return;

  for (const n of notes) {
    let body = '';

    try {
      body = noteMarkdown(n.id);
    } catch {}

    const md = noteToFrontmatter(n) + body;

    downloadBlob(
      new Blob([md], { type: 'text/markdown' }),
      safeFilename(n.title) + '.md'
    );

    await new Promise((r) => setTimeout(r, 80));
  }

  toast('Exported ' + notes.length + ' note(s)', 'success');
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}

// ----------------- Folder helpers --------------------------------
const _folderCache = new Map();
export async function ensureFolderPath(pathArr) {
  if (!pathArr || pathArr.length === 0) return null;
  const key = pathArr.join('/');
  if (_folderCache.has(key)) return _folderCache.get(key);
  let parentId = null, cum = '';
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

export function folderPathSegments(folderId) {
  if (!folderId) return [];
  const parts = []; let f = state.folders.get(folderId); const seen = new Set();
  while (f && !seen.has(f.id)) { parts.unshift(f.name); seen.add(f.id); f = f.parentId ? state.folders.get(f.parentId) : null; }
  return parts;
}

export function imageExt(meta) {
  const t = (meta?.type || '').split('/')[1] || '';
  if (t === 'jpeg') return 'jpg';
  if (t === 'svg+xml') return 'svg';
  return t || 'bin';
}

// ----------------- Bundle import --------------------------------
export async function importBundleFile(file) {
  const data = JSON.parse(await file.text());

  if (!data.yanta) {
    throw new Error('Not a YANTA bundle');
  }

  for (const f of data.folders || []) {
    state.folders.set(f.id, f);
    await store.folders.put(f);
  }

  for (const n of data.notes || []) {
    const { body = '', ...meta } = n;

    state.notes.set(meta.id, meta);
    await store.notes.put(meta);

    if (body) {
      const entry = getNoteDoc(meta.id);
      await entry.ready;

      const ytext = entry.doc.getText('markdown');

      if (ytext.length === 0) {
        ytext.insert(0, body);
      }
    }

    updateImportedNoteSearchIndex(meta);
  }

  for (const im of data.images || []) {
    const blob = await (await fetch(im.data)).blob();
    const { data: _, ...meta } = im;

    await store.images.put({
      ...meta,
      blob,
    });

    state.imagesMeta.set(meta.id, meta);
  }
}

function applyNoteMetaFromFrontmatter(note, meta = {}) {
  if (!note || !meta) return note;

  if (meta.dashboardOrder != null) {
    note.dashboardOrder = Number(meta.dashboardOrder);
  }

  if (meta.dashboardHeight != null) {
    note.dashboardHeight = Number(meta.dashboardHeight);
  }

  if (meta.dashboardHeightPx != null) {
    note.dashboardHeightPx = Number(meta.dashboardHeightPx);
    delete note.dashboardHeight;
  }

  if (meta.dashboardPinnedOrder != null) {
    note.dashboardPinnedOrder = Number(meta.dashboardPinnedOrder);
  }

  if (meta.icon) {
    note.icon = meta.icon;
  }

  if (meta.color) {
    note.color = meta.color;
  }

  if (meta.hidden) note.hidden = true;
  else delete note.hidden;

  if (meta.archived) note.archived = true;
  else delete note.archived;

  if (meta.system) note.system = true;
  else delete note.system;

  if (meta.aiBrain) note.aiBrain = true;
  else delete note.aiBrain;

  if (meta.dashboardHidden) note.dashboardHidden = true;
  else delete note.dashboardHidden;

  if (meta.hiddenFromDashboard) note.hiddenFromDashboard = true;
  else delete note.hiddenFromDashboard;

  if (meta.trashed) {
    note.trashed = true;

    if (meta.deletedAt != null) {
      note.deletedAt = Number(meta.deletedAt);
    }

    if (meta.deletedBy) {
      note.deletedBy = String(meta.deletedBy);
    }

    if (meta.trashOriginalFolderId) {
      note.trashOriginalFolderId = meta.trashOriginalFolderId;
    }

    if (Array.isArray(meta.trashOriginalFolderPath)) {
      note.trashOriginalFolderPath = meta.trashOriginalFolderPath.map(String);
    }
  } else {
    // Wichtig bei Import über existierende ID:
    // Wenn Frontmatter nicht trashed ist, alte Trash-Felder entfernen.
    delete note.trashed;
    delete note.deletedAt;
    delete note.deletedBy;
    delete note.trashOriginalFolderId;
    delete note.trashOriginalFolderPath;
  }

  return note;
}

function updateImportedNoteSearchIndex(note) {
  if (!note) return;

  if (isNoteInTrash(note)) {
    state.searchIndex.delete(note.id);
    return;
  }

  let body = '';

  try {
    body = noteMarkdown(note.id);
  } catch {}

  state.searchIndex.set(
    note.id,
    [
      note.title || '',
      (note.tags || []).join(' '),
      body || '',
    ].join(' ').toLowerCase()
  );
}

// ----------------- Generic file import --------------------------
export async function importItems(items) {
  _folderCache.clear();
  let noteCount = 0, bundleCount = 0, zipCount = 0, failed = 0, skipped = 0;
  for (const { file, pathArr } of items) {
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.yanta')) {
        const { importSyncCapsuleFile } = await import('./sync2/capsule.js');
        await importSyncCapsuleFile(file);
        bundleCount++;
      }
      else if (lower.endsWith('.zip')) { await importZipBlob(file); zipCount++; }
      else if (lower.endsWith('.ics')) {
        const { importCalendarFile } = await import('./calendar.js');
        await importCalendarFile(file);
        bundleCount++;
      }
      else if (lower.endsWith('.calendar.json')) {
        const { importCalendarFile } = await import('./calendar.js');
        await importCalendarFile(file);
        bundleCount++;
      }
      else if (lower.endsWith('.excalidraw') || lower.endsWith('.excalidraw.json')) {
        const { importExcalidrawFileAsNote } = await import('./draw.js');
        await importExcalidrawFileAsNote(file);
        noteCount++;
      }
      else if (lower.endsWith('.json')) { await importBundleFile(file); bundleCount++; }
      else if (/\.(md|markdown|txt)$/i.test(file.name)) {
        const text = await file.text();
        const { meta, body } = parseFrontmatter(text);

        const resolvedBody = body.replace(
          /(?:\.\.\/)*_images\/([a-z0-9]+)(?:\.[a-z0-9]+)?/gi,
          (_, id) => 'yanta-img://' + id
        );

        let folderId = await ensureFolderPath(pathArr);

        if (!folderId && meta.folder) {
          folderId = await ensureFolderPath([meta.folder]);
        }

        const title = file.name.replace(/\.(md|markdown|txt)$/i, '');
        const fileTime = file.lastModified || Date.now();
        const id = meta.id || uid();

        const note = state.notes.get(id) || {
          id,
          created: meta.created
            ? Date.parse(meta.created) || fileTime
            : fileTime,
        };

        note.title = title || note.title || 'Untitled';
        note.type = meta.type || note.type || 'markdown';
        note.folderId = folderId || null;
        note.tags = Array.isArray(meta.tags) ? meta.tags : note.tags || [];
        note.pinned = !!meta.pinned;
        note.updated = meta.updated
          ? Date.parse(meta.updated) || fileTime
          : fileTime;

        applyNoteMetaFromFrontmatter(note, meta);

        state.notes.set(id, note);
        await store.notes.put(note);

        const entry = getNoteDoc(id);
        await entry.ready;

        const ytext = entry.doc.getText('markdown');

        if (ytext.length === 0) {
          ytext.insert(0, resolvedBody);
        }

        updateImportedNoteSearchIndex(note);

        noteCount++;
      } else skipped++;
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
  if (!(zipCount && !noteCount && !bundleCount)) toast('Imported ' + (parts.join(', ') || 'nothing'), failed ? 'error' : 'success');
}

export async function importFiles(files) { return importItems(files.map((f) => ({ file: f, pathArr: [] }))); }

// ----------------- ZIP read / write (STORED + DEFLATE) -----------
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c; }
  return t;
})();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC32_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const _enc = new TextEncoder();
const _dec = new TextDecoder();

function makeZip(entries) {
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  const chunks = []; const cd = []; let offset = 0;
  for (const e of entries) {
    const name = _enc.encode(e.path);
    const data = e.data;
    const c = crc32(data);
    const lfh = new Uint8Array(30 + name.length);
    const dv = new DataView(lfh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true);
    dv.setUint16(8, 0, true); dv.setUint16(10, dosTime, true); dv.setUint16(12, dosDate, true);
    dv.setUint32(14, c, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
    dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true);
    lfh.set(name, 30);
    chunks.push(lfh, data);
    cd.push({ name, dataLen: data.length, crc: c, offset });
    offset += lfh.length + data.length;
  }
  const cdStart = offset;
  for (const ent of cd) {
    const h = new Uint8Array(46 + ent.name.length);
    const dv = new DataView(h.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true); dv.setUint16(10, 0, true);
    dv.setUint16(12, dosTime, true); dv.setUint16(14, dosDate, true);
    dv.setUint32(16, ent.crc, true); dv.setUint32(20, ent.dataLen, true); dv.setUint32(24, ent.dataLen, true);
    dv.setUint16(28, ent.name.length, true); dv.setUint32(42, ent.offset, true);
    h.set(ent.name, 46);
    chunks.push(h);
    offset += h.length;
  }
  const eocd = new Uint8Array(22);
  const dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, cd.length, true); dv.setUint16(10, cd.length, true);
  dv.setUint32(12, offset - cdStart, true); dv.setUint32(16, cdStart, true);
  chunks.push(eocd);
  return new Blob(chunks, { type: 'application/zip' });
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const chunks = []; const reader = stream.getReader();
  while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function readZip(blob) {
  const buf = await blob.arrayBuffer();
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP');
  const numEntries = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const entries = []; let p = cdOffset;
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
    const data = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : (() => { throw new Error('Unsupported method ' + method); })();
    entries.push({ path: name, data, isDir: name.endsWith('/') });
  }
  return entries;
}

export async function exportAsZip() {
  const used = new Set();
  for (const note of state.notes.values()) {
    if (isNoteInTrash(note)) continue;

    let body = ''; try { body = noteMarkdown(note.id); } catch {}
    const re = /yanta-img:\/\/([a-z0-9]+)/gi; let m;
    while ((m = re.exec(body)) !== null) used.add(m[1]);
  }
  const entries = [];
  const usedPaths = new Set();
  const pickPath = (segs, base) => {
    let p = [...segs, base].join('/');
    if (!usedPaths.has(p)) { usedPaths.add(p); return p; }
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    for (let i = 2; i < 1000; i++) {
      const np = [...segs, `${stem} (${i})${ext}`].join('/');
      if (!usedPaths.has(np)) { usedPaths.add(np); return np; }
    }
    return p;
  };
  for (const note of state.notes.values()) {
    if (isNoteInTrash(note)) continue;
    const segs = folderPathSegments(note.folderId);
    const fname = `${safeFilename(note.title)}__${note.id.slice(0, 8)}.md`;
    const path = pickPath(segs, fname);
    let body = ''; try { body = noteMarkdown(note.id); } catch {}
    body = body.replace(/yanta-img:\/\/([a-z0-9]+)/gi, (full, id) => {
      const meta = state.imagesMeta.get(id);
      if (!meta) return full;
      return (segs.length ? '../'.repeat(segs.length) : '') + '_images/' + id + '.' + imageExt(meta);
    });
    entries.push({ path, data: _enc.encode(noteToFrontmatter(note) + body) });
  }
  for (const id of used) {
    const rec = await store.images.get(id);
    if (!rec || !rec.blob) continue;
    const meta = state.imagesMeta.get(id) || { type: rec.type };
    entries.push({ path: '_images/' + id + '.' + imageExt(meta), data: new Uint8Array(await rec.blob.arrayBuffer()) });
  }
  let totalCitationCount = 0;

  for (const note of state.notes.values()) {
    if (isNoteInTrash(note)) continue;
    const citations = listCitationsForNote(note.id);

    if (!citations.length) continue;

    totalCitationCount += citations.length;

    const csl = citations
      .map((c) => c.csl)
      .filter(Boolean);

    if (!csl.length) continue;

    entries.push({
      path: `citations/${note.id}.csl.json`,
      data: _enc.encode(JSON.stringify(csl, null, 2)),
    });
  }
  for (const note of state.notes.values()) {
    if (isNoteInTrash(note)) continue;
    for (const d of listDrawingsForNote(note.id)) {
      const json = {
        type: 'excalidraw',
        version: 2,
        source: 'https://yanta.local/draw',
        elements: d.elements || [],
        appState: d.appState || {},
        files: d.files || {},

        // YANTA extension: persisted visual canvas/container size.
        yanta: {
          canvas: d.canvas || { width: 760, height: 420 },
          title: d.title || 'Drawing',
        },
      };

      entries.push({
        path: `drawings/${note.id}/${d.id}.excalidraw`,
        data: _enc.encode(JSON.stringify(json, null, 2)),
      });
    }
  }
  try {
    const { exportCalendarZipEntries } = await import('./calendar.js');

    for (const entry of exportCalendarZipEntries(_enc)) {
      entries.push(entry);
    }
  } catch (err) {
    console.warn('Calendar ZIP export skipped', err);
  }

  const manifest = {
    yanta: 2,
    exported: new Date().toISOString(),
    counts: {
      notes: [...state.notes.values()].filter((n) => !isNoteInTrash(n)).length,
      trashNotesExcluded: [...state.notes.values()].filter(isNoteInTrash).length,
      folders: [...state.folders.values()].filter((folder) => !isFolderInTrash(folder)).length,
      images: used.size,
      citations: totalCitationCount || 0,
      calendarEvents: state.calendarEvents?.size || 0,
      calendarCategories: state.calendarCategories?.size || 0,
    },
  };
  entries.push({ path: '_yanta-manifest.json', data: _enc.encode(JSON.stringify(manifest, null, 2)) });
  downloadBlob(makeZip(entries), `yanta-${new Date().toISOString().slice(0, 10)}.zip`);
  toast(`Exported ${entries.length} files`, 'success');
}

const _imageExtToMime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', bin: 'application/octet-stream' };

export async function importZipBlob(blob) {
  let entries;

  try {
    entries = await readZip(blob);
  } catch (e) {
    toast('ZIP read failed: ' + e.message, 'error');
    return;
  }

  _folderCache.clear();

  const remap = new Map();       // image old id -> new id
  const noteIdMap = new Map();   // exported note id -> imported note id

  // 1. Import images first.
  for (const ent of entries) {
    if (ent.isDir || !ent.path.startsWith('_images/')) continue;

    const fname = ent.path.slice('_images/'.length);
    const dot = fname.lastIndexOf('.');
    const origId = dot > 0 ? fname.slice(0, dot) : fname;
    const ext = (dot > 0 ? fname.slice(dot + 1) : 'bin').toLowerCase();
    const mime = _imageExtToMime[ext] || 'application/octet-stream';

    const blob2 = new Blob([ent.data], {
      type: mime,
    });

    const newId = state.imagesMeta.has(origId) ? uid() : origId;

    const meta = {
      id: newId,
      name: fname,
      size: blob2.size,
      type: mime,
      ts: Date.now(),
    };

    await store.images.put({
      ...meta,
      blob: blob2,
    });

    state.imagesMeta.set(newId, meta);
    remap.set(origId, newId);
  }

  // 2. Import Markdown notes before drawings.
  let noteCount = 0;

  const noteEntries = entries.filter((ent) =>
    !ent.isDir &&
    !ent.path.startsWith('_images/') &&
    !ent.path.startsWith('_yanta-') &&
    !ent.path.startsWith('drawings/') &&
    !ent.path.startsWith('citations/') &&
    /\.(md|markdown|txt)$/i.test(ent.path)
  );

  for (const ent of noteEntries) {
    const parts = ent.path.split('/');
    const fname = parts.pop();
    const folderId = await ensureFolderPath(parts);

    const text = _dec.decode(ent.data);
    const { meta, body: raw } = parseFrontmatter(text);

    const body = raw.replace(
      /(?:\.\.\/)*_images\/([a-z0-9]+)(?:\.[a-z0-9]+)?/gi,
      (_full, id) => 'yanta-img://' + (remap.get(id) || id)
    );

    const title = fname
      .replace(/\.(md|markdown|txt)$/i, '')
      .replace(/__[a-z0-9]{8}$/i, '');

    const exportedId = meta.id || '';
    const importedId =
      exportedId && !state.notes.has(exportedId)
        ? exportedId
        : uid();

    if (exportedId) {
      noteIdMap.set(exportedId, importedId);
    }

    const note = {
      id: importedId,
      title,
      type: meta.type || 'markdown',
      folderId,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      pinned: !!meta.pinned,
      icon: meta.icon || undefined,
      color: meta.color || undefined,
      created: meta.created
        ? Date.parse(meta.created) || Date.now()
        : Date.now(),
      updated: meta.updated
        ? Date.parse(meta.updated) || Date.now()
        : Date.now(),
    };

    applyNoteMetaFromFrontmatter(note, meta);

    state.notes.set(importedId, note);
    await store.notes.put(note);

    const entry = getNoteDoc(importedId);
    await entry.ready;

    const ytext = entry.doc.getText('markdown');

    if (ytext.length === 0) {
      ytext.insert(0, body);
    }

    updateImportedNoteSearchIndex(note);

    noteCount++;
  }

  // 3. Import drawings after notes and map exported note IDs.
  const drawingEntries = entries.filter((ent) =>
    !ent.isDir &&
    /^drawings\/[^/]+\/[^/]+\.excalidraw(\.json)?$/i.test(ent.path)
  );

  let drawingCount = 0;

  for (const ent of drawingEntries) {
    try {
      const parts = ent.path.split('/');
      const exportedNoteId = parts[1];
      const fileName = parts[2];

      const targetNoteId =
        noteIdMap.get(exportedNoteId) ||
        (state.notes.has(exportedNoteId) ? exportedNoteId : '');

      if (!targetNoteId || !state.notes.has(targetNoteId)) {
        continue;
      }

      const drawingId = fileName.replace(/\.excalidraw(\.json)?$/i, '');
      const data = JSON.parse(_dec.decode(ent.data));
      const scene = normalizeDrawingScene(data);

      setDrawing(targetNoteId, drawingId, {
        id: drawingId,
        title: data?.yanta?.title || drawingId,
        ...scene,
      }, 'draw-zip-import');

      const entry = getNoteDoc(targetNoteId);
      await entry.ready;

      const ytext = entry.doc.getText('markdown');
      const md = ytext.toString();

      if (!md.includes(`draw://${drawingId}`)) {
        ytext.insert(ytext.length, `\n\ndraw://${drawingId}\n`);
      }

      drawingCount++;
    } catch (e) {
      console.warn('Drawing ZIP import failed', ent.path, e);
    }
  }

  rebuildWikilinkIndex();
  renderTree();

  toast(
    `Imported ${noteCount} note${noteCount === 1 ? '' : 's'}` +
      (drawingCount ? ` + ${drawingCount} drawing${drawingCount === 1 ? '' : 's'}` : '') +
      (remap.size ? ` + ${remap.size} image${remap.size === 1 ? '' : 's'}` : '') +
      ' from ZIP',
    'success'
  );
}

export async function walkEntry(entry, pathArr = []) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    return [{ file, pathArr }];
  }
  const childPath = [...pathArr, entry.name];
  const reader = entry.createReader();
  const all = [];
  while (true) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    for (const e of batch) all.push(...(await walkEntry(e, childPath)));
  }
  return all;
}

export function openExportMenu(anchorBtn, showMenuFn) {
  const r = anchorBtn.getBoundingClientRect();
  const note = state.currentNoteId ? state.notes.get(state.currentNoteId) : null;

  showMenuFn(r.left, r.bottom + 4, [
    {
      label: 'Back up YANTA (.yanta, encrypted)',
      action: async () => {
        const { exportSyncCapsule } = await import('./sync2/capsule.js');
        await exportSyncCapsule();
      },
    },
    {
      label: 'Save sync key…',
      action: async () => {
        const { copySyncCapsuleRecoveryKey } = await import('./sync2/capsule.js');
        await copySyncCapsuleRecoveryKey();
      },
    },
    'hr',
    { label: 'Export readable folder ZIP (.zip)', action: exportAsZip },
    'hr',
    { label: 'Export current note (.md)', action: () => note && exportNoteAsMd(note) },
    { label: 'Export every note as .md files', action: exportEveryNoteMd },
    { label: 'Export legacy full bundle (.json + base64 images)', action: exportBundle },
  ]);
}