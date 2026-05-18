/* ============================================================
   YANTA — image insertion modal, compression preview, library.
   ============================================================ */
'use strict';

/* ----------------------------------------------------------------
   image insert flow
---------------------------------------------------------------- */
const imgModal = $('imageModal');
const compressPanel = $('compressPanel');
let imgWorkingBlob = null;       // original
let imgCompressedBlob = null;    // result
let imgCompressedDataUrl = null;
let imgCompressedDims = null;

// Cursor position captured before the modal opens — restored when
// the user clicks Insert so the image lands where the caret was, not
// at the start of the document.
let _imageInsertAnchor = null;
function openImageModal() {
  _imageInsertAnchor = getCursorPos();
  imgModal.hidden = false;
  setTab('upload');
  imgWorkingBlob = null;
  imgCompressedBlob = null;
  compressPanel.hidden = true;
}
function closeImageModal() { imgModal.hidden = true; }

function setTab(name) {
  for (const b of imgModal.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === name);
  for (const p of imgModal.querySelectorAll('.tab-pane')) p.hidden = p.dataset.pane !== name;
  if (name === 'library') renderLibrary();
}

async function pickImageFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('Not an image', 'error'); return; }
  imgWorkingBlob = file;
  compressPanel.hidden = false;
  // default format hint
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

  // SVG: keep as-is, no compression
  if (imgWorkingBlob.type === 'image/svg+xml') {
    imgCompressedBlob = imgWorkingBlob;
    imgCompressedDataUrl = await blobToDataURL(imgWorkingBlob);
    imgCompressedDims = { w: 0, h: 0 };
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
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((res) => canvas.toBlob(res, fmt, fmt === 'image/png' ? undefined : q));
  imgCompressedBlob = blob;
  imgCompressedDims = { w, h };
  imgCompressedDataUrl = await blobToDataURL(blob);
  $('imgPreview').src = imgCompressedDataUrl;
  const orig = imgWorkingBlob.size;
  const out = blob.size;
  const pct = orig ? (100 * (orig - out) / orig) : 0;
  const cls = pct >= 0 ? 'delta-good' : 'delta-bad';
  $('imgMeta').innerHTML =
    `<span>${bmp.width}×${bmp.height} → <strong>${w}×${h}</strong></span>
     <span>${fmtBytes(orig)} → <strong>${fmtBytes(out)}</strong></span>
     <span class="${cls}">${pct >= 0 ? '−' : '+'}${Math.abs(pct).toFixed(1)}%</span>`;
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
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
    const u = URL.createObjectURL(imgCompressedBlob);
    state.imageBlobs.set(id, u);
    md = `![${imgWorkingBlob.name?.replace(/\.[^.]+$/, '') || 'image'}](yanta-img://${id})`;
  } else if (asBase64) {
    md = `![${imgWorkingBlob.name?.replace(/\.[^.]+$/, '') || 'image'}](${imgCompressedDataUrl})`;
  } else {
    toast('Pick a save mode (Base64 or library reference)', 'error');
    return;
  }
  // Restore the cursor to where the user was before the modal opened
  // (paste / drag-drop / Ctrl+I) so the image lands at the caret.
  if (_imageInsertAnchor) {
    editor.focus();
    setCursorPos(_imageInsertAnchor);
  }
  insertAtCursor('\n' + md + '\n');
  _imageInsertAnchor = null;
  closeImageModal();
  updateStorageMeter();
  toast('Image inserted', 'success');
}

// Returns the start/end positions of the current editor selection in
// (lineIndex, offset) form. If selection is collapsed, start === end.
function getSelectionRangePos() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!editor.contains(r.startContainer)) return null;
  const start = _posFor(r.startContainer, r.startOffset);
  const end = _posFor(r.endContainer, r.endOffset);
  if (!start || !end) return null;
  // Normalize order
  const cmp = start.lineIndex === end.lineIndex
    ? start.offset - end.offset
    : start.lineIndex - end.lineIndex;
  return cmp <= 0 ? { start, end } : { start: end, end: start };
}
function _posFor(node, offset) {
  let line = node;
  while (line && line.parentNode !== editor) line = line.parentNode;
  if (!line || line.parentNode !== editor) return null;
  const blocks = [...editor.children];
  const lineIndex = blocks.indexOf(line);
  if (lineIndex < 0) return null;
  let off = 0;
  function walk(n) {
    if (n === node) {
      if (n.nodeType === 3) off += offset;
      else for (let i = 0; i < offset; i++) walk(n.childNodes[i]);
      return true;
    }
    if (n.classList && n.classList.contains('ed-trunc')) { off += n.dataset.full.length; return false; }
    if (n.nodeType === 3) { off += n.nodeValue.length; return false; }
    if (n.nodeName === 'BR' || n.nodeName === 'IMG') return false;
    for (const c of n.childNodes) if (walk(c)) return true;
    return false;
  }
  for (const c of line.childNodes) if (walk(c)) break;
  return { lineIndex, offset: off };
}

function insertAtCursor(text) {
  editor.focus();
  let md = readEditorMarkdown();
  const inserts = text.split('\n');

  // Delete any active selection first (so paste-over-selection works).
  const selRange = getSelectionRangePos();
  let startPos;
  if (selRange && (selRange.start.lineIndex !== selRange.end.lineIndex || selRange.start.offset !== selRange.end.offset)) {
    const lines = md.split('\n');
    const startLine = lines[selRange.start.lineIndex] || '';
    const endLine = lines[selRange.end.lineIndex] || '';
    const before = startLine.slice(0, selRange.start.offset);
    const after = endLine.slice(selRange.end.offset);
    const merged = before + after;
    lines.splice(selRange.start.lineIndex, selRange.end.lineIndex - selRange.start.lineIndex + 1, merged);
    md = lines.join('\n');
    startPos = { lineIndex: selRange.start.lineIndex, offset: selRange.start.offset };
  } else {
    startPos = getCursorPos();
  }

  let newPos;
  if (!startPos) {
    md = md + text;
    const parts = md.split('\n');
    newPos = { lineIndex: parts.length - 1, offset: parts[parts.length - 1].length };
  } else {
    const lines = md.split('\n');
    const line = lines[startPos.lineIndex] || '';
    const before = line.slice(0, startPos.offset);
    const after = line.slice(startPos.offset);
    const insertedLines = (before + text + after).split('\n');
    lines.splice(startPos.lineIndex, 1, ...insertedLines);
    md = lines.join('\n');
    const newLineIndex = startPos.lineIndex + inserts.length - 1;
    const offset = inserts.length === 1
      ? startPos.offset + text.length
      : inserts[inserts.length - 1].length;
    newPos = { lineIndex: newLineIndex, offset };
  }
  lastMarkdown = md;
  pushUndo();  // snapshot the post-insert state
  renderEditor(md);
  setCursorPos(newPos);
  $('preview').innerHTML = renderPreview(md);
  renderOutline();
  renderBacklinks();
  syncLineHeights();
  markDirty();
  scheduleSave();
  updateWordCount(md);
}
