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

/*
  Two-factor sign-in: destructive account actions (removing a device,
  deleting the account) answer 403 mfa_required when 2FA is on. The app
  registers a prompter (an input for the authenticator code); the request
  is then repeated with the code — so every caller gets it for free.
*/
let mfaPrompter = null;

export function setMfaPrompter(fn) {
  mfaPrompter = typeof fn === 'function' ? fn : null;
}

export async function apiFetch(path, {
  method = 'GET',
  body = null,
  headers = {},
  mfaAttempt = 0,
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

  if (
    res.status === 403 &&
    (json?.code === 'mfa_required' || json?.code === 'mfa_invalid') &&
    mfaPrompter &&
    mfaAttempt < 3
  ) {
    const code = await mfaPrompter({ invalid: json.code === 'mfa_invalid' });
    if (code) {
      return apiFetch(path, {
        method,
        body,
        headers: { ...headers, 'x-yanta-mfa': String(code).trim() },
        mfaAttempt: mfaAttempt + 1,
      });
    }
  }

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

/** Second step of a sign-in with 2FA. */
export function cloudVerifyMfa(mfaToken, code) {
  return apiFetch('/api/auth/verify-mfa', {
    method: 'POST',
    body: { mfaToken, code },
  });
}

export function cloudMfaStatus() {
  return apiFetch('/api/mfa');
}

export function cloudMfaSetup() {
  return apiFetch('/api/mfa/setup', { method: 'POST' });
}

export function cloudMfaEnable(code) {
  return apiFetch('/api/mfa/enable', { method: 'POST', body: { code } });
}

export function cloudMfaDisable(code) {
  return apiFetch('/api/mfa/disable', { method: 'POST', body: { code } });
}

export function cloudMfaRenewBackupCodes(code) {
  return apiFetch('/api/mfa/backup-codes', { method: 'POST', body: { code } });
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

/*
  Fetches an Excalidraw ".excalidrawlib" file through the YANTA Cloud proxy.
  CSP intentionally blocks libraries.excalidraw.com in connect-src, and the
  proxy also keeps the user's IP/referrer off the Excalidraw CDN. Returns the
  raw library JSON ({ type, version, libraryItems } | { library }).
*/
export function cloudFetchExcalidrawLibrary(libraryUrl) {
  return apiFetch(
    `/api/excalidraw/library?url=${encodeURIComponent(String(libraryUrl || ''))}`
  );
}

export function cloudStorageBreakdown(vaultId, {
  deviceId = '',
} = {}) {
  const q = vaultId
    ? `?vaultId=${encodeURIComponent(vaultId)}`
    : '';

  return apiFetch(`/api/storage/breakdown${q}`, {
    headers: cloudDeviceHeaders(deviceId),
  });
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