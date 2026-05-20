// ============================================================
// YANTA — Note / folder CRUD, openNote, preview rendering,
// tag chips, welcome note.
//
// In the new architecture, note CONTENTS live in a per-note Y.Doc
// (see src/yjs.js). This module handles metadata + the open/save lifecycle:
//   - mount the editor onto the current note's Y.Doc
//   - subscribe to Y.Doc updates to re-render preview/title/sync mirror
//   - update metadata (title, tags, pin, folder) on user actions
// ============================================================

import { $, el, uid, state, store, lucide, fmtDate, debounce, toast } from './core.js';
import {
  getNoteDoc,
  getMarkdownText,
  migrateBodyIfNeeded,
  destroyNoteDoc,
  onDocChange,
  noteMarkdown,
  drawingsTextForNote,
  setDrawing,
} from './yjs.js';
import { mountEditor, destroyEditor, currentMarkdown, focusEditor, getView } from './editor.js';
import { renderPreview, setMarkdownRerenderHook } from './markdown.js';
import { wikilinkIndex } from './features-state.js';
import { renderTree, renderTagCloud } from './tree.js';
import { renderBacklinks, renderOutline } from './features.js';
import { renderShareIndicator } from './sharing.js';
import { syncWriteNote, syncDeleteNoteFile, markNoteSyncStatus, refreshGlobalSyncStatus } from './sync.js';

let _navSuppress = false;
let _unsubDoc = null;

setMarkdownRerenderHook(() => { schedulePreview(); });

function searchHaystack(note, body = '') {
  return [
    note?.title || '',
    (note?.tags || []).join(' '),
    body || '',
    note?.id ? drawingsTextForNote(note.id) : '',
  ].join(' ').toLowerCase();
}

function updateSearchIndexFor(note) {
  if (!note) return;

  let body = '';
  try {
    body = noteMarkdown(note.id);
  } catch {}

  state.searchIndex.set(note.id, searchHaystack(note, body));
}

// ---------------- factories -----------------------------------
export async function newNote(folderId = null, type = 'markdown') {
  const id = uid();
  const note = {
    id,
    title: type === 'list' ? 'Shopping list' : 'Untitled',
    type,
    folderId,
    tags: [],
    pinned: false,
    created: Date.now(),
    updated: Date.now(),
  };
  state.notes.set(id, note);
  await store.notes.put(note);
  updateSearchIndexFor(note);
  rebuildWikilinkIndex();
  await openNote(id);
  renderTree();
  $('noteTitle').focus();
  $('noteTitle').select();
}

export async function newFolder(parentId = null) {
  const name = prompt('Folder name:');
  if (!name) return;
  const f = { id: uid(), name: name.trim(), parentId, created: Date.now() };
  state.folders.set(f.id, f);
  await store.folders.put(f);
  state.expandedFolders.add(f.id);
  renderTree();
}

// ---------------- open / save / delete ------------------------
export async function openNote(id) {
  if (state.currentNoteId === id) return;
  const note = state.notes.get(id);
  if (!note) return;
  // Tear down previous subscription / editor
  if (_unsubDoc) { _unsubDoc(); _unsubDoc = null; }
  state.currentNoteId = id;
  store.settings.set('lastNoteId', id);
  if (!_navSuppress) history.pushState({ noteId: id }, '', '#' + encodeURIComponent(id));

  // Ensure Y.Doc + migration done before mount
  await migrateBodyIfNeeded(note);
  const entry = getNoteDoc(id);
  await entry.ready;

  $('noteTitle').value = note.title || '';
  // Mount editor (replaces previous instance)
  const host = $('editor');
  host.replaceChildren();
  mountEditor(host, { noteId: id });
  renderChips();
  updatePinIcon();
  renderShareIndicator();
  renderTree();
  schedulePreview();
  scrollCurrentNoteToTop();

  // Subscribe to Y.Doc updates → re-render preview, persist mirror.
  _unsubDoc = onDocChange(id, (_update, origin) => {
    const isDrawUpdate =
      typeof origin === 'string' &&
      origin.startsWith('draw');

    if (origin === 'sync-folder') {
      schedulePreview();
      updateSearchIndexFor(note);
      markNoteSyncStatus(id, 'synced');
      refreshGlobalSyncStatus();
      markSaved();
      return;
    }

    if (isDrawUpdate) {
      window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
        detail: { noteId: id },
      }));

      updateSearchIndexFor(note);

      note.updated = Date.now();
      store.notes.put(note);

      // Yjs/y-indexeddb persistiert das Drawing sowieso.
      // Optional Sync-Mirror/Snapshot anstoßen, aber Footer nicht dauernd auf dirty setzen.
      scheduleMirror(note);

      return;
    }

    schedulePreview();
    updateSearchIndexFor(note);

    markDirty();

    note.updated = Date.now();
    store.notes.put(note);

    scheduleMirror(note);

    markNoteSyncStatus(id, 'local');
    refreshGlobalSyncStatus();
  });

  preloadImagesFor(noteMarkdown(id));
}

