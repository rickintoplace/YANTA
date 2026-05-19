// ============================================================
// YANTA — Main entry point. Wires DOM events, hotkeys, drop overlay,
// pane divider, history navigation, view modes.
// ============================================================

import { $, state, store, openDB, setTheme, toggleTheme, toast } from './core.js';
import { openNote, newNote, newFolder, saveCurrentNote, deleteCurrentNote, togglePin, createWelcomeNote, rebuildWikilinkIndex, setNavSuppress, addTag, createNoteWithTitle } from './notes.js';
import { renderTree, renderTagCloud, showMenu, closeMenu, currentFolderForNew } from './tree.js';
import { renderBacklinks, renderOutline, setupWikilinkHover, handleWikilinkClick, openPalette, closePalette, buildCommandList, paletteMove, paletteAccept, paletteFilter } from './features.js';
import { openImageModal, closeImageModal, setupImage, pickImageFile, cleanupUnusedImages, insertImageAsRef } from './image.js';
import { openIconInsertPicker } from './icon-picker.js';
import { focusEditorEnd, getView } from './editor.js';
import { setupFormatToolbar } from './format-menu.js';
import { exportAsZip, exportNoteAsMd, exportBundle, exportEveryNoteMd, openExportMenu, importFiles, importItems, walkEntry } from './io.js';
import { syncRestore, syncConnect, syncDisconnect, syncFull, openSyncSetup, closeSyncSetup, syncMenu } from './sync.js';
import { openGraph, closeGraph, setupGraphInteractions } from './graph.js';
import { wikilinkIndex } from './features-state.js';
import { getNoteDoc, noteMarkdown } from './yjs.js';
import { openShareModal, closeShareModal, stopSharing, restoreSharedNotes, handleShareUrl } from './sharing.js';

let sharePreviewLocked = false;

function searchHaystack(note, body = '') {
  return [
    note?.title || '',
    (note?.tags || []).join(' '),
    body || '',
  ].join(' ').toLowerCase();
}

