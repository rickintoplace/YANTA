// ============================================================
// YANTA — Editor shortcuts.
//
// The single registry of everything the Markdown editor can do from the
// keyboard, plus the machinery to rebind it. One catalogue feeds three
// consumers: the CodeMirror keymap, the Settings › Shortcuts pane and
// the hints shown next to menu entries.
//
// Chords are written in CodeMirror's notation (`Mod-Shift-8`), with two
// additions that make rebinding survive real keyboards:
//
//   - Chords are matched a second time against the *physical* key
//     (`event.code`). On a German layout Ctrl+Shift+8 reports "(" and
//     Ctrl+^ reports the dead key "Dead"; neither can be matched by key
//     name alone, but both are unambiguous as physical keys.
//   - A base token may be written as `[Backquote]` to name a physical
//     key directly, for keys no layout gives a usable name.
//
// Bindings are device-local (localStorage): which chord is comfortable
// depends on the keyboard in front of you, not on the account.
// ============================================================

import { keymap } from '@codemirror/view';
import { Compartment, Prec } from '@codemirror/state';

import { t } from '../i18n/index.js';

import {
  insertLink,
  setHeading,
  toggleBlockKind,
  toggleCodeBlock,
  toggleInlineMark,
  toggleTaskDone,
} from './markdown-commands.js';

const STORAGE_KEY = 'yanta.settings.device.editorShortcuts';

// ------------------------------------------------------------
// Platform
// ------------------------------------------------------------

const isMac = /Mac|iPhone|iPad|iPod/i.test(
  globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || ''
);

// ------------------------------------------------------------
// Command catalogue
// ------------------------------------------------------------

/**
 * `Mod-1…6` and `Mod-0` are the shortcuts users ask for and they work in
 * the installed app; inside a browser tab the same chords are claimed by
 * tab switching and zoom reset. Each heading therefore also ships with a
 * `Mod-Alt-` chord that no browser intercepts.
 */
function headingCommand(level) {
  return {
    id: `heading${level}`,
    group: 'headings',
    defaultKeys: [`Mod-${level}`, `Mod-Alt-${level}`],
    run: (view) => setHeading(view, level),
  };
}

/** Opens the link dialog, which only the app shell knows how to render. */
async function promptForLink(view) {
  const { yantaPrompt } = await import('../dialogs.js');
  const { from, to } = view.state.selection.main;

  const url = await yantaPrompt({
    title: t('format.insertLink'),
    label: t('format.urlLabel'),
    initial: 'https://',
    placeholder: t('format.urlPlaceholder'),
    required: true,
    confirmLabel: t('format.insertLink'),
    icon: 'link',
    validate(value) {
      try {
        const parsed = new URL(value);
        if (['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) return true;
      } catch {}

      return t('format.invalidUrl');
    },
  });

  if (!url) return;

  // The dialog took the focus and with it the selection — put the user's
  // range back before the link replaces it.
  const length = view.state.doc.length;
  view.dispatch({
    selection: { anchor: Math.min(from, length), head: Math.min(to, length) },
  });

  insertLink(view, url, t('format.linkText'));
}

export const EDITOR_COMMAND_GROUPS = ['inline', 'headings', 'blocks'];

export const EDITOR_COMMANDS = [
  { id: 'bold',          group: 'inline', defaultKeys: ['Mod-b'],       run: (v) => toggleInlineMark(v, 'bold') },
  { id: 'italic',        group: 'inline', defaultKeys: ['Mod-i'],       run: (v) => toggleInlineMark(v, 'italic') },
  { id: 'strikethrough', group: 'inline', defaultKeys: ['Mod-Shift-x'], run: (v) => toggleInlineMark(v, 'strikethrough') },
  { id: 'highlight',     group: 'inline', defaultKeys: ['Mod-Shift-h'], run: (v) => toggleInlineMark(v, 'highlight') },
  { id: 'inlineCode',    group: 'inline', defaultKeys: ['Mod-Shift-e'], run: (v) => toggleInlineMark(v, 'code') },
  {
    id: 'link',
    group: 'inline',
    defaultKeys: ['Mod-Shift-k'],
    run: (view) => {
      promptForLink(view).catch((err) => console.error('[YANTA Editor] link prompt failed', err));
      return true;
    },
  },

  ...[1, 2, 3, 4, 5, 6].map(headingCommand),
  {
    id: 'paragraph',
    group: 'headings',
    // The third chord is the key left of "1" — "^" on a German keyboard,
    // "`" on a US one. The physical fallback makes both land here.
    defaultKeys: ['Mod-0', 'Mod-Alt-0', 'Mod-`'],
    run: (view) => setHeading(view, 0),
  },

  { id: 'bulletList',     group: 'blocks', defaultKeys: ['Mod-Shift-8'], run: (v) => toggleBlockKind(v, 'bullet') },
  { id: 'numberedList',   group: 'blocks', defaultKeys: ['Mod-Shift-7'], run: (v) => toggleBlockKind(v, 'ordered') },
  { id: 'taskList',       group: 'blocks', defaultKeys: ['Mod-Shift-9'], run: (v) => toggleBlockKind(v, 'task') },
  { id: 'quote',          group: 'blocks', defaultKeys: ['Mod-Shift-.'], run: (v) => toggleBlockKind(v, 'quote') },
  { id: 'codeBlock',      group: 'blocks', defaultKeys: ['Mod-Alt-c'],   run: toggleCodeBlock },
  { id: 'toggleTaskDone', group: 'blocks', defaultKeys: ['Mod-Enter'],   run: toggleTaskDone },
];

const COMMANDS_BY_ID = new Map(EDITOR_COMMANDS.map((c) => [c.id, c]));

/** Localized name of a command, e.g. for the settings list or a menu. */
export function editorCommandLabel(id) {
  return t(`editor.commands.${id}`);
}

// ------------------------------------------------------------
// Chords
// ------------------------------------------------------------

const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'];

const CODE_TOKENS = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Space: 'Space',
};

const TOKEN_CODES = Object.fromEntries(
  Object.entries(CODE_TOKENS).map(([code, token]) => [token, code])
);

const NAMED_KEYS = new Set([
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Insert',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
]);

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead']);

/** Physical key (`event.code`) a chord's base token stands for, if any. */
function tokenToCode(token) {
  const explicit = /^\[(.+)]$/.exec(token);
  if (explicit) return explicit[1];

  if (/^[a-z]$/.test(token)) return `Key${token.toUpperCase()}`;
  if (/^[0-9]$/.test(token)) return `Digit${token}`;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(token) || NAMED_KEYS.has(token)) return token;

  return TOKEN_CODES[token] || null;
}