function scrollCurrentNoteToTop() {
  const run = () => {
    const editorScroller = getView()?.scrollDOM;
    const previewPane = $('panePreview');

    if (editorScroller) editorScroller.scrollTop = 0;
    if (previewPane) previewPane.scrollTop = 0;
  };

  requestAnimationFrame(() => {
    run();
    requestAnimationFrame(run);
  });
}

function videoSrcIn(el) {
  const src = el
    ?.querySelector?.('.pv-embed-video iframe[src]')
    ?.getAttribute('src') || '';

  if (!src) return '';

  // URLs normalisieren, damit relative/absolute Varianten gleich verglichen werden.
  try {
    return new URL(src, location.href).href;
  } catch {
    return src;
  }
}

function syncAttrs(target, source) {
  for (const attr of [...target.attributes]) {
    if (!source.hasAttribute(attr.name)) {
      target.removeAttribute(attr.name);
    }
  }

  for (const attr of [...source.attributes]) {
    target.setAttribute(attr.name, attr.value);
  }
}

function setPreviewHtmlPreservingVideos(previewEl, html) {
  if (!previewEl) return;

  const hasOldVideo = !!previewEl.querySelector('.pv-embed-video iframe[src]');

  // Kein Video im alten Preview: schneller Normalpfad.
  if (!hasOldVideo) {
    previewEl.innerHTML = html;
    return;
  }

  // Backlinks werden nachher wieder von renderBacklinks() erzeugt.
  previewEl.querySelector('.backlinks')?.remove();

  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  const oldLines = [...previewEl.children].filter((el) =>
    el.classList?.contains('pv-line')
  );

  const newLines = [...tmp.children].filter((el) =>
    el.classList?.contains('pv-line')
  );

  const max = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < max; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (!newLine) {
      oldLine?.remove();
      continue;
    }

    if (!oldLine) {
      previewEl.append(newLine);
      continue;
    }

    const oldVideoSrc = videoSrcIn(oldLine);
    const newVideoSrc = videoSrcIn(newLine);

    const sameSourceLine =
      oldLine.dataset.line === newLine.dataset.line;

    const sameVideo =
      oldVideoSrc &&
      newVideoSrc &&
      oldVideoSrc === newVideoSrc;

    // Wichtig:
    // Wenn auf derselben Source-Line derselbe Video-Embed steht,
    // behalten wir die ALTE DOM-Node komplett.
    // Dadurch bleibt das iframe leben und YouTube lädt nicht neu.
    if (sameSourceLine && sameVideo) {
      syncAttrs(oldLine, newLine);
      continue;
    }

    oldLine.replaceWith(newLine);
  }
}

export function clearEditor() {
  if (_unsubDoc) { _unsubDoc(); _unsubDoc = null; }
  state.currentNoteId = null;
  $('noteTitle').value = '';
  destroyEditor();
  $('editor').replaceChildren();
  $('preview').innerHTML = '';
  renderChips();
  markSaved();
}

export async function saveCurrentNote() {
  if (!state.currentNoteId) return;
  const note = state.notes.get(state.currentNoteId);
  if (!note) return;
  const newTitle = $('noteTitle').value.trim() || 'Untitled';
  const titleChanged = note.title !== newTitle;
  note.title = newTitle;
  note.updated = Date.now();
  await store.notes.put(note);
  updateSearchIndexFor(note);
  if (titleChanged) {
    rebuildWikilinkIndex();
    schedulePreview();
  }
  syncWriteNote(note).catch(() => {});
  markSaved();
  renderTree();
}

