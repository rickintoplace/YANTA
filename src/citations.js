// ============================================================
// YANTA — Citation Manager
// Native YANTA modal, client-only resolvers, CSL storage in note Y.Doc.
// Default insertion mode: Markdown footnote.
// ============================================================

import {
  $,
  state,
  toast,
  escapeHtml,
  escapeAttr,
  downloadBlob,
  safeFilename,
  lucide,
} from './core.js';

import {
  getView,
  insertAtCursor,
} from './editor.js';

import {
  getMarkdownText,
  getCitationsMap,
  setCitation,
  deleteCitation,
  listCitationsForNote,
} from './yjs.js';

import {
  pushOverlayState,
  closeTopOverlay,
  registerOverlayRoute,
} from './overlay-history.js';

import {
  resolveCitation,
  modelToCSL,
  cslToModel,
  formatCitation,
  parseAuthorsInput,
  authorsToInput,
  cleanDOI,
  extractPMCID,
  extractPMID,
  extractISBN,
  isUrlLike,
  normUrl,
} from './citation-resolvers.js';

let modal = null;
let citationOverlayRegistered = false;
let selectedStyle = 'apa';
let currentModel = null;
let currentKey = '';
let currentFormatted = '';
let fetching = false;

const STYLE_KEY = 'yanta.citations.style';

function citationManagerIsOpen() {
  return !!modal && modal.hidden === false;
}

function registerCitationOverlayRoute() {
  if (citationOverlayRegistered) return;

  citationOverlayRegistered = true;

  registerOverlayRoute('citations', {
    open: ({ data } = {}) => {
      openCitationManager(data?.seed || '', {
        fromHistory: true,
      });
    },

    close: () => {
      closeCitationManager({
        fromHistory: true,
      });
    },

    isOpen: citationManagerIsOpen,
  });
}

function loadStylePref() {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    if (['apa', 'harvard', 'de'].includes(v)) selectedStyle = v;
  } catch {}
}

function saveStylePref() {
  try {
    localStorage.setItem(STYLE_KEY, selectedStyle);
  } catch {}
}

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
}

function firstUsefulTitleWord(title) {
  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'with',
    'der', 'die', 'das', 'ein', 'eine', 'und', 'oder', 'von', 'im', 'in',
  ]);

  return String(title || '')
    .split(/[^\p{L}\p{N}]+/u)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3)
    .find((x) => !stop.has(x.toLowerCase())) || 'source';
}

function citationKeyFromModel(model) {
  const firstAuthor =
    model?.authors?.[0]?.family ||
    model?.authors?.[0]?.literal ||
    model?.publisher ||
    model?.siteName ||
    'source';

  const year =
    model?.year ||
    String(model?.publishedDate || '').slice(0, 4) ||
    'nd';

  const word = firstUsefulTitleWord(model?.title || '');

  return [
    slug(firstAuthor) || 'source',
    slug(year) || 'nd',
    slug(word) || 'ref',
  ].join('-');
}

function uniqueCitationKey(noteId, baseKey) {
  const map = getCitationsMap(noteId);
  if (!map.has(baseKey)) return baseKey;

  for (let i = 2; i < 1000; i++) {
    const k = `${baseKey}-${i}`;
    if (!map.has(k)) return k;
  }

  return `${baseKey}-${Date.now().toString(36)}`;
}

function selectedEditorText() {
  const v = getView();
  if (!v) return '';

  const sel = v.state.selection.main;
  if (!sel || sel.empty) return '';

  return v.state.sliceDoc(sel.from, sel.to).trim();
}

function textAroundCursor(max = 600) {
  const v = getView();
  if (!v) return '';

  const pos = v.state.selection.main.head;
  const from = Math.max(0, pos - max);
  const to = Math.min(v.state.doc.length, pos + max);

  return v.state.sliceDoc(from, to);
}

function normalizeSeed(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';

  const doi = cleanDOI(s);
  if (doi) return doi;

  const pmcid = extractPMCID(s);
  if (pmcid) return pmcid;

  const pmid = extractPMID(s);
  if (/PMID/i.test(s) && pmid) return `PMID:${pmid}`;

  const isbn = extractISBN(s);
  if (isbn) return isbn;

  if (isUrlLike(s)) return normUrl(s);

  return s;
}

