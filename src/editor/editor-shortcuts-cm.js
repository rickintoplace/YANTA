// ============================================================
// YANTA Editor — shortcut keymap for CodeMirror
//
// The CodeMirror half of editor-shortcuts.js: builds the keymap from
// the current bindings and reconfigures live editors on a rebind.
// Loaded with the editor (editor-cm.js), never at boot.
// ============================================================

import { keymap } from '@codemirror/view';
import { Compartment, Prec } from '@codemirror/state';

import * as markdownCommands from './markdown-commands.js';

import {
  EDITOR_COMMANDS,
  editorShortcuts,
  physicalChord,
  physicalChordFromEvent,
  provideMarkdownCommands,
  onEditorShortcutsChanged,
} from './editor-shortcuts.js';

provideMarkdownCommands(markdownCommands);

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

onEditorShortcutsChanged(() => {
  const next = buildKeymap();

  for (const view of liveViews) {
    try {
      view.dispatch({ effects: shortcutsCompartment.reconfigure(next) });
    } catch {
      liveViews.delete(view);
    }
  }
});

