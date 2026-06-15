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
  const base = String(YANTA_CLOUD_BASE_URL || '/cloud-api').replace(/\/+$/, '');
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

function currentYantaCloudDeviceId() {
  try {
    return (
      window.yantaSync2?.deviceId ||
      window.yantaSync2?.engine?.deviceId ||
      ''
    );
  } catch {
    return '';
  }
}

function currentPlatformHint() {
  try {
    return (
      navigator.userAgentData?.platform ||
      navigator.platform ||
      ''
    );
  } catch {
    return '';
  }
}

function cloudDeviceHeaders(deviceId = currentYantaCloudDeviceId()) {
  const headers = {};

  const id = String(deviceId || '').trim();
  const platform = String(currentPlatformHint() || '').trim();

  if (id) {
    headers['x-yanta-device-id'] = id;
  }

  if (platform) {
    headers['x-yanta-platform'] = platform;
  }

  return headers;
}

export function cloudListVaultDevices(vaultId, {
  deviceId = '',
} = {}) {
  return apiFetch(`/api/devices?vaultId=${encodeURIComponent(vaultId)}`, {
    headers: cloudDeviceHeaders(deviceId),
  });
}


export function cloudRemoveVaultDevice(vaultId, deviceId, {
  currentDeviceId = '',
} = {}) {
  return apiFetch(
    `/api/devices?vaultId=${encodeURIComponent(vaultId)}&deviceId=${encodeURIComponent(deviceId)}`,
    {
      method: 'DELETE',
      headers: cloudDeviceHeaders(currentDeviceId),
    }
  );
}