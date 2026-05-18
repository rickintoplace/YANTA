/* ============================================================
   YANTA — notes / folders CRUD, openNote, save, chips, welcome
   ============================================================ */
'use strict';

/* ----------------------------------------------------------------
   notes — CRUD
---------------------------------------------------------------- */
function newNote(folderId = null) {
  const id = uid();
  const note = {
    id,
    title: 'Untitled',
    body: '',
    folderId,
    tags: [],
    pinned: false,
    created: Date.now(),
    updated: Date.now(),
  };
  state.notes.set(id, note);
  store.notes.put(note);
  rebuildWikilinkIndex();
  openNote(id);
  renderTree();
  $('noteTitle').focus();
  $('noteTitle').select();
}

function newFolder(parentId = null) {
  const name = prompt('Folder name:');
  if (!name) return;
  const f = { id: uid(), name: name.trim(), parentId, created: Date.now() };
  state.folders.set(f.id, f);
  store.folders.put(f);
  state.expandedFolders.add(f.id);
  renderTree();
}

// History entry shape: { noteId }. Set _navSuppressPush=true to skip
// pushState (used when reacting to popstate or initial load).
let _navSuppressPush = false;
async function openNote(id) {
  if (state.currentNoteId === id) return;
  if (state.dirty) await saveCurrentNote();
  const note = state.notes.get(id);
  if (!note) return;
  state.currentNoteId = id;
  store.settings.set('lastNoteId', id);
  if (!_navSuppressPush) {
    history.pushState({ noteId: id }, '', '#' + encodeURIComponent(id));
  }
  // Reset undo stack per note — keeps things predictable.
  resetUndo();
  $('noteTitle').value = note.title || '';
  lastMarkdown = note.body || '';
  renderEditor(lastMarkdown);
  $('preview').innerHTML = renderPreview(lastMarkdown);
  renderOutline();
  renderBacklinks();
  renderChips();
  updatePinIcon();
  syncLineHeights();
  updateWordCount(lastMarkdown);
  markSaved();
  renderTree();
  // Pre-load any image blobs referenced by the note so they don't show
  // as "broken" on a cold reload (object URLs from the previous session
  // are gone after page load).
  preloadImagesFor(lastMarkdown);
}

function preloadImagesFor(md) {
  const re = /yanta-img:\/\/([a-z0-9]+)/gi;
  let m;
  const ids = [];
  while ((m = re.exec(md || '')) !== null) ids.push(m[1]);
  if (!ids.length) return;
  let needsRerender = false;
  Promise.all(ids.map(async (id) => {
    if (state.imageBlobs.has(id)) return;
    const rec = await store.images.get(id);
    if (rec && rec.blob) {
      state.imageBlobs.set(id, URL.createObjectURL(rec.blob));
      needsRerender = true;
    }
  })).then(() => {
    if (needsRerender) {
      $('preview').innerHTML = renderPreview(lastMarkdown);
      renderBacklinks();
      renderEditor(lastMarkdown);
      syncLineHeights();
    }
  });
}

async function saveCurrentNote() {
  if (!state.currentNoteId) return;
  const note = state.notes.get(state.currentNoteId);
  if (!note) return;
  const newTitle = $('noteTitle').value.trim() || 'Untitled';
  const newBody = readEditorMarkdown();
  if (note.title === newTitle && note.body === newBody) {
    markSaved();
    return;
  }
  const titleChanged = note.title !== newTitle;
  note.title = newTitle;
  note.body = newBody;
  note.updated = Date.now();
  await store.notes.put(note);
  if (titleChanged) {
    rebuildWikilinkIndex();
    schedulePreview();
  }
  markSaved();
  renderTree();
}

async function deleteCurrentNote() {
  if (!state.currentNoteId) return;
  const note = state.notes.get(state.currentNoteId);
  if (!confirm(`Delete "${note.title}"? This cannot be undone.`)) return;
  await store.notes.del(note.id);
  state.notes.delete(note.id);
  rebuildWikilinkIndex();
  state.currentNoteId = null;
  // pick another note
  const next = [...state.notes.values()].sort((a, b) => b.updated - a.updated)[0];
  if (next) openNote(next.id);
  else clearEditor();
  renderTree();
  toast('Note deleted');
}

function clearEditor() {
  state.currentNoteId = null;
  $('noteTitle').value = '';
  lastMarkdown = '';
  renderEditor('');
  $('preview').innerHTML = '';
  renderChips();
  markSaved();
}

function togglePin() {
  if (!state.currentNoteId) return;
  const n = state.notes.get(state.currentNoteId);
  n.pinned = !n.pinned;
  n.updated = Date.now();
  store.notes.put(n);
  updatePinIcon();
  renderTree();
}
function updatePinIcon() {
  const btn = $('btn-pin');
  if (!state.currentNoteId) { btn.classList.remove('active'); return; }
  const n = state.notes.get(state.currentNoteId);
  btn.classList.toggle('active', !!n?.pinned);
}