function findCitationSeed() {
  const selected = normalizeSeed(selectedEditorText());
  if (selected) return selected;

  const around = textAroundCursor();

  const doi = cleanDOI(around);
  if (doi) return doi;

  const pmcid = extractPMCID(around);
  if (pmcid) return pmcid;

  const pmid = around.match(/\bPMID[:\s]*([0-9]{4,})\b/i)?.[1];
  if (pmid) return `PMID:${pmid}`;

  const isbn = extractISBN(around);
  if (isbn) return isbn;

  const url = around.match(/https?:\/\/[^\s)\]]+/i)?.[0];
  if (url) return normUrl(url);

  return '';
}

function citationDefinitionPrefix(key) {
  return `[^${key}]:`;
}

function hasFootnoteDefinition(md, key) {
  return md.split('\n').some((line) => line.startsWith(citationDefinitionPrefix(key)));
}

function citationInlineRefKeysFromMarkdown(md) {
  const out = new Set();
  const lines = String(md || '').split('\n');

  for (const line of lines) {
    // Definitionen NICHT als Nutzung zählen:
    // [^key]: Bibliography text
    if (/^\s*\[\^[^\]]+\]:/.test(line)) continue;

    const re = /\[\^([^\]\s]+)\]/g;
    let m;

    while ((m = re.exec(line)) !== null) {
      if (m[1]) out.add(m[1]);
    }
  }

  return out;
}

function citationIsInlineUsed(md, key) {
  return citationInlineRefKeysFromMarkdown(md).has(String(key || ''));
}

function removeFootnoteDefinitionLine(noteId, key) {
  if (!noteId || !key) return false;

  const ytext = getMarkdownText(noteId);
  const md = ytext.toString();
  const prefix = citationDefinitionPrefix(key);

  const lines = md.split('\n');

  let pos = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = pos;
    const lineEnd = pos + line.length;
    const hasNewline = lineEnd < md.length;

    if (line.startsWith(prefix)) {
      const deleteLen = line.length + (hasNewline ? 1 : 0);
      ytext.delete(lineStart, deleteLen);
      return true;
    }

    pos = lineEnd + 1;
  }

  return false;
}

/**
 * Removes citation metadata from the current note when the citation key
 * is no longer used inline as [^key].
 *
 * This fixes stale entries in:
 * - "Citations in this note"
 * - CSL export per note
 * - Citation library's "used citations"
 *
 * Also removes generated footnote definition lines if they became orphaned.
 */
export function pruneUnusedCitationsForNote(noteId, {
  removeOrphanFootnoteDefinitions = true,
} = {}) {
  if (!noteId) return 0;

  const map = getCitationsMap(noteId);
  const citations = listCitationsForNote(noteId);
  if (!citations.length) return 0;

  const md = getMarkdownText(noteId).toString();
  const usedKeys = citationInlineRefKeysFromMarkdown(md);

  let removed = 0;

  for (const c of citations) {
    const key = String(c.key || '').trim();
    if (!key) continue;

    if (usedKeys.has(key)) continue;

    deleteCitation(noteId, key, 'citation-gc');

    if (removeOrphanFootnoteDefinitions) {
      removeFootnoteDefinitionLine(noteId, key);
    }

    removed++;
  }

  return removed;
}

let _citationPruneTimer = 0;

function scheduleCitationPrune(noteId) {
  clearTimeout(_citationPruneTimer);

  _citationPruneTimer = setTimeout(() => {
    if (!noteId || noteId !== state.currentNoteId) return;

    try {
      const removed = pruneUnusedCitationsForNote(noteId);

      if (removed && modal && !modal.hidden) {
        renderExistingCitations();
      }
    } catch (err) {
      console.warn('[YANTA Citations] prune failed', err);
    }
  }, 700);
}

function upsertFootnoteDefinition(noteId, key, formatted) {
  const ytext = getMarkdownText(noteId);
  const md = ytext.toString();
  const prefix = citationDefinitionPrefix(key);
  const newLine = `${prefix} ${stripHtmlToText(formatted)}`;

  const lines = md.split('\n');
  const idx = lines.findIndex((line) => line.startsWith(prefix));

  if (idx >= 0) {
    const before = lines.slice(0, idx).join('\n');
    const oldLine = lines[idx];
    const from = before.length + (idx > 0 ? 1 : 0);
    const to = from + oldLine.length;

    ytext.delete(from, to - from);
    ytext.insert(from, newLine);
    return;
  }

  const append = md.endsWith('\n')
    ? `\n${newLine}\n`
    : `\n\n${newLine}\n`;

  ytext.insert(ytext.length, append);
}

