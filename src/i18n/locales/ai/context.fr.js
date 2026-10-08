// YANTA AI — sélecteur et compteur de contexte (français).
// Utilisé comme t('ai.context.<path>').

export default {
  picker: {
    title: 'Ajouter au contexte IA',
    close: 'Fermer',
    tabsLabel: 'Source du contexte IA',
    tabs: {
      notes: 'Notes',
      folders: 'Dossiers',
      events: 'Événements',
      upload: 'Importer',
    },
    searchPlaceholder: 'Rechercher…',
    searchLabel: 'Rechercher du contexte IA',
    noResults: 'Aucun résultat.',
    untitledNote: 'Sans titre',
    untitledFolder: 'Dossier',
    untitledEvent: 'Événement sans titre',
    home: 'Accueil',
    uploadTitle: 'Importer des fichiers comme contexte IA',
    uploadHint: 'Texte, Markdown, JSON, CSV, PDF, DOCX et images sont pris en charge. Les images sont compressées en WEBP.',
    pickFiles: 'Choisir des fichiers',
    added: 'Contexte IA ajouté',
    addedUploads: {
      one: '{count} fichier importé ajouté au contexte IA',
      other: '{count} fichiers importés ajoutés au contexte IA',
    },
  },
  meter: {
    tokens: '~{count} jetons',
    words: { one: '{count} mot', other: '{count} mots' },
    chars: { one: '{count} car.', other: '{count} car.' },
    items: { one: '{count} élément de contexte', other: '{count} éléments de contexte' },
    images: { one: '{count} image', other: '{count} images' },
    audio: { one: '{count} audio', other: '{count} audios' },
    unsupported: '{count} non pris en charge',
    messages: { one: '{count} message', other: '{count} messages' },
    titleEstimated: 'Total estimé : ~{tokens} jetons',
    titleTotal: 'Total : {words} mots · {chars} car.',
    titleHistory: 'Historique : {messages} messages · {words} mots · {chars} car.',
    titleAttached: 'Contexte joint : {items} éléments · {words} mots · {chars} car.',
    titleImages: 'Images : {count}',
    titleAudio: 'Audio : {count}',
    titleUnsupported: 'Non pris en charge : {count}',
    titleNote: 'Le nombre de jetons est une estimation locale. Le décompte exact dépend du modèle.',
  },
};
