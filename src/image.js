// ============================================================
// YANTA — Image insertion modal, compression preview, library.
// Stores image blobs in IndexedDB, refs notes as ![alt](yanta-img://<id>).
// ============================================================

import { $, el, uid, state, store, toast, fmtBytes, lucide } from './core.js';
import { insertAtCursor } from './editor.js';
import { updateStorageMeter } from './core.js';

let imgModal, compressPanel;
let imgWorkingBlob = null;
let imgCompressedBlob = null;
let imgCompressedDataUrl = null;

export function setupImage() {
  imgModal = $('imageModal');
  compressPanel = $('compressPanel');
  imgModal.addEventListener('click', (e) => {
    if (e.target === imgModal) closeImageModal();
    if (e.target.matches('[data-close]')) closeImageModal();
    if (e.target.matches('.tab')) setTab(e.target.dataset.tab);
  });
  $('pickFile').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => { if (e.target.files[0]) pickImageFile(e.target.files[0]); });
  const dz = $('dropZone');
  dz.addEventListener('dragenter', () => dz.classList.add('over'));
  dz.addEventListener('dragleave', (e) => { if (e.target === dz) dz.classList.remove('over'); });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('over');
    if (e.dataTransfer.files[0]) pickImageFile(e.dataTransfer.files[0]);
  });
  document.addEventListener('paste', (e) => {
    if (imgModal.hidden) return;
    for (const it of e.clipboardData.items) {
      if (it.type.startsWith('image/')) { pickImageFile(it.getAsFile()); break; }
    }
  });
  $('quality').addEventListener('input', recompress);
  $('maxW').addEventListener('input', recompress);
  $('fmt').addEventListener('change', recompress);
  $('asBase64').addEventListener('change', (e) => { if (e.target.checked) $('asReference').checked = false; updateBase64Warning(imgCompressedBlob?.size || 0); });
  $('asReference').addEventListener('change', (e) => { if (e.target.checked) $('asBase64').checked = false; updateBase64Warning(imgCompressedBlob?.size || 0); });
  $('insertImage').addEventListener('click', insertCompressedImage);
  $('insertPath').addEventListener('click', () => {
    const path = $('pathInput').value.trim();
    if (!path) return;
    const alt = $('pathAlt').value.trim() || 'image';
    insertAtCursor(`\n![${alt}](${path})\n`);
    $('pathInput').value = ''; $('pathAlt').value = '';
    closeImageModal();
  });
}

export function openImageModal() {
  imgModal.hidden = false;
  setTab('upload');
  imgWorkingBlob = null;
  imgCompressedBlob = null;
  compressPanel.hidden = true;
}
export function closeImageModal() { imgModal.hidden = true; }

function setTab(name) {
  for (const b of imgModal.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === name);
  for (const p of imgModal.querySelectorAll('.tab-pane')) p.hidden = p.dataset.pane !== name;
  if (name === 'library') renderLibrary();
}

// Drop-in helper: take a raw image File, compress it lightly and
// insert as a library reference at the current cursor position.
// Used by drag-drop directly onto the editor (no modal).
export async function insertImageAsRef(file) {
  if (!file || !file.type.startsWith('image/')) return;
  let blob = file;
  let dims = { w: 0, h: 0 };
  if (file.type !== 'image/svg+xml') {
    try {
      const bmp = await createImageBitmap(file);
      const ratio = Math.min(1, 1600 / bmp.width);
      const w = Math.round(bmp.width * ratio);
      const h = Math.round(bmp.height * ratio);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.85));
      dims = { w, h };
    } catch { blob = file; }
  }
  const id = uid();
  const meta = { id, name: file.name || (id + '.img'), size: blob.size, type: blob.type, ts: Date.now() };
  await store.images.put({ ...meta, blob });
  state.imagesMeta.set(id, meta);
  state.imageBlobs.set(id, URL.createObjectURL(blob));
  const altBase = (file.name || 'image').replace(/\.[^.]+$/, '');
  insertAtCursor(`\n![${altBase}](yanta-img://${id})\n`);
  updateStorageMeter();
  toast('Image inserted', 'success');
}

export async function pickImageFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('Not an image', 'error'); return; }
  imgWorkingBlob = file;
  compressPanel.hidden = false;
  if (file.type === 'image/png' || file.type === 'image/svg+xml') $('fmt').value = 'image/png';
  else $('fmt').value = 'image/webp';
  await recompress();
}