function stripHtmlToText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '');
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
}

function copyRich(html) {
  const text = stripHtmlToText(html);

  if (navigator.clipboard?.write && window.ClipboardItem) {
    const item = new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    });

    return navigator.clipboard.write([item]);
  }

  return navigator.clipboard.writeText(text);
}

function ensureModal() {
  registerCitationOverlayRoute();

  if (modal) return modal;

  injectCitationCss();

  modal = document.createElement('div');
  modal.className = 'yanta-cite-modal';
  modal.hidden = true;

  modal.innerHTML = `
    <div class="yanta-cite-card" role="dialog" aria-modal="true" aria-label="Insert citation">
      <header class="yanta-cite-head">
        <div class="yanta-cite-title">
          <span>${lucide('quote', 17)}</span>
          <strong>Insert citation</strong>
        </div>
        <button class="icon-btn" data-cite-close title="Close">${lucide('x', 16)}</button>
      </header>

      <div class="yanta-cite-body">
        <section class="yanta-cite-panel yanta-cite-input-panel">
          <div class="yanta-cite-input-row">
            <label>
              DOI / PMID / PMCID / ISBN / URL
              <input data-cite-input class="text-input" placeholder="10.1038/... · PMID:123456 · PMC123456 · ISBN · https://..." spellcheck="false" />
            </label>
            <button class="btn primary" data-cite-fetch>${lucide('search', 14)} Fetch</button>
          </div>

          <div class="yanta-cite-status" data-cite-status></div>
        </section>

        <section class="yanta-cite-panel">
          <div class="yanta-cite-panel-title">Metadata</div>

          <div class="yanta-cite-grid">
            <label>
              Type
              <select data-cite-type class="text-input">
                <option value="journal-article">Journal article</option>
                <option value="book">Book</option>
                <option value="book-chapter">Book chapter</option>
                <option value="website">Website</option>
                <option value="video">Video</option>
                <option value="post-weblog">Blog post</option>
                <option value="social-post">Social / forum post</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label>
              Year
              <input data-cite-year class="text-input" />
            </label>

            <label class="wide">
              Authors <span class="hint">Last, First; Last, First</span>
              <input data-cite-authors class="text-input" />
            </label>

            <label class="wide">
              Title
              <input data-cite-title-input class="text-input" />
            </label>

            <label>
              Journal / Container / Site
              <input data-cite-journal class="text-input" />
            </label>

            <label>
              Publisher
              <input data-cite-publisher class="text-input" />
            </label>

            <label>
              Volume
              <input data-cite-volume class="text-input" />
            </label>

            <label>
              Issue
              <input data-cite-issue class="text-input" />
            </label>

            <label>
              Pages
              <input data-cite-pages class="text-input" />
            </label>

            <label>
              Published date
              <input data-cite-published class="text-input" placeholder="YYYY-MM-DD or YYYY" />
            </label>

            <label>
              DOI
              <input data-cite-doi class="text-input" />
            </label>

            <label>
              ISBN
              <input data-cite-isbn class="text-input" />
            </label>

            <label class="wide">
              URL
              <input data-cite-url class="text-input" />
            </label>

            <label>
              Access date
              <input data-cite-access class="text-input" placeholder="YYYY-MM-DD" />
            </label>

            <label>
              Citation key
              <input data-cite-key class="text-input" />
            </label>
          </div>

          <div class="yanta-cite-style-row">
            <span>Style</span>
            <button class="btn" data-cite-style="apa">APA 7</button>
            <button class="btn" data-cite-style="harvard">Harvard</button>
            <button class="btn" data-cite-style="de">German</button>
            <button class="btn" data-cite-refresh>${lucide('refresh-cw', 13)} Refresh preview</button>
          </div>
        </section>

        <section class="yanta-cite-panel">
          <div class="yanta-cite-panel-title">Preview</div>
          <div data-cite-preview class="yanta-cite-preview">No citation yet.</div>
          <div data-cite-warning class="yanta-cite-warning" hidden></div>
        </section>

        <section class="yanta-cite-panel">
          <div class="yanta-cite-panel-title">Citations in this note</div>
          <div data-cite-existing class="yanta-cite-existing"></div>
        </section>
      </div>

      <footer class="yanta-cite-foot">
        <button class="btn" data-cite-copy>${lucide('copy', 14)} Copy</button>
        <button class="btn" data-cite-export>${lucide('download', 14)} CSL JSON</button>
        <span class="grow"></span>
        <button class="btn" data-cite-insert-ref>${lucide('list-plus', 14)} Insert bibliography entry</button>
        <button class="btn primary" data-cite-insert>${lucide('quote', 14)} Insert citation</button>
      </footer>
    </div>
  `;

  document.body.append(modal);

  modal.addEventListener('mousedown', (e) => {
    if (e.target === modal) closeCitationManager();
  });

  modal.querySelector('[data-cite-close]').addEventListener('click', closeCitationManager);

  modal.querySelector('[data-cite-fetch]').addEventListener('click', () => {
    const input = modal.querySelector('[data-cite-input]');
    resolveIntoModal(input.value).catch((err) => {
      setStatus(err?.message || String(err), 'error');
    });
  });

  modal.querySelector('[data-cite-input]').addEventListener('paste', () => {
    setTimeout(() => {
      const input = modal.querySelector('[data-cite-input]');
      if (input.value.trim()) {
        resolveIntoModal(input.value).catch(() => {});
      }
    }, 0);
  });

  modal.querySelector('[data-cite-input]').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      resolveIntoModal(e.currentTarget.value).catch((err) => {
        setStatus(err?.message || String(err), 'error');
      });
    }
  });

  for (const btn of modal.querySelectorAll('[data-cite-style]')) {
    btn.addEventListener('click', () => {
      selectedStyle = btn.dataset.citeStyle;
      saveStylePref();
      updateStyleButtons();
      readModelFromForm();
      refreshPreview();
    });
  }

  modal.querySelector('[data-cite-refresh]').addEventListener('click', () => {
    readModelFromForm();
    refreshPreview();
  });

  for (const el of modal.querySelectorAll('input, select')) {
    if (el.matches('[data-cite-input]')) continue;
    el.addEventListener('input', () => {
      readModelFromForm();
      refreshPreview({ quiet: true });
    });
    el.addEventListener('change', () => {
      readModelFromForm();
      refreshPreview({ quiet: true });
    });
  }

  modal.querySelector('[data-cite-copy]').addEventListener('click', async () => {
    readModelFromForm();
    refreshPreview();

    if (!currentFormatted) return;

    try {
      await copyRich(currentFormatted);
      toast('Citation copied', 'success');
    } catch {
      toast('Copy failed', 'error');
    }
  });

  modal.querySelector('[data-cite-export]').addEventListener('click', () => {
    readModelFromForm();
    refreshPreview();

    if (!currentModel) return;

    const csl = modelToCSL(currentModel, { style: selectedStyle });
    const name = `${safeFilename(currentKey || 'citation')}.csl.json`;

    downloadBlob(
      new Blob([JSON.stringify([csl], null, 2)], { type: 'application/json' }),
      name
    );
  });

  modal.querySelector('[data-cite-insert]').addEventListener('click', () => {
    insertCurrentCitation({ mode: 'footnote' });
  });

  modal.querySelector('[data-cite-insert-ref]').addEventListener('click', () => {
    insertCurrentCitation({ mode: 'bibliography' });
  });

  window.addEventListener('keydown', (e) => {
    if (!modal || modal.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCitationManager();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      insertCurrentCitation({ mode: 'footnote' });
    }
  });

  return modal;
}

