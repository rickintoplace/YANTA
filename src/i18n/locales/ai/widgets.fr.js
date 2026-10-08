// YANTA AI — widgets interactifs du chat (français). Utilisé comme t('ai.widgets.<path>').
// Même structure de clés que widgets.en.js.

export default {
  titles: {
    calculator: 'Calculatrice',
    chart: 'Graphique',
    table: 'Comparaison',
    checklist: 'Liste de contrôle',
    events: 'Programme',
    stats: 'En un coup d’œil',
    progress: 'Progression',
    steps: 'Étapes',
    proscons: 'Pour et contre',
    choices: 'Faites un choix',
    flashcards: 'Cartes mémoire',
    timer: 'Minuteur',
  },

  actions: {
    saveAsNote: 'Enregistrer comme note',
    noteTitleFallback: 'De YANTA AI',
  },

  toast: {
    saved: '« {title} » enregistré',
    savedUntitled: 'Note enregistrée',
    open: 'Ouvrir',
    saveFailed: 'Impossible d’enregistrer : {error}',
  },

  error: {
    notShown: 'Impossible d’afficher cette vue interactive',
    notBuilt: 'Impossible de construire cette vue.',
  },

  calculator: {
    yes: 'oui',
    no: 'non',
  },

  chart: {
    seriesName: 'Série {n}',
    total: 'Total',
  },

  table: {
    best: 'meilleur',
  },

  events: {
    allDay: 'Toute la journée',
    add: 'Ajouter',
    addToCalendar: 'Ajouter au calendrier',
    addAll: 'Tout ajouter',
    added: 'Ajouté',
    addFailed: 'Impossible d’ajouter l’événement : {error}',
    allAdded: 'Événements ajoutés à votre calendrier',
  },

  steps: {
    markDone: 'Marquer comme terminé',
  },

  proscons: {
    pros: 'Pour',
    cons: 'Contre',
    verdictMarkdown: '**Verdict :** {verdict}',
  },

  flashcards: {
    flip: 'Retourner la carte',
    tapToFlip: 'Touchez pour retourner',
    question: 'Question',
    answer: 'Réponse',
    previous: 'Précédente',
    next: 'Suivante',
    shuffle: 'Mélanger',
    cardMarkdown: '**Q :** {front}\n**R :** {back}',
  },

  timer: {
    start: 'Démarrer',
    pause: 'Pause',
    resume: 'Reprendre',
    reset: 'Réinitialiser',
    minutes: { one: '{count} min', other: '{count} min' },
    noteLine: 'Minuteur : {duration}',
    timeUp: '{label} : le temps est écoulé',
    notificationBody: 'Le temps est écoulé.',
  },
};
