/* ============================================================
   YANTA — main: init, bindEvents, hotkeys, drop overlay,
   pane divider, history navigation, view modes.
   ============================================================ */
'use strict';

async function init() {
  await openDB();
  // Ask the browser to persist our IndexedDB so it isn't evicted under
  // pressure. On Chrome/Firefox this either auto-grants (PWA/bookmarked)
  // or is silently ignored — no prompt for the user.
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    }
  } catch {}

  // Load all
  const [notes, folders, images, theme, expanded, view] = await Promise.all([
    store.notes.all(),
    store.folders.all(),
    store.images.all(),
    store.settings.get('theme', 'auto'),
    store.settings.get('expandedFolders', []),
    store.settings.get('view', 'split'),
  ]);
  for (const n of notes) state.notes.set(n.id, n);
  for (const f of folders) state.folders.set(f.id, f);
  for (const im of images) {
    const { blob, ...meta } = im;
    state.imagesMeta.set(meta.id, meta);
  }
  setTheme(theme);
  state.expandedFolders = new Set(expanded);
  setView(view);

  rebuildWikilinkIndex();
  buildCommandList();
  setupGraphInteractions();
  setupWikilinkHover();
  await vaultRestore();

  renderTree();

  // Restore from URL hash, then last opened note, then most-recent,
  // then create a welcome note if the vault is empty.
  const hashId = decodeURIComponent((window.location.hash || '').slice(1));
  const lastId = await store.settings.get('lastNoteId', null);
  let toOpen = null;
  if (hashId && state.notes.has(hashId)) toOpen = state.notes.get(hashId);
  if (!toOpen && lastId && state.notes.has(lastId)) toOpen = state.notes.get(lastId);
  if (!toOpen) toOpen = [...state.notes.values()].sort((a, b) => b.updated - a.updated)[0];
  _navSuppressPush = true;
  if (toOpen) openNote(toOpen.id);
  else createWelcomeNote();
  _navSuppressPush = false;

  // popstate: user pressed back/forward
  window.addEventListener('popstate', (e) => {
    const id = (e.state && e.state.noteId) || decodeURIComponent((window.location.hash || '').slice(1));
    if (id && state.notes.has(id) && id !== state.currentNoteId) {
      _navSuppressPush = true;
      openNote(id).finally(() => { _navSuppressPush = false; });
    }
  });

  bindEvents();
  editor.dataset.placeholder = 'Start writing in Markdown…';
}


function setView(v) {
  state.view = v;
  document.getElementById('app').dataset.view = v;
  $('btn-view-edit').classList.toggle('active', v === 'edit');
  $('btn-view-split').classList.toggle('active', v === 'split');
  $('btn-view-preview').classList.toggle('active', v === 'preview');
  store.settings.set('view', v);
  if (v !== 'edit') syncLineHeights();
}

