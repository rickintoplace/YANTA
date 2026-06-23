// ============================================================
// YANTA — Note Chrome
// Header + mobile bottom actions for the note view.
// ============================================================

import {
  $,
  el,
  state,
  lucide,
  toast,
  uid,
} from './core.js';

import {
  insertAtCursor,
  getView,
} from './editor.js';

import {
  togglePin,
  addTag,
  removeTag,
} from './notes.js';

import {
  applyEditorFormat,
} from './format-menu.js';

import {
  showMenu,
} from './tree.js';

import {
  duplicateNoteById,
} from './item-actions.js';

import {
  showDashboardFromNote,
} from './dashboard.js';

import {
  calendarEventUrl,
} from './navigation.js';

import {
  renderShareIndicator,
} from './sharing.js';

const MOBILE_MQ = window.matchMedia('(max-width: 760px)');

let initialized = false;
let formatBtn = null;
let viewToggleBtn = null;
let titleRow = null;
let notePicker = null;
let tagsPopover = null;

function isMobile() {
  return MOBILE_MQ.matches;
}

function currentNote() {
  return state.currentNoteId
    ? state.notes.get(state.currentNoteId)
    : null;
}

function setViewMode(view) {
  window.dispatchEvent(new CustomEvent('yanta-set-view', {
    detail: { view },
  }));

  requestAnimationFrame(() => {
    refreshHeaderButtons();
    updateViewToggleButton();
  });
}

function currentTags() {
  return currentNote()?.tags || [];
}

function tagSummaryLabel() {
  const count = currentTags().length;
  return count ? `Tags · ${count}` : 'Tags';
}

function closeTagsPopover() {
  if (!tagsPopover) return;

  document.removeEventListener('pointerdown', tagsPopover.__outside, true);
  tagsPopover.remove();
  tagsPopover = null;
}

function renderTagsPopoverBody(body) {
  const note = currentNote();

  body.replaceChildren();

  if (!note) {
    body.append(el('div', { class: 'yanta-tags-empty' }, 'Open a note first.'));
    return;
  }

  const tags = note.tags || [];

  const currentWrap = el('div', { class: 'yanta-tags-section' });
  currentWrap.append(el('div', { class: 'yanta-tags-section-title' }, 'This note'));

  const pills = el('div', { class: 'yanta-tags-pills' });

  if (!tags.length) {
    pills.append(el('div', { class: 'yanta-tags-empty' }, 'No tags yet.'));
  } else {
    for (const tag of tags) {
      const pill = el('button', {
        type: 'button',
        class: 'yanta-tags-pill active',
        title: `Remove #${tag}`,
        onclick: async () => {
          removeTag(tag);
          renderTagsPopoverBody(body);
          refreshHeaderButtons();
        },
      });

      pill.innerHTML = `<span>#${tag}</span>${lucide('x', 13)}`;
      pills.append(pill);
    }
  }

  currentWrap.append(pills);

  const input = el('input', {
    class: 'text-input yanta-tags-input',
    placeholder: 'Add tag and press Enter…',
    autocomplete: 'off',
    spellcheck: 'false',
  });

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;

    e.preventDefault();

    const value = input.value.trim();
    if (!value) return;

    addTag(value);
    input.value = '';

    renderTagsPopoverBody(body);
    refreshHeaderButtons();
  });

  const allTags = new Map();

  for (const n of state.notes.values()) {
    for (const tag of n.tags || []) {
      allTags.set(tag, (allTags.get(tag) || 0) + 1);
    }
  }

  const suggestions = [...allTags.entries()]
    .filter(([tag]) => !tags.includes(tag))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 18);

  const suggestWrap = el('div', { class: 'yanta-tags-section' });
  suggestWrap.append(el('div', { class: 'yanta-tags-section-title' }, 'Suggestions'));

  const suggestPills = el('div', { class: 'yanta-tags-pills' });

  if (!suggestions.length) {
    suggestPills.append(el('div', { class: 'yanta-tags-empty' }, 'No suggestions.'));
  } else {
    for (const [tag, count] of suggestions) {
      const btn = el('button', {
        type: 'button',
        class: 'yanta-tags-pill',
        title: `Add #${tag}`,
        onclick: () => {
          addTag(tag);
          renderTagsPopoverBody(body);
          refreshHeaderButtons();
        },
      }, `#${tag} · ${count}`);

      suggestPills.append(btn);
    }
  }

  suggestWrap.append(suggestPills);

  body.append(currentWrap, input, suggestWrap);

  requestAnimationFrame(() => input.focus());
}

