// YANTA — KI-Einstellungen und Zugriffsrichtlinie (Deutsch).
// Gleiche Schlüsselstruktur wie settings.en.js. "Included AI", "BYOK",
// YANTA Cloud, OpenRouter, Open-Meteo, ZDR und AI Brain bleiben Namen.

export default {
  access: {
    label: 'KI-Zugang',
    included: 'Included AI: YANTA-Cloud-Guthaben',
    byok: 'BYOK: mein OpenRouter-Schlüssel',
    includedModel: 'Included-AI-Modell',
    provider: 'Anbieter',
    baseUrl: 'Basis-URL',
    model: 'Modell',
    keyStorage: 'Speicherung des API-Schlüssels',
    keyStorageSession: 'Nur für diese Sitzung',
    keyStorageLocal: 'Auf diesem Gerät merken (localStorage)',
    keyStorageNone: 'Nicht speichern',
    apiKey: 'OpenRouter-API-Schlüssel',
    clearKey: 'Schlüssel entfernen',
  },

  privacy: {
    label: 'Datenschutz',
    currentNote: 'Aktuelle Notiz einbeziehen',
    metadataOnly: 'Nur Metadaten',
  },

  thinking: {
    label: 'Denken',
    off: 'Aus · am schnellsten, das meiste Budget geht in die Antwort',
    low: 'Niedrig · ein kurzer Plan vor dem Handeln',
    medium: 'Mittel · für schwierigere Aufgaben, langsamer und teurer',
  },

  citations: {
    label: 'Zitate prüfen',
    check: 'Prüfen · jedes Zitat aus einer Webseite, einem Artikel oder einer Notiz wird damit abgeglichen',
    revise: 'Prüfen und korrigieren · fehlgeschlagene Zitate gehen einmal zurück ans Modell',
    off: 'Aus · keine Zitierregeln, keine Prüfung',
  },

  includedLimits: {
    heading: 'Limits für Included AI',
    body: 'Included AI nutzt verwaltetes YANTA-Cloud-Guthaben. Du kannst eines der von YANTA freigegebenen Modelle wählen. Kontextgröße, Ausgabegröße, tägliches Guthaben und Ratenlimits legt YANTA Cloud zum Schutz vor Missbrauch fest.',
    current: 'Aktuelle clientseitige Limits: {context} Kontextzeichen, {rounds} Tool-Runden, {output} maximale Ausgabe-Tokens.',
  },

  byokLimits: {
    heading: 'Erweiterte BYOK-Limits',
    maxContext: 'Max. Kontextzeichen',
    maxToolRounds: 'Max. Tool-Runden',
    body: 'BYOK nutzt deinen eigenen OpenRouter-Schlüssel. Modell, Basis-URL und Limits sind frei einstellbar.',
  },

  badges: {
    recommended: 'Empfohlen',
    optional: 'Optional',
  },

  permissions: {
    heading: 'Berechtigungen',
    readNotes: 'Assistent darf Notizen lesen',
    createNotes: 'Assistent darf Notizen erstellen',
    editNotes: 'Assistent darf Notizen bearbeiten',
    deleteNotes: 'Assistent darf Notizen löschen',
    manageCalendar: 'Assistent darf Kalendertermine verwalten',
    readAiBrain: 'Assistent darf AI Brain lesen',
    writeAiBrain: 'Assistent darf in AI Brain schreiben',
    weather: 'Assistent darf Wetterdaten über Open-Meteo abrufen',
    webSearch: 'Assistent darf im Web suchen',
    approxLocation: 'Assistent darf ungefähren Standortkontext erhalten',
    readRss: 'Assistent darf Einträge aus Quellen/RSS lesen',
    manageRss: 'Assistent darf Quellen aktualisieren/verwalten',
    addRssSources: 'Assistent darf RSS-Feeds und YouTube-Kanäle zu Quellen hinzufügen',
    saveRssToNotes: 'Assistent darf Einträge aus Quellen als Notizen speichern',
    readChat: 'Assistent darf Chat-Nachrichten lesen',
    sendChat: 'Assistent darf Chat-Nachrichten nach Bestätigung senden',
    sendChatAutonomous: 'Assistent darf Chat-Nachrichten ohne Prüfung senden',
  },

  location: {
    heading: 'Ungefährer Standort',
    intro: 'Wird für Wetterfragen wie „Wetter hier“ verwendet. Gib stattdessen eine Stadt, Region oder Postleitzahl ein.',
    stored: 'Gespeichert:',
    none: 'Kein ungefährer Standort gespeichert.',
    placeLabel: 'Stadt, Region oder Postleitzahl',
    placePlaceholder: 'z. B. Göttingen, 37073, 10001, SW1A 1AA',
    countryLabel: 'Ländercode (optional)',
    searching: 'Orte werden gesucht…',
    resultFallback: 'Ort',
    find: 'Treffer suchen',
    saveBest: 'Besten Treffer speichern',
    clear: 'Standort entfernen',
    enterQuery: 'Gib eine Stadt, Region oder Postleitzahl ein',
    saved: 'Ungefährer Standort gespeichert',
    cleared: 'Ungefährer Standort entfernt',
    notFound: 'Ort nicht gefunden',
    saveFailed: 'Standort konnte nicht gespeichert werden',
  },

  externalAgents: {
    heading: 'Externe Agents',
    allow: 'Externen KI-Agents die Verbindung erlauben',
    enabled: 'Aktiviert',
    disabled: 'Deaktiviert',
    bridgeUrl: 'URL der lokalen Bridge',
    token: 'Sitzungstoken',
    connected: 'Mit lokaler Bridge verbunden',
    notConnected: 'Nicht verbunden',
    hidden: 'Die Bridge-Einstellungen für externe Agents sind ausgeblendet, solange der Zugriff externer Agents deaktiviert ist. Aktiviere diese Option, um Bridge-URL, Token, Berechtigungen und Einrichtungstext anzuzeigen.',
    copySetup: 'Einrichtungstext kopieren',
    regenerateToken: 'Token neu erzeugen',
    disconnect: 'Trennen',
    connect: 'Verbinden',
    setupCopied: 'Einrichtungstext für externe Agents kopiert',
    tokenRegenerated: 'Token für externe Agents neu erzeugt',
    bridgeConnected: 'Bridge für externe Agents verbunden',
    connectFailed: 'Bridge konnte nicht verbunden werden',
    disconnected: 'Externer Agent getrennt',
    permissions: {
      readNotes: 'Externe Agents dürfen Notizen lesen',
      createNotes: 'Externe Agents dürfen Notizen erstellen',
      editNotes: 'Externe Agents dürfen Notizen bearbeiten',
      deleteNotes: 'Externe Agents dürfen Notizen löschen',
      manageCalendar: 'Externe Agents dürfen Kalendertermine verwalten',
    },
  },

  advanced: 'Erweiterte Optionen',

  prompt: {
    heading: 'Assistenten-Prompt',
    reset: 'Auf Standard zurücksetzen',
    resetDone: 'Assistenten-Prompt zurückgesetzt',
  },

  privacyNote: {
    zdrEnabled: '{label} aktiviert.',
    includedTitle: 'Datenschutzhinweis zu Included AI:',
    includedBody: 'Prompts und ausgewählter Kontext werden von YANTA Cloud nur flüchtig verarbeitet, um sie mit aktiviertem ZDR an OpenRouter weiterzuleiten. YANTA speichert keine Prompts, Antworten oder Tool-Ergebnisse auf dem Server. Dein verschlüsselter Sync-Tresor bleibt Zero-Knowledge.',
    byokTitle: 'Datenschutzhinweis zu BYOK:',
    byokBody: 'Dein API-Schlüssel bleibt in diesem Browser. Prompts und ausgewählter Kontext werden mit aktiviertem ZDR direkt an OpenRouter gesendet. Dauerhaftes localStorage ist bequem, aber weniger sicher als „Nur für diese Sitzung“.',
  },

  save: 'KI-Einstellungen speichern',
  saved: 'KI-Einstellungen gespeichert',
  keyCleared: 'KI-Schlüssel entfernt',
  copyFailed: 'Kopieren fehlgeschlagen',
  includedEnabled: 'Included AI mit YANTA-Cloud-Guthaben aktiviert',

  policy: {
    includedModelLabel: 'YANTA-Cloud-Guthaben',
    zdrDescription: 'YANTA fordert bei OpenRouter Zero-Data-Retention-Routing an. Prompts werden nur an Endpunkte mit einer Zero-Data-Retention-Richtlinie weitergeleitet.',
    syncInactive: 'YANTA Cloud Sync ist auf diesem Gerät nicht aktiv.',
    signIn: 'Melde dich zuerst bei YANTA Cloud an.',
    notOnPlan: 'Included AI ist in deinem aktuellen Tarif nicht verfügbar.',
    verifyFailed: 'Der YANTA-Cloud-Status konnte nicht überprüft werden.',
  },
};
