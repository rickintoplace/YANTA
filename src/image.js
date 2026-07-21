// ============================================================
// YANTA — Image insertion modal, compression preview, library.
// Stores image blobs in IndexedDB, refs notes as ![alt](yanta-img://<id>).
// ============================================================

import { $, el, uid, state, store, toast, fmtBytes, lucide } from './core.js';
import { t } from './i18n/index.js';
import {
  pushOverlayState,
  closeTopOverlay,
  registerOverlayRoute,
} from './overlay-history.js';
import { insertAtCursor } from './editor.js';
import { updateStorageMeter } from './core.js';
import { listAllDrawings } from './yjs.js';
import {
  drawingThumbnailUrl,
  importSvgFileAsDrawing,
  listDrawLibraryItems,
  listDrawLibraryGroups,
  drawLibraryItemThumbnailUrl,
  insertDrawLibraryItemIntoCurrent,
} from './draw.js';
import {
  collectCitationLibrary,
  insertSavedCitationIntoCurrentNote,
  openCitationManager,
} from './citations.js';
import {
  yantaConfirm,
} from './dialogs.js';
import {
  compressImageFile,
  blobToDataURL,
} from './media/image-compression.js';

let imgModal, compressPanel;
let imageOverlayRegistered = false;
let imgWorkingBlob = null;
let imgCompressedBlob = null;
let imgCompressedDataUrl = null;

function imageModalIsOpen() {
  return !!imgModal && imgModal.hidden === false;
}

function registerImageOverlayRoute() {
  if (imageOverlayRegistered) return;

  imageOverlayRegistered = true;

  registerOverlayRoute('image-library', {
    open: () => {
      openImageModal({
        fromHistory: true,
      });
    },

    close: () => {
      closeImageModal({
        fromHistory: true,
      });
    },

    isOpen: imageModalIsOpen,
  });
}

export function setupImage() {
  registerImageOverlayRoute();

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
  window.addEventListener('yanta-draw-library-updated', () => {
    const libraryPane = imgModal?.querySelector('[data-pane="library"]');
    if (imgModal && !imgModal.hidden && libraryPane && !libraryPane.hidden) {
      renderLibrary();
    }
  });
}

export function openImageModal({
  fromHistory = false,
} = {}) {
  registerImageOverlayRoute();

  const wasClosed = imgModal.hidden !== false;

  imgModal.hidden = false;
  setTab('upload');
  imgWorkingBlob = null;
  imgCompressedBlob = null;
  imgCompressedDataUrl = null;
  compressPanel.hidden = true;

  if (!fromHistory && wasClosed) {
    pushOverlayState('image-library');
  }
}

export function closeImageModal({
  fromHistory = false,
} = {}) {
  if (!imgModal) return;

  if (!fromHistory && imgModal.hidden === false) {
    closeTopOverlay(() => {
      closeImageModal({
        fromHistory: true,
      });
    });

    return;
  }

  imgModal.hidden = true;
}

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

  let compressed;

  try {
    compressed = await compressImageFile(file, {
      maxWidth: 1600,
      quality: 0.85,
      mime: file.type === 'image/svg+xml' ? file.type : 'image/webp',
    });
  } catch {
    compressed = {
      blob: file,
      mime: file.type,
      compressedSize: file.size,
    };
  }

  const blob = compressed.blob || file;
  const id = uid();

  const meta = {
    id,
    name: file.name || (id + '.img'),
    size: blob.size,
    type: blob.type || compressed.mime || file.type,
    ts: Date.now(),
  };

  await store.images.put({ ...meta, blob });
  state.imagesMeta.set(id, meta);
  state.imageBlobs.set(id, URL.createObjectURL(blob));

  const altBase = (file.name || 'image').replace(/\.[^.]+$/, '');

  insertAtCursor(`\n![${altBase}](yanta-img://${id})\n`);

  updateStorageMeter();
  toast(t('image.inserted'), 'success');
}

export async function pickImageFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast(t('image.notAnImage'), 'error'); return; }
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
    $('imgMeta').innerHTML = `<span>${t('image.svgKept')}</span><strong>${fmtBytes(imgWorkingBlob.size)}</strong>`;
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
    w.textContent = t('image.base64Warning', { size: fmtBytes(size) });
  } else w.hidden = true;
}

async function insertCompressedImage() {
  if (!imgCompressedBlob) { toast(t('image.pickImageFirst'), 'error'); return; }
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
  } else { toast(t('image.pickSaveMode'), 'error'); return; }
  insertAtCursor('\n' + md + '\n');
  closeImageModal();
  updateStorageMeter();
  toast(t('image.inserted'), 'success');
}

function sectionTitle(text) {
  return el('div', {
    style: {
      gridColumn: '1 / -1',
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      color: 'var(--text-faint)',
      margin: '8px 0 2px',
    },
  }, text);
}

