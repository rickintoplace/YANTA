// ============================================================
// YANTA Cloud API client
// ============================================================

const RAW_YANTA_CLOUD_BASE_URL =
  import.meta.env.VITE_YANTA_CLOUD_API_BASE_URL ||
  '/cloud-api';

export const YANTA_CLOUD_BASE_URL =
  RAW_YANTA_CLOUD_BASE_URL.startsWith('http')
    ? RAW_YANTA_CLOUD_BASE_URL.replace(/\/+$/, '')
    : (location.origin + RAW_YANTA_CLOUD_BASE_URL).replace(/\/+$/, '');

function apiUrl(path) {
  return `${YANTA_CLOUD_BASE_URL}/${String(path || '').replace(/^\/+/, '')}`;
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
      `YANTA Cloud request failed: HTTP ${res.status}`
    );

    err.status = res.status;
    err.response = json;

    throw err;
  }

  return json;
}

export function cloudMe() {
  return apiFetch('/api/me');
}

export function cloudSendCode(email, turnstileToken = '') {
  return apiFetch('/api/auth/send-code', {
    method: 'POST',
    body: {
      email,
      turnstileToken,
    },
  });
}

export function cloudVerifyCode(email, code) {
  return apiFetch('/api/auth/verify-code', {
    method: 'POST',
    body: {
      email,
      code,
    },
  });
}

export function cloudLogout() {
  return apiFetch('/api/auth/logout', {
    method: 'POST',
  });
}

export function cloudListVaults() {
  return apiFetch('/api/vaults');
}

export function cloudCreateVault({ name = 'My YANTA Vault' } = {}) {
  return apiFetch('/api/vaults', {
    method: 'POST',
    body: {
      name,
    },
  });
}

export function cloudUsage() {
  return apiFetch('/api/usage');
}