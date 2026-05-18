/* ============================================================
   YANTA — editor: tokenization, DOM render, cursor, undo,
   hot input path, line-height sync, scroll sync.
   ============================================================ */
'use strict';

/* ----------------------------------------------------------------
   editor — contenteditable; one div per line; tokenized formatting
   Cursor preserved by char-offset within current line.
---------------------------------------------------------------- */
const editor = $('editor');

function tokenizeLine(line, info) {
  // Returns array of {text, cls} or {trunc, full}
  if (info.type === 'code' || info.type === 'fence') {
    return [{ text: line, cls: '' }];
  }
  const tokens = [];
  let s = line;
  // strip leading markers for headings/quotes/lists but keep visible
  // Approach: walk through inline patterns and split
  // We handle inline tokens, but keep markers (** ** etc) visible.
  const inlineRegex = /(`[^`\n]+`)|(\[\[[^\]\n]+\]\])|(!\[[^\]]*\]\([^)]+\))|(\[[^\]]+\]\([^)]+\))|(\*\*\*[^*\n]+\*\*\*)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~\n]+~~)|(\s#[a-zA-Z][\w-]*)/g;
  let last = 0; let m;
  while ((m = inlineRegex.exec(s)) !== null) {
    if (m.index > last) tokens.push({ text: s.slice(last, m.index) });
    const tok = m[0];
    if (m[1]) tokens.push({ text: tok, cls: 'ed-code' });
    else if (m[2]) {
      // wikilink [[Target]] or [[Target|alias]]
      const inner = tok.slice(2, -2);
      const pipeIdx = inner.indexOf('|');
      tokens.push({ text: '[[', cls: 'ed-mark' });
      if (pipeIdx >= 0) {
        const target = inner.slice(0, pipeIdx);
        const alias = inner.slice(pipeIdx + 1);
        const exists = wikilinkIndex.has(target.trim().toLowerCase());
        tokens.push({ text: target, cls: exists ? 'ed-wiki' : 'ed-wiki-missing' });
        tokens.push({ text: '|', cls: 'ed-mark' });
        tokens.push({ text: alias, cls: exists ? 'ed-wiki' : 'ed-wiki-missing' });
      } else {
        const exists = wikilinkIndex.has(inner.trim().toLowerCase());
        tokens.push({ text: inner, cls: exists ? 'ed-wiki' : 'ed-wiki-missing' });
      }
      tokens.push({ text: ']]', cls: 'ed-mark' });
    }
    else if (m[3]) tokens.push(...tokenizeImage(tok));
    else if (m[4]) {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      tokens.push({ text: '[', cls: 'ed-mark' });
      tokens.push({ text: lm[1], cls: 'ed-link' });
      tokens.push({ text: '](', cls: 'ed-mark' });
      tokens.push({ text: lm[2], cls: 'ed-url' });
      tokens.push({ text: ')', cls: 'ed-mark' });
    } else if (m[5]) {
      tokens.push({ text: '***', cls: 'ed-mark' });
      tokens.push({ text: tok.slice(3, -3), cls: 'ed-bold ed-italic' });
      tokens.push({ text: '***', cls: 'ed-mark' });
    } else if (m[6] || m[7]) {
      const mk = tok.slice(0, 2);
      tokens.push({ text: mk, cls: 'ed-mark' });
      tokens.push({ text: tok.slice(2, -2), cls: 'ed-bold' });
      tokens.push({ text: mk, cls: 'ed-mark' });
    } else if (m[8] || m[9]) {
      const mk = tok[0];
      tokens.push({ text: mk, cls: 'ed-mark' });
      tokens.push({ text: tok.slice(1, -1), cls: 'ed-italic' });
      tokens.push({ text: mk, cls: 'ed-mark' });
    } else if (m[10]) {
      tokens.push({ text: '~~', cls: 'ed-mark' });
      tokens.push({ text: tok.slice(2, -2), cls: 'ed-strike' });
      tokens.push({ text: '~~', cls: 'ed-mark' });
    } else if (m[11]) {
      tokens.push({ text: tok, cls: 'ed-tag-ref' });
    }
    last = m.index + tok.length;
  }
  if (last < s.length) tokens.push({ text: s.slice(last) });
  return tokens;
}

function tokenizeImage(tok) {
  // ![alt](url) — if url is base64 long, render as truncated chip
  const m = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(tok);
  if (!m) return [{ text: tok }];
  const alt = m[1], url = m[2];
  const out = [
    { text: '![', cls: 'ed-mark' },
    { text: alt, cls: 'ed-img-tag' },
    { text: '](', cls: 'ed-mark' },
  ];
  if (/^data:image\/[\w+]+;base64,/.test(url) && url.length > 80) {
    const head = url.slice(0, url.indexOf(',') + 1);
    out.push({ text: head, cls: 'ed-url' });
    out.push({ trunc: true, full: url.slice(head.length), label: `base64 · ${fmtBytes(url.length * 0.75)}` });
  } else if (url.startsWith('yanta-img://')) {
    out.push({ text: url, cls: 'ed-img-tag' });
  } else {
    out.push({ text: url, cls: 'ed-url' });
  }
  out.push({ text: ')', cls: 'ed-mark' });
  return out;
}

// Render the entire editor from a markdown string
function renderEditor(md, opts = {}) {
  const lines = md.split('\n');
  const ctx = { inFence: false };
  const frag = document.createDocumentFragment();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const info = classifyLine(line, ctx);
    if (info.type === 'fence') {
      if (info.opens) ctx.inFence = true;
      else if (info.closes) ctx.inFence = false;
    }
    const lineDiv = el('div', { class: 'ed-line', dataset: { line: String(i), type: info.type } });
    // Image lines: render the actual image FIRST (so it sits at the top
    // of the line, aligned with the preview's image), then the source
    // markdown beneath as a small caption.
    let imageEl = null;
    if (info.type === 'image') {
      const m = /!\[([^\]]*)\]\(([^)]+)\)/.exec(line);
      if (m) {
        const resolved = resolveImageUrl(m[2]);
        if (resolved !== null) {
          imageEl = document.createElement('img');
          imageEl.className = 'ed-img-thumb';
          imageEl.src = resolved;
          imageEl.alt = m[1];
          imageEl.contentEditable = 'false';
          imageEl.draggable = false;
          lineDiv.append(imageEl);
        }
      }
    }
    const tokens = tokenizeLine(line, info);
    if (tokens.length === 0 || line === '') {
      lineDiv.append(document.createElement('br'));
    } else {
      // Group source tokens inside a small "caption" span on image lines
      const host = imageEl ? el('span', { class: 'ed-img-caption' }) : lineDiv;
      for (const t of tokens) {
        if (t.trunc) {
          const span = el('span', { class: 'ed-trunc', dataset: { full: t.full } }, t.label);
          span.contentEditable = 'false';
          host.append(span);
        } else {
          const sp = el('span', t.cls ? { class: t.cls } : {}, t.text);
          host.append(sp);
        }
      }
      if (imageEl) lineDiv.append(host);
    }
    frag.append(lineDiv);
  }
  editor.replaceChildren(frag);
}

// Read markdown back from editor DOM. Each top-level block child of the
// editor is exactly one source line; BRs and images inside a block are
// treated as layout / non-source (they don't create new source lines).
function readEditorMarkdown() {
  const lines = [];
  const isBlock = (n) => n.nodeName && ['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE'].includes(n.nodeName);
  function readInline(n) {
    let s = '';
    function w(x) {
      if (x.nodeType === 3) { s += x.nodeValue; return; }
      if (x.nodeName === 'BR' || x.nodeName === 'IMG') return;
      if (x.classList && x.classList.contains('ed-trunc')) { s += x.dataset.full; return; }
      for (const c of x.childNodes) w(c);
    }
    w(n);
    return s;
  }
  let pending = '';
  for (const child of editor.childNodes) {
    if (child.nodeType === 3) {
      pending += child.nodeValue;
    } else if (child.nodeName === 'BR') {
      lines.push(pending); pending = '';
    } else if (isBlock(child)) {
      if (pending.length > 0) { lines.push(pending); pending = ''; }
      lines.push(readInline(child));
    } else {
      pending += readInline(child);
    }
  }
  if (pending.length > 0) lines.push(pending);
  return lines.join('\n');
}

/* ----------------------------------------------------------------
   cursor — save/restore by (lineIndex, charOffset)
   Uses sibling index (not data-line attr) so it works even when the
   DOM is in a transient state between lazy re-renders.
---------------------------------------------------------------- */
function getCursorPos() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  let node = range.startContainer;
  // Climb to the direct child of editor
  let line = node;
  while (line && line.parentNode !== editor) line = line.parentNode;
  if (!line || line.parentNode !== editor) return null;
  const blocks = [...editor.children];
  const lineIndex = blocks.indexOf(line);
  if (lineIndex < 0) return null;
  let offset = 0;
  function walk(n) {
    if (n === range.startContainer) {
      if (n.nodeType === 3) offset += range.startOffset;
      else for (let i = 0; i < range.startOffset; i++) walk(n.childNodes[i]);
      return true;
    }
    if (n.classList && n.classList.contains('ed-trunc')) { offset += n.dataset.full.length; return false; }
    if (n.nodeType === 3) { offset += n.nodeValue.length; return false; }
    if (n.nodeName === 'BR' || n.nodeName === 'IMG') return false;
    for (const c of n.childNodes) if (walk(c)) return true;
    return false;
  }
  for (const c of line.childNodes) if (walk(c)) break;
  return { lineIndex, offset };
}

function setCursorPos(pos) {
  if (!pos) return;
  const blocks = [...editor.children];
  if (!blocks.length) return;
  const line = blocks[Math.min(Math.max(0, pos.lineIndex), blocks.length - 1)];
  if (!line) return;
  let remaining = pos.offset;
  const sel = window.getSelection();
  const range = document.createRange();
  function place(n) {
    if (!n) return false;
    if (n.classList && n.classList.contains('ed-trunc')) {
      const len = n.dataset.full.length;
      if (remaining <= len) { range.setStartAfter(n); range.collapse(true); return true; }
      remaining -= len; return false;
    }
    if (n.nodeType === 3) {
      if (remaining <= n.nodeValue.length) { range.setStart(n, remaining); range.collapse(true); return true; }
      remaining -= n.nodeValue.length; return false;
    }
    if (n.nodeName === 'BR' || n.nodeName === 'IMG') return false;
    for (const c of n.childNodes) if (place(c)) return true;
    return false;
  }
  let placed = false;
  for (const c of line.childNodes) if (place(c)) { placed = true; break; }
  if (!placed) { range.selectNodeContents(line); range.collapse(false); }
  sel.removeAllRanges(); sel.addRange(range);
}

/* ----------------------------------------------------------------
   Undo / redo

   Model: undoStack holds checkpoint snapshots of lastMarkdown,
   chronologically with the *current* state always on top. To undo,
   pop the top (current) onto redoStack and apply the new top.

   Two paths feed snapshots in:
     · pushUndo()       — called immediately before any structural
                          mutation (image insert/delete, paste, format).
     · pushUndoDebounced() — called from the typing input handler;
                             collapses a typing burst into one snapshot.
---------------------------------------------------------------- */
const undoStack = [];
const redoStack = [];
const UNDO_MAX = 200;
let _lastSnapshotMd = '';
let _lastSnapshotNote = null;

function resetUndo() {
  undoStack.length = 0;
  redoStack.length = 0;
  _lastSnapshotMd = lastMarkdown;
  _lastSnapshotNote = state.currentNoteId;
  // Seed with current state so first undo reverts to "empty state"
  if (state.currentNoteId) {
    undoStack.push({ id: state.currentNoteId, md: lastMarkdown });
  }
}

function _snap() {
  if (!state.currentNoteId) return;
  if (lastMarkdown === _lastSnapshotMd && state.currentNoteId === _lastSnapshotNote) return;
  // If we're snapshotting after the user moved on from a redo state,
  // drop the redo stack — the redo timeline has diverged.
  redoStack.length = 0;
  undoStack.push({ id: state.currentNoteId, md: lastMarkdown });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  _lastSnapshotMd = lastMarkdown;
  _lastSnapshotNote = state.currentNoteId;
}

// Force an immediate snapshot. Use before structural mutations.
function pushUndo() { _snap(); }

// Debounced (~500ms) snapshot — used from the typing path so a burst
// of keystrokes turns into a single undo step.
const pushUndoDebounced = debounce(_snap, 500);

function performUndo() {
  // Make sure the current state is captured before we step back.
  _snap();
  if (undoStack.length < 2) return false;
  const current = undoStack.pop();
  const prev = undoStack[undoStack.length - 1];
  if (prev.id !== state.currentNoteId) return false;
  redoStack.push(current);
  lastMarkdown = prev.md;
  _lastSnapshotMd = lastMarkdown;
  renderEditor(lastMarkdown);
  $('preview').innerHTML = renderPreview(lastMarkdown);
  renderOutline();
  renderBacklinks();
  syncLineHeights();
  markDirty(); scheduleSave();
  return true;
}
function performRedo() {
  if (!redoStack.length) return false;
  const next = redoStack[redoStack.length - 1];
  if (next.id !== state.currentNoteId) return false;
  redoStack.pop();
  undoStack.push(next);
  lastMarkdown = next.md;
  _lastSnapshotMd = lastMarkdown;
  renderEditor(lastMarkdown);
  $('preview').innerHTML = renderPreview(lastMarkdown);
  renderOutline();
  renderBacklinks();
  syncLineHeights();
  markDirty(); scheduleSave();
  return true;
}

/* ----------------------------------------------------------------
   editor input handling

   Hot path (each keystroke):
     - quickStyleCurrentLine: just updates the data-type attr of the
       current line (font-size / colour comes from CSS) — no DOM swap.
     - readEditorMarkdown + schedulePreview: refresh preview.
     - scheduleLazyEditorRender: full re-tokenization happens only
       after the user pauses (debounced). This is what gives us
       fast, smooth typing.
---------------------------------------------------------------- */
let lastMarkdown = '';

function readCurrentEditorLine() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let n = sel.getRangeAt(0).startContainer;
  while (n && n.parentNode !== editor) n = n.parentNode;
  if (!n || n.parentNode !== editor) return null;
  let s = '';
  function w(x) {
    if (x.nodeType === 3) { s += x.nodeValue; return; }
    if (x.nodeName === 'BR' || x.nodeName === 'IMG') return;
    if (x.classList && x.classList.contains('ed-trunc')) { s += x.dataset.full; return; }
    for (const c of x.childNodes) w(c);
  }
  w(n);
  return { line: n, text: s };
}

function quickStyleCurrentLine() {
  const cur = readCurrentEditorLine();
  if (!cur) return;
  const info = classifyLine(cur.text, { inFence: false });
  if (cur.line.dataset.type !== info.type) cur.line.dataset.type = info.type;
}

function handleEditorInput() {
  quickStyleCurrentLine();
  const md = readEditorMarkdown();
  if (md === lastMarkdown) {
    checkWikiAutocomplete();
    return;
  }
  // The previous _lastSnapshotMd hasn't been captured into the undo
  // stack yet — schedule a snapshot so the typing burst collapses into
  // one undo step.
  pushUndoDebounced();
  lastMarkdown = md;
  schedulePreview();
  scheduleLazyEditorRender();
  checkWikiAutocomplete();
  markDirty();
  scheduleSave();
  updateWordCount(md);
}

const scheduleLazyEditorRender = debounce(() => {
  const isEditing = editor.contains(document.activeElement);
  const pos = isEditing ? getCursorPos() : null;
  renderEditor(lastMarkdown);
  if (pos) setCursorPos(pos);
  syncLineHeights();
}, 450);

// Always renders the *current* lastMarkdown — avoids stale renders after
// switching notes (previously the debounced callback captured the old body).
const schedulePreview = debounce(() => {
  $('preview').innerHTML = renderPreview(lastMarkdown);
  if (typeof renderOutline === 'function') renderOutline();
  if (typeof renderBacklinks === 'function') renderBacklinks();
  syncLineHeights();
}, 100);

function renderPreviewSoon() { schedulePreview(); }

const scheduleSave = debounce(() => saveCurrentNote(), 700);

function markDirty() {
  state.dirty = true;
  const e = $('statSaved');
  e.textContent = 'Saving…';
  e.className = 'dirty';
}
function markSaved() {
  state.dirty = false;
  const e = $('statSaved');
  e.textContent = 'Saved · ' + fmtDate(Date.now());
  e.className = 'saved';
}

function updateWordCount(md) {
  const text = md.replace(/```[\s\S]*?```/g, '').replace(/[#*_>`-]/g, '').trim();
  const words = text ? text.split(/\s+/).length : 0;
  $('statWords').textContent = words + ' word' + (words === 1 ? '' : 's');
  $('statChars').textContent = md.length + ' char' + (md.length === 1 ? '' : 's');
}