function setStatus(msg, type = '') {
  const el = modal?.querySelector('[data-cite-status]');
  if (!el) return;

  el.textContent = msg || '';
  el.className = 'yanta-cite-status' + (type ? ` ${type}` : '');
}

function setWarning(msg) {
  const el = modal?.querySelector('[data-cite-warning]');
  if (!el) return;

  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    return;
  }

  el.hidden = false;
  el.textContent = msg;
}

function updateStyleButtons() {
  for (const btn of modal.querySelectorAll('[data-cite-style]')) {
    const active = btn.dataset.citeStyle === selectedStyle;
    btn.classList.toggle('primary', active);
  }
}

function fillForm(model) {
  if (!modal || !model) return;

  const q = (sel) => modal.querySelector(sel);

  q('[data-cite-type]').value = model.type || 'other';
  q('[data-cite-year]').value = model.year || '';
  q('[data-cite-authors]').value = authorsToInput(model.authors || []);
  q('[data-cite-title-input]').value = model.title || '';
  q('[data-cite-journal]').value = model.journal || model.siteName || '';
  q('[data-cite-publisher]').value = model.publisher || '';
  q('[data-cite-volume]').value = model.volume || '';
  q('[data-cite-issue]').value = model.issue || '';
  q('[data-cite-pages]').value = model.pages || '';
  q('[data-cite-published]').value = model.publishedDate || '';
  q('[data-cite-doi]').value = model.doi || '';
  q('[data-cite-isbn]').value = model.isbn || '';
  q('[data-cite-url]').value = model.url || '';
  q('[data-cite-access]').value = model.accessDate || new Date().toISOString().slice(0, 10);

  const baseKey = citationKeyFromModel(model);
  const key = state.currentNoteId
    ? uniqueCitationKey(state.currentNoteId, baseKey)
    : baseKey;

  q('[data-cite-key]').value = key;

  currentModel = { ...model };
  currentKey = key;
}

