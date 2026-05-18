// ============================================================
// YANTA — Main entry point. Wires DOM events, hotkeys, drop overlay,
// pane divider, history navigation, view modes.
// ============================================================

import { $, state, store, openDB, setTheme, toggleTheme, toast } from './core.js';
import { openNote, newNote, newFolder, saveCurrentNote, deleteCurrentNote, togglePin, createWelcomeNote, rebuildWikilinkIndex, setNavSuppress, addTag, createNoteWithTitle } from './notes.js';
import { renderTree, renderTagCloud, showMenu, closeMenu, currentFolderForNew } from './tree.js';
import { renderBacklinks, renderOutline, setupWikilinkHover, handleWikilinkClick, openPalette, closePalette, buildCommandList, paletteMove, paletteAccept, paletteFilter } from './features.js';
import { openImageModal, closeImageModal, setupImage, pickImageFile, cleanupUnusedImages } from './image.js';
import { exportAsZip, exportNoteAsMd, exportBundle, exportEveryNoteMd, openExportMenu, importFiles, importItems, walkEntry } from './io.js';
import { syncRestore, syncConnect, syncDisconnect, syncFull, openSyncSetup, closeSyncSetup, syncMenu } from './sync.js';
import { openGraph, closeGraph, setupGraphInteractions } from './graph.js';
import { wikilinkIndex } from './features-state.js';
import { getNoteDoc } from './yjs.js';
import { openShareModal, closeShareModal, stopSharing, restoreSharedNotes, handleShareUrl } from './sharing.js';

async function init() {
  await openDB();
  try {
    if (navigator.storage?.persist) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    }
  } catch {}

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
  for (const im of images) { const { blob, ...meta } = im; state.imagesMeta.set(meta.id, meta); }
  setTheme(theme);
  state.expandedFolders = new Set(expanded);
  setView(view);

  rebuildWikilinkIndex();
  buildCommandList({
    openImageModal, openGraph, exportAsZip, exportNoteAsMd, exportBundle, exportEveryNoteMd,
    openSyncSetup, syncFull, syncDisconnect, cleanupUnusedImages,
    openShareModal, stopSharing: () => stopSharing(state.currentNoteId),
    importFiles, importFolder: () => $('importFolder').click(),
  });
  setupGraphInteractions();
  setupWikilinkHover();
  setupImage();
  await syncRestore();
  if (window.location.hash.startsWith('#share=')) {
    const id = await handleShareUrl();
    if (id) await openNote(id);
  } else {
    await restoreSharedNotes();
  }

  renderTree();

  // Open last note / hash / most recent / welcome
  const hashId = decodeURIComponent((window.location.hash || '').slice(1));
  const lastId = await store.settings.get('lastNoteId', null);
  let toOpen = null;
  if (hashId && state.notes.has(hashId)) toOpen = state.notes.get(hashId);
  if (!toOpen && lastId && state.notes.has(lastId)) toOpen = state.notes.get(lastId);
  if (!toOpen) toOpen = [...state.notes.values()].sort((a, b) => b.updated - a.updated)[0];
  setNavSuppress(true);
  if (toOpen) await openNote(toOpen.id);
  else await createWelcomeNote();
  setNavSuppress(false);

  if (state.notes.size && state.currentNoteId) {
    // Trigger initial sync pull (if linked) — fire-and-forget.
    // (Pull happens in syncRestore already if handle exists, but kick it
    // again so we pick up changes since the page was last open.)
    syncFull(false).catch(() => {});
  }

  window.addEventListener('popstate', (e) => {
    const id = (e.state && e.state.noteId) || decodeURIComponent((window.location.hash || '').slice(1));
    if (id && state.notes.has(id) && id !== state.currentNoteId) {
      setNavSuppress(true);
      openNote(id).finally(() => setNavSuppress(false));
    }
  });

  bindEvents();
}

function setView(v) {
  state.view = v;
  $('app').dataset.view = v;
  $('btn-view-edit').classList.toggle('active', v === 'edit');
  $('btn-view-split').classList.toggle('active', v === 'split');
  $('btn-view-preview').classList.toggle('active', v === 'preview');
  store.settings.set('view', v);
}

