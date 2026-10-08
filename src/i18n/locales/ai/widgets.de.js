// YANTA AI — interaktive Chat-Widgets (Deutsch). Gleiche Schlüsselstruktur
// wie widgets.en.js.

export default {
  titles: {
    calculator: 'Rechner',
    chart: 'Diagramm',
    table: 'Vergleich',
    checklist: 'Checkliste',
    events: 'Zeitplan',
    stats: 'Auf einen Blick',
    progress: 'Fortschritt',
    steps: 'Schritte',
    proscons: 'Vor- und Nachteile',
    choices: 'Wähle eine Option',
    flashcards: 'Karteikarten',
    timer: 'Timer',
  },

  actions: {
    saveAsNote: 'Als Notiz speichern',
    noteTitleFallback: 'Von YANTA AI',
  },

  toast: {
    saved: '„{title}“ gespeichert',
    savedUntitled: 'Notiz gespeichert',
    open: 'Öffnen',
    saveFailed: 'Speichern fehlgeschlagen: {error}',
  },

  error: {
    notShown: 'Diese interaktive Ansicht konnte nicht angezeigt werden',
    notBuilt: 'Diese Ansicht konnte nicht erstellt werden.',
  },

  calculator: {
    yes: 'ja',
    no: 'nein',
  },

  chart: {
    seriesName: 'Reihe {n}',
    total: 'Gesamt',
  },

  table: {
    best: 'beste',
  },

  events: {
    allDay: 'Ganztägig',
    add: 'Hinzufügen',
    addToCalendar: 'Zum Kalender hinzufügen',
    addAll: 'Alle hinzufügen',
    added: 'Hinzugefügt',
    addFailed: 'Termin konnte nicht hinzugefügt werden: {error}',
    allAdded: 'Termine zu deinem Kalender hinzugefügt',
  },

  steps: {
    markDone: 'Als erledigt markieren',
  },

  proscons: {
    pros: 'Vorteile',
    cons: 'Nachteile',
    verdictMarkdown: '**Fazit:** {verdict}',
  },

  flashcards: {
    flip: 'Karte umdrehen',
    tapToFlip: 'Zum Umdrehen tippen',
    question: 'Frage',
    answer: 'Antwort',
    previous: 'Zurück',
    next: 'Weiter',
    shuffle: 'Mischen',
    cardMarkdown: '**F:** {front}\n**A:** {back}',
  },

  timer: {
    start: 'Start',
    pause: 'Pause',
    resume: 'Fortsetzen',
    reset: 'Zurücksetzen',
    minutes: { one: '{count} Min.', other: '{count} Min.' },
    noteLine: 'Timer: {duration}',
    timeUp: '{label}: Zeit ist um',
    notificationBody: 'Die Zeit ist um.',
  },
};