function readModelFromForm() {
  if (!modal) return null;

  const q = (sel) => modal.querySelector(sel);

  currentKey = q('[data-cite-key]').value.trim();

  currentModel = {
    type: q('[data-cite-type]').value,
    authors: parseAuthorsInput(q('[data-cite-authors]').value),
    year: q('[data-cite-year]').value.trim(),
    publishedDate: q('[data-cite-published]').value.trim(),
    title: q('[data-cite-title-input]').value.trim(),
    subtitle: '',
    journal: q('[data-cite-journal]').value.trim(),
    siteName: q('[data-cite-journal]').value.trim(),
    volume: q('[data-cite-volume]').value.trim(),
    issue: q('[data-cite-issue]').value.trim(),
    pages: q('[data-cite-pages]').value.trim(),
    publisher: q('[data-cite-publisher]').value.trim(),
    place: '',
    url: q('[data-cite-url]').value.trim(),
    doi: cleanDOI(q('[data-cite-doi]').value.trim()) || q('[data-cite-doi]').value.trim(),
    isbn: q('[data-cite-isbn]').value.trim(),
    accessDate: q('[data-cite-access]').value.trim() || new Date().toISOString().slice(0, 10),
  };

  return currentModel;
}

function refreshPreview({ quiet = false } = {}) {
  const preview = modal.querySelector('[data-cite-preview]');

  if (!currentModel) {
    preview.textContent = 'No citation yet.';
    currentFormatted = '';
    return;
  }

  currentFormatted = formatCitation(currentModel, selectedStyle);
  preview.innerHTML = currentFormatted || '<span class="muted">No citation yet.</span>';

  if (!quiet) {
    setStatus(currentModel.resolver ? `Resolved via ${currentModel.resolver}` : '');
  }

  setWarning(currentModel.warning || '');

  if (!currentKey && currentModel) {
    currentKey = citationKeyFromModel(currentModel);
    modal.querySelector('[data-cite-key]').value = currentKey;
  }
}

async function resolveIntoModal(raw) {
  if (fetching) return;
  fetching = true;

  try {
    setStatus('Fetching metadata…');
    setWarning('');

    const input = normalizeSeed(raw);
    modal.querySelector('[data-cite-input]').value = input;

    const model = await resolveCitation(input);

    fillForm(model);
    refreshPreview();

    setStatus(model.warning ? 'Metadata partially resolved — please verify manually.' : 'Metadata resolved.', model.warning ? 'warn' : 'ok');
  } finally {
    fetching = false;
  }
}

