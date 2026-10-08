// YANTA AI — Kontextauswahl und Kontextanzeige (Deutsch).
// Gleiche Schlüsselstruktur wie context.en.js.

export default {
  picker: {
    title: 'Zum KI-Kontext hinzufügen',
    close: 'Schließen',
    tabsLabel: 'Quelle für KI-Kontext',
    tabs: {
      notes: 'Notizen',
      folders: 'Ordner',
      events: 'Termine',
      upload: 'Hochladen',
    },
    searchPlaceholder: 'Suchen…',
    searchLabel: 'KI-Kontext durchsuchen',
    noResults: 'Keine Ergebnisse.',
    untitledNote: 'Ohne Titel',
    untitledFolder: 'Ordner',
    untitledEvent: 'Termin ohne Titel',
    home: 'Start',
    uploadTitle: 'Dateien als KI-Kontext hochladen',
    uploadHint: 'Unterstützt werden Text, Markdown, JSON, CSV, PDF, DOCX und Bilder. Bilder werden zu WEBP komprimiert.',
    pickFiles: 'Dateien auswählen',
    added: 'KI-Kontext hinzugefügt',
    addedUploads: {
      one: '{count} Upload zum KI-Kontext hinzugefügt',
      other: '{count} Uploads zum KI-Kontext hinzugefügt',
    },
  },
  meter: {
    tokens: '~{count} Tokens',
    words: { one: '{count} Wort', other: '{count} Wörter' },
    chars: { one: '{count} Zeichen', other: '{count} Zeichen' },
    items: { one: '{count} Kontextelement', other: '{count} Kontextelemente' },
    images: { one: '{count} Bild', other: '{count} Bilder' },
    audio: { one: '{count} Audio', other: '{count} Audios' },
    unsupported: '{count} nicht unterstützt',
    messages: { one: '{count} Nachricht', other: '{count} Nachrichten' },
    titleEstimated: 'Geschätzt insgesamt: ~{tokens} Tokens',
    titleTotal: 'Gesamt: {words} Wörter · {chars} Zeichen',
    titleHistory: 'Verlauf: {messages} Nachrichten · {words} Wörter · {chars} Zeichen',
    titleAttached: 'Angehängter Kontext: {items} Elemente · {words} Wörter · {chars} Zeichen',
    titleImages: 'Bilder: {count}',
    titleAudio: 'Audio: {count}',
    titleUnsupported: 'Nicht unterstützt: {count}',
    titleNote: 'Die Token-Anzahl ist eine lokale Schätzung. Die genaue Zahl hängt vom Modell ab.',
  },
};