/**
 * The base token for a key press. Derived from the physical key wherever
 * possible so that a chord recorded on one layout still describes the
 * same key on another — and so that dead keys are representable at all.
 */
function baseTokenFromEvent(event) {
  const code = event.code || '';

  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].toLowerCase();

  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];

  if (CODE_TOKENS[code]) return CODE_TOKENS[code];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code) || NAMED_KEYS.has(code)) return code;

  const key = event.key;
  if (key && key.length === 1) return key.toLowerCase();
  if (key && !MODIFIER_KEYS.has(key) && key !== 'Unidentified' && key !== 'Process') return key;

  return code ? `[${code}]` : null;
}

function chordParts(event) {
  const parts = [];

  if (isMac ? event.metaKey : event.ctrlKey) parts.push('Mod');
  if (isMac ? event.ctrlKey : event.metaKey) parts.push(isMac ? 'Ctrl' : 'Meta');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  return parts;
}

/**
 * Normalized chord for a keydown, or `null` when the event carries no
 * key of its own (a bare modifier press while recording).
 */
export function chordFromEvent(event) {
  if (MODIFIER_KEYS.has(event.key)) return null;

  const base = baseTokenFromEvent(event);
  if (!base) return null;

  return [...chordParts(event), base].join('-');
}

/** Splits a chord into its modifier set and base token. */
function parseChord(chord) {
  const parts = String(chord).split(/-(?!$)/);
  const base = parts.pop();
  const mods = new Set(parts);

  return { mods, base };
}

/** Chord rewritten so its base token names a physical key, or `null`. */
function physicalChord(chord) {
  const { mods, base } = parseChord(chord);
  const code = tokenToCode(base);
  if (!code) return null;

  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), `[${code}]`].join('-');
}

/** Physical form of a keydown, used for the layout-independent fallback. */
function physicalChordFromEvent(event) {
  if (!event.code || MODIFIER_KEYS.has(event.key)) return null;

  return [...chordParts(event), `[${event.code}]`].join('-');
}

const CHORD_SYMBOLS = isMac
  ? { Mod: '⌘', Ctrl: '⌃', Meta: '⌘', Alt: '⌥', Shift: '⇧' }
  : { Mod: 'Ctrl', Ctrl: 'Ctrl', Meta: 'Win', Alt: 'Alt', Shift: 'Shift' };

const BASE_SYMBOLS = {
  ' ': 'Space', Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Enter: '↵', Escape: 'Esc', Backspace: '⌫', Delete: 'Del',
};

/** Human-readable chord, e.g. "Ctrl + Shift + 8" or "⌘⇧8". */
export function formatChord(chord) {
  const { mods, base } = parseChord(chord);

  const physical = /^\[(.+)]$/.exec(base);
  const label = physical
    ? (CODE_TOKENS[physical[1]] || physical[1])
    : (BASE_SYMBOLS[base] || (base.length === 1 ? base.toUpperCase() : base));

  const parts = [
    ...MODIFIER_ORDER.filter((m) => mods.has(m)).map((m) => CHORD_SYMBOLS[m]),
    label,
  ];

  return isMac ? parts.join('') : parts.join(' + ');
}