function openTagsPopover(anchor) {
  closeTagsPopover();

  tagsPopover = el('div', {
    class: 'yanta-tags-popover',
    role: 'dialog',
    'aria-label': 'Manage note tags',
  });

  const head = el('div', { class: 'yanta-tags-popover-head' },
    el('strong', {}, 'Manage tags'),
    el('button', {
      type: 'button',
      class: 'icon-btn',
      title: 'Close',
      onclick: closeTagsPopover,
    })
  );

  head.querySelector('button').innerHTML = lucide('x', 16);

  const body = el('div', { class: 'yanta-tags-popover-body' });

  tagsPopover.append(head, body);
  document.body.append(tagsPopover);

  const r = anchor.getBoundingClientRect();
  const width = 340;

  tagsPopover.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, r.left))}px`;
  tagsPopover.style.top = `${Math.min(window.innerHeight - 420, r.bottom + 8)}px`;

  tagsPopover.__outside = (e) => {
    if (!tagsPopover) return;
    if (tagsPopover.contains(e.target)) return;
    closeTagsPopover();
  };

  setTimeout(() => {
    document.addEventListener('pointerdown', tagsPopover.__outside, true);
  }, 0);

  renderTagsPopoverBody(body);
}

function iconButton({
  id = '',
  icon,
  title,
  className = '',
  onClick,
}) {
  const btn = el('button', {
    id: id || null,
    type: 'button',
    class: `icon-btn ${className}`.trim(),
    title,
    'aria-label': title,
    onclick: async (e) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        await onClick?.(btn, e);
      } catch (err) {
        console.error(err);
        toast('Action failed', 'error');
      }
    },
  });

  btn.innerHTML = lucide(icon, 18);
  return btn;
}

function mainHeader() {
  let header = document.querySelector('.main-head');

  if (!header) {
    header = el('header', { class: 'main-head' });
    document.querySelector('main.main')?.prepend(header);
  }

  return header;
}

function mainElement() {
  return document.querySelector('main.main');
}

function ensureNoteChromeNodes() {
  let noteTitle = $('noteTitle');

  if (!noteTitle) {
    noteTitle = el('input', {
      id: 'noteTitle',
      class: 'note-title yanta-canonical-note-title',
      placeholder: 'Untitled note',
      autocomplete: 'off',
      spellcheck: 'false',
    });
  }

  let chips = $('chips');

  if (!chips) {
    chips = el('div', {
      id: 'chips',
      class: 'chips',
    });
  }

  let tagInput = $('tagInput');

  if (!tagInput) {
    tagInput = el('input', {
      id: 'tagInput',
      class: 'tag-input',
      placeholder: '+ tag',
      autocomplete: 'off',
      spellcheck: 'false',
    });
  }

  return {
    noteTitle,
    chips,
    tagInput,
  };
}

function createNoteBindingFields({
  noteTitle,
  chips,
  tagInput,
  includeTitle = false,
} = {}) {
  const fields = el('div', {
    class: 'yanta-note-binding-fields',
    hidden: true,
    'aria-hidden': 'true',
  });

  if (includeTitle && noteTitle) {
    fields.append(noteTitle);
  }

  if (chips) {
    fields.append(chips);
  }

  if (tagInput) {
    fields.append(tagInput);
  }

  return fields;
}

function syncMirrorInputFromCanonical(input, canonical) {
  if (!input || !canonical) return;
  if (input === document.activeElement) return;

  input.value = canonical.value || '';
}

function ensurePaneTitleRow({
  parent,
  surface,
  before = null,
}) {
  if (!parent) return null;

  let row = parent.querySelector(`:scope > [data-note-pane-title="${surface}"]`);

  if (!row) {
    row = createPaneTitleRow(surface);

    if (before && before.parentElement === parent) {
      parent.insertBefore(row, before);
    } else {
      parent.prepend(row);
    }
  }

  return row;
}

function removeDuplicatePaneTitleRows({
  surface,
  keep,
}) {
  document
    .querySelectorAll(`[data-note-pane-title="${surface}"]`)
    .forEach((row) => {
      if (row !== keep) {
        row.remove();
      }
    });
}

function renderPaneTitleRowsSoon() {
  const render = () => {
    renderPaneTitleRows();
    syncTitleMirrorValue();
  };

  requestAnimationFrame(() => {
    render();

    // CodeMirror / mobile layout can settle one frame later after view switches.
    window.setTimeout(render, 80);
  });
}

function hasEditorSelection() {
  const v = getView();
  if (!v) return false;

  const sel = v.state.selection.main;
  return !!sel && !sel.empty;
}

function updateFormatButtonState() {
  const active = hasEditorSelection();

  document
    .querySelectorAll('[data-note-action="format"]')
    .forEach((btn) => {
      btn.disabled = !active;
      btn.classList.toggle('is-disabled', !active);
      btn.setAttribute('aria-disabled', active ? 'false' : 'true');
    });
}

function updateViewToggleButton() {
  if (!viewToggleBtn) return;

  const preview = state.view === 'preview';

  viewToggleBtn.innerHTML = lucide(preview ? 'pencil' : 'eye', 18);
  viewToggleBtn.title = preview ? 'Switch to edit' : 'Switch to preview';
  viewToggleBtn.setAttribute('aria-label', viewToggleBtn.title);
}

async function goBackFromNote() {
  if (history.length > 1 && history.state?.surface === 'note') {
    history.back();
    return;
  }

  if (state.currentNoteId) {
    await showDashboardFromNote(state.currentNoteId, {
      replace: true,
    });
  }
}

function insertListItem() {
  insertAtCursor('\n- ');
}

function insertEventTextOnly() {
  /*
    Text-only Event-Link:
    Das erzeugt bewusst KEINE Event<->Note-Verknüpfung.
    Falls calendar.js später einen Picker exportiert, kann dieser Hook
    dort direkt angebunden werden.
  */
  const eventId = uid();

  insertAtCursor(`[Event](${calendarEventUrl(eventId)})`);

  toast('Event text link inserted', 'success');
}

async function addLinkedEventToNote() {
  if (!state.currentNoteId) {
    toast('Open a note first', 'error');
    return;
  }

  const calendar = await import('./calendar.js');

  /*
    Best effort:
    Falls calendar.js bereits eine spezialisierte Funktion besitzt,
    wird sie genutzt. Sonst öffnen wir den New-Event-Dialog mit noteId.
  */
  if (typeof calendar.openNewLinkedCalendarEventForNote === 'function') {
    calendar.openNewLinkedCalendarEventForNote(state.currentNoteId);
    return;
  }

  if (typeof calendar.openNewCalendarEvent === 'function') {
    calendar.openNewCalendarEvent({
      noteId: state.currentNoteId,
      linkedNoteId: state.currentNoteId,
      linkNote: true,
    });

    return;
  }

  toast('Calendar event creation is not available here', 'error');
}

function insertSourceLink() {
  insertAtCursor('[Source](https://)');
}

function openInsertMenu(anchor, deps) {
  const r = anchor.getBoundingClientRect();

  showMenu(r.left, r.top - 6, [
    {
      label: 'Add List Entry',
      icon: 'list-plus',
      action: insertListItem,
    },
    {
      label: 'Add Image',
      icon: 'image-plus',
      action: deps.openImage,
    },
    {
      label: 'Add Drawing',
      icon: 'line-squiggle',
      action: deps.createDrawing,
    },
    {
      label: 'Link Note',
      icon: 'brackets',
      action: () => openNoteLinkPicker(anchor),
    },
    {
      label: 'Add Citation',
      icon: 'quote',
      action: deps.openCitation,
    },
    {
      label: 'Link Event',
      icon: 'calendar-plus',
      action: insertEventTextOnly,
    },
    {
      label: 'Link Source',
      icon: 'rss',
      action: insertSourceLink,
    },
    {
      label: 'Add Icon',
      icon: 'shapes',
      action: deps.openIcon,
    },
  ], {
    align: 'start',
  });
}

function openFormatMenu(anchor) {
  if (!hasEditorSelection()) return;

  const r = anchor.getBoundingClientRect();

  showMenu(r.left, r.top - 6, [
    {
      label: 'H1',
      icon: 'heading-1',
      action: () => applyEditorFormat('h1'),
    },
    {
      label: 'H2',
      icon: 'heading-2',
      action: () => applyEditorFormat('h2'),
    },
    {
      label: 'Aa',
      icon: 'type',
      action: () => applyEditorFormat('clear-heading'),
    },
    'hr',
    {
      label: 'Strong',
      icon: 'bold',
      action: () => applyEditorFormat('bold'),
    },
    {
      label: 'Italic',
      icon: 'italic',
      action: () => applyEditorFormat('italic'),
    },
    {
      label: 'Strikethrough',
      icon: 'strikethrough',
      action: () => applyEditorFormat('strike'),
    },
    {
      label: 'Create Link',
      icon: 'link',
      action: () => applyEditorFormat('link'),
    },
    {
      label: 'Highlight',
      icon: 'highlighter',
      action: () => applyEditorFormat('highlight'),
    },
  ], {
    align: 'start',
  });
}

function openMoreMenu(anchor, deps) {
  const note = currentNote();
  if (!note) return;

  const r = anchor.getBoundingClientRect();

  showMenu(r.right, r.top - 6, [
    {
      label: 'Move to Trash',
      icon: 'trash',
      danger: true,
      action: deps.deleteNote,
    },
    {
      label: 'Duplicate',
      icon: 'sticky-notes',
      action: () => duplicateNoteById(note.id),
    },
    {
      label: 'Export as .md',
      icon: 'download',
      action: () => deps.exportNote?.(note),
    },
  ], {
    align: 'end',
  });
}

async function editCurrentNoteAppearance() {
  const note = currentNote();
  if (!note) return;

  const { editNoteAppearance } = await import('./graph.js');
  editNoteAppearance(note);
}

function toggleEditPreview() {
  window.dispatchEvent(new CustomEvent('yanta-cycle-view'));

  requestAnimationFrame(updateViewToggleButton);
  setTimeout(updateViewToggleButton, 80);
}

function viewModeButton(view, icon, title) {
  const btn = iconButton({
    icon,
    title,
    className: state.view === view ? 'active' : '',
    onClick: () => setViewMode(view),
  });

  btn.dataset.viewMode = view;
  return btn;
}

function buildDesktopActions(deps) {
  const wrap = el('div', {
    class: 'yanta-desktop-note-actions',
    role: 'toolbar',
    'aria-label': 'Note actions',
  });

  const note = currentNote();

  // --- Right Group: Views ---
  const views = el('div', { 
    class: 'yanta-note-head-group align-right' 
  });

  views.append(
    viewModeButton('edit', 'pencil', 'Edit-View'),
    viewModeButton('split', 'columns-2', 'Split-View'),
    viewModeButton('preview', 'eye', 'Preview')
  );

  // --- Left Group: Tags, Tools, Primary, More ---
  const leftGroup = el('div', { 
    class: 'yanta-note-head-supergroup align-left' 
  });

  // 1. Manage Tags
  const tagsBtn = buildTagsButton();
  leftGroup.append(tagsBtn);

  // 2. Tools
  const tools = el('div', { class: 'yanta-note-head-group' });

  const add = iconButton({
    icon: 'plus',
    title: 'Add content',
    className: 'primary-ish',
    onClick: (btn) => openInsertMenu(btn, deps),
  });

  const appearance = iconButton({
    icon: 'palette',
    title: 'Icon & Color',
    onClick: editCurrentNoteAppearance,
  });

  const format = iconButton({
    icon: 'pilcrow',
    title: 'Format selected text',
    onClick: openFormatMenu,
  });

  format.dataset.noteAction = 'format';

  tools.append(add, appearance, format);
  leftGroup.append(tools);

  // 3. Primary
  const primary = el('div', { class: 'yanta-note-head-group' });

  const share = iconButton({
    id: 'btn-share',
    icon: 'share-2',
    title: 'Share',
    onClick: deps.openShare,
  });

  const pin = iconButton({
    id: 'btn-pin',
    icon: note?.pinned ? 'pin-off' : 'pin',
    title: note?.pinned ? 'Unpin' : 'Pin',
    onClick: async () => {
      togglePin();
      refreshHeaderButtons();
    },
  });

  const event = iconButton({
    icon: 'calendar-plus',
    title: 'Add linked Event',
    onClick: addLinkedEventToNote,
  });

  primary.append(pin, event, share);
  leftGroup.append(primary);

  // 4. More (Standalone)
  const more = iconButton({
    icon: 'ellipsis-vertical',
    title: 'More',
    onClick: (btn) => openMoreMenu(btn, deps),
  });
  leftGroup.append(more);

  // Append groups to main wrapper
  wrap.append(leftGroup, views);

  return wrap;
}

function buildTagsButton() {
  const btn = iconButton({
    icon: 'tags',
    title: 'Manage tags',
    className: 'yanta-tags-button',
    onClick: openTagsPopover,
  });

  const label = el('span', { class: 'yanta-tags-button-label' }, tagSummaryLabel());
  btn.append(label);

  return btn;
}

function buildHeader(deps) {
  const header = mainHeader();
  const { noteTitle, chips, tagInput } = ensureNoteChromeNodes();

  header.replaceChildren();

  noteTitle.classList.add('yanta-canonical-note-title');

  const back = iconButton({
    icon: 'arrow-left',
    title: 'Back',
    className: 'yanta-note-back-btn',
    onClick: goBackFromNote,
  });

  const tagsBtn = buildTagsButton();

  if (isMobile()) {
    const bindingFields = createNoteBindingFields({
      noteTitle,
      chips,
      tagInput,
      includeTitle: true,
    });

    const spacer = el('span', {
      class: 'grow yanta-note-head-grow',
    });

    const group = el('div', {
      class: 'yanta-note-head-group',
      role: 'group',
      'aria-label': 'Note actions',
    });

    const note = currentNote();

    const pin = iconButton({
      id: 'btn-pin',
      icon: note?.pinned ? 'pin-off' : 'pin',
      title: note?.pinned ? 'Unpin' : 'Pin',
      onClick: async () => {
        togglePin();
        refreshHeaderButtons();
      },
    });

    const event = iconButton({
      icon: 'calendar-plus',
      title: 'Add linked Event',
      onClick: addLinkedEventToNote,
    });

    const share = iconButton({
      id: 'btn-share',
      icon: 'share-2',
      title: 'Share this Note',
      onClick: deps.openShare,
    });

    group.append(pin, event, share);
    header.append(back, tagsBtn, spacer, group, bindingFields);
  } else {
    const bindingFields = createNoteBindingFields({
      chips,
      tagInput,
      includeTitle: false,
    });

    header.append(
      back,
      noteTitle,
      bindingFields,
      buildDesktopActions(deps)
    );
  }

  refreshHeaderButtons();
  updateFormatButtonState();
  renderPaneTitleRowsSoon();
}

function syncTitleMirrorValue() {
  const canonical = $('noteTitle');
  if (!canonical) return;

  document
    .querySelectorAll('.yanta-note-title-mirror')
    .forEach((input) => {
      if (input === document.activeElement) return;
      input.value = canonical.value || '';
    });
}

function commitMirrorTitleInput(input) {
  const canonical = $('noteTitle');
  if (!canonical || !input) return;

  canonical.value = input.value || '';

  canonical.dispatchEvent(new Event('input', {
    bubbles: true,
  }));
}

function blurMirrorTitleInput(input) {
  const canonical = $('noteTitle');
  if (!canonical || !input) return;

  canonical.value = input.value || '';

  canonical.dispatchEvent(new Event('blur', {
    bubbles: true,
  }));
}

function createPaneTitleRow(surface) {
  const canonical = $('noteTitle');

  const row = el('div', {
    class: `yanta-pane-title-row ${surface}`,
    dataset: {
      notePaneTitle: surface,
    },
  });

  const input = el('input', {
    class: 'yanta-note-title-mirror',
    value: canonical?.value || '',
    placeholder: 'Untitled note',
    autocomplete: 'off',
    spellcheck: 'false',
  });

  input.addEventListener('input', () => {
    commitMirrorTitleInput(input);
  });

  input.addEventListener('blur', () => {
    blurMirrorTitleInput(input);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
  });

  row.append(input);

  return row;
}

function renderPaneTitleRows() {
  const canonical = $('noteTitle');
  if (!canonical) return;

  const panePreview = $('panePreview');
  const preview = $('preview');

  if (panePreview && preview) {
    const previewRow = ensurePaneTitleRow({
      parent: panePreview,
      surface: 'preview',
      before: preview,
    });

    const previewInput = previewRow?.querySelector('.yanta-note-title-mirror');
    syncMirrorInputFromCanonical(previewInput, canonical);
  }

  const v = getView();
  const editScroller = v?.scrollDOM;

  if (editScroller) {
    const editRow = ensurePaneTitleRow({
      parent: editScroller,
      surface: 'edit',
    });

    removeDuplicatePaneTitleRows({
      surface: 'edit',
      keep: editRow,
    });

    const editInput = editRow?.querySelector('.yanta-note-title-mirror');
    syncMirrorInputFromCanonical(editInput, canonical);
  }
}

function buildFooter(deps) {
  let footer = document.querySelector('.head-actions');

  if (!footer) {
    footer = el('div', { class: 'head-actions' });
    mainElement()?.append(footer);
  }

  footer.replaceChildren();

  // Create container for left-aligned buttons
  const leftGroup = el('div', { class: 'bottom-actions-left' });

  // Create container for right-aligned buttons
  const rightGroup = el('div', { class: 'bottom-actions-right' });

  const add = iconButton({
    icon: 'plus',
    title: 'Add content',
    className: 'primary-ish',
    onClick: (btn) => openInsertMenu(btn, deps),
  });

  const appearance = iconButton({
    icon: 'palette',
    title: 'Icon & Color',
    onClick: editCurrentNoteAppearance,
  });

formatBtn = iconButton({
  icon: 'pilcrow',
  title: 'Format selected text',
  onClick: openFormatMenu,
});

formatBtn.dataset.noteAction = 'format';

  viewToggleBtn = iconButton({
    icon: state.view === 'preview' ? 'pencil' : 'eye',
    title: state.view === 'preview' ? 'Switch to edit' : 'Switch to preview',
    onClick: toggleEditPreview,
  });

  const more = iconButton({
    icon: 'ellipsis-vertical',
    title: 'More',
    onClick: (btn) => openMoreMenu(btn, deps),
  });

  // Append buttons to their respective groups
  leftGroup.append(add, appearance, formatBtn);
  rightGroup.append(viewToggleBtn, more);

  // Append groups to footer
  footer.append(leftGroup, rightGroup);

  updateFormatButtonState();
  updateViewToggleButton();
}

function refreshHeaderButtons() {
  const note = currentNote();

  document.querySelectorAll('#btn-pin').forEach((pin) => {
    if (!note) return;

    pin.innerHTML = lucide(note.pinned ? 'pin-off' : 'pin', 18);
    pin.classList.toggle('active', !!note.pinned);
    pin.title = note.pinned ? 'Unpin' : 'Pin';
    pin.setAttribute('aria-label', pin.title);
  });

  document.querySelectorAll('[data-view-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.viewMode === state.view);
  });

  document.querySelectorAll('.yanta-tags-button-label').forEach((label) => {
    label.textContent = tagSummaryLabel();
  });

  /*
    buildHeader() ersetzt #btn-share beim Note-Wechsel.
    Danach muss der neue Button sofort aus Live-Share + Public-Share-State
    synchronisiert werden. Sonst ist der Button nach Navigation visuell inaktiv,
    obwohl die Note öffentlich geteilt ist.
  */
  renderShareIndicator();
}

function positionPopover(anchor, popover) {
  const r = anchor.getBoundingClientRect();

  popover.style.left = `${Math.max(8, Math.min(window.innerWidth - 328, r.left))}px`;
  popover.style.bottom = `${Math.max(72, window.innerHeight - r.top + 8)}px`;
}

function openNoteLinkPicker(anchor) {
  closeNoteLinkPicker();

  notePicker = el('div', {
    class: 'yanta-note-link-picker',
    role: 'dialog',
    'aria-label': 'Link note',
  });

  const input = el('input', {
    class: 'text-input',
    type: 'search',
    placeholder: 'Search notes…',
    autocomplete: 'off',
  });

  const list = el('div', { class: 'yanta-note-link-picker-list' });

  notePicker.append(input, list);
  document.body.append(notePicker);

  const render = () => {
    const q = input.value.trim().toLowerCase();

    const notes = [...state.notes.values()]
      .filter((n) => n.id !== state.currentNoteId)
      .filter((n) => !q || (n.title || '').toLowerCase().includes(q))
      .sort((a, b) => (b.updated || 0) - (a.updated || 0))
      .slice(0, 24);

    list.replaceChildren();

    if (!notes.length) {
      list.append(el('div', { class: 'yanta-note-link-empty' }, 'No notes found'));
      return;
    }

    for (const note of notes) {
      const btn = el('button', {
        type: 'button',
        class: 'yanta-note-link-option',
        onclick: () => {
          insertAtCursor(`[[${note.title || 'Untitled'}]]`);
          closeNoteLinkPicker();
        },
      });

      btn.innerHTML = `
        <span>${lucide(note.icon || 'file-text', 15)}</span>
        <strong>${note.title || 'Untitled'}</strong>
      `;

      list.append(btn);
    }
  };

  input.addEventListener('input', render);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeNoteLinkPicker();
      return;
    }

    if (e.key === 'Enter') {
      const first = list.querySelector('button');
      if (first) {
        e.preventDefault();
        first.click();
      }
    }
  });

  const outside = (e) => {
    if (!notePicker) return;
    if (notePicker.contains(e.target)) return;
    closeNoteLinkPicker();
  };

  notePicker.__outside = outside;

  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
  }, 0);

  positionPopover(anchor, notePicker);
  render();

  requestAnimationFrame(() => input.focus());
}

function closeNoteLinkPicker() {
  if (!notePicker) return;

  document.removeEventListener('pointerdown', notePicker.__outside, true);
  notePicker.remove();
  notePicker = null;
}

export function setupNoteChrome(deps = {}) {
  if (initialized) return;
  initialized = true;

  buildHeader(deps);
  buildFooter(deps);
  renderPaneTitleRowsSoon();

  window.addEventListener('yanta-selection-change', updateFormatButtonState);

  window.addEventListener('yanta-note-opened', () => {
    buildHeader(deps);
    buildFooter(deps);
    refreshHeaderButtons();
    renderPaneTitleRowsSoon();
  });

  window.addEventListener('yanta-note-updated', () => {
    refreshHeaderButtons();
    renderPaneTitleRowsSoon();

    if (tagsPopover) {
      const body = tagsPopover.querySelector('.yanta-tags-popover-body');
      if (body) renderTagsPopoverBody(body);
    }
  });

  window.addEventListener('yanta-set-view', () => {
    requestAnimationFrame(refreshHeaderButtons);
    renderPaneTitleRowsSoon();
  });

  window.addEventListener('yanta-cycle-view', () => {
    requestAnimationFrame(refreshHeaderButtons);
    renderPaneTitleRowsSoon();
  });

  window.addEventListener('resize', () => {
    if (notePicker && document.activeElement) {
      positionPopover(document.activeElement, notePicker);
    }

    renderPaneTitleRowsSoon();
  });

  MOBILE_MQ.addEventListener?.('change', () => {
    buildHeader(deps);
    buildFooter(deps);
    renderPaneTitleRowsSoon();
  });
}