async function recompress() {
  if (!imgWorkingBlob) return;
  const fmt = $('fmt').value;
  const q = parseFloat($('quality').value);
  const maxW = parseInt($('maxW').value, 10);
  $('qualVal').textContent = q.toFixed(2);
  $('mwVal').textContent = maxW + ' px';

  if (imgWorkingBlob.type === 'image/svg+xml') {
    imgCompressedBlob = imgWorkingBlob;
    imgCompressedDataUrl = await blobToDataURL(imgWorkingBlob);
    $('imgPreview').src = imgCompressedDataUrl;
    $('imgMeta').innerHTML = `<span>SVG (kept as-is)</span><strong>${fmtBytes(imgWorkingBlob.size)}</strong>`;
    return;
  }
  const bmp = await createImageBitmap(imgWorkingBlob);
  const ratio = Math.min(1, maxW / bmp.width);
  const w = Math.round(bmp.width * ratio);
  const h = Math.round(bmp.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((res) => canvas.toBlob(res, fmt, fmt === 'image/png' ? undefined : q));
  imgCompressedBlob = blob;
  imgCompressedDataUrl = await blobToDataURL(blob);
  $('imgPreview').src = imgCompressedDataUrl;
  const orig = imgWorkingBlob.size, out = blob.size;
  const pct = orig ? (100 * (orig - out) / orig) : 0;
  const cls = pct >= 0 ? 'delta-good' : 'delta-bad';
  $('imgMeta').innerHTML =
    `<span>${bmp.width}×${bmp.height} → <strong>${w}×${h}</strong></span>
     <span>${fmtBytes(orig)} → <strong>${fmtBytes(out)}</strong></span>
     <span class="${cls}">${pct >= 0 ? '−' : '+'}${Math.abs(pct).toFixed(1)}%</span>`;
  updateBase64Warning(out);
}

function updateBase64Warning(size) {
  const w = $('base64Warning'); if (!w) return;
  if (!$('asBase64').checked) { w.hidden = true; return; }
  if (size > 200 * 1024) {
    w.hidden = false;
    w.textContent = `Embedding ${fmtBytes(size)} as Base64 will bloat your .md file. Library reference recommended.`;
  } else w.hidden = true;
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}

async function insertCompressedImage() {
  if (!imgCompressedBlob) { toast('Pick an image first', 'error'); return; }
  const asRef = $('asReference').checked;
  const asBase64 = $('asBase64').checked;
  let md;
  if (asRef) {
    const id = uid();
    const meta = { id, name: imgWorkingBlob.name || (id + '.img'), size: imgCompressedBlob.size, type: imgCompressedBlob.type, ts: Date.now() };
    await store.images.put({ ...meta, blob: imgCompressedBlob });
    state.imagesMeta.set(id, meta);
    state.imageBlobs.set(id, URL.createObjectURL(imgCompressedBlob));
    md = `![${imgWorkingBlob.name?.replace(/\.[^.]+$/, '') || 'image'}](yanta-img://${id})`;
  } else if (asBase64) {
    md = `![${imgWorkingBlob.name?.replace(/\.[^.]+$/, '') || 'image'}](${imgCompressedDataUrl})`;
  } else { toast('Pick a save mode', 'error'); return; }
  insertAtCursor('\n' + md + '\n');
  closeImageModal();
  updateStorageMeter();
  toast('Image inserted', 'success');
}

function renderLibrary() {
  const g = $('libraryGrid');
  g.replaceChildren();
  const items = [...state.imagesMeta.values()].sort((a, b) => b.ts - a.ts);
  if (!items.length) {
    g.append(el('div', { class: 'tree-empty' }, 'No images in library yet.'));
    return;
  }
  for (const meta of items) {
    let url = state.imageBlobs.get(meta.id);
    if (!url) {
      store.images.get(meta.id).then((rec) => {
        if (rec && rec.blob) { state.imageBlobs.set(meta.id, URL.createObjectURL(rec.blob)); renderLibrary(); }
      });
    }
    const card = el('div', { class: 'lib-card', onclick: () => {
      insertAtCursor(`\n![${meta.name || 'image'}](yanta-img://${meta.id})\n`);
      closeImageModal();
    } });
    if (url) card.append(el('img', { src: url, alt: meta.name }));
    card.append(el('div', { class: 'lib-meta' }, fmtBytes(meta.size)));
    g.append(card);
  }
}

export async function cleanupUnusedImages() {
  const used = new Set();
  const { noteMarkdown } = await import('./yjs.js');
  for (const n of state.notes.values()) {
    let body = '';
    try { body = noteMarkdown(n.id); } catch {}
    const re = /yanta-img:\/\/([a-z0-9]+)/gi;
    let m;
    while ((m = re.exec(body)) !== null) used.add(m[1]);
  }
  const unused = [...state.imagesMeta.values()].filter((meta) => !used.has(meta.id));
  if (!unused.length) { toast('No unused images', 'success'); return; }
  const total = unused.reduce((s, m) => s + (m.size || 0), 0);
  if (!confirm(`Delete ${unused.length} unused image(s) (${fmtBytes(total)})?`)) return;
  for (const meta of unused) {
    await store.images.del(meta.id);
    state.imagesMeta.delete(meta.id);
    if (state.imageBlobs.has(meta.id)) { URL.revokeObjectURL(state.imageBlobs.get(meta.id)); state.imageBlobs.delete(meta.id); }
  }
  toast(`Cleaned up ${unused.length} image(s)`, 'success');
}