function renderExistingCitations() {
  const host = modal?.querySelector('[data-cite-existing]');
  if (!host) return;

  host.replaceChildren();

  if (!state.currentNoteId) {
    host.innerHTML = `<div class="yanta-cite-empty">Open a note first.</div>`;
    return;
  }

  const md = getMarkdownText(state.currentNoteId).toString();
  const usedKeys = citationInlineRefKeysFromMarkdown(md);

  const list = listCitationsForNote(state.currentNoteId)
    .filter((c) => usedKeys.has(String(c.key || '')));

  if (!list.length) {
    host.innerHTML = `<div class="yanta-cite-empty">No citations saved in this note yet.</div>`;
    return;
  }

  for (const c of list) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'yanta-cite-existing-row';

    const title =
      c.csl?.title ||
      stripHtmlToText(c.formatted || '') ||
      c.key;

    row.innerHTML = `
      <span class="key">[^${escapeHtml(c.key)}]</span>
      <span class="title">${escapeHtml(title)}</span>
    `;

    row.addEventListener('click', () => {
      insertAtCursor(`[^${c.key}]`);

      const md = getMarkdownText(state.currentNoteId).toString();
      if (!hasFootnoteDefinition(md, c.key) && c.formatted) {
        upsertFootnoteDefinition(state.currentNoteId, c.key, c.formatted);
      }

      toast('Existing citation inserted', 'success');
      closeCitationManager();
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      if (c.csl) {
        currentModel = cslToModel(c.csl);
        currentKey = c.key;
        fillForm(currentModel);
        modal.querySelector('[data-cite-key]').value = c.key;
        refreshPreview();
        toast('Citation loaded for editing', 'success');
      }
    });

    host.append(row);
  }
}

function insertCurrentCitation({ mode = 'footnote' } = {}) {
  if (!state.currentNoteId) {
    toast('Open a note first', 'error');
    return;
  }

  readModelFromForm();
  refreshPreview();

  if (!currentModel || !currentFormatted) {
    toast('Create or fetch a citation first', 'error');
    return;
  }

  if (!currentKey) {
    currentKey = uniqueCitationKey(state.currentNoteId, citationKeyFromModel(currentModel));
    modal.querySelector('[data-cite-key]').value = currentKey;
  }

  const csl = modelToCSL(currentModel, { style: selectedStyle });

  setCitation(state.currentNoteId, currentKey, {
    key: currentKey,
    csl,
    formatted: currentFormatted,
    style: selectedStyle,
    model: currentModel,
    created: Date.now(),
    updated: Date.now(),
  });

  if (mode === 'bibliography') {
    insertAtCursor(`\n${stripHtmlToText(currentFormatted)}\n`);
    toast('Bibliography entry inserted', 'success');
    closeCitationManager();
    return;
  }

  insertAtCursor(`[^${currentKey}]`);
  upsertFootnoteDefinition(state.currentNoteId, currentKey, currentFormatted);

  toast('Citation inserted', 'success');
  closeCitationManager();
}

export function openCitationManager(seed = '', {
  fromHistory = false,
} = {}) {
  loadStylePref();
  ensureModal();
  updateStyleButtons();

  const autoSeed = seed || findCitationSeed();

  const wasClosed = modal.hidden !== false;

  modal.hidden = false;

  if (!fromHistory && wasClosed) {
    pushOverlayState('citations', {
      seed: seed || '',
    });
  }
  modal.querySelector('[data-cite-input]').value = autoSeed || '';
  modal.querySelector('[data-cite-preview]').textContent = 'No citation yet.';
  setStatus('');
  setWarning('');
  renderExistingCitations();

  currentModel = null;
  currentKey = '';
  currentFormatted = '';

  const input = modal.querySelector('[data-cite-input]');
  setTimeout(() => input.focus(), 0);

  if (autoSeed) {
    resolveIntoModal(autoSeed).catch((err) => {
      setStatus(err?.message || String(err), 'error');
    });
  }
}

export function closeCitationManager({
  fromHistory = false,
} = {}) {
  if (!modal) return;

  if (!fromHistory && modal.hidden === false) {
    closeTopOverlay(() => {
      closeCitationManager({
        fromHistory: true,
      });
    });

    return;
  }

  modal.hidden = true;
}

export function setupCitations() {
  loadStylePref();
  ensureModal();

  // After each preview render, prune stale citation metadata for the current note.
  // This covers manual deletion of [^key] from the editor.
  window.addEventListener('yanta-preview-rendered', () => {
    if (!state.currentNoteId) return;
    scheduleCitationPrune(state.currentNoteId);
  });
}

