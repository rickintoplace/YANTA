// Chaînes françaises du panneau de paramètres IA (src/ai/ai-settings-panel.js)
// et des textes visibles de la politique d’accès IA (src/ai/ai-access-policy.js).
// Même structure de clés que settings.en.js.

export default {
  access: {
    label: 'Accès à l’IA',
    included: 'Included AI : crédits YANTA Cloud',
    byok: 'BYOK : ma clé OpenRouter',
    includedModel: 'Modèle Included AI',
    provider: 'Fournisseur',
    baseUrl: 'URL de base',
    model: 'Modèle',
    keyStorage: 'Stockage de la clé d’API',
    keyStorageSession: 'Session uniquement',
    keyStorageLocal: 'Mémoriser sur cet appareil (localStorage)',
    keyStorageNone: 'Ne pas stocker',
    apiKey: 'Clé d’API OpenRouter',
    clearKey: 'Effacer la clé',
  },

  privacy: {
    label: 'Confidentialité',
    currentNote: 'Inclure la note actuelle',
    metadataOnly: 'Métadonnées uniquement',
  },

  thinking: {
    label: 'Réflexion',
    off: 'Désactivée · la plus rapide, l’essentiel du budget va à la réponse',
    low: 'Faible · un court plan avant d’agir',
    medium: 'Moyenne · pour les tâches plus difficiles, plus lente et plus coûteuse',
  },

  citations: {
    label: 'Vérifier les citations',
    check: 'Vérifier · chaque citation d’une page web, d’un article ou d’une note est vérifiée par rapport à celle-ci',
    revise: 'Vérifier et corriger · les citations en échec sont renvoyées une fois au modèle',
    off: 'Désactivé · aucune règle de citation, aucune vérification',
  },

  includedLimits: {
    heading: 'Limites Included AI',
    body: 'Included AI utilise des crédits YANTA Cloud gérés. Vous pouvez choisir l’un des modèles approuvés par YANTA. La taille du contexte, la taille de sortie, les crédits quotidiens et les limites de débit sont contrôlés par YANTA Cloud pour prévenir les abus.',
    current: 'Limites actuelles côté client : {context} caractères de contexte, {rounds} tours d’outils, {output} jetons de sortie max.',
  },

  byokLimits: {
    heading: 'Limites avancées BYOK',
    maxContext: 'Caractères de contexte max.',
    maxToolRounds: 'Tours d’outils max.',
    body: 'BYOK utilise votre propre clé OpenRouter. Le modèle, l’URL de base et les limites sont librement configurables.',
  },

  badges: {
    recommended: 'Recommandé',
    optional: 'Facultatif',
  },

  permissions: {
    heading: 'Autorisations',
    readNotes: 'Autoriser l’assistant à lire les notes',
    createNotes: 'Autoriser l’assistant à créer des notes',
    editNotes: 'Autoriser l’assistant à modifier les notes',
    deleteNotes: 'Autoriser l’assistant à supprimer des notes',
    manageCalendar: 'Autoriser l’assistant à gérer les événements du calendrier',
    readAiBrain: 'Autoriser l’assistant à lire AI Brain',
    writeAiBrain: 'Autoriser l’assistant à écrire dans AI Brain',
    weather: 'Autoriser l’assistant à récupérer la météo via Open-Meteo',
    webSearch: 'Autoriser l’assistant à effectuer des recherches sur le web',
    approxLocation: 'Autoriser l’assistant à recevoir une position approximative comme contexte',
    readRss: 'Autoriser l’assistant à lire les éléments Sources/RSS',
    manageRss: 'Autoriser l’assistant à actualiser/gérer les Sources',
    addRssSources: 'Autoriser l’assistant à ajouter des flux RSS et des chaînes YouTube aux Sources',
    saveRssToNotes: 'Autoriser l’assistant à enregistrer des éléments des Sources comme notes',
    readChat: 'Autoriser l’assistant à lire les messages Chat',
    sendChat: 'Autoriser l’assistant à envoyer des messages Chat après confirmation',
    sendChatAutonomous: 'Autoriser l’assistant à envoyer des messages Chat sans vérification',
  },

  location: {
    heading: 'Position approximative',
    intro: 'Utilisée pour les questions météo comme « la météo ici ». Saisissez plutôt une ville, une région ou un code postal.',
    stored: 'Enregistrée :',
    none: 'Aucune position approximative enregistrée.',
    placeLabel: 'Ville, région ou code postal',
    placePlaceholder: 'p. ex. Göttingen, 37073, 10001, SW1A 1AA',
    countryLabel: 'Code pays (facultatif)',
    searching: 'Recherche de lieux…',
    resultFallback: 'Lieu',
    find: 'Trouver des correspondances',
    saveBest: 'Enregistrer la meilleure correspondance',
    clear: 'Effacer la position',
    enterQuery: 'Saisissez une ville, une région ou un code postal',
    saved: 'Position approximative enregistrée',
    cleared: 'Position approximative effacée',
    notFound: 'Lieu introuvable',
    saveFailed: 'Impossible d’enregistrer la position',
  },

  externalAgents: {
    heading: 'Agents externes',
    allow: 'Autoriser les agents IA externes à se connecter',
    enabled: 'Activé',
    disabled: 'Désactivé',
    bridgeUrl: 'URL de la passerelle locale',
    token: 'Jeton de session',
    connected: 'Connecté à la passerelle locale',
    notConnected: 'Non connecté',
    hidden: 'Les paramètres de la passerelle d’agents externes sont masqués tant que l’accès des agents externes est désactivé. Activez cette option pour afficher l’URL de la passerelle, le jeton, les autorisations et le texte de configuration.',
    copySetup: 'Copier le texte de configuration',
    regenerateToken: 'Régénérer le jeton',
    disconnect: 'Déconnecter',
    connect: 'Connecter',
    setupCopied: 'Texte de configuration de l’agent externe copié',
    tokenRegenerated: 'Jeton de l’agent externe régénéré',
    bridgeConnected: 'Passerelle d’agents externes connectée',
    connectFailed: 'Impossible de connecter la passerelle',
    disconnected: 'Agent externe déconnecté',
    permissions: {
      readNotes: 'Autoriser les agents externes à lire les notes',
      createNotes: 'Autoriser les agents externes à créer des notes',
      editNotes: 'Autoriser les agents externes à modifier les notes',
      deleteNotes: 'Autoriser les agents externes à supprimer des notes',
      manageCalendar: 'Autoriser les agents externes à gérer les événements du calendrier',
    },
  },

  advanced: 'Options avancées',

  prompt: {
    heading: 'Invite de l’assistant',
    reset: 'Rétablir la valeur par défaut',
    resetDone: 'Invite de l’assistant réinitialisée',
  },

  privacyNote: {
    zdrEnabled: '{label} activé.',
    includedTitle: 'Note de confidentialité Included AI :',
    includedBody: 'Les invites et le contexte sélectionné sont traités de manière transitoire par YANTA Cloud, uniquement pour être transmis à OpenRouter avec ZDR activé. YANTA ne stocke ni les invites, ni les réponses, ni les résultats d’outils sur le serveur. Votre coffre de synchronisation chiffré reste à connaissance nulle (zero-knowledge).',
    byokTitle: 'Note de confidentialité BYOK :',
    byokBody: 'Votre clé d’API reste dans ce navigateur. Les invites et le contexte sélectionné sont envoyés directement à OpenRouter avec ZDR activé. Le localStorage persistant est pratique, mais moins sûr que le stockage limité à la session.',
  },

  save: 'Enregistrer les paramètres de l’IA',
  saved: 'Paramètres de l’IA enregistrés',
  keyCleared: 'Clé d’IA effacée',
  copyFailed: 'Échec de la copie',
  includedEnabled: 'Included AI activé avec les crédits YANTA Cloud',

  policy: {
    includedModelLabel: 'Crédits YANTA Cloud',
    zdrDescription: 'YANTA demande à OpenRouter un routage Zero Data Retention. Les invites ne sont acheminées que vers des points de terminaison appliquant une politique de non-conservation des données (Zero Data Retention).',
    syncInactive: 'YANTA Cloud Sync n’est pas actif sur cet appareil.',
    signIn: 'Connectez-vous d’abord à YANTA Cloud.',
    notOnPlan: 'Included AI n’est pas disponible avec votre formule actuelle.',
    verifyFailed: 'Impossible de vérifier l’état de YANTA Cloud.',
  },
};