function bindEvents() {
  // title + tags
  $('noteTitle').addEventListener('input', () => { saveCurrentNote(); });
  $('noteTitle').addEventListener('blur', () => saveCurrentNote().then(() => renderTree()));
  $('tagInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { addTag(e.target.value); e.target.value = ''; } });

  // sidebar
  $('btn-new-note').addEventListener('click', () => newNote(currentFolderForNew()));
  $('btn-new-folder').addEventListener('click', () => newFolder(null));
  $('btn-theme').addEventListener('click', toggleTheme);
  $('btn-export').addEventListener('click', (e) => { e.stopPropagation(); openExportMenu(e.currentTarget, showMenu); });
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
  $('importFile').addEventListener('change', (e) => { if (e.target.files.length) importFiles([...e.target.files]); e.target.value = ''; });
  $('importFolder').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) { e.target.value = ''; return; }
    const items = files.map((f) => {
      const parts = (f.webkitRelativePath || f.name).split('/');
      parts.pop();
      return { file: f, pathArr: parts };
    });
    await importItems(items);
    e.target.value = '';
  });
  $('btn-export-note').addEventListener('click', () => {
    const n = state.notes.get(state.currentNoteId);
    if (n) exportNoteAsMd(n);
  });
  $('btn-images').addEventListener('click', () => { openImageModal(); });

  // Sync
  $('vaultIndicator').addEventListener('click', (e) => { e.stopPropagation(); syncMenu(e.currentTarget, showMenu); });
  $('syncSetupPick')?.addEventListener('click', async () => { closeSyncSetup(); await syncConnect(); });
  document.querySelectorAll('[data-sync-close]').forEach((b) => b.addEventListener('click', closeSyncSetup));
  document.querySelectorAll('[data-conflict-close]').forEach((b) => b.addEventListener('click', () => { $('conflictModal').hidden = true; }));
  window.addEventListener('focus', () => { syncFull(false).catch(() => {}); });

  // Settings (placeholder)
  $('btn-settings').addEventListener('click', () => { toast('Settings: theme & view persist automatically'); });

  // Search
  $('search').addEventListener('input', (e) => { state.searchQuery = e.target.value; renderTree(); });

  // View toggles
  $('btn-view-edit').addEventListener('click', () => setView('edit'));
  $('btn-view-split').addEventListener('click', () => setView('split'));
  $('btn-view-preview').addEventListener('click', () => setView('preview'));

  // Head actions
  $('btn-pin').addEventListener('click', togglePin);
  $('btn-delete').addEventListener('click', deleteCurrentNote);
  $('btn-insert-image').addEventListener('click', openImageModal);
  $('btn-share').addEventListener('click', openShareModal);

  // Share modal
  $('btn-share-copy').addEventListener('click', async () => {
    const v = $('shareLink').value;
    try { await navigator.clipboard.writeText(v); toast('Link copied', 'success'); } catch { toast('Copy failed', 'error'); }
  });
  $('btn-share-stop').addEventListener('click', async () => { await stopSharing(state.currentNoteId); closeShareModal(); });
  document.querySelectorAll('[data-share-close]').forEach((b) => b.addEventListener('click', closeShareModal));

  // Divider
  setupDivider();

  // Preview interactions
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

  // Global keyboard
  window.addEventListener('keydown', handleGlobalKey);

  // Drop import
  setupGlobalDropImport();

  // Slash → image insert event from editor
  window.addEventListener('yanta-open-image-modal', () => openImageModal());
  // Ctrl/Cmd+click wikilink from editor
  window.addEventListener('yanta-follow-wiki', (e) => {
    const target = e.detail.target;
    const id = wikilinkIndex.get(target.toLowerCase());
    if (id) openNote(id);
    else if (confirm(`Note "${target}" doesn't exist. Create it?`)) createNoteWithTitle(target);
  });
  // Cycle view from command palette
  window.addEventListener('yanta-cycle-view', () => {
    setView(state.view === 'split' ? 'preview' : state.view === 'preview' ? 'edit' : 'split');
  });

  // Palette
  $('btn-palette').addEventListener('click', () => openPalette('commands'));
  $('btn-graph').addEventListener('click', openGraph);
  const palEl = $('palette');
  palEl.addEventListener('click', (e) => { if (e.target === palEl) closePalette(); });
  $('paletteInput').addEventListener('input', (e) => paletteFilter(e.target.value));
  $('paletteInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteMove(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); paletteAccept(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });

  // Persist expanded folders
  setInterval(() => store.settings.set('expandedFolders', [...state.expandedFolders]), 5000);

  // Unload
  window.addEventListener('beforeunload', () => { if (state.dirty) saveCurrentNote(); });
}