/* Pair each editor line with its preview line so y-positions match. */
function syncLineHeights() {
  const edLines = editor.querySelectorAll('.ed-line');
  const pvLines = $('preview').querySelectorAll('.pv-line');
  const n = Math.min(edLines.length, pvLines.length);
  // first pass: clear forced heights
  for (let i = 0; i < n; i++) {
    edLines[i].style.minHeight = '';
    pvLines[i].style.minHeight = '';
  }
  // measure after reflow
  requestAnimationFrame(() => {
    for (let i = 0; i < n; i++) {
      const eh = edLines[i].offsetHeight;
      const ph = pvLines[i].offsetHeight;
      const h = Math.max(eh, ph);
      if (eh !== h) edLines[i].style.minHeight = h + 'px';
      if (ph !== h) pvLines[i].style.minHeight = h + 'px';
    }
  });
}

/* Synchronized scrolling */
let scrollSyncing = false;
function syncScroll(source, target) {
  if (scrollSyncing) return;
  scrollSyncing = true;
  const max = source.scrollHeight - source.clientHeight;
  const ratio = max > 0 ? source.scrollTop / max : 0;
  const tmax = target.scrollHeight - target.clientHeight;
  target.scrollTop = ratio * tmax;
  requestAnimationFrame(() => { scrollSyncing = false; });
}

