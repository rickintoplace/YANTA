// YANTA AI — context picker and context meter (English source).
// Used as t('ai.context.<path>').

export default {
  picker: {
    title: 'Add to AI Context',
    close: 'Close',
    tabsLabel: 'AI context source',
    tabs: {
      notes: 'Notes',
      folders: 'Folders',
      events: 'Events',
      upload: 'Upload',
    },
    searchPlaceholder: 'Search…',
    searchLabel: 'Search AI context',
    noResults: 'No results.',
    // Fallbacks for items without a title, and the root folder's name.
    untitledNote: 'Untitled',
    untitledFolder: 'Folder',
    untitledEvent: 'Untitled event',
    home: 'Home',
    uploadTitle: 'Upload files as AI context',
    uploadHint: 'Text, Markdown, JSON, CSV, PDF, DOCX and images are supported. Images are compressed to WEBP.',
    pickFiles: 'Pick files',
    added: 'Added AI context',
    addedUploads: {
      one: 'Added {count} upload to AI context',
      other: 'Added {count} uploads to AI context',
    },
  },
  // The small line under the chat ("~1,200 tokens · 300 words · …").
  meter: {
    tokens: '~{count} tokens',
    words: { one: '{count} word', other: '{count} words' },
    chars: { one: '{count} char', other: '{count} chars' },
    items: { one: '{count} context item', other: '{count} context items' },
    images: { one: '{count} image', other: '{count} images' },
    audio: { one: '{count} audio', other: '{count} audio' },
    unsupported: '{count} unsupported',
    messages: { one: '{count} message', other: '{count} messages' },
    // Tooltip lines.
    titleEstimated: 'Estimated total: ~{tokens} tokens',
    titleTotal: 'Total: {words} words · {chars} chars',
    titleHistory: 'History: {messages} messages · {words} words · {chars} chars',
    titleAttached: 'Attached context: {items} items · {words} words · {chars} chars',
    titleImages: 'Images: {count}',
    titleAudio: 'Audio: {count}',
    titleUnsupported: 'Unsupported: {count}',
    titleNote: 'Token count is a local estimate. Exact tokens are model-specific.',
  },
};