/* ----------------------------------------------------------------
   tags / chips
---------------------------------------------------------------- */
function renderChips() {
  const c = $('chips');
  c.replaceChildren();
  if (!state.currentNoteId) return;
  const n = state.notes.get(state.currentNoteId);
  for (const tag of n.tags) {
    const chip = el('span', { class: 'chip' }, '#' + tag,
      el('button', { title: 'Remove tag', onclick: () => removeTag(tag) }, '×'));
    c.append(chip);
  }
}
function addTag(tag) {
  tag = tag.trim().replace(/^#/, '').toLowerCase();
  if (!tag || !state.currentNoteId) return;
  const n = state.notes.get(state.currentNoteId);
  if (!n.tags.includes(tag)) {
    n.tags.push(tag);
    n.updated = Date.now();
    store.notes.put(n);
    renderChips();
    renderTagCloud();
    markSaved();
  }
}
function removeTag(tag) {
  const n = state.notes.get(state.currentNoteId);
  n.tags = n.tags.filter((t) => t !== tag);
  n.updated = Date.now();
  store.notes.put(n);
  renderChips();
  renderTagCloud();
}

/* ----------------------------------------------------------------
   welcome note — created on first launch when the vault is empty
---------------------------------------------------------------- */
async function createWelcomeNote() {
  const body = `# Welcome to YANTA

**Yet another note taking app** — but small, fast, and 100% local.

## Features at a glance

- Markdown editor on the left with **live styled preview** on the right (read-only — formatting is done in the editor)
- **[[Wikilinks]]** between notes — type \`[[\` to get autocomplete; click a missing link to create that note
- **Backlinks panel** below every note shows who references it
- **Interactive graph view** — see your knowledge network (Ctrl+G)
- **Command palette** for everything (Ctrl+P) · **Quick switcher** to jump to any note (Ctrl+O)
- Select text → **floating formatting toolbar** (bold · italic · headings · list · quote · link)
- Drop, paste or upload **images** — choose Base64 or library **references** · live compression preview
- **Folders** with sub-folders, **#tags**, pin, search, full offline use
- **Cross-device sync via export**: a single \`.zip\` mirrors your folder tree on disk. Drop it on any other device to restore the same setup
- Also imports loose \`.md\` files or whole **folders** with sub-folders preserved
- **Auto theme** follows your system

> Try pasting an image from your clipboard right now (\`Ctrl+V\`).

### Shortcuts

| Action | Shortcut |
|---|---|
| Command palette | \`Ctrl+P\` |
| Quick switcher | \`Ctrl+O\` |
| Graph view | \`Ctrl+G\` |
| New note | \`Ctrl+N\` |
| Search | \`Ctrl+K\` |
| Insert image | \`Ctrl+I\` |
| Save | \`Ctrl+S\` |
| Export current note | \`Ctrl+E\` |
| Toggle preview | \`Ctrl+/\` |

### Try wikilinks (hover them!)

This note links to [[Welcome to YANTA]] (itself) and to a non-existent note: [[My next idea]] — click missing ones to create them.

### Admonitions / callouts

> [!NOTE]
> Type \`> [!NOTE]\` (or \`tip\`, \`warning\`, \`info\`, \`important\`, \`caution\`) followed by indented \`>\` lines to get a coloured callout block.

> [!TIP]
> Wrap inline text with \`==text==\` for ==highlight==. Use \`$E=mc^2$\` for inline math and \`$$...$$\` for display math.

> [!WARNING]
> Embedded videos (YouTube / Vimeo) work too — just write \`![](https://www.youtube.com/watch?v=…)\` on its own line.

### Footnotes & citations

A scientific paper[^1] often uses DOI links like doi:10.1038/nature12373 — both are clickable.

[^1]: This is a footnote. Drop \`[^1]\` anywhere and define it with \`[^1]: text\`.

### Transclusion

Embed another note's content with \`![[Note Title]]\` or a section with \`![[Note#Heading]]\`. Updates live as the source note changes.

### Inline formatting examples

- **bold**, *italic*, ***bold italic***, ~~strike~~, ==highlight==, \`code\`
- A [link](https://example.com) and a #tag
- Task lists:
  - [x] Set up storage
  - [ ] Write your first note

\`\`\`js
// fenced code is preserved
console.log("hello from YANTA");
\`\`\`

Happy writing!
`;
  const id = uid();
  const note = { id, title: 'Welcome to YANTA', body, folderId: null, tags: ['welcome'], pinned: true, created: Date.now(), updated: Date.now() };
  state.notes.set(id, note);
  await store.notes.put(note);
  rebuildWikilinkIndex();
  openNote(id);
  renderTree();
}

