import {
  YANTA_CLOUD_BASE_URL,
} from '../cloud/cloud-api.js';

function apiUrl(path) {
  const base = String(YANTA_CLOUD_BASE_URL || '/cloud-api').replace(/\/+$/, '');
  const clean = String(path || '').replace(/^\/+/, '');
  return `${base}/${clean}`;
}

async function parseJsonError(res, fallback) {
  try {
    const json = await res.json();
    return json?.message || json?.error?.message || json?.error || fallback;
  } catch {
    try {
      return await res.text();
    } catch {
      return fallback;
    }
  }
}

async function fetchJson(path, {
  method = 'GET',
  body = null,
  auth = true,
} = {}) {
  const res = await fetch(apiUrl(path), {
    method,
    credentials: auth ? 'include' : 'omit',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : null,
  });

  if (!res.ok) {
    const err = new Error(await parseJsonError(res, `HTTP ${res.status}`));
    err.status = res.status;
    throw err;
  }

  return res.json();
}

export function createPresentationSession({
  vaultId,
  sourceType = 'drawing',
  sourceId,
  ttlMs = 2 * 60 * 60 * 1000,
}) {
  return fetchJson('/api/presentation-sessions', {
    method: 'POST',
    body: {
      vaultId,
      sourceType,
      sourceId,
      ttlMs,
    },
  });
}

export function publishPresentationSessionPayload(sessionId, {
  encryptedPayload,
  etag,
}) {
  return fetchJson(`/api/presentation-sessions/${encodeURIComponent(sessionId)}/payload`, {
    method: 'PUT',
    body: {
      encryptedPayload,
      etag,
    },
  });
}

export function getPresentationSession(sessionId) {
  return fetchJson(`/api/presentation-sessions/${encodeURIComponent(sessionId)}`, {
    auth: false,
  });
}

export function deletePresentationSession(sessionId) {
  return fetchJson(`/api/presentation-sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}