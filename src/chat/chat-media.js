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
  safeFilename,
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

function imageExtForMime(mime = '') {
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/avif') return '.avif';
  if (mime === 'image/svg+xml') return '.svg';
  return '.img';
}

function outputImageName(inputName = 'photo', mime = 'image/webp') {
  const base = fileBaseName(inputName || 'photo');
  return safeFilename(`${base}${imageExtForMime(mime)}`);
}

async function imageDimensionsFromBlob(blob) {
  if (!blob || blob.type === 'image/svg+xml') {
    return {
      width: 0,
      height: 0,
    };
  }

  try {
    const bitmap = await createImageBitmap(blob);

    return {
      width: bitmap.width || 0,
      height: bitmap.height || 0,
    };
  } catch (err) {
    console.warn('[YANTA Chat] Could not read image dimensions', err);
    toast('Could not read image dimensions.', 'error');

    return {
      width: 0,
      height: 0,
    };
  }
}

async function prepareImageVariants(file, {
  optimize = true,
  convertWebp = true,
} = {}) {
  const originalMime = file.type || 'application/octet-stream';

  if (!optimize) {
    const dim = await imageDimensionsFromBlob(file);

    let thumb = null;

    try {
      thumb = await compressImageFile(file, {
        maxWidth: 320,
        quality: 0.78,
        mime: convertWebp ? 'image/webp' : originalMime,
      });
    } catch (err) {
      console.warn('[YANTA Chat] Could not create image thumbnail', err);
      toast('Could not create image thumbnail.', 'error');
    }

    return {
      full: {
        blob: file,
        mime: originalMime,
        width: dim.width,
        height: dim.height,
        size: file.size || 0,
        optimized: false,
      },
      thumb: thumb
        ? {
            blob: thumb.blob,
            mime: thumb.mime || thumb.blob?.type || 'image/webp',
            width: thumb.width || 0,
            height: thumb.height || 0,
            size: thumb.blob?.size || 0,
          }
        : null,
    };
  }

  const targetMime = convertWebp
    ? 'image/webp'
    : originalMime;

  const full = await compressImageFile(file, {
    maxWidth: 2048,
    quality: 0.85,
    mime: targetMime,
  });

  const thumb = await compressImageFile(file, {
    maxWidth: 320,
    quality: 0.78,
    mime: convertWebp ? 'image/webp' : targetMime,
  });

  return {
    full: {
      blob: full.blob,
      mime: full.mime || full.blob?.type || targetMime,
      width: full.width || 0,
      height: full.height || 0,
      size: full.blob?.size || 0,
      originalSize: full.originalSize || file.size || 0,
      optimized: true,
    },
    thumb: {
      blob: thumb.blob,
      mime: thumb.mime || thumb.blob?.type || 'image/webp',
      width: thumb.width || 0,
      height: thumb.height || 0,
      size: thumb.blob?.size || 0,
    },
  };
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

function openImagePreviewSheet(file) {
  return new Promise((resolve) => {
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
          <span class="yanta-chat-spinner"></span>
          <img hidden alt="${escapeHtml(file.name || 'Photo')}">
        </div>

        <div class="yanta-chat-image-options">
          <label>
            <input type="checkbox" data-optimize checked>
            <span>Optimize image</span>
          </label>

          <label>
            <input type="checkbox" data-webp checked>
            <span>Convert to WEBP</span>
          </label>
        </div>

        <div class="yanta-chat-image-output-meta" data-meta>
          Preparing preview…
        </div>

        <textarea
          rows="2"
          maxlength="4000"
          placeholder="Add a caption…"
          data-caption></textarea>

        <footer>
          <button class="btn" data-cancel>Cancel</button>
          <button class="btn primary" data-send disabled>
            ${lucide('send-horizontal', 14)}
            Send
          </button>
        </footer>
      </div>
    `;

    const img = overlay.querySelector('img');
    const spinner = overlay.querySelector('.yanta-chat-spinner');
    const optimizeInput = overlay.querySelector('[data-optimize]');
    const webpInput = overlay.querySelector('[data-webp]');
    const metaEl = overlay.querySelector('[data-meta]');
    const sendBtn = overlay.querySelector('[data-send]');

    let previewUrl = '';
    let variants = null;
    let seq = 0;
    let recompressTimer = 0;

    const cleanupPreviewUrl = () => {
      if (!previewUrl) return;

      try {
        URL.revokeObjectURL(previewUrl);
      } catch (err) {
        console.warn('[YANTA Chat] Could not revoke preview URL', err);
      }

      previewUrl = '';
    };

    const close = (value) => {
      window.clearTimeout(recompressTimer);
      cleanupPreviewUrl();
      overlay.remove();
      resolve(value);
    };

    const renderMeta = () => {
      if (!variants?.full) {
        metaEl.textContent = 'Preparing preview…';
        return;
      }

      const full = variants.full;
      const original = file.size || 0;
      const output = full.blob?.size || full.size || 0;
      const delta = original
        ? Math.round((1 - output / original) * 100)
        : 0;

      const dimensions = full.width && full.height
        ? `${full.width}×${full.height}`
        : 'original dimensions';

      const optimizationText = full.optimized
        ? `${delta >= 0 ? '−' : '+'}${Math.abs(delta)}%`
        : 'original file';

      metaEl.innerHTML = `
        <span>${escapeHtml(dimensions)}</span>
        <span>${escapeHtml(fmtBytes(original))} → <strong>${escapeHtml(fmtBytes(output))}</strong></span>
        <span>${escapeHtml((full.mime || file.type || 'image').replace(/^image\//, '').toUpperCase())}</span>
        <span>${escapeHtml(optimizationText)}</span>
      `;
    };

    const recompute = async () => {
      const ownSeq = ++seq;

      sendBtn.disabled = true;
      spinner.hidden = false;
      img.hidden = true;
      metaEl.textContent = 'Preparing preview…';

      try {
        const next = await prepareImageVariants(file, {
          optimize: !!optimizeInput.checked,
          convertWebp: !!webpInput.checked,
        });

        if (ownSeq !== seq) return;

        variants = next;

        cleanupPreviewUrl();

        previewUrl = URL.createObjectURL(variants.full.blob);
        img.src = previewUrl;
        img.hidden = false;
        spinner.hidden = true;

        renderMeta();

        sendBtn.disabled = false;
      } catch (err) {
        console.warn('[YANTA Chat] Could not prepare image preview', err);
        toast('Could not prepare image preview.', 'error');

        if (ownSeq !== seq) return;

        variants = null;
        sendBtn.disabled = true;
        spinner.hidden = true;
        img.hidden = true;
        metaEl.textContent = 'Could not prepare image.';
      }
    };

    const scheduleRecompute = () => {
      window.clearTimeout(recompressTimer);

      recompressTimer = window.setTimeout(() => {
        recompute();
      }, 80);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
      if (e.target.closest?.('[data-close], [data-cancel]')) close(null);

      if (e.target.closest?.('[data-send]')) {
        if (!variants?.full) {
          toast('Image preview is not ready yet.', 'error');
          return;
        }

        close({
          caption: String(overlay.querySelector('[data-caption]')?.value || '').trim(),
          variants,
        });
      }
    });

    optimizeInput.addEventListener('change', scheduleRecompute);
    webpInput.addEventListener('change', scheduleRecompute);

    document.body.append(overlay);

    recompute();

    setTimeout(() => {
      overlay.querySelector('[data-caption]')?.focus();
    }, 0);
  });
}

/**
 * Previews, optionally optimizes/converts, uploads and sends an m.image message.
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
    const preview = await openImagePreviewSheet(file);

    if (!preview) return null;

    const { variants } = preview;
    const full = variants.full;
    const thumb = variants.thumb;

    if (!full?.blob) {
      throw new Error('Prepared image is missing.');
    }

    const encrypted = roomIsEncrypted(client, roomId);
    const safeName = outputImageName(file.name || 'photo', full.mime || file.type || 'image/webp');

    /*
      Matrix m.image has no separate caption field in classic events. For
      interoperability we use body as caption when present, otherwise a file
      name. The renderer suppresses filename-like bodies under the image.
    */
    const content = {
      msgtype: 'm.image',
      body: preview.caption || safeName,
      info: {
        w: full.width || 0,
        h: full.height || 0,
        size: full.blob.size || 0,
        mimetype: full.mime || full.blob.type || file.type || 'application/octet-stream',
      },
    };

    if (thumb?.blob) {
      content.info.thumbnail_info = {
        w: thumb.width || 0,
        h: thumb.height || 0,
        size: thumb.blob.size || 0,
        mimetype: thumb.mime || thumb.blob.type || 'image/webp',
      };
    }

    if (encrypted) {
      const encryptedFull = await encryptMatrixAttachment(full.blob);

      encryptedFull.file.url = await uploadMatrixContent(client, encryptedFull.blob, {
        name: safeName,
        type: 'application/octet-stream',
        onProgress,
      });

      content.file = encryptedFull.file;

      if (thumb?.blob) {
        const encryptedThumb = await encryptMatrixAttachment(thumb.blob);

        encryptedThumb.file.url = await uploadMatrixContent(client, encryptedThumb.blob, {
          name: `thumb-${safeName}`,
          type: 'application/octet-stream',
        });

        content.info.thumbnail_file = encryptedThumb.file;
      }
    } else {
      content.url = await uploadMatrixContent(client, full.blob, {
        name: safeName,
        type: full.mime || full.blob.type || file.type || 'application/octet-stream',
        onProgress,
      });

      if (thumb?.blob) {
        content.info.thumbnail_url = await uploadMatrixContent(client, thumb.blob, {
          name: `thumb-${safeName}`,
          type: thumb.mime || thumb.blob.type || 'image/webp',
        });
      }
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