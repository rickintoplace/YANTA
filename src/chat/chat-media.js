// ============================================================
// YANTA Chat — Matrix authenticated media helpers
//
// Matrix >= 1.11 requires authenticated media endpoints.
// Therefore <img src="mxc://..."> or public thumbnail URLs are not enough.
// We fetch with Authorization and expose short-lived object URLs.
// ============================================================

import {
  toast,
} from '../core.js';

const MAX_CHAT_MEDIA_OBJECT_URLS = 160;

const objectUrlCache = new Map();

function cacheKeyFor(mxcUrl, {
  thumbnail = true,
  w = 96,
  h = 96,
} = {}) {
  return [
    String(mxcUrl || ''),
    thumbnail ? 'thumb' : 'download',
    Number(w || 0),
    Number(h || 0),
  ].join('|');
}

function touch(key, value) {
  objectUrlCache.delete(key);
  objectUrlCache.set(key, {
    ...value,
    touched: Date.now(),
  });
}

function evictIfNeeded() {
  while (objectUrlCache.size > MAX_CHAT_MEDIA_OBJECT_URLS) {
    const [oldestKey, oldest] = objectUrlCache.entries().next().value || [];

    if (!oldestKey) return;

    objectUrlCache.delete(oldestKey);

    try {
      URL.revokeObjectURL(oldest.url);
    } catch (err) {
      console.warn('[YANTA Chat] Could not revoke media object URL', err);
    }
  }
}

function parseMxcUrl(mxcUrl) {
  const raw = String(mxcUrl || '').trim();

  const match = /^mxc:\/\/([^/]+)\/(.+)$/.exec(raw);

  if (!match) {
    throw new Error('Invalid Matrix media URL.');
  }

  return {
    serverName: match[1],
    mediaId: match[2],
  };
}

function matrixBaseUrl(client) {
  const base =
    client?.getHomeserverUrl?.() ||
    client?.baseUrl ||
    client?.opts?.baseUrl ||
    '';

  return String(base || '').replace(/\/+$/, '');
}

function matrixAccessToken(client) {
  return (
    client?.getAccessToken?.() ||
    client?.accessToken ||
    client?.credentials?.accessToken ||
    ''
  );
}

/**
 * Fetch an MXC media URL through Matrix authenticated media APIs.
 *
 * @param {object} client MatrixClient.
 * @param {string} mxcUrl Matrix mxc:// URL.
 * @param {object} options Media options.
 * @returns {Promise<string>} Browser object URL.
 */
export async function mxcToBlobUrl(client, mxcUrl, {
  thumbnail = true,
  w = 96,
  h = 96,
} = {}) {
  const key = cacheKeyFor(mxcUrl, {
    thumbnail,
    w,
    h,
  });

  const cached = objectUrlCache.get(key);

  if (cached?.url) {
    touch(key, cached);
    return cached.url;
  }

  const baseUrl = matrixBaseUrl(client);
  const accessToken = matrixAccessToken(client);

  if (!baseUrl) {
    throw new Error('Matrix homeserver URL is missing.');
  }

  if (!accessToken) {
    throw new Error('Matrix access token is missing.');
  }

  const {
    serverName,
    mediaId,
  } = parseMxcUrl(mxcUrl);

  const encodedServer = encodeURIComponent(serverName);
  const encodedMedia = encodeURIComponent(mediaId);

  const endpoint = thumbnail
    ? `${baseUrl}/_matrix/client/v1/media/thumbnail/${encodedServer}/${encodedMedia}?width=${Math.max(1, Number(w || 96))}&height=${Math.max(1, Number(h || 96))}&method=scale&allow_remote=true`
    : `${baseUrl}/_matrix/client/v1/media/download/${encodedServer}/${encodedMedia}`;

  let response;

  try {
    response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    });
  } catch (err) {
    console.warn('[YANTA Chat] Media fetch failed', err);
    toast('Could not load chat media.', 'error');
    throw err;
  }

  if (!response.ok) {
    const err = new Error(`Matrix media request failed: ${response.status}`);
    console.warn('[YANTA Chat] Media fetch failed', err);
    toast('Could not load chat media.', 'error');
    throw err;
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  touch(key, {
    url,
  });

  evictIfNeeded();

  return url;
}

/**
 * Revoke all chat media object URLs.
 */
export function revokeAllChatMediaObjectUrls() {
  for (const entry of objectUrlCache.values()) {
    try {
      URL.revokeObjectURL(entry.url);
    } catch (err) {
      console.warn('[YANTA Chat] Could not revoke media object URL', err);
    }
  }

  objectUrlCache.clear();
}