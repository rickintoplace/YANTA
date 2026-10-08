// YANTA — ajustes de IA (español). Misma estructura de claves que
// settings.en.js; se usan como t('ai.settings.<path>').

export default {
  access: {
    label: 'Acceso a la IA',
    included: 'IA incluida: créditos de YANTA Cloud',
    byok: 'BYOK: mi clave de OpenRouter',
    includedModel: 'Modelo de la IA incluida',
    provider: 'Proveedor',
    baseUrl: 'URL base',
    model: 'Modelo',
    keyStorage: 'Almacenamiento de la clave de API',
    keyStorageSession: 'Solo esta sesión',
    keyStorageLocal: 'Recordar en este dispositivo (localStorage)',
    keyStorageNone: 'No guardar',
    apiKey: 'Clave de API de OpenRouter',
    clearKey: 'Borrar clave',
  },

  privacy: {
    label: 'Privacidad',
    currentNote: 'Incluir la nota actual',
    metadataOnly: 'Solo metadatos',
  },

  thinking: {
    label: 'Razonamiento',
    off: 'Desactivado · lo más rápido, casi todo el presupuesto va a la respuesta',
    low: 'Bajo · un plan breve antes de actuar',
    medium: 'Medio · para tareas más difíciles, más lento y más caro',
  },

  citations: {
    label: 'Comprobar citas',
    check: 'Comprobar · cada cita de una página web, artículo o nota se verifica con su origen',
    revise: 'Comprobar y corregir · las citas fallidas vuelven al modelo una vez',
    off: 'Desactivado · sin reglas de citas ni comprobación',
  },

  includedLimits: {
    heading: 'Límites de la IA incluida',
    body: 'La IA incluida usa créditos gestionados de YANTA Cloud. Puedes elegir uno de los modelos aprobados por YANTA. El tamaño del contexto, el tamaño de la respuesta, los créditos diarios y los límites de frecuencia los controla YANTA Cloud para evitar abusos.',
    current: 'Límites actuales del cliente: {context} caracteres de contexto, {rounds} rondas de herramientas, {output} tokens de salida como máximo.',
  },

  byokLimits: {
    heading: 'Límites avanzados de BYOK',
    maxContext: 'Máximo de caracteres de contexto',
    maxToolRounds: 'Máximo de rondas de herramientas',
    body: 'BYOK usa tu propia clave de OpenRouter. El modelo, la URL base y los límites se pueden configurar libremente.',
  },

  badges: {
    recommended: 'Recomendado',
    optional: 'Opcional',
  },

  permissions: {
    heading: 'Permisos',
    readNotes: 'Permitir al asistente leer notas',
    createNotes: 'Permitir al asistente crear notas',
    editNotes: 'Permitir al asistente editar notas',
    deleteNotes: 'Permitir al asistente eliminar notas',
    manageCalendar: 'Permitir al asistente gestionar eventos del calendario',
    readAiBrain: 'Permitir al asistente leer AI Brain',
    writeAiBrain: 'Permitir al asistente escribir en AI Brain',
    weather: 'Permitir al asistente consultar el tiempo a través de Open-Meteo',
    webSearch: 'Permitir al asistente buscar en la web',
    approxLocation: 'Permitir al asistente recibir contexto de ubicación aproximada',
    readRss: 'Permitir al asistente leer elementos de Fuentes/RSS',
    manageRss: 'Permitir al asistente actualizar/gestionar Fuentes',
    addRssSources: 'Permitir al asistente añadir fuentes RSS y canales de YouTube a Fuentes',
    saveRssToNotes: 'Permitir al asistente guardar elementos de Fuentes como notas',
    readChat: 'Permitir al asistente leer mensajes de Chat',
    sendChat: 'Permitir al asistente enviar mensajes de Chat tras confirmación',
    sendChatAutonomous: 'Permitir al asistente enviar mensajes de Chat sin revisión',
  },

  location: {
    heading: 'Ubicación aproximada',
    intro: 'Se usa para preguntas sobre el tiempo como «qué tiempo hace aquí». Introduce en su lugar una ciudad, región o código postal.',
    stored: 'Guardada:',
    none: 'No hay ninguna ubicación aproximada guardada.',
    placeLabel: 'Ciudad, región o código postal',
    placePlaceholder: 'p. ej. Göttingen, 28013, 10001, SW1A 1AA',
    countryLabel: 'Código de país (opcional)',
    searching: 'Buscando ubicaciones…',
    resultFallback: 'Ubicación',
    find: 'Buscar coincidencias',
    saveBest: 'Guardar la mejor coincidencia',
    clear: 'Borrar ubicación',
    enterQuery: 'Introduce una ciudad, región o código postal',
    saved: 'Ubicación aproximada guardada',
    cleared: 'Ubicación aproximada borrada',
    notFound: 'No se encontró la ubicación',
    saveFailed: 'No se pudo guardar la ubicación',
  },

  externalAgents: {
    heading: 'Agentes externos',
    allow: 'Permitir que se conecten agentes de IA externos',
    enabled: 'Activado',
    disabled: 'Desactivado',
    bridgeUrl: 'URL del puente local',
    token: 'Token de sesión',
    connected: 'Conectado al puente local',
    notConnected: 'Sin conexión',
    hidden: 'Los ajustes del puente de agentes externos están ocultos mientras el acceso de agentes externos esté desactivado. Activa esta opción para mostrar la URL del puente, el token, los permisos y el texto de configuración.',
    copySetup: 'Copiar texto de configuración',
    regenerateToken: 'Regenerar token',
    disconnect: 'Desconectar',
    connect: 'Conectar',
    setupCopied: 'Texto de configuración del agente externo copiado',
    tokenRegenerated: 'Token del agente externo regenerado',
    bridgeConnected: 'Puente de agentes externos conectado',
    connectFailed: 'No se pudo conectar el puente',
    disconnected: 'Agente externo desconectado',
    permissions: {
      readNotes: 'Permitir a los agentes externos leer notas',
      createNotes: 'Permitir a los agentes externos crear notas',
      editNotes: 'Permitir a los agentes externos editar notas',
      deleteNotes: 'Permitir a los agentes externos eliminar notas',
      manageCalendar: 'Permitir a los agentes externos gestionar eventos del calendario',
    },
  },

  advanced: 'Opciones avanzadas',

  prompt: {
    heading: 'Instrucciones del asistente',
    reset: 'Restablecer valores predeterminados',
    resetDone: 'Instrucciones del asistente restablecidas',
  },

  privacyNote: {
    zdrEnabled: '{label} activado.',
    includedTitle: 'Nota de privacidad de la IA incluida:',
    includedBody: 'YANTA Cloud procesa las indicaciones y el contexto seleccionado de forma transitoria, solo para reenviarlos a OpenRouter con ZDR activado. YANTA no almacena en el servidor indicaciones, respuestas ni resultados de herramientas. Tu bóveda de sincronización cifrada sigue siendo de conocimiento cero.',
    byokTitle: 'Nota de privacidad de BYOK:',
    byokBody: 'Tu clave de API se queda en este navegador. Las indicaciones y el contexto seleccionado se envían directamente a OpenRouter con ZDR activado. El localStorage persistente es cómodo, pero menos seguro que la opción de solo esta sesión.',
  },

  save: 'Guardar ajustes de IA',
  saved: 'Ajustes de IA guardados',
  keyCleared: 'Clave de IA borrada',
  copyFailed: 'No se pudo copiar',
  includedEnabled: 'IA incluida activada con créditos de YANTA Cloud',

  policy: {
    includedModelLabel: 'Créditos de YANTA Cloud',
    zdrDescription: 'YANTA solicita a OpenRouter el enrutamiento con retención de datos cero (Zero Data Retention). Las indicaciones solo se envían a endpoints con una política de Zero Data Retention.',
    syncInactive: 'YANTA Cloud Sync no está activo en este dispositivo.',
    signIn: 'Primero inicia sesión en YANTA Cloud.',
    notOnPlan: 'La IA incluida no está disponible en tu plan actual.',
    verifyFailed: 'No se pudo verificar el estado de YANTA Cloud.',
  },
};