function bindEvents() {
  // editor input
  editor.addEventListener('input', handleEditorInput);
  editor.addEventListener('keydown', handleEditorKey);
  editor.addEventListener('paste', handleEditorPaste);
  editor.addEventListener('click', handleEditorClick);

  // Click anywhere in the edit pane that isn't a real line → focus editor at end.
  $('paneEdit').addEventListener('mousedown', (e) => {
    if (e.target.closest('.ed-line') || e.target.closest('img')) return;
    e.preventDefault();
    focusEditorEnd();
  });

  // title
  $('noteTitle').addEventListener('input', () => { markDirty(); scheduleSave(); });
  $('noteTitle').addEventListener('blur', () => saveCurrentNote().then(() => renderTree()));

  // tag input
  $('tagInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { addTag(e.target.value); e.target.value = ''; }
  });

  // sidebar buttons
  $('btn-new-note').addEventListener('click', () => newNote(currentFolderForNew()));
  $('btn-new-folder').addEventListener('click', () => newFolder(null));
  $('btn-theme').addEventListener('click', toggleTheme);
  $('btn-export').addEventListener('click', (e) => { e.stopPropagation(); openExportMenu(e.currentTarget); });
  $('btn-import').addEventListener('click', (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      { label: 'Import files (.md / .json / .zip)…', action: () => $('importFile').click() },
      { label: 'Import folder (with sub-folders)…', action: () => $('importFolder').click() },
      'hr',
      { label: 'Or drop files/folders anywhere on the window', action: () => toast('Drop files or a folder onto YANTA') },
    ]);
  });
  $('importFile').addEventListener('change', (e) => {
    if (e.target.files.length) importFiles([...e.target.files]);
    e.target.value = '';
  });
  $('importFolder').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) { e.target.value = ''; return; }
    const items = files.map((f) => {
      const parts = (f.webkitRelativePath || f.name).split('/');
      parts.pop(); // drop the filename
      return { file: f, pathArr: parts };
    });
    await importItems(items);
    e.target.value = '';
  });
  $('btn-export-note').addEventListener('click', () => {
    const n = state.currentNoteId ? state.notes.get(state.currentNoteId) : null;
    if (n) exportNoteAsMd(n);
  });
  $('btn-images').addEventListener('click', () => { openImageModal(); setTab('library'); });

  // Vault indicator → menu
  $('vaultIndicator').addEventListener('click', (e) => { e.stopPropagation(); vaultMenu(e.currentTarget); });
  $('btn-settings').addEventListener('click', () => {
    toast('Settings: theme & view persist automatically');
  });

  // search
  $('search').addEventListener('input', (e) => { state.searchQuery = e.target.value; renderTree(); });

  // view toggles
  $('btn-view-edit').addEventListener('click', () => setView('edit'));
  $('btn-view-split').addEventListener('click', () => setView('split'));
  $('btn-view-preview').addEventListener('click', () => setView('preview'));

  // head actions
  $('btn-pin').addEventListener('click', togglePin);
  $('btn-delete').addEventListener('click', deleteCurrentNote);
  $('btn-insert-image').addEventListener('click', openImageModal);

  // modal
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
    e.preventDefault();
    dz.classList.remove('over');
    if (e.dataTransfer.files[0]) pickImageFile(e.dataTransfer.files[0]);
  });
  // when modal open, also accept paste
  document.addEventListener('paste', (e) => {
    if (imgModal.hidden) return;
    for (const it of e.clipboardData.items) {
      if (it.type.startsWith('image/')) { pickImageFile(it.getAsFile()); break; }
    }
  });

  $('quality').addEventListener('input', recompress);
  $('maxW').addEventListener('input', recompress);
  $('fmt').addEventListener('change', recompress);
  $('asBase64').addEventListener('change', (e) => { if (e.target.checked) $('asReference').checked = false; });
  $('asReference').addEventListener('change', (e) => { if (e.target.checked) $('asBase64').checked = false; });
  $('insertImage').addEventListener('click', insertCompressedImage);
  $('insertPath').addEventListener('click', () => {
    const path = $('pathInput').value.trim();
    if (!path) return;
    const alt = $('pathAlt').value.trim() || 'image';
    insertAtCursor(`\n![${alt}](${path})\n`);
    $('pathInput').value = ''; $('pathAlt').value = '';
    closeImageModal();
  });

  // divider drag
  setupDivider();

  // scroll sync
  const pe = $('paneEdit'); const pp = $('panePreview');
  pe.addEventListener('scroll', () => syncScroll(pe, pp));
  pp.addEventListener('scroll', () => syncScroll(pp, pe));

  // global shortcuts
  window.addEventListener('keydown', handleGlobalKey);

  // global drag-and-drop import of .md/.json files & folders
  setupGlobalDropImport();

  // make the preview editable + floating format toolbar
  setupEditablePreview();
  setupFormatToolbar();

  // preview interactions (checkbox toggle, tag click, wikilinks, backlinks)
  $('preview').addEventListener('click', (e) => {
    if (e.target.closest('a.wiki-link')) { handleWikilinkClick(e); return; }
    if (e.target.matches('input[type=checkbox][data-line]')) {
      const line = parseInt(e.target.dataset.line, 10);
      toggleTaskLine(line, e.target.checked);
    } else if (e.target.matches('.tag-ref')) {
      state.activeTagFilter = e.target.dataset.tag;
      renderTree();
    }
  });

  // Editor wikilink follow: Ctrl/Cmd+click (single click stays in edit mode)
  editor.addEventListener('click', (e) => {
    const w = e.target.closest('.ed-wiki, .ed-wiki-missing');
    if (!w) return;
    if (!(e.ctrlKey || e.metaKey)) {
      // Show a transient hint the first time
      if (!editor.dataset.hintShown) {
        toast('Tip: Ctrl/⌘+click a wikilink to follow it', '');
        editor.dataset.hintShown = '1';
      }
      return;
    }
    e.preventDefault();
    const lineDiv = w.closest('div');
    if (!lineDiv) return;
    const idx = [...editor.children].indexOf(lineDiv);
    const line = lastMarkdown.split('\n')[idx] || '';
    const m = /\[\[([^\]|\n]+)/.exec(line);
    if (m) {
      const target = m[1].trim();
      const nid = wikilinkIndex.get(target.toLowerCase());
      if (nid) openNote(nid);
      else if (confirm(`Note "${target}" doesn't exist. Create it?`)) createNoteWithTitle(target);
    }
  });

  // Editor key handling for autocomplete (must run before our other Enter handler)
  editor.addEventListener('keydown', (e) => {
    const acEl = $('autocomplete');
    if (!acEl.hidden && ac.items.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); acMove(1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); acMove(-1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acAccept(); return; }
      if (e.key === 'Escape')    { e.preventDefault(); acHide(); return; }
    }
  }, true); // capture so we win over the other Enter handler

  // Hide autocomplete on click anywhere
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#autocomplete') && !editor.contains(e.target)) acHide();
  });

  // Palette
  $('btn-palette').addEventListener('click', () => openPalette('commands'));
  $('btn-graph').addEventListener('click', openGraph);
  const palEl = $('palette');
  palEl.addEventListener('click', (e) => { if (e.target === palEl) closePalette(); });
  $('paletteInput').addEventListener('input', (e) => {
    palette.filter = e.target.value;
    buildPaletteItems();
  });
  $('paletteInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteMove(-1); }
    else if (e.key === 'Enter')  { e.preventDefault(); paletteAccept(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });

  // resize -> re-sync heights
  window.addEventListener('resize', debounce(syncLineHeights, 100));

  // unload — flush save
  window.addEventListener('beforeunload', () => { if (state.dirty) saveCurrentNote(); });

  // persist expanded folders
  setInterval(() => store.settings.set('expandedFolders', [...state.expandedFolders]), 5000);
}