export async function deleteCurrentNote() {
  if (!state.currentNoteId) return;
  const note = state.notes.get(state.currentNoteId);
  if (!confirm(`Delete "${note.title}"? This cannot be undone.`)) return;
  await store.notes.del(note.id);
  state.notes.delete(note.id);
  await destroyNoteDoc(note.id);
  syncDeleteNoteFile(note).catch(() => {});
  rebuildWikilinkIndex();
  state.currentNoteId = null;
  const next = [...state.notes.values()].sort((a, b) => b.updated - a.updated)[0];
  if (next) openNote(next.id); else clearEditor();
  renderTree();
  toast('Note deleted');
}

export function togglePin() {
  if (!state.currentNoteId) return;
  const n = state.notes.get(state.currentNoteId);
  n.pinned = !n.pinned;
  n.updated = Date.now();
  store.notes.put(n);
  updatePinIcon();
  renderTree();
}
export function updatePinIcon() {
  const btn = $('btn-pin');
  if (!state.currentNoteId) { btn.classList.remove('active'); return; }
  const n = state.notes.get(state.currentNoteId);
  btn.classList.toggle('active', !!n?.pinned);
}

// ---------------- tags ----------------------------------------
export function renderChips() {
  const c = $('chips');
  c.replaceChildren();
  if (!state.currentNoteId) return;
  const n = state.notes.get(state.currentNoteId);
  for (const tag of n.tags || []) {
    const chip = el('span', { class: 'chip' }, '#' + tag,
      el('button', { title: 'Remove tag', onclick: () => removeTag(tag) }, '×'));
    c.append(chip);
  }
}
export function addTag(tag) {
  tag = tag.trim().replace(/^#/, '').toLowerCase();
  if (!tag || !state.currentNoteId) return;
  const n = state.notes.get(state.currentNoteId);
  if (!n.tags) n.tags = [];
  if (!n.tags.includes(tag)) {
    n.tags.push(tag);
    n.updated = Date.now();
    store.notes.put(n);
    updateSearchIndexFor(n);
    renderChips();
    renderTagCloud();
  }
}
export function removeTag(tag) {
  const n = state.notes.get(state.currentNoteId);
  n.tags = (n.tags || []).filter((t) => t !== tag);
  n.updated = Date.now();
  store.notes.put(n);
  updateSearchIndexFor(n);
  renderChips();
  renderTagCloud();
}

// ---------------- wikilink index ------------------------------
export function rebuildWikilinkIndex() {
  wikilinkIndex.clear();
  for (const n of state.notes.values()) if (n.title) wikilinkIndex.set(n.title.toLowerCase(), n.id);
}

// ---------------- preview + mirror ----------------------------
export const schedulePreview = debounce(() => {
  if (!state.currentNoteId) return;

  const md = noteMarkdown(state.currentNoteId);
  setPreviewHtmlPreservingVideos($('preview'), renderPreview(md));
  renderOutline(md);
  renderBacklinks(state.currentNoteId);
  updateWordCount(md);

  requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent('yanta-preview-rendered'));
  });
}, 80);

const scheduleMirror = debounce(async (note) => {
  try {
    await syncWriteNote(note);
    markSaved();
  } catch {
    // Keep dirty state if writing failed.
  }
}, 700);

function preloadImagesFor(md) {
  const re = /yanta-img:\/\/([a-z0-9]+)/gi;
  const ids = [];
  let m;
  while ((m = re.exec(md || '')) !== null) ids.push(m[1]);
  if (!ids.length) return;
  let needsRerender = false;
  Promise.all(ids.map(async (id) => {
    if (state.imageBlobs.has(id)) return;
    const rec = await store.images.get(id);
    if (rec && rec.blob) { state.imageBlobs.set(id, URL.createObjectURL(rec.blob)); needsRerender = true; }
  })).then(() => { if (needsRerender) schedulePreview(); });
}