async function buildSearchIndex() {
  for (const note of state.notes.values()) {
    try {
      const entry = getNoteDoc(note.id);
      await entry.ready;
      state.searchIndex.set(note.id, searchHaystack(note, noteMarkdown(note.id)));
    } catch {
      state.searchIndex.set(note.id, searchHaystack(note, ''));
    }
  }
}

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
    store.images.allMeta(),
    store.settings.get('theme', 'auto'),
    store.settings.get('expandedFolders', []),
    store.settings.get('view', 'split'),
  ]);
  for (const n of notes) state.notes.set(n.id, n);
  for (const f of folders) state.folders.set(f.id, f);
  for (const im of images) state.imagesMeta.set(im.id, im);
  setTheme(theme);
  state.expandedFolders = new Set(expanded);
  setView(view);

  rebuildWikilinkIndex();
  await buildSearchIndex();

  buildCommandList({
    openImageModal, openGraph, exportAsZip, exportNoteAsMd, exportBundle, exportEveryNoteMd,
    openSyncSetup, syncFull, syncDisconnect, cleanupUnusedImages,
    openShareModal, stopSharing: () => stopSharing(state.currentNoteId),
    importFiles, importFolder: () => $('importFolder').click(),
  });
  setupGraphInteractions();
  setupWikilinkHover();
  setupImage();
  setupFormatToolbar();
  await syncRestore();
  let sharedOpen = null;

  if (window.location.hash.startsWith('#share=') || window.location.hash.startsWith('#share2=')) {
    sharedOpen = await handleShareUrl();

    if (sharedOpen?.noteId) {
      if (sharedOpen.previewOnly) {
        sharePreviewLocked = true;
        $('app').dataset.shareMode = 'preview';
      }

      await openNote(sharedOpen.noteId);
      setView(sharedOpen.view || 'preview');
    }
  } else {
    await restoreSharedNotes();
  }

  renderTree();

  // Open last note / hash / most recent / welcome
  // Nur ausführen, wenn nicht gerade ein Share-Link geöffnet wurde.
  if (!sharedOpen?.noteId) {
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
  }

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
  if (sharePreviewLocked && v !== 'preview') {
    v = 'preview';
  }

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
  setupPaneScrollSync();

  // Preview interactions
  $('preview').addEventListener('click', (e) => {
    if (e.target.closest('a.wiki-link')) {
      handleWikilinkClick(e);
      return;
    }

    const tag = e.target.closest('.tag-ref');
    if (tag) {
      state.activeTagFilter = tag.dataset.tag;
      renderTree();
      return;
    }

    const task = e.target.closest('.task[data-line]');
    if (!task) return;

    // Normale Links in Tasks sollen weiterhin Links bleiben, nicht toggeln.
    if (e.target.closest('a, button')) return;

    const line = parseInt(task.dataset.line, 10);
    if (Number.isNaN(line)) return;

    const cb = task.querySelector('input[type=checkbox]');
    if (!cb) return;

    const checked = e.target.matches('input[type=checkbox]')
      ? e.target.checked
      : !cb.checked;

    toggleTaskLine(line, checked);
  });

  // Global keyboard
  window.addEventListener('keydown', handleGlobalKey);

  // Drop import
  setupGlobalDropImport();

  // Click anywhere in the editor pane that is BELOW the last line of
  // text (or in the gutter) → focus the end of the document. CM6 only
  // catches clicks inside .cm-content; the empty area below it is
  // .cm-scroller (or paneEdit padding), which we route here.
  $('paneEdit').addEventListener('mousedown', (e) => {
    if (e.target.closest('.cm-content')) return;            // CM handles it
    if (e.target.closest('.format-toolbar')) return;        // toolbar swallows clicks
    if (e.target.closest('.cm-tooltip')) return;            // autocomplete tooltip
    e.preventDefault();
    focusEditorEnd();
  });

  // Paste image inside editor → open the image insert modal with the file.
  window.addEventListener('yanta-paste-image', async (e) => {
    openImageModal();
    await pickImageFile(e.detail.file);
  });

  // Files dropped directly on the editor:
  //   - single image  → insert directly as a library ref (no modal)
  //   - .md/.json/.zip → import as note(s)
  window.addEventListener('yanta-editor-drop-files', async (e) => {
    const { files } = e.detail;
    for (const f of files) {
      if (f.type.startsWith('image/')) {
        await insertImageAsRef(f);
      } else if (/\.(md|markdown|txt|json|zip)$/i.test(f.name)) {
        await importFiles([f]);
      }
    }
  });

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

  window.addEventListener('yanta-open-icon-insert', () => openIconInsertPicker());

  // Persist expanded folders
  setInterval(() => store.settings.set('expandedFolders', [...state.expandedFolders]), 5000);

  // Unload
  window.addEventListener('beforeunload', () => { if (state.dirty) saveCurrentNote(); });
}

