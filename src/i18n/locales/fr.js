// Français. Mirrors the key structure of en.js exactly (see i18n:check).

export default {
  boot: {
    loading: 'Chargement de l’application…',
    slow: 'Chargement en cours – votre connexion semble lente…',
    failed: 'Impossible de démarrer YANTA. Veuillez recharger la page.',
    stage: {
      vault: 'Ouverture de votre coffre…',
      notes: 'Chargement de vos notes…',
      workspace: 'Préparation de votre espace de travail…',
      almost: 'Presque prêt…',
    },
  },

  common: {
    save: 'Enregistrer',
    cancel: 'Annuler',
    close: 'Fermer',
    done: 'Terminé',
    delete: 'Supprimer',
    copy: 'Copier',
    back: 'Retour',
    reset: 'Réinitialiser',
    continue: 'Continuer',
    maybeLater: 'Plus tard',
  },

  appShell: {
    searchPlaceholder: 'Rechercher des notes… (Ctrl+K)',
    toggleTheme: 'Changer de thème (T)',
    settings: 'Paramètres',
    status: {
      words: { one: '{count} mot', other: '{count} mots' },
      chars: { one: '{count} caractère', other: '{count} caractères' },
      saved: 'Enregistré',
    },
  },

  settings: {
    language: {
      title: 'Langue',
      subtitle: 'Choisissez la langue d’affichage de l’interface de YANTA.',
      label: 'Langue d’affichage',
      hint: 'S’applique à toute l’application. YANTA se recharge pour changer de langue.',
      matchSystem: 'Suivre le système',
      changed: 'Langue mise à jour',
    },
  },

  onboarding: {
    chooser: {
      title: 'Où vos notes doivent-elles vivre ?',
      subtitle: 'Choisissez un point de départ – ce n’est pas définitif.',
      ariaLabel: 'Où vos notes doivent-elles vivre ?',
      groupLabel: 'Emplacement de stockage',
      footnote: 'Vous pouvez changer d’avis à tout moment dans les Paramètres – vos notes restent en place.',
    },
    badge: {
      default: 'Par défaut',
      recommended: 'Recommandé',
      advanced: 'Avancé',
    },
    choices: {
      local: {
        title: 'Sur cet appareil',
        desc: 'Aucun compte, rien à configurer. Privé par défaut : vos notes ne quittent jamais cet appareil.',
      },
      cloud: {
        title: 'YANTA Cloud',
        desc: 'Synchronisez sur tous vos appareils, avec un chiffrement de bout en bout. Nous ne stockons que des objets chiffrés.',
      },
      byo: {
        title: 'Votre propre Google Drive',
        desc: 'Apportez votre propre stockage. La synchronisation chiffrée passe par un dossier Drive que vous contrôlez entièrement.',
      },
    },
    localToast: 'Vos notes restent sur cet appareil. Vous pouvez activer la synchronisation à tout moment dans les Paramètres.',
    openError: 'Impossible d’ouvrir la configuration de synchronisation. Vous pouvez l’activer à tout moment dans les Paramètres.',
    nudge: {
      title: 'Vos notes sont sur cet appareil',
      subtitle: 'Configurez la synchronisation pour les retrouver sur tous vos appareils. Chiffrement de bout en bout.',
      cta: 'Configurer la synchronisation',
      dismiss: 'Ignorer',
    },
  },
};
