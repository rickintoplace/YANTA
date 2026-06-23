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

export function createPublicShare({
  vaultId,
  sourceType = 'note',
  sourceId,
  expiresAt = null,
  reuseActive = false,
}) {
  return fetchJson('/api/public-shares', {
    method: 'POST',
    body: {
      vaultId,
      sourceType,
      sourceId,
      expiresAt,

      /*
        Zero-knowledge important:
        A reused cloud share would need the exact original private shareKey.
        The server never has that key. Therefore reuse must be explicit.
      */
      reuseActive,
    },
  });
}

export function publishPublicSharePayload(shareId, {
  encryptedPayload,
  etag,
  assetGrants = [],
}) {
  return fetchJson(`/api/public-shares/${encodeURIComponent(shareId)}/payload`, {
    method: 'PUT',
    body: {
      encryptedPayload,
      etag,
      assetGrants,
    },
  });
}

export function deletePublicShare(shareId) {
  return fetchJson(`/api/public-shares/${encodeURIComponent(shareId)}`, {
    method: 'DELETE',
  });
}

export function listOwnPublicShares() {
  return fetchJson('/api/public-shares');
}

export function getPublicShare(shareId) {
  return fetchJson(`/api/public-shares/${encodeURIComponent(shareId)}`, {
    auth: false,
  });
}

export async function getPublicShareAssetBytes(shareId, assetObjectId) {
  const res = await fetch(
    apiUrl(`/api/public-shares/${encodeURIComponent(shareId)}/assets/${encodeURIComponent(assetObjectId)}`),
    {
      method: 'GET',
      credentials: 'omit',
      headers: {
        accept: 'application/octet-stream',
      },
    }
  );

  if (!res.ok) {
    throw new Error(await parseJsonError(res, `Asset fetch failed: HTTP ${res.status}`));
  }

  return new Uint8Array(await res.arrayBuffer());
}