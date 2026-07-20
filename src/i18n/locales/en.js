// English — source of truth. Every other locale mirrors these keys exactly;
// `npm run i18n:check` fails the build on any drift (missing/extra keys).
//
// Conventions:
//   - Full sentences per key. Never concatenate fragments — other languages
//     order and inflect words differently.
//   - Plurals: an object of CLDR categories ({ one, other, ... }) selected by
//     a `count` param. Interpolate values as `{name}`.

export default {
  boot: {
    loading: 'Loading app…',
    slow: 'Still loading — your connection seems slow…',
    failed: 'Could not start YANTA. Please reload.',
    stage: {
      vault: 'Opening your vault…',
      notes: 'Loading your notes…',
      workspace: 'Preparing your workspace…',
      almost: 'Almost ready…',
    },
  },

  common: {
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    done: 'Done',
    delete: 'Delete',
    copy: 'Copy',
    back: 'Back',
    reset: 'Reset',
    continue: 'Continue',
    maybeLater: 'Maybe later',
  },

  appShell: {
    searchPlaceholder: 'Search notes… (Ctrl+K)',
    toggleTheme: 'Toggle theme (T)',
    settings: 'Settings',
    status: {
      words: { one: '{count} word', other: '{count} words' },
      chars: { one: '{count} char', other: '{count} chars' },
      saved: 'Saved',
    },
  },

  settings: {
    language: {
      title: 'Language',
      subtitle: 'Choose the language YANTA’s interface is shown in.',
      label: 'Display language',
      hint: 'Applies across the whole app. YANTA reloads to switch languages.',
      matchSystem: 'Match system',
      changed: 'Language updated',
    },
  },

  onboarding: {
    chooser: {
      title: 'Where should your notes live?',
      subtitle: 'Pick a starting point — this isn’t permanent.',
      ariaLabel: 'Where should your notes live?',
      groupLabel: 'Storage location',
      footnote: 'You can change this anytime in Settings — your notes stay put when you do.',
    },
    badge: {
      default: 'Default',
      recommended: 'Recommended',
      advanced: 'Advanced',
    },
    choices: {
      local: {
        title: 'On this device',
        desc: 'No account, nothing to set up. Private by default — your notes never leave this device.',
      },
      cloud: {
        title: 'YANTA Cloud',
        desc: 'Sync across all your devices, end-to-end encrypted. We only ever store encrypted objects.',
      },
      byo: {
        title: 'Your own Google Drive',
        desc: 'Bring your own storage. Encrypted sync runs through a Drive folder you fully control.',
      },
    },
    localToast: 'Your notes stay on this device. You can enable sync anytime in Settings.',
    openError: 'Could not open sync setup. You can enable it anytime in Settings.',
    nudge: {
      title: 'Your notes live on this device',
      subtitle: 'Set up sync to keep them on all your devices. End-to-end encrypted.',
      cta: 'Set up sync',
      dismiss: 'Dismiss',
    },
  },
};
