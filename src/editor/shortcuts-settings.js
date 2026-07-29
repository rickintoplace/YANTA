// ============================================================
// YANTA — Settings › Shortcuts.
//
// Rebinding surface for every editor command. One row per command:
// its current chords as chips, a recorder that captures the next key
// press, and a reset that brings the default back.
//
// A recorded chord that is already taken is not silently accepted —
// the row explains who owns it and offers to take it over, because a
// shortcut that quietly stops working is worse than one that never did.
// ============================================================

import { el } from '../core.js';
import { t } from '../i18n/index.js';

import {
  EDITOR_COMMANDS,
  EDITOR_COMMAND_GROUPS,
  chordFromEvent,
  editorCommandLabel,
  editorShortcutConflicts,
  editorShortcuts,
  formatChord,
  isEditorShortcutCustomized,
  resetAllEditorShortcuts,
  resetEditorShortcut,
  setEditorShortcut,
} from './editor-shortcuts.js';

/** Commands of one group, in catalogue order. */
function commandsInGroup(group) {
  return EDITOR_COMMANDS.filter((cmd) => cmd.group === group);
}

export function editorShortcutsSettingsElement() {
  const host = el('div', { class: 'yanta-shortcuts' });

  // Whichever row is recording; only one at a time.
  let recording = null;

  function stopRecording() {
    if (!recording) return;

    window.removeEventListener('keydown', recording.onKeyDown, true);
    recording = null;
  }

  /**
   * Captures the next key press for `commandId`. The listener runs in
   * the capture phase so the app's own shortcuts cannot swallow the
   * chord the user is trying to assign.
   */
  function startRecording(commandId, onDone) {
    stopRecording();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        stopRecording();
        onDone(null);
        return;
      }

      const chord = chordFromEvent(event);
      if (!chord) return;

      event.preventDefault();
      event.stopPropagation();
      stopRecording();
      onDone(chord);
    };

    recording = { commandId, onKeyDown };
    window.addEventListener('keydown', onKeyDown, true);

    return () => stopRecording();
  }

  function render() {
    stopRecording();
    host.replaceChildren();

    host.append(el('p', { class: 'yanta-settings-subtitle' }, t('settings.shortcuts.deviceNote')));

    const bindings = editorShortcuts();

    for (const group of EDITOR_COMMAND_GROUPS) {
      const section = el('div', { class: 'yanta-settings-group' });
      section.append(el('div', { class: 'yanta-settings-group-title' }, t(`settings.shortcuts.groups.${group}`)));

      for (const cmd of commandsInGroup(group)) {
        section.append(renderRow(cmd, bindings[cmd.id] || []));
      }

      host.append(section);
    }

    host.append(el('p', { class: 'yanta-settings-hint' }, t('settings.shortcuts.browserNote')));

    const footer = el('div', { class: 'yanta-shortcuts-footer' });
    footer.append(el('button', {
      class: 'btn',
      onclick: () => {
        resetAllEditorShortcuts();
        render();
      },
    }, t('settings.shortcuts.resetAll')));

    host.append(footer);
  }

  function renderRow(cmd, chords) {
    const row = el('div', { class: 'yanta-shortcut-row' });

    row.append(el('span', { class: 'yanta-shortcut-label' }, editorCommandLabel(cmd.id)));

    const keys = el('div', { class: 'yanta-shortcut-keys' });

    for (const chord of chords) {
      const chip = el('span', { class: 'yanta-shortcut-chip' }, formatChord(chord));

      chip.append(el('button', {
        class: 'yanta-shortcut-chip-remove',
        type: 'button',
        'aria-label': t('settings.shortcuts.removeAria', { chord: formatChord(chord) }),
        onclick: () => {
          setEditorShortcut(cmd.id, chords.filter((c) => c !== chord));
          render();
        },
      }, '×'));

      keys.append(chip);
    }

    if (!chords.length) {
      keys.append(el('span', { class: 'yanta-shortcut-empty' }, t('settings.shortcuts.unbound')));
    }

    const record = el('button', {
      class: 'btn yanta-shortcut-record',
      type: 'button',
    }, t('settings.shortcuts.add'));

    record.addEventListener('click', () => {
      record.classList.add('is-recording');
      record.textContent = t('settings.shortcuts.pressKeys');

      startRecording(cmd.id, (chord) => {
        record.classList.remove('is-recording');
        record.textContent = t('settings.shortcuts.add');

        if (chord) assign(cmd, chords, chord, row);
      });
    });

    row.append(keys, record);

    if (isEditorShortcutCustomized(cmd.id)) {
      row.append(el('button', {
        class: 'btn yanta-shortcut-reset',
        type: 'button',
        title: t('settings.shortcuts.reset'),
        'aria-label': t('settings.shortcuts.reset'),
        onclick: () => {
          resetEditorShortcut(cmd.id);
          render();
        },
      }, '↺'));
    }

    return row;
  }

  /** Applies a recorded chord, asking first when it is already taken. */
  function assign(cmd, chords, chord, row) {
    host.querySelectorAll('.yanta-shortcut-conflict').forEach((node) => node.remove());

    const conflicts = editorShortcutConflicts(chord, cmd.id);

    if (!conflicts.length) {
      setEditorShortcut(cmd.id, [...chords, chord]);
      render();
      return;
    }

    const warning = el('div', { class: 'yanta-shortcut-conflict' });

    warning.append(el('span', {}, t('settings.shortcuts.conflict', {
      chord: formatChord(chord),
      command: conflicts.map(editorCommandLabel).join(', '),
    })));

    warning.append(el('button', {
      class: 'btn primary',
      type: 'button',
      onclick: () => {
        const bindings = editorShortcuts();

        for (const other of conflicts) {
          setEditorShortcut(other, (bindings[other] || []).filter((c) => c !== chord));
        }

        setEditorShortcut(cmd.id, [...chords, chord]);
        render();
      },
    }, t('settings.shortcuts.takeOver')));

    warning.append(el('button', {
      class: 'btn',
      type: 'button',
      onclick: () => render(),
    }, t('common.cancel')));

    row.after(warning);
  }

  render();

  return host;
}