// ============================================================
// Citation Library helpers
// Used by Image/Media Library tab to show citations next to
// images and drawings.
// ============================================================

function citationIdentity(citation) {
  const csl = citation?.csl || {};
  const doi = String(csl.DOI || citation?.model?.doi || '').trim().toLowerCase();
  if (doi) return `doi:${doi}`;

  const isbn = String(csl.ISBN || citation?.model?.isbn || '').trim().toLowerCase();
  if (isbn) return `isbn:${isbn}`;

  const url = String(csl.URL || citation?.model?.url || '').trim().toLowerCase();
  if (url) return `url:${url}`;

  const title = String(csl.title || citation?.model?.title || citation?.formatted || '').trim().toLowerCase();
  const authors = (csl.author || [])
    .map((a) => [a.family, a.given, a.literal].filter(Boolean).join(' '))
    .join('|')
    .toLowerCase();

  return `text:${title}|${authors}`;
}

export function collectCitationLibrary({ currentFirst = true } = {}) {
  const out = [];
  const seen = new Set();

  const noteIds = [];

  if (currentFirst && state.currentNoteId) {
    noteIds.push(state.currentNoteId);
  }

  for (const note of state.notes.values()) {
    if (!noteIds.includes(note.id)) noteIds.push(note.id);
  }

  for (const noteId of noteIds) {
    const note = state.notes.get(noteId);
    if (!note) continue;

    const md = getMarkdownText(noteId).toString();
    const usedKeys = citationInlineRefKeysFromMarkdown(md);

    const list = listCitationsForNote(noteId)
      .filter((c) => usedKeys.has(String(c.key || '')));

    for (const c of list) {
      if (!c?.key) continue;

      const ident = citationIdentity(c);
      if (seen.has(ident)) continue;
      seen.add(ident);

      out.push({
        ...c,
        sourceNoteId: noteId,
        sourceNoteTitle: note.title || 'Untitled',
        isFromCurrentNote: noteId === state.currentNoteId,
      });
    }
  }

  return out.sort((a, b) => {
    if (a.isFromCurrentNote !== b.isFromCurrentNote) {
      return a.isFromCurrentNote ? -1 : 1;
    }

    return String(a.key || '').localeCompare(String(b.key || ''));
  });
}

function formattedFromSavedCitation(citation) {
  if (citation?.formatted) return citation.formatted;

  if (citation?.model) {
    return formatCitation(citation.model, citation.style || selectedStyle || 'apa');
  }

  if (citation?.csl) {
    const model = cslToModel(citation.csl);
    return formatCitation(model, citation.style || selectedStyle || 'apa');
  }

  return '';
}

function citationModelFromSavedCitation(citation) {
  if (citation?.model) return citation.model;
  if (citation?.csl) return cslToModel(citation.csl);
  return null;
}

function cslFromSavedCitation(citation) {
  if (citation?.csl) return citation.csl;

  const model = citationModelFromSavedCitation(citation);
  if (model) return modelToCSL(model, { style: citation.style || selectedStyle || 'apa' });

  return null;
}

/**
 * Insert a saved citation into the current note.
 *
 * mode:
 * - "footnote": inserts [^key] and ensures footnote definition exists
 * - "bibliography": inserts plain bibliography entry at cursor
 */
export function insertSavedCitationIntoCurrentNote(citation, { mode = 'footnote' } = {}) {
  if (!state.currentNoteId) {
    toast('Open a note first', 'error');
    return;
  }

  if (!citation) {
    toast('Citation not found', 'error');
    return;
  }

  const noteId = state.currentNoteId;
  const map = getCitationsMap(noteId);

  let key = String(citation.key || '').trim();
  const model = citationModelFromSavedCitation(citation);
  const csl = cslFromSavedCitation(citation);
  const formatted = formattedFromSavedCitation(citation);

  if (!key) {
    key = citationKeyFromModel(model || cslToModel(csl || {}));
  }

  if (!formatted) {
    toast('Citation has no formatted text', 'error');
    return;
  }

  // If another citation with same key but different CSL already exists
  // in the current note, create a safe unique key.
  const existing = map.get(key);

  if (existing) {
    try {
      const a = JSON.stringify(existing.csl || {});
      const b = JSON.stringify(csl || {});

      if (a !== b) {
        key = uniqueCitationKey(noteId, key);
      }
    } catch {
      key = uniqueCitationKey(noteId, key);
    }
  }

  setCitation(noteId, key, {
    ...citation,
    key,
    csl,
    model,
    formatted,
    style: citation.style || selectedStyle,
    sourceNoteId: citation.sourceNoteId || citation.noteId || null,
    sourceNoteTitle: citation.sourceNoteTitle || '',
    updated: Date.now(),
  });

  if (mode === 'bibliography') {
    insertAtCursor(`\n${stripHtmlToText(formatted)}\n`);
    toast('Bibliography entry inserted', 'success');
    return;
  }

  insertAtCursor(`[^${key}]`);
  upsertFootnoteDefinition(noteId, key, formatted);

  toast('Citation inserted', 'success');
}

