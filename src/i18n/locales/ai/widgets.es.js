// YANTA AI — widgets interactivos del chat (español). Misma estructura de
// claves que widgets.en.js; se usan como t('ai.widgets.<path>').

export default {
  titles: {
    calculator: 'Calculadora',
    chart: 'Gráfico',
    table: 'Comparación',
    checklist: 'Lista de comprobación',
    events: 'Agenda',
    stats: 'De un vistazo',
    progress: 'Progreso',
    steps: 'Pasos',
    proscons: 'Pros y contras',
    choices: 'Elige una opción',
    flashcards: 'Tarjetas de estudio',
    timer: 'Temporizador',
  },

  actions: {
    saveAsNote: 'Guardar como nota',
    noteTitleFallback: 'De YANTA AI',
  },

  toast: {
    saved: '«{title}» guardada',
    savedUntitled: 'Nota guardada',
    open: 'Abrir',
    saveFailed: 'No se pudo guardar: {error}',
  },

  error: {
    notShown: 'No se pudo mostrar esta vista interactiva',
    notBuilt: 'No se pudo generar esta vista.',
  },

  calculator: {
    yes: 'sí',
    no: 'no',
  },

  chart: {
    seriesName: 'Serie {n}',
    total: 'Total',
  },

  table: {
    best: 'mejor',
  },

  events: {
    allDay: 'Todo el día',
    add: 'Añadir',
    addToCalendar: 'Añadir al calendario',
    addAll: 'Añadir todos',
    added: 'Añadido',
    addFailed: 'No se pudo añadir el evento: {error}',
    allAdded: 'Eventos añadidos a tu calendario',
  },

  steps: {
    markDone: 'Marcar como hecho',
  },

  proscons: {
    pros: 'Pros',
    cons: 'Contras',
    verdictMarkdown: '**Veredicto:** {verdict}',
  },

  flashcards: {
    flip: 'Dar la vuelta a la tarjeta',
    tapToFlip: 'Toca para dar la vuelta',
    question: 'Pregunta',
    answer: 'Respuesta',
    previous: 'Anterior',
    next: 'Siguiente',
    shuffle: 'Barajar',
    cardMarkdown: '**P:** {front}\n**R:** {back}',
  },

  timer: {
    start: 'Iniciar',
    pause: 'Pausar',
    resume: 'Reanudar',
    reset: 'Restablecer',
    minutes: { one: '{count} min', other: '{count} min' },
    noteLine: 'Temporizador: {duration}',
    timeUp: '{label}: se acabó el tiempo',
    notificationBody: 'Se acabó el tiempo.',
  },
};