function currentFolderForNew() {
  // If current note has a folder, default new note there
  if (state.currentNoteId) {
    const n = state.notes.get(state.currentNoteId);
    return n?.folderId || null;
  }
  return null;
}

function toggleTaskLine(lineIndex, checked) {
  const lines = lastMarkdown.split('\n');
  const line = lines[lineIndex];
  if (!line) return;
  lines[lineIndex] = line.replace(/^(\s*[-*+]\s+\[)([ xX])(\])/, (_, a, _b, c) => a + (checked ? 'x' : ' ') + c);
  lastMarkdown = lines.join('\n');
  renderEditor(lastMarkdown);
  $('preview').innerHTML = renderPreview(lastMarkdown);
  syncLineHeights();
  markDirty();
  scheduleSave();
}


function handleGlobalKey(e) {
  const meta = e.ctrlKey || e.metaKey;
  // Our undo covers BOTH typing (debounced snapshots) and structural
  // operations, so always intercept and let performUndo decide.
  if (meta && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    if (performUndo()) { e.preventDefault(); return; }
  }
  if (meta && ((e.shiftKey && (e.key === 'Z' || e.key === 'z')) || e.key === 'y' || e.key === 'Y')) {
    if (performRedo()) { e.preventDefault(); return; }
  }
  if (meta && e.key === 'n') { e.preventDefault(); newNote(currentFolderForNew()); }
  else if (meta && e.key === 'k') { e.preventDefault(); $('search').focus(); }
  else if (meta && e.key === 's') { e.preventDefault(); saveCurrentNote(); toast('Saved', 'success'); }
  else if (meta && e.key === 'i') { e.preventDefault(); openImageModal(); }
  else if (meta && e.key === 'o') { e.preventDefault(); openPalette('notes'); }
  else if (meta && e.key === 'p') { e.preventDefault(); openPalette('commands'); }
  else if (meta && e.key === 'g') { e.preventDefault(); openGraph(); }
  else if (meta && e.key === 'e') {
    e.preventDefault();
    const n = state.currentNoteId ? state.notes.get(state.currentNoteId) : null;
    if (n) exportNoteAsMd(n);
  }
  else if (meta && e.key === '/') { e.preventDefault(); setView(state.view === 'split' ? 'preview' : 'split'); }
  else if (e.key === 'Escape') {
    closeImageModal();
    closeMenu();
    closePalette();
    if (!$('graphOverlay').hidden) closeGraph();
    acHide();
    $('dropOverlay').hidden = true;
  }
}