function injectCitationCss() {
  if (document.getElementById('yanta-citation-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-citation-css';
  style.textContent = `
.yanta-cite-modal {
  position: fixed;
  inset: 0;
  z-index: 210;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0,0,0,0.54);
  backdrop-filter: blur(4px);
  animation: fade-in 0.12s ease;
}

.yanta-cite-modal[hidden] {
  display: none !important;
}

.yanta-cite-card {
  width: min(920px, 96vw);
  max-height: min(860px, 92vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 24px 80px rgba(0,0,0,.45);
}

.yanta-cite-head,
.yanta-cite-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev-2);
}

.yanta-cite-foot {
  border-top: 1px solid var(--border);
  border-bottom: 0;
}

.yanta-cite-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.yanta-cite-title span {
  display: inline-flex;
  color: var(--accent);
}

.yanta-cite-title strong {
  font-size: 14px;
}

.yanta-cite-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.yanta-cite-panel {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
}

.yanta-cite-panel-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--text-faint);
  font-weight: 700;
  margin-bottom: 10px;
}

.yanta-cite-input-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: end;
}

.yanta-cite-input-row label,
.yanta-cite-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-dim);
}

.yanta-cite-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.yanta-cite-grid .wide {
  grid-column: 1 / -1;
}

.yanta-cite-grid .hint {
  color: var(--text-faint);
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}

.yanta-cite-status {
  min-height: 18px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-faint);
}

.yanta-cite-status.ok {
  color: var(--green);
}

.yanta-cite-status.warn {
  color: var(--yellow);
}

.yanta-cite-status.error {
  color: var(--red);
}

.yanta-cite-style-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-dim);
}

.yanta-cite-preview {
  min-height: 58px;
  padding: 12px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: var(--bg);
  font-family: Georgia, "Times New Roman", serif;
  font-size: 16px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.yanta-cite-preview .muted {
  color: var(--text-faint);
  font-family: var(--font);
  font-size: 13px;
}

.yanta-cite-warning {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--yellow) 45%, var(--border));
  background: color-mix(in srgb, var(--yellow) 10%, transparent);
  color: var(--yellow);
  border-radius: 7px;
  font-size: 12px;
}

.yanta-cite-existing {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.yanta-cite-existing-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  background: transparent;
  color: var(--text);
  border: 0;
  border-radius: 7px;
  cursor: pointer;
  text-align: left;
}

.yanta-cite-existing-row:hover {
  background: var(--bg-elev-2);
}

.yanta-cite-existing-row .key {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 11px;
  flex: 0 0 auto;
}

.yanta-cite-existing-row .title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-dim);
  font-size: 12px;
}

.yanta-cite-empty {
  padding: 10px;
  color: var(--text-faint);
  font-size: 12px;
  font-style: italic;
}

.yanta-cite-foot .grow {
  flex: 1;
}

@media (max-width: 720px) {
  .yanta-cite-modal {
    padding: 8px;
    align-items: stretch;
  }

  .yanta-cite-card {
    width: 100%;
    max-height: 96vh;
  }

  .yanta-cite-input-row {
    grid-template-columns: 1fr;
  }

  .yanta-cite-grid {
    grid-template-columns: 1fr;
  }

  .yanta-cite-foot {
    flex-wrap: wrap;
  }

  .yanta-cite-foot .grow {
    display: none;
  }
}
`;

  document.head.append(style);
}