function toggleTaskLine(lineIndex, checked) {
  if (!state.currentNoteId) return;

  const { doc } = getNoteDoc(state.currentNoteId);
  const ytext = doc.getText('markdown');

  const text = ytext.toString();
  const lines = text.split('\n');
  const line = lines[lineIndex];
  if (!line) return;

  const m = /^(\s*[-*+]\s+\[)([ xX])(\])/.exec(line);
  if (!m) return;

  let lineStart = 0;
  for (let i = 0; i < lineIndex; i++) {
    lineStart += lines[i].length + 1;
  }

  const target = lineStart + m[1].length;
  const newChar = checked ? 'x' : ' ';

  // Wichtig: delete + insert als EIN Update, nicht zwei separate Updates.
  doc.transact(() => {
    ytext.delete(target, 1);
    ytext.insert(target, newChar);
  }, 'preview-task-toggle');
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

function setupPaneScrollSync() {
  const pvPane = $('panePreview');
  const preview = $('preview');
  if (!pvPane || !preview) return;

  const sync = {
    raf: 0,

    // Smooth follower
    followRaf: 0,
    followEl: null,
    followTarget: 0,
    followMax: 0,

    // Nur Scroll-Events dieses Elements werden als programmatic ignoriert.
    programmaticEl: null,
    programmaticUntil: 0,
    releaseTimer: 0,

    // User möchte gerade selbst in einem Pane scrollen.
    manualEl: null,
    manualUntil: 0,

    measureTimer: 0,
    measuring: false,
    measureAgain: false,

    editorTops: [],
    previewTops: [],
    maxEditor: 1,
    maxPreview: 1,
  };

  function editorScroller() {
    return getView()?.scrollDOM || null;
  }

  function paneForTarget(target) {
    const scroller = editorScroller();

    if (scroller && (target === scroller || scroller.contains(target))) {
      return scroller;
    }

    if (target === pvPane || pvPane.contains(target)) {
      return pvPane;
    }

    return null;
  }

  function markProgrammatic(el) {
    sync.programmaticEl = el;
    sync.programmaticUntil = performance.now() + 120;

    clearTimeout(sync.releaseTimer);
    sync.releaseTimer = setTimeout(() => {
      if (performance.now() >= sync.programmaticUntil) {
        sync.programmaticEl = null;
      }
    }, 140);
  }

  function stopFollower() {
    if (sync.followRaf) {
      cancelAnimationFrame(sync.followRaf);
      sync.followRaf = 0;
    }

    sync.followEl = null;
    sync.programmaticEl = null;
    sync.programmaticUntil = 0;
  }

  function noteManualIntent(el) {
    if (!el) return;

    sync.manualEl = el;
    sync.manualUntil = performance.now() + 300;

    // Wenn der User genau das Pane anfassen will, das gerade automatisch
    // bewegt wird, muss die Automatik sofort loslassen.
    if (el === sync.followEl) {
      stopFollower();
    }
  }

  document.addEventListener('wheel', (e) => {
    noteManualIntent(paneForTarget(e.target));
  }, { capture: true, passive: true });

  document.addEventListener('touchstart', (e) => {
    noteManualIntent(paneForTarget(e.target));
  }, { capture: true, passive: true });

  document.addEventListener('mousedown', (e) => {
    noteManualIntent(paneForTarget(e.target));
  }, { capture: true, passive: true });

  const setProgrammaticScrollTop = (el, top, max) => {
    if (!el) return;

    const target = Math.max(0, Math.min(max || 0, top || 0));

    sync.followEl = el;
    sync.followTarget = target;
    sync.followMax = max || 0;

    if (!sync.followRaf) {
      sync.followRaf = requestAnimationFrame(animateFollower);
    }
  };

  function animateFollower() {
    sync.followRaf = 0;

    const el = sync.followEl;
    if (!el) return;

    if (state.view !== 'split') {
      stopFollower();
      return;
    }

    // Wenn der User gerade im Ziel-Pane selbst scrollen will: loslassen.
    if (el === sync.manualEl && performance.now() < sync.manualUntil) {
      stopFollower();
      return;
    }

    const target = Math.max(0, Math.min(sync.followMax || 0, sync.followTarget || 0));
    const current = el.scrollTop;
    const diff = target - current;

    if (Math.abs(diff) < 0.6) {
      markProgrammatic(el);
      el.scrollTop = target;
      sync.followEl = null;
      return;
    }

    // Höher = direkter, niedriger = weicher/träger.
    const factor = 0.32;

    markProgrammatic(el);
    el.scrollTop = current + diff * factor;

    sync.followRaf = requestAnimationFrame(animateFollower);
  }

  const scheduleMeasure = () => {
    if (sync.measuring) {
      sync.measureAgain = true;
      return;
    }

    clearTimeout(sync.measureTimer);
    sync.measureTimer = setTimeout(() => {
      requestAnimationFrame(() => measureAndAlign(sync));
    }, 120);
  };

  function mapScroll(sourceTop, sourceTops, targetTops, fallbackRatio, sourceMax, targetMax) {
    if (!sourceTops.length || !targetTops.length) {
      return fallbackRatio * targetMax;
    }

    let lo = 0;
    let hi = sourceTops.length - 1;

    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (sourceTops[mid] <= sourceTop) lo = mid;
      else hi = mid - 1;
    }

    const i = lo;

    const a0 = sourceTops[i] ?? 0;
    const a1 = sourceTops[i + 1] ?? sourceMax;
    const b0 = targetTops[i] ?? 0;
    const b1 = targetTops[i + 1] ?? targetMax;

    const spanA = Math.max(1, a1 - a0);
    const t = Math.max(0, Math.min(1, (sourceTop - a0) / spanA));

    return b0 + t * (b1 - b0);
  }

  function editorToPreview() {
    if (state.view !== 'split') return;

    const v = getView();
    if (!v) return;

    const scroller = v.scrollDOM;
    if (!scroller) return;

    cancelAnimationFrame(sync.raf);
    sync.raf = requestAnimationFrame(() => {
      const ratio = scroller.scrollTop / Math.max(1, sync.maxEditor);

      const target = mapScroll(
        scroller.scrollTop,
        sync.editorTops,
        sync.previewTops,
        ratio,
        sync.maxEditor,
        sync.maxPreview
      );

      setProgrammaticScrollTop(pvPane, target, sync.maxPreview);
    });
  }

  function previewToEditor() {
    if (state.view !== 'split') return;

    const v = getView();
    if (!v) return;

    const scroller = v.scrollDOM;
    if (!scroller) return;

    cancelAnimationFrame(sync.raf);
    sync.raf = requestAnimationFrame(() => {
      const ratio = pvPane.scrollTop / Math.max(1, sync.maxPreview);

      const target = mapScroll(
        pvPane.scrollTop,
        sync.previewTops,
        sync.editorTops,
        ratio,
        sync.maxPreview,
        sync.maxEditor
      );

      setProgrammaticScrollTop(scroller, target, sync.maxEditor);
    });
  }

  document.addEventListener('scroll', (e) => {
    const v = getView();
    if (!v) return;

    const scroller = v.scrollDOM;
    const target = e.target;
    const now = performance.now();

    // Nur Scroll-Events des automatisch bewegten Elements ignorieren.
    // Scroll-Events des aktiven User-Panes müssen weiterhin durchkommen.
    if (
      target === sync.programmaticEl &&
      now < sync.programmaticUntil &&
      !(target === sync.manualEl && now < sync.manualUntil)
    ) {
      return;
    }

    if (target === scroller) {
      editorToPreview();
    } else if (target === pvPane) {
      previewToEditor();
    }
  }, { capture: true, passive: true });

  window.addEventListener('resize', scheduleMeasure);
  window.addEventListener('yanta-preview-rendered', scheduleMeasure);

  window.addEventListener('yanta-editor-geometry-change', () => {
    if (sync.measuring) {
      sync.measureAgain = true;
      return;
    }

    scheduleMeasure();
  });

  preview.addEventListener('load', scheduleMeasure, true);

  scheduleMeasure();
}