// ---------------- dirty / saved status ------------------------
export function markDirty() {
  state.dirty = true;
  const e = $('statSaved');
  if (e) { e.textContent = 'Saving…'; e.className = 'dirty'; }
}
export function markSaved() {
  state.dirty = false;
  const e = $('statSaved');
  if (e) { e.textContent = 'Saved · ' + fmtDate(Date.now()); e.className = 'saved'; }
}

function updateWordCount(md) {
  const text = md.replace(/```[\s\S]*?```/g, '').replace(/[#*_>`-]/g, '').trim();
  const words = text ? text.split(/\s+/).length : 0;
  $('statWords').textContent = words + ' word' + (words === 1 ? '' : 's');
  $('statChars').textContent = md.length + ' char' + (md.length === 1 ? '' : 's');
}

// ---------------- welcome -------------------------------------
export async function createWelcomeNote() {
  const now = Date.now();

  const folderIds = {
    start: uid(),
    guides: uid(),
    examples: uid(),
  };

  const folders = [
    {
      id: folderIds.start,
      name: 'Start here',
      parentId: null,
      created: now,
      icon: 'sparkles',
      color: '#6ea8fe',
    },
    {
      id: folderIds.guides,
      name: 'Guides',
      parentId: null,
      created: now,
      icon: 'book-open',
      color: '#a78bfa',
    },
    {
      id: folderIds.examples,
      name: 'Examples',
      parentId: null,
      created: now,
      icon: 'flask-conical',
      color: '#4ade80',
    },
  ];

  for (const folder of folders) {
    state.folders.set(folder.id, folder);
    await store.folders.put(folder);
    state.expandedFolders.add(folder.id);
  }

  const ids = {
    welcome: uid(),
    map: uid(),
    markdown: uid(),
    drawing: uid(),
    graph: uid(),
    sync: uid(),
    media: uid(),
    tasks: uid(),
    research: uid(),
  };

  const drawingId = uid();

const notes = [
  {
    id: ids.welcome,
    title: 'Welcome to YANTA',
    type: 'markdown',
    folderId: folderIds.start,
    tags: ['welcome', 'onboarding', 'start'],
    pinned: true,
    icon: 'sparkles',
    color: '#2563eb',
    body: `# Welcome to YANTA

Welcome to **YANTA**, a local-first Markdown workspace for notes, drawings, tasks, graph navigation and sync.

This vault is not just a feature demo. It is a guided starting point.

> [!NOTE]
> If you only read one note, read this one and follow the short tour below.

## The 5-minute tour

### 1. Write something

Open [[Markdown Essentials]] when you want to learn how YANTA notes are written.

You will see:

- headings
- lists
- tasks
- callouts
- equations
- Wikilinks

### 2. Connect two ideas

YANTA uses Wikilinks to connect notes.

A useful link is not decorative. It should help you move from one idea to the next.

Example:

- this welcome note points to [[Markdown Essentials]]
- the writing guide explains how links work
- the graph guide explains what those links become

### 3. Open the graph

Press Ctrl/⌘+G after reading a few notes.

The graph should feel like a map of meaningful relationships, not like a tangled ball of random lines.

### 4. Try one visual note

YANTA can embed drawings directly inside Markdown notes.

You can try that later in the visual guide.

### 5. Decide your next path

Open [[Feature Map]] when you are ready to choose what to explore next.

## First checklist

- [ ] Read this note
- [ ] Open [[Markdown Essentials]]
- [ ] Create one new note
- [ ] Add one meaningful Wikilink
- [ ] Open the graph
- [ ] Return to [[Feature Map]] and choose a path

## Mental model

Think of YANTA as three layers:

:lucide[file-text]{#0891b2}: **Notes** are where you write.  
:lucide[network]{#7c3aed}: **Links** are how ideas connect.  
:lucide[folder-sync]{#d97706}: **Sync** is how your workspace stays portable.

Start small. Add structure only when it helps.`,
  },
  {
    id: ids.map,
    title: 'Feature Map',
    type: 'markdown',
    folderId: folderIds.start,
    tags: ['overview', 'navigation', 'guide'],
    pinned: true,
    icon: 'map',
    color: '#1d4ed8',
    body: `# Feature Map

This is the main map of the welcome vault.

Unlike normal notes, this note is allowed to link broadly because its job is orientation.

## What do you want to do?

### I want to write better notes

Start here:

1. [[Markdown Essentials]]
2. [[Tasks & Workflows]]
3. [[Research Notes]]

Use this path if you want to learn formatting, structure, checkboxes, equations or reference-style notes.

### I want to understand the graph

Start here:

1. [[Graph & Wikilinks]]
2. [[Markdown Essentials]]
3. [[Drawings & Visual Thinking]]

Use this path if you want to understand why some notes are connected and how to keep the graph useful.

### I want to think visually

Start here:

1. [[Drawings & Visual Thinking]]
2. [[Images, Icons & Media]]
3. [[Graph & Wikilinks]]

Use this path if you like diagrams, sketches, concept maps or visual workflows.

### I want to organize real work

Start here:

1. [[Tasks & Workflows]]
2. [[Sync & Live Sharing]]
3. [[Research Notes]]

Use this path if you want a practical workspace for projects, reading, planning or recurring review.

## All notes

### Start

- [[Welcome to YANTA]]

### Guides

- [[Markdown Essentials]]
- [[Graph & Wikilinks]]
- [[Drawings & Visual Thinking]]
- [[Sync & Live Sharing]]

### Examples

- [[Images, Icons & Media]]
- [[Tasks & Workflows]]
- [[Research Notes]]

## Structure principle

This vault uses a simple rule:

> [!TIP]
> The map links to many notes. Normal notes link only to directly relevant next steps.

That keeps the graph readable while still giving new users clear navigation.`,
  },
  {
    id: ids.markdown,
    title: 'Markdown Essentials',
    type: 'markdown',
    folderId: folderIds.guides,
    tags: ['markdown', 'writing', 'syntax'],
    pinned: false,
    icon: 'file-text',
    color: '#0891b2',
    body: `# Markdown Essentials

Markdown is the writing layer of YANTA.

Use this note when you want to understand how to format text, structure notes and create links.

## Start with plain structure

A useful note usually starts with simple structure:

# Title

## Main idea

Write the core idea in a few sentences.

## Details

- one supporting point
- another supporting point
- a question to answer later

## Formatting

Use common Markdown formatting:

- **bold** for emphasis
- *italic* for subtle emphasis
- ==highlight== for important phrases
- ~~strikethrough~~ for removed ideas
- inline code for technical terms

## Tasks

Tasks are plain Markdown checkboxes:

- [ ] Capture an idea
- [ ] Clarify it
- [ ] Decide whether it needs a link

For a practical workflow built around checkboxes, continue with [[Tasks & Workflows]].

## Wikilinks

Wikilinks connect notes by title.

Example:

- [[Graph & Wikilinks]]

Use a Wikilink when the target note is a useful next step or explanation.

Do not link every possible keyword. That makes navigation worse.

## Callouts

> [!NOTE]
> Callouts are readable in preview mode and still editable as Markdown.

> [!TIP]
> A good note is not the longest note. It is the note you can understand again later.

## Math and references

Inline math:

$E=mc^2$

Block-style math placeholder:

$$\\nabla \\cdot E = \\rho / \\epsilon_0$$

DOI example:

doi:10.1038/nature12373

For scientific note structure, see [[Research Notes]].

## Next step

If you understand Wikilinks, continue with [[Graph & Wikilinks]].`,
  },
  {
    id: ids.graph,
    title: 'Graph & Wikilinks',
    type: 'markdown',
    folderId: folderIds.guides,
    tags: ['graph', 'wikilinks', 'navigation'],
    pinned: false,
    icon: 'network',
    color: '#7c3aed',
    body: `# Graph & Wikilinks

The graph view turns your notes into a navigable network.

The goal is not maximum connectivity. The goal is meaningful connectivity.

## What creates graph structure?

YANTA can use several signals:

- Wikilinks in Markdown notes
- links inside drawings
- folder structure
- optional semantic suggestions

## A good link has a reason

Before adding a Wikilink, ask:

- Does the target note explain this idea?
- Is it the next useful step?
- Is it a concrete example?
- Would I actually want to navigate there from here?

If the answer is no, skip the link.

## Example relationship

Writing a Wikilink is part of Markdown, so the syntax belongs in [[Markdown Essentials]].

Visual notes can also contain links, so drawing-based relationships are covered in [[Drawings & Visual Thinking]].

## Try the graph

Press Ctrl/⌘+G or open the graph from the sidebar.

Then try this:

- click a node to preview a note
- double-click a node to open it
- search for a note title
- look for hubs
- look for isolated notes
- hide or show folders if the view gets too busy

## Reading this vault

In this welcome vault:

- [[Feature Map]] is the main hub
- guide notes form a learning path
- examples connect to the guide they demonstrate

That gives the graph structure without making every note point to every other note.`,
  },
  {
    id: ids.drawing,
    title: 'Drawings & Visual Thinking',
    type: 'markdown',
    folderId: folderIds.guides,
    tags: ['drawing', 'excalidraw', 'visual'],
    pinned: false,
    icon: 'pencil',
    color: '#16a34a',
    body: `# Drawings & Visual Thinking

Some ideas are easier to understand visually.

YANTA can embed Excalidraw scenes directly inside Markdown notes.

The line below is a real drawing reference:

draw://${drawingId}

## When drawings help

Use drawings for:

- concept maps
- system diagrams
- workflows
- research models
- architecture sketches
- quick visual explanations

## Try this

- Click into the drawing in edit or split mode
- Add a rectangle
- Add an arrow
- Add a text label
- Drag a note from the sidebar into the drawing
- Link a drawing element to a note

## Drawings and links

Drawings can contribute to the graph when they contain note references.

For how those relationships appear, see [[Graph & Wikilinks]].

## Reusing drawings

Drawings can also behave like reusable visual assets.

That workflow is shown in [[Images, Icons & Media]].

## Good practice

A useful drawing has a clear purpose.

It should usually link to the few notes it explains, not to the whole vault.`,
  },
  {
    id: ids.sync,
    title: 'Sync & Live Sharing',
    type: 'markdown',
    folderId: folderIds.guides,
    tags: ['sync', 'sharing', 'backup'],
    pinned: false,
    icon: 'refresh-cw',
    color: '#d97706',
    body: `# Sync & Live Sharing

YANTA is local-first.

That means your workspace should remain useful even before you think about cloud accounts or collaboration.

## Folder sync

Use the sync indicator in the sidebar footer to select a folder.

YANTA can write:

- human-readable Markdown mirrors
- assets such as images
- CRDT snapshots for robust conflict handling

This works with normal folder sync tools such as:

- Syncthing
- Dropbox
- iCloud Drive
- SMB shares
- external drives
- regular backup folders

## Live sharing

Use the Share button in the note toolbar when you want active collaboration.

A share link contains room credentials in the URL fragment. The transport uses WebRTC and an end-to-end encrypted room password.

## Recommended setup

- [ ] Choose a local sync folder
- [ ] Let YANTA write Markdown mirrors
- [ ] Back up that folder with your normal backup tool
- [ ] Use live sharing only when someone should edit with you
- [ ] Review your workspace regularly

For recurring maintenance and review checklists, see [[Tasks & Workflows]].

## Simple rule

Sync is not organization.

First make your notes understandable. Then make them portable.`,
  },
  {
    id: ids.media,
    title: 'Images, Icons & Media',
    type: 'markdown',
    folderId: folderIds.examples,
    tags: ['media', 'icons', 'images'],
    pinned: false,
    icon: 'image',
    color: '#f97316',
    body: `# Images, Icons & Media

This note shows how YANTA can make Markdown richer without turning it into a messy document.

Use media when it adds meaning.

## Inline icons

You can write Lucide icons directly in Markdown:

:lucide[sparkles]{#2563eb}: start and orientation  
:lucide[file-text]{#0891b2}: writing and Markdown  
:lucide[network]{#7c3aed}: graph and structure  
:lucide[pencil]{#16a34a}: visual thinking  
:lucide[refresh-cw]{#d97706}: sync and backup  

The colors follow the same visual language as this vault.

## Images

Use the image button or Ctrl/⌘+I.

YANTA can store images as local library references instead of bloating Markdown with Base64.

## Drawings as visual assets

Drawings from [[Drawings & Visual Thinking]] can be reused as part of your visual library.

## Media guidelines

Good uses of media:

- a diagram that explains a concept
- a screenshot that documents a state
- an image that serves as evidence
- an icon that improves scanning

Weak uses of media:

- decoration without meaning
- repeated screenshots without context
- colorful elements that do not encode anything

## Related basics

For normal formatting and note structure, see [[Markdown Essentials]].`,
  },
  {
    id: ids.tasks,
    title: 'Tasks & Workflows',
    type: 'markdown',
    folderId: folderIds.examples,
    tags: ['tasks', 'workflow', 'planning'],
    pinned: false,
    icon: 'list-checks',
    color: '#059669',
    body: `# Tasks & Workflows

YANTA tasks are plain Markdown checkboxes.

They work well for lightweight planning because they stay readable, portable and editable.

## Daily capture

Use this when you need a low-friction inbox:

- [ ] Capture the idea
- [ ] Add one sentence of context
- [ ] Decide whether it needs action
- [ ] Link it only if another note is directly useful
- [ ] Review it later

## A simple note workflow

1. Capture quickly
2. Clarify the title
3. Add headings if the note grows
4. Add tasks only when action is required
5. Add Wikilinks only when navigation becomes useful
6. Review unfinished items

## Example project note

### Goal

What should be true when this project is done?

### Next actions

- [ ] Define the problem
- [ ] Collect material
- [ ] Write a first draft
- [ ] Review open questions

### Decisions

- Decision 1
- Decision 2

### Open questions

- What is still unclear?
- Who needs to be involved?

## Useful foundations

Task syntax is part of Markdown, so the writing basics are covered in [[Markdown Essentials]].

If your workflow spans multiple devices, combine it with [[Sync & Live Sharing]].

For reading papers or technical material, see [[Research Notes]].`,
  },
  {
    id: ids.research,
    title: 'Research Notes',
    type: 'markdown',
    folderId: folderIds.examples,
    tags: ['research', 'science', 'references'],
    pinned: false,
    icon: 'beaker',
    color: '#e11d48',
    body: `# Research Notes

This note shows a structured pattern for scientific or technical reading.

It is not a medical, legal or domain-specific recommendation. It is only a note-taking template.

## What a research note should do

A useful research note should help you answer:

- What is the claim?
- What evidence supports it?
- What method was used?
- What are the limitations?
- What should I read or test next?

## Example claim

A research note can combine prose, DOI links, equations, tasks and footnotes.[^localfirst]

DOI example:

doi:10.1038/nature12373

## Reading checklist

- [ ] Extract the main claim
- [ ] Note the method
- [ ] Record assumptions
- [ ] Save relevant references
- [ ] Write down limitations
- [ ] Add open questions
- [ ] Create a visual model if the concept is easier to understand spatially

## Equation placeholder

Inline math:

$p(x|y)$

Block-style math placeholder:

$$L(\\theta)=\\sum_i \\log p(x_i|\\theta)$$

## Suggested structure

### Summary

What is the work about?

### Method

How was the result obtained?

### Evidence

Which data, experiment or argument supports the claim?

### Limitations

What remains uncertain?

### Follow-up

Which question should be investigated next?

## Related notes

For formatting, equations and DOI syntax, see [[Markdown Essentials]].

For diagrams, models or concept sketches, see [[Drawings & Visual Thinking]].

[^localfirst]: Local-first tools keep user data available offline and sync later when possible.`,
  },
];

  for (const note of notes) {
    const { body, ...meta } = note;

    meta.created = now;
    meta.updated = now;

    state.notes.set(meta.id, meta);
    await store.notes.put(meta);

    const entry = getNoteDoc(meta.id);
    await entry.ready;

    const ytext = entry.doc.getText('markdown');

    if (ytext.length === 0) {
      ytext.insert(0, body);
    }

    updateSearchIndexFor(meta);
  }

  const makeBox = (i, x, y, width, height, strokeColor, backgroundColor) => ({
    id: uid(),
    type: 'rectangle',
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor,
    backgroundColor,
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    seed: 1000 + i,
    version: 1,
    versionNonce: 2000 + i,
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
  });

  const makeLinkedText = (i, title, noteId, x, y, width, color = '#f8f9fa') => {
    const text = `[[${title}]]`;

    return {
      id: uid(),
      type: 'text',
      x,
      y,
      width,
      height: 34,
      angle: 0,
      strokeColor: color,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 3000 + i,
      version: 1,
      versionNonce: 4000 + i,
      isDeleted: false,
      boundElements: null,
      updated: now,
      link: `yanta-note://${noteId}`,
      locked: false,

      text,
      rawText: text,
      originalText: text,
      fontSize: 20,
      fontFamily: 5,
      textAlign: 'center',
      verticalAlign: 'middle',
      baseline: 24,
      containerId: null,
      lineHeight: 1.25,

      customData: {
        yanta: {
          wikilink: {
            noteId,
            target: title,
            alias: null,
            href: `yanta-note://${noteId}`,
            updated: now,
          },
        },
      },
    };
  };

  const makeLabel = (i, text, x, y, width, color = '#f8f9fa', fontSize = 22) => ({
    id: uid(),
    type: 'text',
    x,
    y,
    width,
    height: Math.max(34, fontSize * 1.4),
    angle: 0,
    strokeColor: color,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 5000 + i,
    version: 1,
    versionNonce: 6000 + i,
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,

    text,
    rawText: text,
    originalText: text,
    fontSize,
    fontFamily: 5,
    textAlign: 'center',
    verticalAlign: 'middle',
    baseline: Math.round(fontSize * 1.15),
    containerId: null,
    lineHeight: 1.25,
    customData: {},
  });

  setDrawing(ids.drawing, drawingId, {
    id: drawingId,
    title: 'YANTA Feature Map',
    canvas: {
      width: 960,
      height: 560,
    },
    elements: [
      makeBox(1, 350, 210, 260, 90, '#6ea8fe', '#1e293b'),
      makeLabel(2, 'YANTA', 390, 232, 180, '#6ea8fe', 34),

      makeBox(3, 70, 60, 230, 70, '#a78bfa', '#2e1065'),
      makeLinkedText(4, 'Feature Map', ids.map, 86, 80, 198),

      makeBox(5, 365, 45, 230, 70, '#22d3ee', '#164e63'),
      makeLinkedText(6, 'Markdown Essentials', ids.markdown, 382, 65, 198),

      makeBox(7, 660, 60, 230, 70, '#4ade80', '#14532d'),
      makeLinkedText(8, 'Graph & Wikilinks', ids.graph, 676, 80, 198),

      makeBox(9, 70, 395, 230, 70, '#fbbf24', '#713f12'),
      makeLinkedText(10, 'Sync & Live Sharing', ids.sync, 86, 415, 198),

      makeBox(11, 365, 430, 230, 70, '#fb923c', '#7c2d12'),
      makeLinkedText(12, 'Images, Icons & Media', ids.media, 382, 450, 198),

      makeBox(13, 660, 395, 230, 70, '#10b981', '#064e3b'),
      makeLinkedText(14, 'Tasks & Workflows', ids.tasks, 676, 415, 198),

      makeBox(15, 660, 230, 230, 70, '#f87171', '#7f1d1d'),
      makeLinkedText(16, 'Research Notes', ids.research, 676, 250, 198),

      makeLabel(
        17,
        'Tip: drag notes from the sidebar into a drawing, or type [[ to create linked drawing text.',
        190,
        525,
        590,
        '#94a3b8',
        18
      ),
    ],
    appState: {
      theme: 'dark',
      viewBackgroundColor: '#121212',
      currentItemStrokeColor: '#f8f9fa',
      currentItemBackgroundColor: 'transparent',
    },
    files: {},
  }, 'welcome-draw');

  updateSearchIndexFor(state.notes.get(ids.drawing));

  rebuildWikilinkIndex();

  await openNote(ids.welcome);

  renderTree();

  toast('Welcome vault created', 'success');
}

export function setNavSuppress(v) { _navSuppress = v; }

// Used by wikilink follow when target doesn't exist.
export async function createNoteWithTitle(title) {
  const id = uid();
  const note = { id, title: title.trim() || 'Untitled', type: 'markdown', folderId: state.notes.get(state.currentNoteId)?.folderId || null, tags: [], pinned: false, created: Date.now(), updated: Date.now() };
  state.notes.set(id, note);
  await store.notes.put(note);
  updateSearchIndexFor(note);
  rebuildWikilinkIndex();
  await openNote(id);
  renderTree();
}