function stripHtmlForLibrary(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '');
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
}

function citationTitleForLibrary(c) {
  return (
    c?.csl?.title ||
    c?.model?.title ||
    stripHtmlForLibrary(c?.formatted || '') ||
    c?.key ||
    t('image.citationFallback')
  );
}

function citationMetaForLibrary(c) {
  const csl = c?.csl || {};
  const parts = [];

  const year = c?.model?.year ||
    csl.issued?.['date-parts']?.[0]?.[0] ||
    '';

  const doi = csl.DOI || c?.model?.doi || '';
  const url = csl.URL || c?.model?.url || '';

  if (year) parts.push(String(year));
  if (doi) parts.push('DOI');
  else if (url) parts.push('URL');

  if (c?.sourceNoteTitle && !c.isFromCurrentNote) {
    parts.push(c.sourceNoteTitle);
  }

  if (c?.isFromCurrentNote) {
    parts.push(t('image.currentNote'));
  }

  return parts.join(' · ');
}

function libraryItemCard(item) {
  const card = el('div', {
    class: 'lib-card',
    title: t('image.insertLibraryItem', { name: item.name || t('image.libraryItem') }),
    onclick: async () => {
      await insertDrawLibraryItemIntoCurrent(item.id);
      closeImageModal();
    },
  });

  const thumb = el('div', {
    style: {
      width: '100%',
      height: '80px',
      borderRadius: '4px',
      border: '1px solid var(--border)',
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--accent)',
      overflow: 'hidden',
    },
  });

  thumb.innerHTML = lucide('library', 26);

  drawLibraryItemThumbnailUrl(item.id).then((url) => {
    if (!url) return;

    thumb.replaceChildren();
    thumb.append(el('img', {
      src: url,
      alt: item.name || t('image.libraryItem'),
      style: {
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        border: '0',
      },
    }));
  });

  card.append(
    thumb,
    el('div', {
      class: 'lib-meta',
      title: item.name || t('image.libraryItem'),
    }, item.name || t('image.libraryItem')),
    el('div', {
      class: 'lib-meta',
      style: { color: 'var(--text-faint)' },
    }, t('image.elementCount', { count: (item.elements || []).length }))
  );

  return card;
}

