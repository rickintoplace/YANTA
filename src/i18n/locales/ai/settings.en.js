// English strings for the AI settings panel (src/ai/ai-settings-panel.js) and
// the user-visible texts of the AI access policy (src/ai/ai-access-policy.js).
// Wired into en.js as `ai: { settings }` → keys are t('ai.settings.<path>').
//
// "Included AI" is YANTA's managed AI (paid with YANTA Cloud credits);
// "BYOK" (bring your own key) means the user's own OpenRouter API key.
// Keep product names as they are: YANTA, YANTA Cloud, OpenRouter, Open-Meteo,
// ZDR (Zero Data Retention), AI Brain, Sources, RSS, YouTube.

export default {
  access: {
    // Label of the select that switches between Included AI and BYOK.
    label: 'AI access',
    included: 'Included AI: YANTA Cloud credits',
    byok: 'BYOK: my OpenRouter key',
    includedModel: 'Included AI model',
    // Label of a disabled field that always shows "OpenRouter".
    provider: 'Provider',
    // API endpoint URL of the AI provider.
    baseUrl: 'Base URL',
    model: 'Model',
    keyStorage: 'API key storage',
    keyStorageSession: 'Session only',
    keyStorageLocal: 'Remember on this device (localStorage)',
    keyStorageNone: 'Do not store',
    apiKey: 'OpenRouter API key',
    clearKey: 'Clear key',
  },

  // Hidden privacy select (kept for compatibility, not shown at the moment).
  privacy: {
    label: 'Privacy',
    currentNote: 'Include current note',
    metadataOnly: 'Metadata only',
  },

  // How much the model reasons before answering. Option format: "Level · explanation".
  thinking: {
    label: 'Thinking',
    off: 'Off · fastest, most of the budget goes to the answer',
    low: 'Low · a short plan before acting',
    medium: 'Medium · for harder tasks, slower and costlier',
  },

  // Verification of quotes the AI attributes to sources. Option format: "Mode · explanation".
  citations: {
    label: 'Check citations',
    check: 'Check · every quote from a web page, article or note is verified against it',
    revise: 'Check and fix · failed citations go back to the model once',
    off: 'Off · no citation rules, no checking',
  },

  includedLimits: {
    heading: 'Included AI limits',
    body: 'Included AI uses managed YANTA Cloud credits. You can choose one of the YANTA-approved models. Context size, output size, daily credits and rate limits are controlled by YANTA Cloud for abuse protection.',
    // {context}, {rounds} and {output} are numbers.
    current: 'Current client-side limits: {context} context characters, {rounds} tool rounds, {output} max output tokens.',
  },

  byokLimits: {
    heading: 'BYOK advanced limits',
    maxContext: 'Max context characters',
    // A tool round is one step in which the assistant calls tools (search, read a note, …).
    maxToolRounds: 'Max tool rounds',
    body: 'BYOK uses your own OpenRouter key. Model, base URL and limits are freely configurable.',
  },

  // Badges shown under each permission checkbox.
  badges: {
    recommended: 'Recommended',
    optional: 'Optional',
  },

  permissions: {
    heading: 'Permissions',
    readNotes: 'Allow assistant to read notes',
    createNotes: 'Allow assistant to create notes',
    editNotes: 'Allow assistant to edit notes',
    deleteNotes: 'Allow assistant to delete notes',
    manageCalendar: 'Allow assistant to manage calendar events',
    // "AI Brain" is a product feature name (the assistant's long-term memory notes).
    readAiBrain: 'Allow assistant to read AI Brain',
    writeAiBrain: 'Allow assistant to write AI Brain',
    weather: 'Allow assistant to fetch weather via Open-Meteo',
    webSearch: 'Allow assistant to search the web',
    approxLocation: 'Allow assistant to receive approximate location context',
    // "Sources" is the name of YANTA's feed reader (RSS feeds, YouTube channels).
    readRss: 'Allow assistant to read Sources/RSS items',
    manageRss: 'Allow assistant to refresh/manage Sources',
    addRssSources: 'Allow assistant to add RSS feeds and YouTube channels to Sources',
    saveRssToNotes: 'Allow assistant to save Sources items as notes',
    readChat: 'Allow assistant to read Chat messages',
    sendChat: 'Allow assistant to send Chat messages after confirmation',
    sendChatAutonomous: 'Allow assistant to send Chat messages without review',
  },

  location: {
    heading: 'Approximate location',
    // "instead" = instead of sharing the exact device position.
    intro: 'Used for weather questions like “weather here”. Enter a city, region or postcode instead.',
    // Followed by the stored place, coordinates, time zone and date.
    stored: 'Stored:',
    none: 'No approximate location stored.',
    placeLabel: 'City, region or postcode',
    // Example inputs; keep them real places/postcodes the geocoder can find.
    placePlaceholder: 'e.g. Göttingen, 37073, 10001, SW1A 1AA',
    countryLabel: 'Country code (optional)',
    searching: 'Searching locations…',
    // Fallback name for a search result without a label.
    resultFallback: 'Location',
    find: 'Find matches',
    saveBest: 'Save best match',
    clear: 'Clear location',
    enterQuery: 'Enter a city, region or postcode',
    saved: 'Approximate location saved',
    cleared: 'Approximate location cleared',
    notFound: 'Could not find location',
    saveFailed: 'Could not save location',
  },

  // Local bridge that lets AI agents running on the user's computer access YANTA.
  externalAgents: {
    heading: 'External Agents',
    allow: 'Allow external AI agents to connect',
    enabled: 'Enabled',
    disabled: 'Disabled',
    bridgeUrl: 'Local bridge URL',
    token: 'Session token',
    connected: 'Connected to local bridge',
    notConnected: 'Not connected',
    hidden: 'External agent bridge settings are hidden while external agent access is disabled. Enable this option to show bridge URL, token, permissions and setup text.',
    copySetup: 'Copy setup text',
    regenerateToken: 'Regenerate token',
    disconnect: 'Disconnect',
    connect: 'Connect',
    setupCopied: 'External agent setup text copied',
    tokenRegenerated: 'External agent token regenerated',
    bridgeConnected: 'External agent bridge connected',
    connectFailed: 'Could not connect bridge',
    disconnected: 'External agent disconnected',
    permissions: {
      readNotes: 'Allow external agents to read notes',
      createNotes: 'Allow external agents to create notes',
      editNotes: 'Allow external agents to edit notes',
      deleteNotes: 'Allow external agents to delete notes',
      manageCalendar: 'Allow external agents to manage calendar events',
    },
  },

  advanced: 'Advanced options',

  // The system prompt that tells the assistant how to behave.
  prompt: {
    heading: 'Assistant prompt',
    reset: 'Reset to default',
    resetDone: 'Assistant prompt reset',
  },

  privacyNote: {
    // {label} is a product name, e.g. "OpenRouter ZDR".
    zdrEnabled: '{label} enabled.',
    includedTitle: 'Included AI privacy note:',
    includedBody: 'Prompts and selected context are processed transiently by YANTA Cloud only to forward them to OpenRouter with ZDR enabled. YANTA does not store prompts, completions or tool results on the server. Your encrypted sync vault remains zero-knowledge.',
    byokTitle: 'BYOK privacy note:',
    byokBody: 'Your API key stays in this browser. Prompts and selected context are sent directly to OpenRouter with ZDR enabled. Persistent localStorage is convenient but less safe than session-only.',
  },

  save: 'Save AI settings',
  saved: 'AI settings saved',
  keyCleared: 'AI key cleared',
  copyFailed: 'Copy failed',
  includedEnabled: 'Included AI enabled with YANTA Cloud credits',

  // Texts from the access policy (ai-access-policy.js).
  policy: {
    // Short name of the Included AI billing source.
    includedModelLabel: 'YANTA Cloud credits',
    // Explains the OpenRouter ZDR (Zero Data Retention) routing YANTA requests.
    zdrDescription: 'YANTA requests Zero Data Retention routing from OpenRouter. Prompts are routed only to endpoints with a Zero Data Retention policy.',
    // Reasons shown in a toast when Included AI can't be switched on or used.
    syncInactive: 'YANTA Cloud Sync is not active on this device.',
    signIn: 'Sign in to YANTA Cloud first.',
    notOnPlan: 'Included AI is not available on your current plan.',
    verifyFailed: 'Could not verify YANTA Cloud status.',
  },
};
