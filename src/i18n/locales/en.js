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
    ok: 'OK',
    apply: 'Apply',
  },

  dialog: {
    ariaFallback: 'Dialog',
    confirmTitle: 'Confirm',
    confirmAction: 'Confirm',
    noticeTitle: 'Notice',
    inputTitle: 'Input',
    invalid: 'Invalid input',
    required: 'This field is required.',
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
    title: 'Settings',
    searchPlaceholder: 'Search settings…',
    searchAria: 'Search settings',
    noMatches: 'No matching settings',
    backAria: 'Back to settings',

    // Left-rail labels (may differ from the in-page section heading).
    nav: {
      appearance: 'Appearance',
      language: 'Language',
      colors: 'Colors',
      typography: 'Typography',
      dashboard: 'Dashboard',
      quickCreate: 'Quick Actions',
      calendar: 'Calendar',
      sources: 'Sources',
      ai: 'AI',
      semantic: 'Semantic search',
      chat: 'Chat',
      sync: 'Sync & Backup',
      notifications: 'Notifications',
      install: 'Install app',
      billing: 'Plan & Billing',
      about: 'About',
    },

    // Section headings (title + subtitle) shown at the top of each pane.
    sections: {
      appearance: { title: 'Appearance', subtitle: 'Choose how YANTA looks.' },
      colors: { title: 'Colors', subtitle: 'Customize the color palette. Dark and light modes are configured separately.' },
      typography: { title: 'Typography', subtitle: 'Choose fonts and sizing.' },
      dashboard: { title: 'Dashboard', subtitle: 'Choose how note and folder cards are displayed.' },
      quickCreate: { title: 'Quick Actions', subtitle: 'Customize the floating quick-access button: trigger icon, actions, labels and free bubble positions.' },
      calendar: { title: 'Calendar', subtitle: 'Configure date display, time format, week start and calendar weeks.' },
      sources: { title: 'Sources', subtitle: 'Follow RSS, Atom and JSON feeds. Feed items are cached locally; only saved items become YANTA notes.' },
      ai: { title: 'YANTA AI', subtitle: 'Configure the YANTA AI assistant, OpenRouter API key, permissions, location context and external agent bridge.' },
      semantic: { title: 'Semantic search', subtitle: 'On-device AI that finds notes by meaning. Nothing leaves your device.' },
      chat: { title: 'Chat', subtitle: 'Configure encrypted messaging, receipts, media, storage and recovery.' },
      sync: { title: 'Sync', subtitle: 'Keep YANTA up to date across your devices.' },
      notifications: { title: 'Notifications', subtitle: 'Choose what YANTA notifies you about on this device, and see what your connected devices deliver.' },
      install: { title: 'Install app', subtitle: 'Install YANTA so chat messages and event reminders arrive as reliable system notifications.' },
      billing: { title: 'Plan & Billing', subtitle: 'Manage your YANTA Plus subscription, payment method and invoices.' },
      about: { title: 'About' },
    },

    language: {
      title: 'Language',
      subtitle: 'Choose the language YANTA’s interface is shown in.',
      label: 'Display language',
      hint: 'Applies across the whole app. YANTA reloads to switch languages.',
      matchSystem: 'Match system',
      changed: 'Language updated',
    },

    appearance: {
      theme: 'Theme',
      modes: {
        auto: { label: 'Follow system', hint: 'Match OS light/dark' },
        dark: { label: 'Dark', hint: 'Always dark' },
        light: { label: 'Light', hint: 'Always light' },
        systemColors: { label: 'System colors', hint: 'Follow OS theme + use system accent' },
      },
      resetButton: 'Reset all appearance to defaults',
      resetConfirmTitle: 'Reset appearance?',
      resetConfirmMessage: 'Reset appearance, colors and typography to defaults?\n\nYour notes are not affected.',
      resetConfirmAction: 'Reset appearance',
      resetToast: 'Appearance reset',
    },

    typography: {
      bodyFont: 'Body font',
      // Pangram shown as a live font preview — localized so it exercises each
      // language's own accented / native characters.
      bodySample: 'The quick brown fox jumps',
      monoFont: 'Monospace font (code)',
      fontSize: 'Font size',
      lineHeight: 'Line height',
    },

    colors: {
      tabDark: '🌙 Dark mode',
      tabLight: '☀️ Light mode',
      presets: 'Presets',
      presetsHint: 'These presets only apply to {mode}. Your other mode stays unchanged.',
      presetApplied: 'Applied “{name}” to {mode}',
      resetToast: 'Colors reset for {mode}',
      resetButton: 'Reset colors for {mode} to defaults',
      // Noun form for mid-sentence interpolation into the strings above.
      modeNoun: { dark: 'dark mode', light: 'light mode' },
    },

    quickCreate: {
      triggerIcon: 'Trigger icon',
      triggerIconHint: 'The floating button morphs this icon into a close (×) when the menu opens.',
      triggerIconUpdated: 'Trigger icon updated',
      actions: 'Actions',
      noActions: 'No actions enabled. Add one below.',
      addAction: 'Add action',
      actionAdded: 'Action added',
      chooseIcon: 'Choose icon',
      iconForLabel: 'Icon for {label}',
      iconUpdated: 'Icon updated',
      actionLabelField: 'Action label',
      labelSaved: 'Label saved',
      moveUp: 'Move up',
      moveDown: 'Move down',
      removeAction: 'Remove from quick actions',
      actionRemoved: 'Action removed',
      orderUpdated: 'Order updated',
      bubbleLayout: 'Bubble layout',
      bubbleLayoutHint: 'Drag bubbles freely. Minimum distance: {distance}px. Nearby bubbles move aside automatically.',
      dragBubble: 'Drag a bubble',
      dragging: 'Dragging: {label}',
      bubbleFallback: 'Bubble',
      layoutSaved: 'Layout saved',
      quickActionsButton: 'Quick actions button',
      enableFirst: 'Enable or add an action first.',
      reloadedLayout: 'Reloaded saved layout',
      reloadLayout: 'Reload saved layout',
      layoutReset: 'Quick actions layout reset',
      resetLayout: 'Reset layout',
      resetButton: 'Reset quick actions to default',
      resetToast: 'Quick actions reset to default',
    },

    dashboard: {
      cardLabels: 'Card labels',
      showNoteHeader: 'Show note title and icon',
      showNoteHeaderHint: 'Shows a compact header on note cards.',
      showFolderHeader: 'Show folder title and icon',
      showFolderHeaderHint: 'Shows a compact header on folder cards.',
      saved: 'Dashboard setting saved',
      linkedEventCard: 'Linked event card',
      showLinkedEvent: 'Show linked event card on note cards',
      showLinkedEventHint: 'Shows a compact calendar event header on dashboard note cards when a note is linked to an event.',
      fields: {
        icon: { label: 'Show icon', hint: 'Shows a small calendar icon.' },
        title: { label: 'Show title', hint: 'Shows the event title.' },
        time: { label: 'Show time/date', hint: 'Shows the event date and time.' },
        location: { label: 'Show location', hint: 'Shows the event location if present.' },
        description: { label: 'Show description', hint: 'Shows the event description if present.' },
      },
      info: {
        renameTitle: 'Rename UX:',
        renameBody: 'When headers are hidden, YANTA temporarily opens the card header only for renaming.',
        line2: 'This keeps the dashboard clean by default, while Rename, F2 and keyboard workflows remain reliable.',
      },
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
