// ============================================================
// YANTA — Format actions.
//
// The catalogue behind every formatting affordance in the note editor:
// the floating selection toolbar, the format menu in the note header and
// the shortcut hints they show. It owns *what* an action is — command,
// icon, label — while each surface keeps its own presentation.
//
// The two surfaces stay deliberately different widgets. A selection
// bubble is a horizontal icon strip that must not cover the text you
// just selected; the header menu is a vertical list with room for names
// and shortcuts. Sharing the data is the win here, not the widget.
//
// Labels come from the command registry, so the toolbar tooltip, the
// menu row and Settings › Shortcuts can never drift apart.
// ============================================================

import { lucide } from '../core.js';

import {
  editorCommandLabel,
  editorShortcutsFor,
  formatChord,
  runEditorCommand,
} from './editor-shortcuts.js';

import { getView } from '../editor.js';

/**
 * Action id → the editor command it runs and the Lucide glyph that
 * stands for it. The ids are the stable vocabulary of the toolbar markup
 * and the note chrome.
 */
const FORMAT_ACTIONS = {
  bold:      { command: 'bold',          icon: 'bold' },
  italic:    { command: 'italic',        icon: 'italic' },
  code:      { command: 'inlineCode',    icon: 'code-xml' },
  strike:    { command: 'strikethrough', icon: 'strikethrough' },
  highlight: { command: 'highlight',     icon: 'highlighter' },
  link:      { command: 'link',          icon: 'link' },

  h1:              { command: 'heading1',  icon: 'heading-1' },
  h2:              { command: 'heading2',  icon: 'heading-2' },
  h3:              { command: 'heading3',  icon: 'heading-3' },
  'clear-heading': { command: 'paragraph', icon: 'type' },

  quote:          { command: 'quote',          icon: 'text-quote' },
  'to-bullets':   { command: 'bulletList',     icon: 'list' },
  'to-numbered':  { command: 'numberedList',   icon: 'list-ordered' },
  'to-tasks':     { command: 'taskList',       icon: 'list-todo' },
  'tasks-toggle': { command: 'toggleTaskDone', icon: 'list-checks' },
  'code-block':   { command: 'codeBlock',      icon: 'square-code' },
};

/** Localized name of an action, shared with Settings › Shortcuts. */
export function formatActionLabel(id) {
  const action = FORMAT_ACTIONS[id];
  return action ? editorCommandLabel(action.command) : id;
}

/** Display form of the bound chord, or '' when the action has none. */
export function formatActionHint(id) {
  const action = FORMAT_ACTIONS[id];
  const [chord] = action ? editorShortcutsFor(action.command) : [];

  return chord ? formatChord(chord) : '';
}

/** Runs an action against the live editor. */
export function applyFormatAction(id) {
  const action = FORMAT_ACTIONS[id];
  return action ? runEditorCommand(getView(), action.command) : false;
}

/** Icon-only button for the floating selection toolbar. */
export function formatToolbarButton(id, size = 15) {
  const action = FORMAT_ACTIONS[id];
  if (!action) return '';

  const label = formatActionLabel(id);
  const hint = formatActionHint(id);
  const title = hint ? `${label} · ${hint}` : label;

  return (
    `<button type="button" data-fmt="${id}"` +
    ` title="${escapeAttr(title)}" aria-label="${escapeAttr(label)}">` +
    `${lucide(action.icon, size)}</button>`
  );
}

/** Rows for the shared context menu (see showMenu in tree.js). */
export function formatMenuItems(ids) {
  return ids.map((id) => {
    if (id === 'hr') return 'hr';

    return {
      label: formatActionLabel(id),
      icon: FORMAT_ACTIONS[id]?.icon,
      hint: formatActionHint(id),
      action: () => applyFormatAction(id),
    };
  });
}

// Tooltips carry user-recorded chords, which can contain quotes.
function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
