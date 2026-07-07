// ============================================================
// YANTA Chat — Matrix authenticated media helpers
//
// Matrix >= 1.11 requires authenticated media endpoints.
// Therefore <img src="mxc://..."> or public thumbnail URLs are not enough.
// We fetch with Authorization and expose short-lived object URLs.
//
// E2EE attachments:
// Matrix encrypted media stores the MXC in content.file.url plus crypto
// metadata. In that case we must download the encrypted bytes and decrypt
// them client-side before creating the object URL.
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
  encryptedFile = null,
} = {}) {
  const fileKey = encryptedFile
    ? [
        encryptedFile.v || '',
        encryptedFile.iv || '',
        encryptedFile.hashes?.sha256 || '',
        encryptedFile.key?.kid || '',
        encryptedFile.key?.k || '',
      ].join(':')
    : '';

  return [
    String(mxcUrl || ''),
    thumbnail ? 'thumb' : 'download',
    Number(w || 0),
    Number(h || 0),
    fileKey,
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

function endpointCandidates(baseUrl, {
  serverName,
  mediaId,
  thumbnail = true,
  w = 96,
  h = 96,
  encrypted = false,
} = {}) {
  const encodedServer = encodeURIComponent(serverName);
  const encodedMedia = encodeURIComponent(mediaId);

  const width = Math.max(1, Math.round(Number(w || 96)));
  const height = Math.max(1, Math.round(Number(h || 96)));

  const downloadV1 =
    `${baseUrl}/_matrix/client/v1/media/download/${encodedServer}/${encodedMedia}`;

  const downloadV3 =
    `${baseUrl}/_matrix/media/v3/download/${encodedServer}/${encodedMedia}`;

  /*
    Important:
    Do NOT add allow_remote=true to /_matrix/client/v1/media/thumbnail.
    Some current homeservers reject it with HTTP 400. The v1 authenticated
    endpoint resolves remote media according to server policy without this
    legacy parameter.
  */
  const thumbnailV1 =
    `${baseUrl}/_matrix/client/v1/media/thumbnail/${encodedServer}/${encodedMedia}?width=${width}&height=${height}&method=scale`;

  const thumbnailV3 =
    `${baseUrl}/_matrix/media/v3/thumbnail/${encodedServer}/${encodedMedia}?width=${width}&height=${height}&method=scale`;

  /*
    Encrypted attachments must be fetched as raw encrypted bytes and decrypted
    locally. Homeserver thumbnailing encrypted ciphertext is not useful.
  */
  if (encrypted) {
    return [
      downloadV1,
      downloadV3,
    ];
  }

  return thumbnail
    ? [
        thumbnailV1,
        thumbnailV3,
        downloadV1,
        downloadV3,
      ]
    : [
        downloadV1,
        downloadV3,
      ];
}

async function fetchFirstSuccessfulMedia(client, mxcUrl, options = {}) {
  const baseUrl = matrixBaseUrl(client);
  const accessToken = matrixAccessToken(client);

  if (!baseUrl) {
    throw new Error('Matrix homeserver URL is missing.');
  }

  if (!accessToken) {
    throw new Error('Matrix access token is missing.');
  }

  const parsed = parseMxcUrl(mxcUrl);
  const candidates = endpointCandidates(baseUrl, {
    ...parsed,
    ...options,
  });

  let lastErr = null;

  for (const endpoint of candidates) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        const err = new Error(`Matrix media request failed: ${response.status}`);
        err.status = response.status;
        err.endpoint = endpoint;
        lastErr = err;

        /*
          Warn for diagnostics, but do not toast here because fallback endpoints
          can still succeed. Final failure below shows the user-facing error.
        */
        console.warn('[YANTA Chat] Media endpoint failed, trying fallback', err);
        continue;
      }

      return response;
    } catch (err) {
      err.endpoint = endpoint;
      lastErr = err;
      console.warn('[YANTA Chat] Media endpoint failed, trying fallback', err);
    }
  }

  throw lastErr || new Error('Matrix media request failed.');
}

async function decryptMatrixAttachment(arrayBuffer, encryptedFile) {
  if (!encryptedFile) return arrayBuffer;

  const mod = await import('matrix-encrypt-attachment');

  const decryptAttachment =
    mod.decryptAttachment ||
    mod.default?.decryptAttachment ||
    mod.default;

  if (typeof decryptAttachment !== 'function') {
    throw new Error('Matrix attachment decryption is not available.');
  }

  const decrypted = await decryptAttachment(arrayBuffer, encryptedFile);

  if (decrypted instanceof ArrayBuffer) {
    return decrypted;
  }

  if (decrypted instanceof Uint8Array) {
    return decrypted.buffer.slice(
      decrypted.byteOffset,
      decrypted.byteOffset + decrypted.byteLength
    );
  }

  if (decrypted instanceof Blob) {
    return decrypted.arrayBuffer();
  }

  if (decrypted?.buffer instanceof ArrayBuffer) {
    return decrypted.buffer;
  }

  throw new Error('Matrix attachment decryption returned unsupported data.');
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
  encryptedFile = null,
  mimeType = '',
} = {}) {
  const key = cacheKeyFor(mxcUrl, {
    thumbnail,
    w,
    h,
    encryptedFile,
  });

  const cached = objectUrlCache.get(key);

  if (cached?.url) {
    touch(key, cached);
    return cached.url;
  }

  try {
    const encrypted = !!encryptedFile;
    const response = await fetchFirstSuccessfulMedia(client, mxcUrl, {
      thumbnail,
      w,
      h,
      encrypted,
    });

    let blob;

    if (encrypted) {
      const encryptedBytes = await response.arrayBuffer();
      const plainBytes = await decryptMatrixAttachment(encryptedBytes, encryptedFile);

      blob = new Blob([plainBytes], {
        type:
          mimeType ||
          encryptedFile?.mimetype ||
          'application/octet-stream',
      });
    } else {
      blob = await response.blob();
    }

    const url = URL.createObjectURL(blob);

    touch(key, {
      url,
    });

    evictIfNeeded();

    return url;
  } catch (err) {
    console.warn('[YANTA Chat] Media fetch failed', err);
    toast('Could not load chat media.', 'error');
    throw err;
  }
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