/* ----------------------------------------------------------------
   editor key handlers (Enter/Tab/Backspace), paste, click, focus
---------------------------------------------------------------- */
function handleEditorKey(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i')) {
    e.preventDefault();
    applyFormat(e.key === 'b' ? 'bold' : 'italic');
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    insertAtCursor('  ');
    return;
  }
  // Backspace/Delete on an image line deletes the whole image line
  // atomically — otherwise the user is left with the huge Base64 source.
  if (e.key === 'Backspace' || e.key === 'Delete') {
    const pos = getCursorPos();
    if (pos) {
      const blocks = [...editor.children];
      const lineDiv = blocks[pos.lineIndex];
      if (lineDiv && lineDiv.dataset.type === 'image') {
        e.preventDefault();
        const lines = lastMarkdown.split('\n');
        lines.splice(pos.lineIndex, 1);
        lastMarkdown = lines.join('\n');
        pushUndo();
        renderEditor(lastMarkdown);
        const newIdx = Math.min(pos.lineIndex, lastMarkdown.split('\n').length - 1);
        const endOff = (lastMarkdown.split('\n')[newIdx] || '').length;
        setCursorPos({ lineIndex: newIdx, offset: e.key === 'Backspace' ? endOff : 0 });
        schedulePreview();
        markDirty(); scheduleSave();
        return;
      }
    }
  }
  if (e.key !== 'Enter') return;
  // Always intercept Enter so our line-per-div structure stays intact
  e.preventDefault();
  const pos = getCursorPos();
  if (!pos) { insertAtCursor('\n'); return; }
  const lines = lastMarkdown.split('\n');
  const line = lines[pos.lineIndex] || '';
  let prefix = '';
  let m;
  if ((m = /^(\s*)([-*+])\s+\[[ xX]\]\s*(.*)$/.exec(line))) {
    if (m[3] === '' && pos.offset === line.length) { replaceCurrentLine(''); return; }
    prefix = m[1] + m[2] + ' [ ] ';
  } else if ((m = /^(\s*)([-*+])\s+(.*)$/.exec(line))) {
    if (m[3] === '' && pos.offset === line.length) { replaceCurrentLine(''); return; }
    prefix = m[1] + m[2] + ' ';
  } else if ((m = /^(\s*)(\d+)\.\s+(.*)$/.exec(line))) {
    if (m[3] === '' && pos.offset === line.length) { replaceCurrentLine(''); return; }
    prefix = m[1] + (parseInt(m[2], 10) + 1) + '. ';
  } else if (/^\s*>/.test(line)) {
    const im = /^(\s*>\s*)/.exec(line);
    prefix = im[1];
  }
  insertAtCursor('\n' + prefix);
}