function renderLibrary() {
  const g = $('libraryGrid');
  g.replaceChildren();

  const drawLibraryItems = listDrawLibraryItems();
  const drawings = listAllDrawings();
  const citations = collectCitationLibrary({ currentFirst: true });
  const images = [...state.imagesMeta.values()].sort((a, b) => b.ts - a.ts);

  if (!images.length && !drawings.length && !drawLibraryItems.length && !citations.length) {
    g.append(el('div', { class: 'tree-empty' }, t('image.libraryEmpty')));
    return;
  }

  if (images.length) {
    g.append(sectionTitle(t('image.sectionImages')));

    for (const meta of images) {
      let url = state.imageBlobs.get(meta.id);

      if (!url) {
        store.images.get(meta.id).then((rec) => {
          if (rec && rec.blob) {
            state.imageBlobs.set(meta.id, URL.createObjectURL(rec.blob));
            renderLibrary();
          }
        });
      }

      const card = el('div', {
        class: 'lib-card',
        onclick: () => {
          insertAtCursor(`\n![${meta.name || 'image'}](yanta-img://${meta.id})\n`);
          closeImageModal();
        },
      });

      if (url) card.append(el('img', { src: url, alt: meta.name }));

      card.append(el('div', { class: 'lib-meta' }, fmtBytes(meta.size)));
      g.append(card);
    }
  }

  if (citations.length) {
    g.append(sectionTitle(t('image.sectionCitations')));

    for (const c of citations) {
      const title = citationTitleForLibrary(c);
      const meta = citationMetaForLibrary(c);
      const formatted = stripHtmlForLibrary(c.formatted || '');

      const card = el('div', {
        class: 'lib-card yanta-citation-lib-card',
        title: formatted || title,
        onclick: () => {
          insertSavedCitationIntoCurrentNote(c, { mode: 'footnote' });
          closeImageModal();
        },
      });

      const head = el('div', {
        class: 'yanta-citation-lib-icon',
      });

      head.innerHTML = lucide('quote', 24);

      const key = el('div', {
        class: 'lib-meta yanta-citation-lib-key',
        title: c.key || '',
      }, `[^${c.key || 'citation'}]`);

      const name = el('div', {
        class: 'lib-meta yanta-citation-lib-title',
        title,
      }, title);

      const metaEl = el('div', {
        class: 'lib-meta yanta-citation-lib-meta',
        title: meta,
      }, meta || t('image.citationMetaFallback'));

      const actions = el('div', {
        class: 'yanta-citation-lib-actions',
      });

      const citeBtn = el('button', {
        class: 'btn',
        title: t('image.insertFootnote'),
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();

          insertSavedCitationIntoCurrentNote(c, { mode: 'footnote' });
          closeImageModal();
        },
      }, t('image.cite'));

      const bibBtn = el('button', {
        class: 'btn',
        title: t('image.insertBibliography'),
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();

          insertSavedCitationIntoCurrentNote(c, { mode: 'bibliography' });
          closeImageModal();
        },
      }, t('image.bib'));

      const editBtn = el('button', {
        class: 'btn',
        title: t('image.openCitationManager'),
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();

          closeImageModal();
          openCitationManager(c.csl?.DOI || c.csl?.URL || c.model?.doi || c.model?.url || c.key || '');
        },
      }, t('image.edit'));

      actions.append(citeBtn, bibBtn, editBtn);

      card.append(head, key, name, metaEl, actions);
      g.append(card);
    }
  }
  
  if (drawLibraryItems.length) {
    // Grouped by source: own drawings first (empty group name), then one
    // section per imported Excalidraw library.
    for (const group of listDrawLibraryGroups()) {
      g.append(sectionTitle(group.name || t('image.sectionExcalidraw')));

      for (const item of group.items) {
        g.append(libraryItemCard(item));
      }
    }
  }
  g.append(sectionTitle(t('image.sectionDrawings')));

  const importSvg = el('div', {
    class: 'lib-card',
    onclick: () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/svg+xml,.svg';

      input.onchange = async () => {
        const file = input.files?.[0];
        if (file) {
          await importSvgFileAsDrawing(file);
          closeImageModal();
        }
      };

      input.click();
    },
  });

  const svgImportBox = el('div', {
    style: {
      width: '100%',
      height: '80px',
      borderRadius: '4px',
      border: '1px dashed var(--accent)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--accent)',
      background: 'rgba(110,168,254,0.08)',
    },
  });

  svgImportBox.innerHTML = lucide('upload', 26);

  importSvg.append(
    svgImportBox,
    el('div', { class: 'lib-meta' }, t('image.importSvg'))
  );

  g.append(importSvg);

  if (!drawings.length) {
    g.append(el('div', {
      class: 'tree-empty',
      style: { gridColumn: '1 / -1' },
    }, t('image.noDrawings')));
    return;
  }

  for (const d of drawings) {
    const card = el('div', {
      class: 'lib-card',
      title: t('image.insertDrawing', { title: d.title || t('image.drawingFallback') }),
      onclick: () => {
        insertAtCursor(`\n\ndraw://${d.id}\n\n`);
        closeImageModal();
        toast(t('image.drawingInserted'), 'success');
      },
    });

    const thumb = el('div', {
      style: {
        width: '100%',
        height: '80px',
        borderRadius: '4px',
        border: '1px solid var(--border)',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--accent)',
        overflow: 'hidden',
      },
    });

    thumb.innerHTML = lucide('line-squiggle', 26);

    drawingThumbnailUrl(d.noteId, d.id).then((url) => {
      if (!url) return;
      thumb.replaceChildren();
      thumb.append(el('img', {
        src: url,
        alt: d.title || t('image.drawingFallback'),
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          border: '0',
        },
      }));
    });

    card.append(
      thumb,
      el('div', {
        class: 'lib-meta',
        title: d.title || t('image.drawingFallback'),
      }, d.title || t('image.drawingFallback')),
      el('div', {
        class: 'lib-meta',
        style: { color: 'var(--text-faint)' },
      }, d.noteTitle || state.notes.get(d.noteId)?.title || t('image.noteFallback'))
    );

    g.append(card);
  }
}

export async function cleanupUnusedImages() {
  const used = new Set();

  const { noteMarkdown } = await import('./yjs.js');

  for (const n of state.notes.values()) {
    let body = '';

    try {
      body = noteMarkdown(n.id);
    } catch {}

    const re = /yanta-img:\/\/([a-z0-9]+)/gi;

    let m;
    while ((m = re.exec(body)) !== null) {
      used.add(m[1]);
    }
  }

  const unused = [...state.imagesMeta.values()]
    .filter((meta) => !used.has(meta.id));

  if (!unused.length) {
    toast(t('image.noUnusedImages'), 'success');
    return;
  }

  const total = unused.reduce((s, m) => s + (m.size || 0), 0);

  const ok = await yantaConfirm({
    title: t('image.deleteUnusedTitle'),
    message: t('image.deleteUnusedMessage', { count: unused.length, size: fmtBytes(total) }),
    confirmLabel: t('image.deleteImages'),
    danger: true,
  });

  if (!ok) return;

  for (const meta of unused) {
    await store.images.del(meta.id);

    state.imagesMeta.delete(meta.id);

    if (state.imageBlobs.has(meta.id)) {
      URL.revokeObjectURL(state.imageBlobs.get(meta.id));
      state.imageBlobs.delete(meta.id);
    }
  }

  toast(t('image.cleanedUp', { count: unused.length }), 'success');
}