function toggleTaskLine(lineIndex, checked) {
  if (!state.currentNoteId) return;
  const ytext = getNoteDoc(state.currentNoteId).doc.getText('markdown');
  const text = ytext.toString();
  const lines = text.split('\n');
  const line = lines[lineIndex];
  if (!line) return;
  // Compute the absolute offset of the bracket char to flip.
  const m = /^(\s*[-*+]\s+\[)([ xX])(\])/.exec(line);
  if (!m) return;
  let lineStart = 0;
  for (let i = 0; i < lineIndex; i++) lineStart += lines[i].length + 1;
  const target = lineStart + m[1].length;
  ytext.delete(target, 1);
  ytext.insert(target, checked ? 'x' : ' ');
}

function handleGlobalKey(e) {
  const meta = e.ctrlKey || e.metaKey;
  if (meta && e.key === 'n') { e.preventDefault(); newNote(currentFolderForNew()); }
  else if (meta && e.key === 'k') { e.preventDefault(); $('search').focus(); }
  else if (meta && e.key === 's') { e.preventDefault(); saveCurrentNote(); toast('Saved', 'success'); }
  else if (meta && e.key === 'i') { e.preventDefault(); openImageModal(); }
  else if (meta && e.key === 'o') { e.preventDefault(); openPalette('notes'); }
  else if (meta && e.key === 'p') { e.preventDefault(); openPalette('commands'); }
  else if (meta && e.key === 'g') { e.preventDefault(); openGraph(); }
  else if (meta && e.key === 'e') {
    e.preventDefault();
    const n = state.notes.get(state.currentNoteId);
    if (n) exportNoteAsMd(n);
  }
  else if (meta && e.key === '/') { e.preventDefault(); setView(state.view === 'split' ? 'preview' : 'split'); }
  else if (e.key === 'Escape') {
    closeImageModal();
    closeShareModal();
    closeMenu();
    closePalette();
    if (!$('graphOverlay').hidden) closeGraph();
    $('dropOverlay').hidden = true;
  }
}

function setupGlobalDropImport() {
  const overlay = $('dropOverlay');
  let hideTimer = null;
  const isFileDrag = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
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
    const items = e.dataTransfer.items ? [...e.dataTransfer.items] : [];
    const entries = items.map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
    const hasDir = entries.some((en) => en && en.isDirectory);
    if (hasDir) {
      const collected = [];
      for (const en of entries) try { collected.push(...(await walkEntry(en, []))); } catch {}
      if (collected.length) await importItems(collected);
      else toast('Folder was empty', 'error');
      return;
    }
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    if (files.length === 1 && files[0].type.startsWith('image/')) {
      openImageModal();
      await pickImageFile(files[0]);
      return;
    }
    const importable = files.filter((f) =>
      /\.(md|markdown|txt|json|zip)$/i.test(f.name) ||
      f.type === 'application/json' || f.type === 'application/zip' ||
      f.type === 'text/markdown' || f.type === 'text/plain'
    );
    if (importable.length) await importFiles(importable);
    else toast('Drop .md, .markdown, .txt, .zip, or YANTA .json files', 'error');
  });
}

function setupDivider() {
  const div = $('divider');
  let dragging = false;
  div.addEventListener('mousedown', (e) => { dragging = true; div.classList.add('dragging'); document.body.style.cursor = 'col-resize'; e.preventDefault(); });
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
  });
}

init().catch((e) => {
  console.error(e);
  toast('Failed to start: ' + e.message, 'error');
});
