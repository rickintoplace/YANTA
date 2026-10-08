// YANTA AI — selector y medidor de contexto (español). Misma estructura de
// claves que context.en.js; se usan como t('ai.context.<path>').

export default {
  picker: {
    title: 'Añadir al contexto de IA',
    close: 'Cerrar',
    tabsLabel: 'Origen del contexto de IA',
    tabs: {
      notes: 'Notas',
      folders: 'Carpetas',
      events: 'Eventos',
      upload: 'Subir',
    },
    searchPlaceholder: 'Buscar…',
    searchLabel: 'Buscar contexto de IA',
    noResults: 'Sin resultados.',
    untitledNote: 'Sin título',
    untitledFolder: 'Carpeta',
    untitledEvent: 'Evento sin título',
    home: 'Inicio',
    uploadTitle: 'Subir archivos como contexto de IA',
    uploadHint: 'Se admiten texto, Markdown, JSON, CSV, PDF, DOCX e imágenes. Las imágenes se comprimen a WEBP.',
    pickFiles: 'Elegir archivos',
    added: 'Contexto de IA añadido',
    addedUploads: {
      one: '{count} archivo subido añadido al contexto de IA',
      other: '{count} archivos subidos añadidos al contexto de IA',
    },
  },
  meter: {
    tokens: '~{count} tokens',
    words: { one: '{count} palabra', other: '{count} palabras' },
    chars: { one: '{count} car.', other: '{count} car.' },
    items: { one: '{count} elemento de contexto', other: '{count} elementos de contexto' },
    images: { one: '{count} imagen', other: '{count} imágenes' },
    audio: { one: '{count} audio', other: '{count} audios' },
    unsupported: '{count} sin soporte',
    messages: { one: '{count} mensaje', other: '{count} mensajes' },
    titleEstimated: 'Total estimado: ~{tokens} tokens',
    titleTotal: 'Total: {words} palabras · {chars} caracteres',
    titleHistory: 'Historial: {messages} mensajes · {words} palabras · {chars} caracteres',
    titleAttached: 'Contexto adjunto: {items} elementos · {words} palabras · {chars} caracteres',
    titleImages: 'Imágenes: {count}',
    titleAudio: 'Audio: {count}',
    titleUnsupported: 'No compatibles: {count}',
    titleNote: 'El recuento de tokens es una estimación local. Los tokens exactos dependen del modelo.',
  },
};