function measureAndAlign(sync) {
  const v = getView();
  const pvPane = $('panePreview');
  const preview = $('preview');

  if (!v || !pvPane || !preview) return;

  if (sync.measuring) {
    sync.measureAgain = true;
    return;
  }

  sync.measuring = true;

  requestAnimationFrame(() => {
    rebuildScrollMaps(sync);

    sync.measuring = false;

    if (sync.measureAgain) {
      sync.measureAgain = false;
      clearTimeout(sync.measureTimer);
      sync.measureTimer = setTimeout(() => {
        requestAnimationFrame(() => measureAndAlign(sync));
      }, 160);
    }
  });
}

function rebuildScrollMaps(sync) {
  const v = getView();
  const pvPane = $('panePreview');
  const preview = $('preview');

  if (!v || !pvPane || !preview) return;

  const scroller = v.scrollDOM;
  const doc = v.state.doc;
  const lineCount = doc.lines;

  const editorTops = new Array(lineCount).fill(0);
  const previewTops = new Array(lineCount).fill(0);

  for (let i = 1; i <= lineCount; i++) {
    const line = doc.line(i);
    const block = v.lineBlockAt(line.from);
    editorTops[i - 1] = Math.round(block.top || 0);
  }

  const paneRect = pvPane.getBoundingClientRect();

  for (const el of preview.querySelectorAll('.pv-line[data-line]')) {
    const i = parseInt(el.dataset.line, 10);
    if (Number.isNaN(i) || i < 0 || i >= lineCount) continue;

    const r = el.getBoundingClientRect();
    previewTops[i] = Math.round(r.top - paneRect.top + pvPane.scrollTop);
  }

  sync.editorTops = editorTops;
  sync.previewTops = previewTops;
  sync.maxEditor = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
  sync.maxPreview = Math.max(1, pvPane.scrollHeight - pvPane.clientHeight);
}

init().catch((e) => {
  console.error(e);
  toast('Failed to start: ' + e.message, 'error');
});
