// ============================================================
// YANTA External Agent — Settings
//
// Device-local only.
// Never synced.
// Never exported.
// ============================================================

const AGENT_SETTINGS_KEY = 'yanta.externalAgent.settings.v1';

const DEFAULT_AGENT_SETTINGS = {
  enabled: false,
  bridgeUrl: 'ws://127.0.0.1:18791',
  token: '',

  permissions: {
    allowReadNotes: true,
    allowCreateNotes: true,
    allowEditNotes: true,
    allowDeleteNotes: true,
    allowManageCalendar: true,
  },

  autoConnect: true,
};

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);

  return 'yanta-agent-session_' + btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function normalize(raw = {}) {
  return {
    ...DEFAULT_AGENT_SETTINGS,
    ...(raw && typeof raw === 'object' ? raw : {}),

    permissions: {
      ...DEFAULT_AGENT_SETTINGS.permissions,
      ...(raw?.permissions && typeof raw.permissions === 'object'
        ? raw.permissions
        : {}),
    },
  };
}

export function getExternalAgentSettings() {
  const raw = localStorage.getItem(AGENT_SETTINGS_KEY);
  const settings = normalize(raw ? safeJsonParse(raw, {}) : {});

  if (!settings.token) {
    settings.token = randomToken();
    saveExternalAgentSettings(settings);
  }

  return settings;
}

export function saveExternalAgentSettings(patch = {}) {
  const current = normalize(
    safeJsonParse(localStorage.getItem(AGENT_SETTINGS_KEY) || '{}', {})
  );

  const next = normalize({
    ...current,
    ...patch,
    permissions: {
      ...current.permissions,
      ...(patch.permissions || {}),
    },
  });

  if (!next.token) {
    next.token = randomToken();
  }

  localStorage.setItem(AGENT_SETTINGS_KEY, JSON.stringify(next));

  window.dispatchEvent(new CustomEvent('yanta-external-agent-settings-changed', {
    detail: next,
  }));

  return next;
}

export function regenerateExternalAgentToken() {
  return saveExternalAgentSettings({
    token: randomToken(),
  });
}

export function externalAgentPermissions() {
  return getExternalAgentSettings().permissions;
}