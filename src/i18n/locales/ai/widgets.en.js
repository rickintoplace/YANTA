// ============================================================
// YANTA AI — interactive chat widgets (src/ai/ui-widgets.js,
// src/ai/ui-widget-charts.js). Used as t('ai.widgets.<path>').
//
// The widgets themselves (titles, labels, values) come from the model in
// the user's language; these strings are only YANTA's own chrome around
// them, plus the labels written into a note by "Save as note".
// ============================================================

export default {
  // Header title when the model gave the widget none.
  titles: {
    calculator: 'Calculator',
    chart: 'Chart',
    table: 'Comparison',
    checklist: 'Checklist',
    events: 'Schedule',
    stats: 'At a glance',
    progress: 'Progress',
    steps: 'Steps',
    proscons: 'Pros and cons',
    choices: 'Pick one',
    flashcards: 'Flashcards',
    timer: 'Timer',
  },

  // Header buttons shared by all widgets.
  actions: {
    saveAsNote: 'Save as note',
    // Title of the saved note when the widget has no title.
    noteTitleFallback: 'From YANTA AI',
  },

  toast: {
    saved: 'Saved “{title}”',
    savedUntitled: 'Note saved',
    // Toast button that opens the note just saved.
    open: 'Open',
    saveFailed: 'Could not save: {error}',
  },

  error: {
    // Fold-out summary when the model's widget block is broken.
    notShown: 'This interactive view could not be shown',
    notBuilt: 'This view could not be built.',
  },

  calculator: {
    // Value of an on/off input in the saved note.
    yes: 'yes',
    no: 'no',
  },

  chart: {
    // Name of an unnamed data series; {n} is its position.
    seriesName: 'Series {n}',
    // Donut centre caption under the sum of all segments.
    total: 'Total',
  },

  table: {
    // Badge on the row with the best value.
    best: 'best',
  },

  events: {
    allDay: 'All day',
    add: 'Add',
    addToCalendar: 'Add to calendar',
    addAll: 'Add all',
    added: 'Added',
    addFailed: 'Could not add the event: {error}',
    allAdded: 'Events added to your calendar',
  },

  steps: {
    markDone: 'Mark as done',
  },

  proscons: {
    pros: 'Pros',
    cons: 'Cons',
    // Markdown line in the saved note; keep the ** around the label.
    verdictMarkdown: '**Verdict:** {verdict}',
  },

  flashcards: {
    flip: 'Flip card',
    tapToFlip: 'Tap to flip',
    // Small caption on the front / back of a card.
    question: 'Question',
    answer: 'Answer',
    previous: 'Previous',
    next: 'Next',
    shuffle: 'Shuffle',
    // One card in the saved note (Markdown; Q = question, A = answer).
    cardMarkdown: '**Q:** {front}\n**A:** {back}',
  },

  timer: {
    start: 'Start',
    pause: 'Pause',
    resume: 'Resume',
    reset: 'Reset',
    // Duration in minutes: preset chips and the saved note.
    minutes: { one: '{count} min', other: '{count} min' },
    // Line in the saved note; {duration} is e.g. "25 min".
    noteLine: 'Timer: {duration}',
    // Toast when the countdown ends; {label} is the timer's name.
    timeUp: '{label}: time is up',
    // Body of the system notification when the countdown ends.
    notificationBody: 'Time is up.',
  },
};