// ------------------------------------------------------------
// Stored overrides
// ------------------------------------------------------------

/** @type {Record<string, string[]> | null} */
let overrides = null;

function loadOverrides() {
  if (overrides) return overrides;

  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');

    overrides = Object.fromEntries(
      Object.entries(raw && typeof raw === 'object' ? raw : {})
        .filter(([id, keys]) => COMMANDS_BY_ID.has(id) && Array.isArray(keys))
        .map(([id, keys]) => [id, keys.filter((k) => typeof k === 'string' && k)])
    );
  } catch {
    overrides = {};
  }

  return overrides;
}

function persistOverrides() {
  try {
    if (Object.keys(overrides).length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

/** Effective chords per command id, defaults merged with user overrides. */
export function editorShortcuts() {
  const stored = loadOverrides();

  return Object.fromEntries(
    EDITOR_COMMANDS.map((cmd) => [cmd.id, stored[cmd.id] ?? cmd.defaultKeys])
  );
}

/** Effective chords for one command. */
export function editorShortcutsFor(id) {
  return editorShortcuts()[id] || [];
}

export function isEditorShortcutCustomized(id) {
  return Boolean(loadOverrides()[id]);
}

/**
 * Commands other than `exceptId` that already answer to `chord` — the
 * settings UI warns before a rebind silently shadows another command.
 */
export function editorShortcutConflicts(chord, exceptId) {
  const physical = physicalChord(chord);
  const bindings = editorShortcuts();

  return EDITOR_COMMANDS
    .filter((cmd) => cmd.id !== exceptId)
    .filter((cmd) => (bindings[cmd.id] || []).some(
      (other) => other === chord || (physical && physicalChord(other) === physical)
    ))
    .map((cmd) => cmd.id);
}

/** Replaces a command's chords. An empty list unbinds it. */
export function setEditorShortcut(id, chords) {
  if (!COMMANDS_BY_ID.has(id)) return;

  loadOverrides()[id] = [...new Set(chords)];
  persistOverrides();
  notifyShortcutsChanged();
}

export function resetEditorShortcut(id) {
  delete loadOverrides()[id];
  persistOverrides();
  notifyShortcutsChanged();
}

export function resetAllEditorShortcuts() {
  overrides = {};
  persistOverrides();
  notifyShortcutsChanged();
}

// ------------------------------------------------------------
// CodeMirror extension
// ------------------------------------------------------------

const shortcutsCompartment = new Compartment();
const liveViews = new Set();

function buildKeymap() {
  const bindings = editorShortcuts();
  const byPhysical = new Map();
  const keyBindings = [];

  for (const cmd of EDITOR_COMMANDS) {
    for (const chord of bindings[cmd.id] || []) {
      // Named chords go through CodeMirror, which already handles Mod →
      // Ctrl/Cmd and the common layout quirks for letters and digits.
      // No `preventDefault` flag: a command that declines (Ctrl+Enter
      // outside a task list) must leave the key to whoever wants it.
      if (!chord.includes('[')) {
        keyBindings.push({ key: chord, run: cmd.run });
      }

      const physical = physicalChord(chord);
      if (physical && !byPhysical.has(physical)) byPhysical.set(physical, cmd.run);
    }
  }

  // Runs only when no named binding matched, so it never double-fires.
  keyBindings.push({
    any(view, event) {
      if (!(event.ctrlKey || event.metaKey || event.altKey)) return false;

      const run = byPhysical.get(physicalChordFromEvent(event));
      return Boolean(run && run(view));
    },
  });

  // Beats the stock editing keymaps, so a user rebind always wins.
  return Prec.high(keymap.of(keyBindings));
}

/** The editor extension, live-reconfigured whenever bindings change. */
export function editorShortcutsExtension() {
  return shortcutsCompartment.of(buildKeymap());
}

/** Editors must register so a rebind reaches them without a remount. */
export function attachEditorShortcuts(view) {
  liveViews.add(view);
}

export function detachEditorShortcuts(view) {
  liveViews.delete(view);
}

function notifyShortcutsChanged() {
  const next = buildKeymap();

  for (const view of liveViews) {
    try {
      view.dispatch({ effects: shortcutsCompartment.reconfigure(next) });
    } catch {
      liveViews.delete(view);
    }
  }
}

/** Runs a command by id — used by menus and the selection toolbar. */
export function runEditorCommand(view, id) {
  const cmd = COMMANDS_BY_ID.get(id);
  return cmd && view ? Boolean(cmd.run(view)) : false;
}
