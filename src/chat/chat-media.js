// ============================================================
// YANTA Chat — Matrix authenticated media helpers + sending
//
// Matrix >= 1.11 requires authenticated media endpoints.
// E2EE attachments are encrypted/decrypted client-side with
// matrix-encrypt-attachment.
// ============================================================

import {
  el,
  escapeHtml,
  fmtBytes,
  lucide,
  toast,
} from '../core.js';

import {
  compressImageFile,
} from '../media/image-compression.js';

const MAX_CHAT_MEDIA_OBJECT_URLS = 160;

const objectUrlCache = new Map();
const blobCache = new Map();

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

function touch(cache, key, value) {
  cache.delete(key);
  cache.set(key, {
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

  while (blobCache.size > MAX_CHAT_MEDIA_OBJECT_URLS) {
    const [oldestKey] = blobCache.entries().next().value || [];
    if (!oldestKey) return;
    blobCache.delete(oldestKey);
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

  const thumbnailV1 =
    `${baseUrl}/_matrix/client/v1/media/thumbnail/${encodedServer}/${encodedMedia}?width=${width}&height=${height}&method=scale`;

  const thumbnailV3 =
    `${baseUrl}/_matrix/media/v3/thumbnail/${encodedServer}/${encodedMedia}?width=${width}&height=${height}&method=scale`;

  /*
    Encrypted media cannot be server-thumbnailed because the homeserver only
    sees ciphertext. We fetch original encrypted bytes and decrypt locally.
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

async function encryptMatrixAttachment(blob) {
  const mod = await import('matrix-encrypt-attachment');

  const encryptAttachment =
    mod.encryptAttachment ||
    mod.default?.encryptAttachment ||
    mod.default;

  if (typeof encryptAttachment !== 'function') {
    throw new Error('Matrix attachment encryption is not available.');
  }

  const plain = await blob.arrayBuffer();
  const encrypted = await encryptAttachment(plain);

  const data =
    encrypted?.data ||
    encrypted?.ciphertext ||
    encrypted?.encrypted ||
    null;

  const info =
    encrypted?.info ||
    encrypted?.file ||
    encrypted?.encryptedFile ||
    null;

  if (!data || !info) {
    throw new Error('Matrix attachment encryption returned unsupported data.');
  }

  const encryptedBlob = new Blob([data], {
    type: 'application/octet-stream',
  });

  return {
    blob: encryptedBlob,
    file: info,
  };
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

function mxcFromUploadResult(result) {
  if (typeof result === 'string') return result;

  return (
    result?.content_uri ||
    result?.contentUri ||
    result?.url ||
    ''
  );
}

function roomIsEncrypted(client, roomId) {
  try {
    if (typeof client?.isRoomEncrypted === 'function') {
      return !!client.isRoomEncrypted(roomId);
    }

    const room = client?.getRoom?.(roomId);
    const state = room?.currentState || room?.getLiveTimeline?.()?.getState?.('f');

    return !!state?.getStateEvents?.('m.room.encryption', '');
  } catch (err) {
    console.warn('[YANTA Chat] Could not determine room encryption state', err);
    toast('Could not check chat encryption.', 'error');
    return false;
  }
}

async function uploadMatrixContent(client, blob, {
  name = 'file',
  type = '',
  onProgress = null,
  abortController = null,
} = {}) {
  if (!client?.uploadContent) {
    throw new Error('Matrix uploadContent is not available.');
  }

  const opts = {
    name,
    type: type || blob.type || 'application/octet-stream',
    includeFilename: true,
  };

  if (typeof onProgress === 'function') {
    opts.progressHandler = (ev) => {
      const loaded = Number(ev?.loaded || 0);
      const total = Number(ev?.total || blob.size || 0);
      onProgress({
        loaded,
        total,
        percent: total ? loaded / total : 0,
      });
    };
  }

  // Newer matrix-js-sdk builds accept AbortController in UploadOpts.
  if (abortController) {
    opts.abortController = abortController;
    opts.signal = abortController.signal;
  }

  const result = await client.uploadContent(blob, opts);
  const mxc = mxcFromUploadResult(result);

  if (!mxc) {
    throw new Error('Homeserver did not return an MXC URI.');
  }

  return mxc;
}

async function sendRoomMessage(client, roomId, content) {
  if (typeof client.sendMessage === 'function') {
    return client.sendMessage(roomId, content);
  }

  if (typeof client.sendEvent === 'function') {
    return client.sendEvent(roomId, 'm.room.message', content);
  }

  throw new Error('Matrix sendMessage is not available.');
}

/**
 * Fetch Matrix media and return a Blob.
 */
export async function mxcToBlob(client, mxcUrl, {
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

  const cached = blobCache.get(key);

  if (cached?.blob) {
    touch(blobCache, key, cached);
    return cached.blob;
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

    touch(blobCache, key, {
      blob,
    });

    evictIfNeeded();

    return blob;
  } catch (err) {
    console.warn('[YANTA Chat] Media fetch failed', err);
    toast('Could not load chat media.', 'error');
    throw err;
  }
}

/**
 * Fetch an MXC media URL through Matrix authenticated media APIs.
 *
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
    touch(objectUrlCache, key, cached);
    return cached.url;
  }

  const blob = await mxcToBlob(client, mxcUrl, {
    thumbnail,
    w,
    h,
    encryptedFile,
    mimeType,
  });

  const url = URL.createObjectURL(blob);

  touch(objectUrlCache, key, {
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
  blobCache.clear();
}

function fileBaseName(name = '') {
  return String(name || 'file')
    .replace(/\.[^.]+$/, '')
    .trim() || 'file';
}

function fileExtForMime(mime = '') {
  if (mime === 'image/webp') return '.webp';
  if (mime === 'audio/ogg') return '.ogg';
  if (mime === 'audio/webm') return '.webm';
  if (mime === 'audio/mp4') return '.m4a';
  return '';
}

function imageObjectUrl(blob) {
  const url = URL.createObjectURL(blob);

  return {
    url,
    revoke: () => {
      try {
        URL.revokeObjectURL(url);
      } catch (err) {
        console.warn('[YANTA Chat] Could not revoke preview URL', err);
      }
    },
  };
}

function openImagePreviewSheet({ blob, fileName }) {
  return new Promise((resolve) => {
    const preview = imageObjectUrl(blob);

    const overlay = el('div', {
      class: 'yanta-chat-preview-sheet',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Send photo',
    });

    overlay.innerHTML = `
      <div class="yanta-chat-preview-card">
        <header>
          <strong>Send photo</strong>
          <button class="icon-btn" data-close title="Close" aria-label="Close">
            ${lucide('x', 18)}
          </button>
        </header>

        <div class="yanta-chat-preview-image-wrap">
          <img src="${preview.url}" alt="${escapeHtml(fileName || 'Photo')}">
        </div>

        <textarea
          rows="2"
          maxlength="4000"
          placeholder="Add a caption…"
          data-caption></textarea>

        <footer>
          <button class="btn" data-cancel>Cancel</button>
          <button class="btn primary" data-send>
            ${lucide('send-horizontal', 14)}
            Send
          </button>
        </footer>
      </div>
    `;

    const close = (value) => {
      preview.revoke();
      overlay.remove();
      resolve(value);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
      if (e.target.closest?.('[data-close], [data-cancel]')) close(null);

      if (e.target.closest?.('[data-send]')) {
        close({
          caption: String(overlay.querySelector('[data-caption]')?.value || '').trim(),
        });
      }
    });

    document.body.append(overlay);

    setTimeout(() => {
      overlay.querySelector('[data-caption]')?.focus();
    }, 0);
  });
}

/**
 * Compresses, previews, uploads and sends an m.image message.
 */
export async function sendImageFileWithPreview(client, roomId, file, {
  onProgress = null,
} = {}) {
  if (!client || !roomId) {
    throw new Error('Chat is not connected.');
  }

  if (!file || !String(file.type || '').startsWith('image/')) {
    toast('Pick an image file.', 'error');
    throw new Error('Not an image file.');
  }

  try {
    const full = await compressImageFile(file, {
      maxWidth: 2048,
      quality: 0.85,
      mime: 'image/webp',
    });

    const thumb = await compressImageFile(file, {
      maxWidth: 320,
      quality: 0.78,
      mime: 'image/webp',
    });

    const preview = await openImagePreviewSheet({
      blob: full.blob,
      fileName: file.name || 'Photo',
    });

    if (!preview) return null;

    const encrypted = roomIsEncrypted(client, roomId);
    const safeName = `${fileBaseName(file.name || 'photo')}.webp`;

    const content = {
      msgtype: 'm.image',
      body: preview.caption || safeName,
      info: {
        w: full.width,
        h: full.height,
        size: full.blob.size,
        mimetype: full.mime || 'image/webp',
        thumbnail_info: {
          w: thumb.width,
          h: thumb.height,
          size: thumb.blob.size,
          mimetype: thumb.mime || 'image/webp',
        },
      },
    };

    if (encrypted) {
      const encryptedFull = await encryptMatrixAttachment(full.blob);
      const encryptedThumb = await encryptMatrixAttachment(thumb.blob);

      encryptedFull.file.url = await uploadMatrixContent(client, encryptedFull.blob, {
        name: safeName,
        type: 'application/octet-stream',
        onProgress,
      });

      encryptedThumb.file.url = await uploadMatrixContent(client, encryptedThumb.blob, {
        name: `thumb-${safeName}`,
        type: 'application/octet-stream',
      });

      content.file = encryptedFull.file;
      content.info.thumbnail_file = encryptedThumb.file;
    } else {
      content.url = await uploadMatrixContent(client, full.blob, {
        name: safeName,
        type: full.mime || 'image/webp',
        onProgress,
      });

      content.info.thumbnail_url = await uploadMatrixContent(client, thumb.blob, {
        name: `thumb-${safeName}`,
        type: thumb.mime || 'image/webp',
      });
    }

    const result = await sendRoomMessage(client, roomId, content);

    toast('Photo sent', 'success');

    return result;
  } catch (err) {
    console.warn('[YANTA Chat] Could not send image', err);
    toast('Could not send photo.', 'error');
    throw err;
  }
}

/**
 * Uploads and sends an m.file message.
 */
export async function sendFileMessage(client, roomId, file, {
  onProgress = null,
  abortController = null,
} = {}) {
  if (!client || !roomId) {
    throw new Error('Chat is not connected.');
  }

  if (!file) {
    toast('Pick a file.', 'error');
    throw new Error('Missing file.');
  }

  try {
    const encrypted = roomIsEncrypted(client, roomId);
    const name = file.name || 'file';
    const mimetype = file.type || 'application/octet-stream';

    const content = {
      msgtype: 'm.file',
      body: name,
      info: {
        size: file.size || 0,
        mimetype,
      },
    };

    if (encrypted) {
      const encryptedFile = await encryptMatrixAttachment(file);

      encryptedFile.file.url = await uploadMatrixContent(client, encryptedFile.blob, {
        name,
        type: 'application/octet-stream',
        onProgress,
        abortController,
      });

      content.file = encryptedFile.file;
    } else {
      content.url = await uploadMatrixContent(client, file, {
        name,
        type: mimetype,
        onProgress,
        abortController,
      });
    }

    const result = await sendRoomMessage(client, roomId, content);

    toast('File sent', 'success');

    return result;
  } catch (err) {
    console.warn('[YANTA Chat] Could not send file', err);
    toast('Could not send file.', 'error');
    throw err;
  }
}

/**
 * Uploads and sends an MSC3245 Matrix voice message.
 */
export async function sendVoiceMessage(client, roomId, {
  blob,
  durationMs,
  waveform = [],
  mimeType = '',
} = {}) {
  if (!client || !roomId) {
    throw new Error('Chat is not connected.');
  }

  if (!blob || !blob.size) {
    toast('Voice message is empty.', 'error');
    throw new Error('Voice message blob is empty.');
  }

  try {
    const mimetype = mimeType || blob.type || 'audio/webm';
    const encrypted = roomIsEncrypted(client, roomId);

    const content = {
      msgtype: 'm.audio',
      body: 'Voice message',
      info: {
        duration: Math.max(0, Math.round(Number(durationMs || 0))),
        mimetype,
        size: blob.size || 0,
      },
      'org.matrix.msc1767.audio': {
        duration: Math.max(0, Math.round(Number(durationMs || 0))),
        waveform: Array.isArray(waveform) ? waveform.slice(0, 100) : [],
      },
      'org.matrix.msc3245.voice': {},
    };

    const name = `voice-message${fileExtForMime(mimetype)}`;

    if (encrypted) {
      const encryptedAudio = await encryptMatrixAttachment(blob);

      encryptedAudio.file.url = await uploadMatrixContent(client, encryptedAudio.blob, {
        name,
        type: 'application/octet-stream',
      });

      content.file = encryptedAudio.file;
    } else {
      content.url = await uploadMatrixContent(client, blob, {
        name,
        type: mimetype,
      });
    }

    const result = await sendRoomMessage(client, roomId, content);

    toast('Voice message sent', 'success');

    return result;
  } catch (err) {
    console.warn('[YANTA Chat] Could not send voice message', err);
    toast('Could not send voice message.', 'error');
    throw err;
  }
}

/**
 * Formats a file attachment subtitle.
 */
export function fileSubtitle(info = {}) {
  const parts = [];

  if (info.mimetype) parts.push(info.mimetype);
  if (info.size != null) parts.push(fmtBytes(info.size || 0));

  return parts.join(' · ');
}