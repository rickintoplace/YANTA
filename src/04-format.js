/* ============================================================
   YANTA — read-only preview hooks + floating format toolbar.
   The toolbar appears on selection and edits the source markdown
   (not the DOM) so it works in both editor and preview panes.
   ============================================================ */
'use strict';

/* ----------------------------------------------------------------
   preview is read-only. You select text in it to format, but actual
   editing happens in the editor pane on the left. This keeps things
   simple and avoids the WYSIWYG-vs-source mismatch.
---------------------------------------------------------------- */
function setupEditablePreview() {
  // No-op kept for backward compatibility with init() wiring.
}

/* ----------------------------------------------------------------
   floating format toolbar — appears on text selection
---------------------------------------------------------------- */
function setupFormatToolbar() {
  const tb = $('formatToolbar');
  if (!tb) return;
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) { tb.hidden = true; return; }
    const range = sel.getRangeAt(0);
    const inEditor = editor.contains(range.startContainer);
    const inPreview = $('preview').contains(range.startContainer);
    if (!inEditor && !inPreview) { tb.hidden = true; return; }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) { tb.hidden = true; return; }
    tb.hidden = false;
    requestAnimationFrame(() => {
      const tw = tb.offsetWidth, th = tb.offsetHeight;
      const x = Math.max(8, Math.min(window.innerWidth - tw - 8, rect.left + rect.width / 2 - tw / 2));
      const y = Math.max(8, rect.top - th - 8);
      tb.style.left = x + 'px';
      tb.style.top = y + 'px';
    });
  });
  // Prevent losing selection when clicking the toolbar
  tb.addEventListener('mousedown', (e) => e.preventDefault());
  tb.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-fmt]');
    if (!btn) return;
    applyFormat(btn.dataset.fmt);
  });
}

// Map a selection to (lineIndex, sourceLine).
function lineIndexFromSelection() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return -1;
  let n = sel.getRangeAt(0).startContainer;
  if (n.nodeType === 3) n = n.parentNode;
  const ed = n.closest?.('.ed-line');
  if (ed) return [...editor.children].indexOf(ed);
  const pv = n.closest?.('.pv-line');
  if (pv) return parseInt(pv.dataset.line, 10);
  return -1;
}

function applyFormat(fmt) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const text = sel.toString();
  const range = sel.getRangeAt(0);
  const inEditor = editor.contains(range.startContainer);

  const wraps = { bold: '**', italic: '*', strike: '~~', code: '`' };
  if (wraps[fmt]) {
    if (!text) return;
    if (inEditor) {
      // Editor is contenteditable — insertText also triggers our input
      // handler, which updates lastMarkdown and schedules re-renders.
      document.execCommand('insertText', false, wraps[fmt] + text + wraps[fmt]);
    } else {
      // Preview is read-only: edit the source directly.
      wrapSelectionInSource(text, wraps[fmt], wraps[fmt]);
    }
    return;
  }
  if (fmt === 'link') {
    const url = prompt('URL:', 'https://');
    if (!url) return;
    const linkText = text || 'link';
    if (inEditor) {
      document.execCommand('insertText', false, `[${linkText}](${url})`);
    } else {
      wrapSelectionInSource(linkText, '[', `](${url})`);
    }
    return;
  }
  if (['h1', 'h2', 'h3', 'quote', 'ul', 'task'].includes(fmt)) applyLinePrefix(fmt);
}

// Wrap the selected text in source markdown (used when selection is in
// the read-only preview). Finds the first occurrence of `text` in the
// affected source line and surrounds it with the given markers.
function wrapSelectionInSource(text, openMark, closeMark) {
  const idx = lineIndexFromSelection();
  if (idx < 0) return;
  const lines = lastMarkdown.split('\n');
  const line = lines[idx] || '';
  const at = line.indexOf(text);
  if (at < 0) return;
  lines[idx] = line.slice(0, at) + openMark + text + closeMark + line.slice(at + text.length);
  lastMarkdown = lines.join('\n');
  pushUndo();
  renderEditor(lastMarkdown);
  $('preview').innerHTML = renderPreview(lastMarkdown);
  renderBacklinks();
  syncLineHeights();
  markDirty(); scheduleSave();
}

function applyLinePrefix(fmt) {
  const idx = lineIndexFromSelection();
  if (idx < 0) return;
  const lines = lastMarkdown.split('\n');
  let line = lines[idx] || '';
  line = line.replace(/^(\s*)(#{1,6}\s+|>\s*|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)/, '$1');
  const prefixes = { h1: '# ', h2: '## ', h3: '### ', quote: '> ', ul: '- ', task: '- [ ] ' };
  lines[idx] = (prefixes[fmt] || '') + line;
  lastMarkdown = lines.join('\n');
  pushUndo();
  renderEditor(lastMarkdown);
  $('preview').innerHTML = renderPreview(lastMarkdown);
  renderBacklinks();
  syncLineHeights();
  markDirty(); scheduleSave();
}
