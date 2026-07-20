// Deutsch. Mirrors the key structure of en.js exactly (see i18n:check).

export default {
  boot: {
    loading: 'App wird geladen…',
    slow: 'Lädt noch – deine Verbindung scheint langsam zu sein…',
    failed: 'YANTA konnte nicht gestartet werden. Bitte neu laden.',
    stage: {
      vault: 'Dein Tresor wird geöffnet…',
      notes: 'Deine Notizen werden geladen…',
      workspace: 'Dein Arbeitsbereich wird vorbereitet…',
      almost: 'Gleich fertig…',
    },
  },

  common: {
    save: 'Speichern',
    cancel: 'Abbrechen',
    close: 'Schließen',
    done: 'Fertig',
    delete: 'Löschen',
    copy: 'Kopieren',
    back: 'Zurück',
    reset: 'Zurücksetzen',
    continue: 'Weiter',
    maybeLater: 'Später',
  },

  appShell: {
    searchPlaceholder: 'Notizen durchsuchen… (Strg+K)',
    toggleTheme: 'Design wechseln (T)',
    settings: 'Einstellungen',
    status: {
      words: { one: '{count} Wort', other: '{count} Wörter' },
      chars: { one: '{count} Zeichen', other: '{count} Zeichen' },
      saved: 'Gespeichert',
    },
  },

  settings: {
    language: {
      title: 'Sprache',
      subtitle: 'Wähle die Sprache, in der die YANTA-Oberfläche angezeigt wird.',
      label: 'Anzeigesprache',
      hint: 'Gilt für die gesamte App. YANTA lädt zum Sprachwechsel neu.',
      matchSystem: 'System übernehmen',
      changed: 'Sprache geändert',
    },
  },

  onboarding: {
    chooser: {
      title: 'Wo sollen deine Notizen leben?',
      subtitle: 'Wähle einen Startpunkt – das ist nicht endgültig.',
      ariaLabel: 'Wo sollen deine Notizen leben?',
      groupLabel: 'Speicherort',
      footnote: 'Du kannst das jederzeit in den Einstellungen ändern – deine Notizen bleiben dabei erhalten.',
    },
    badge: {
      default: 'Standard',
      recommended: 'Empfohlen',
      advanced: 'Fortgeschritten',
    },
    choices: {
      local: {
        title: 'Auf diesem Gerät',
        desc: 'Kein Konto, nichts einzurichten. Privat von Haus aus – deine Notizen verlassen dieses Gerät nie.',
      },
      cloud: {
        title: 'YANTA Cloud',
        desc: 'Auf allen Geräten synchron, Ende-zu-Ende-verschlüsselt. Wir speichern ausschließlich verschlüsselte Objekte.',
      },
      byo: {
        title: 'Dein eigenes Google Drive',
        desc: 'Bring deinen eigenen Speicher mit. Die verschlüsselte Synchronisierung läuft über einen Drive-Ordner, den du vollständig kontrollierst.',
      },
    },
    localToast: 'Deine Notizen bleiben auf diesem Gerät. Du kannst die Synchronisierung jederzeit in den Einstellungen aktivieren.',
    openError: 'Die Sync-Einrichtung konnte nicht geöffnet werden. Du kannst sie jederzeit in den Einstellungen aktivieren.',
    nudge: {
      title: 'Deine Notizen liegen auf diesem Gerät',
      subtitle: 'Richte die Synchronisierung ein, um sie auf allen Geräten zu haben. Ende-zu-Ende-verschlüsselt.',
      cta: 'Sync einrichten',
      dismiss: 'Ausblenden',
    },
  },
};