function setupGlobalDropImport() {
  const overlay = $('dropOverlay');
  let hideTimer = null;
  function isFileDrag(e) {
    return e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  }
  // dragover fires continuously while a drag is in progress; if it stops
  // firing for ~120ms, the drag has left the window — hide the overlay.
  window.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    overlay.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { overlay.hidden = true; }, 120);
  });
  window.addEventListener('drop', async (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    clearTimeout(hideTimer);
    overlay.hidden = true;

    // Prefer the items API (so we can recurse into folders)
    const items = e.dataTransfer.items ? [...e.dataTransfer.items] : [];
    const entries = items.map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
    const hasDirectory = entries.some((en) => en && en.isDirectory);

    if (hasDirectory) {
      const collected = [];
      for (const entry of entries) {
        try {
          collected.push(...(await walkEntry(entry, [])));
        } catch (err) {
          console.error('walkEntry failed', err);
        }
      }
      if (collected.length) await importItems(collected);
      else toast('Folder was empty', 'error');
      return;
    }

    // No directories — flat list of files
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    if (files.length === 1 && files[0].type.startsWith('image/')) {
      openImageModal();
      setTab('upload');
      await pickImageFile(files[0]);
      return;
    }
    const importable = files.filter((f) =>
      /\.(md|markdown|txt|json|zip)$/i.test(f.name) ||
      f.type === 'application/json' || f.type === 'application/zip' ||
      f.type === 'text/markdown' || f.type === 'text/plain'
    );
    if (importable.length) {
      await importFiles(importable);
    } else {
      toast('Drop .md, .markdown, .txt, .zip, or YANTA .json files', 'error');
    }
  });
}

function setupDivider() {
  const div = $('divider');
  let dragging = false;
  div.addEventListener('mousedown', (e) => {
    dragging = true;
    div.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const panes = $('panes').getBoundingClientRect();
    const pct = Math.min(85, Math.max(15, ((e.clientX - panes.left) / panes.width) * 100));
    document.documentElement.style.setProperty('--split', pct + '%');
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    div.classList.remove('dragging');
    document.body.style.cursor = '';
    syncLineHeights();
  });
}

init().catch((e) => {
  console.error(e);
  toast('Failed to start: ' + e.message, 'error');
});