function replaceCurrentLine(text) {
  const pos = getCursorPos();
  if (!pos) return;
  const lines = lastMarkdown.split('\n');
  lines[pos.lineIndex] = text;
  lastMarkdown = lines.join('\n');
  renderEditor(lastMarkdown);
  // move cursor to end of replaced line
  setCursorPos({ lineIndex: pos.lineIndex, offset: text.length });
  schedulePreview();
  markDirty();
  scheduleSave();
}

async function handleEditorPaste(e) {
  // images?
  const items = e.clipboardData?.items || [];
  for (const it of items) {
    if (it.type.startsWith('image/')) {
      e.preventDefault();
      const file = it.getAsFile();
      // Open modal pre-loaded with the pasted image
      openImageModal();
      setTab('upload');
      await pickImageFile(file);
      return;
    }
  }
  // Plain text paste — normalize line endings
  const text = e.clipboardData.getData('text/plain');
  if (text) {
    e.preventDefault();
    insertAtCursor(text.replace(/\r\n/g, '\n'));
  }
}

function focusEditorEnd() {
  editor.focus();
  const lines = editor.querySelectorAll('.ed-line');
  if (!lines.length) return;
  const last = lines[lines.length - 1];
  const range = document.createRange();
  // Place before any contenteditable=false children at the end (e.g., image thumbs)
  let placed = false;
  for (let i = last.childNodes.length - 1; i >= 0; i--) {
    const n = last.childNodes[i];
    if (n.nodeName === 'IMG' || (n.contentEditable === 'false')) continue;
    if (n.nodeType === 3) {
      range.setStart(n, n.nodeValue.length);
      placed = true; break;
    }
    range.selectNodeContents(n);
    range.collapse(false);
    placed = true; break;
  }
  if (!placed) { range.selectNodeContents(last); range.collapse(false); }
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  last.scrollIntoView({ block: 'nearest' });
}

function handleEditorClick(e) {
  // Clicking the inline image thumbnail opens an action menu
  const thumb = e.target.closest('.ed-img-thumb');
  if (thumb) {
    e.preventDefault();
    const lineDiv = thumb.closest('.ed-line');
    const idx = parseInt(lineDiv.dataset.line, 10);
    showMenu(e.clientX, e.clientY, [
      { label: 'Open in new tab', action: () => window.open(thumb.src, '_blank') },
      { label: 'Copy markdown', action: () => {
        navigator.clipboard?.writeText(lastMarkdown.split('\n')[idx] || '');
        toast('Markdown copied');
      } },
      'hr',
      { label: 'Remove image', danger: true, action: () => {
        const lines = lastMarkdown.split('\n');
        lines[idx] = lines[idx].replace(/!\[[^\]]*\]\([^)]+\)/, '');
        lastMarkdown = lines.join('\n');
        renderEditor(lastMarkdown);
        schedulePreview();
        markDirty(); scheduleSave();
      } },
    ]);
  }
}

