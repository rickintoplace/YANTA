// ============================================================
// YANTA Chat API client
// ============================================================

const RAW_YANTA_CHAT_BASE_URL =
  import.meta.env.VITE_YANTA_CHAT_API_BASE_URL ||
  import.meta.env.VITE_YANTA_CLOUD_API_BASE_URL ||
  '/cloud-api';

export const YANTA_CHAT_BASE_URL =
  RAW_YANTA_CHAT_BASE_URL.startsWith('http')
    ? RAW_YANTA_CHAT_BASE_URL.replace(/\/+$/, '')
    : (location.origin + RAW_YANTA_CHAT_BASE_URL).replace(/\/+$/, '');

function apiUrl(path) {
  const base = String(YANTA_CHAT_BASE_URL || '/cloud-api').replace(/\/+$/, '');
  const cleanPath = String(path || '').replace(/^\/+/, '');

  return `${base}/${cleanPath}`;
}

async function apiFetch(path, {
  method = 'GET',
  body = null,
  headers = {},
} = {}) {
  const res = await fetch(apiUrl(path), {
    method,
    credentials: 'include',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : null,
  });

  let json = null;

  try {
    json = await res.json();
  } catch {}

  if (!res.ok) {
    const err = new Error(
      json?.message ||
      json?.error?.message ||
      json?.error ||
      `YANTA Chat request failed: HTTP ${res.status}`
    );

    err.status = res.status;
    err.response = json;

    throw err;
  }

  return json;
}

/**
 * Returns the current user's Chat account/provisioning state.
 */
export function chatAccount() {
  return apiFetch('/api/chat/account');
}

/**
 * Checks whether a Chat handle is still available.
 */
export function chatUsernameAvailable(name) {
  return apiFetch(`/api/chat/username-available?name=${encodeURIComponent(name)}`);
}

/**
 * Permanently provisions a Chat account with the selected handle.
 */
export function chatProvision(name) {
  return apiFetch('/api/chat/provision', {
    method: 'POST',
    body: {
      username: name,
    },
  });
}