// Español. Mirrors the key structure of en.js exactly (see i18n:check).

export default {
  boot: {
    loading: 'Cargando la aplicación…',
    slow: 'Sigue cargando: tu conexión parece lenta…',
    failed: 'No se pudo iniciar YANTA. Vuelve a cargar la página.',
    stage: {
      vault: 'Abriendo tu bóveda…',
      notes: 'Cargando tus notas…',
      workspace: 'Preparando tu espacio de trabajo…',
      almost: 'Casi listo…',
    },
  },

  common: {
    save: 'Guardar',
    cancel: 'Cancelar',
    close: 'Cerrar',
    done: 'Listo',
    delete: 'Eliminar',
    copy: 'Copiar',
    back: 'Atrás',
    reset: 'Restablecer',
    continue: 'Continuar',
    maybeLater: 'Quizás más tarde',
  },

  appShell: {
    searchPlaceholder: 'Buscar notas… (Ctrl+K)',
    toggleTheme: 'Cambiar tema (T)',
    settings: 'Ajustes',
    status: {
      words: { one: '{count} palabra', other: '{count} palabras' },
      chars: { one: '{count} carácter', other: '{count} caracteres' },
      saved: 'Guardado',
    },
  },

  settings: {
    language: {
      title: 'Idioma',
      subtitle: 'Elige el idioma en el que se muestra la interfaz de YANTA.',
      label: 'Idioma de la interfaz',
      hint: 'Se aplica a toda la aplicación. YANTA se recarga para cambiar de idioma.',
      matchSystem: 'Usar el del sistema',
      changed: 'Idioma actualizado',
    },
  },

  onboarding: {
    chooser: {
      title: '¿Dónde deben vivir tus notas?',
      subtitle: 'Elige un punto de partida; no es permanente.',
      ariaLabel: '¿Dónde deben vivir tus notas?',
      groupLabel: 'Ubicación de almacenamiento',
      footnote: 'Puedes cambiarlo cuando quieras en Ajustes; tus notas se quedan donde están.',
    },
    badge: {
      default: 'Predeterminado',
      recommended: 'Recomendado',
      advanced: 'Avanzado',
    },
    choices: {
      local: {
        title: 'En este dispositivo',
        desc: 'Sin cuenta ni configuración. Privado por defecto: tus notas nunca salen de este dispositivo.',
      },
      cloud: {
        title: 'YANTA Cloud',
        desc: 'Sincroniza en todos tus dispositivos, con cifrado de extremo a extremo. Solo almacenamos objetos cifrados.',
      },
      byo: {
        title: 'Tu propio Google Drive',
        desc: 'Usa tu propio almacenamiento. La sincronización cifrada pasa por una carpeta de Drive que controlas por completo.',
      },
    },
    localToast: 'Tus notas se quedan en este dispositivo. Puedes activar la sincronización cuando quieras en Ajustes.',
    openError: 'No se pudo abrir la configuración de sincronización. Puedes activarla cuando quieras en Ajustes.',
    nudge: {
      title: 'Tus notas están en este dispositivo',
      subtitle: 'Configura la sincronización para tenerlas en todos tus dispositivos. Con cifrado de extremo a extremo.',
      cta: 'Configurar sincronización',
      dismiss: 'Descartar',
    },
  },
};
