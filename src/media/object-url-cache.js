import { state } from '../core.js';

const MAX_IMAGE_OBJECT_URLS = 128;
const lru = new Map();

function touch(id, url) {
  lru.delete(id);
  lru.set(id, url);
}

function evictIfNeeded() {
  while (lru.size > MAX_IMAGE_OBJECT_URLS) {
    const [oldestId, oldestUrl] = lru.entries().next().value || [];

    if (!oldestId) return;

    lru.delete(oldestId);

    if (state.imageBlobs.get(oldestId) === oldestUrl) {
      state.imageBlobs.delete(oldestId);
    }

    try {
      URL.revokeObjectURL(oldestUrl);
    } catch {}
  }
}

export function getImageObjectUrl(id) {
  const key = String(id || '');
  const url = state.imageBlobs.get(key) || '';

  if (url) {
    touch(key, url);
  }

  return url;
}

export function putImageObjectUrl(id, blob) {
  const key = String(id || '');
  if (!key || !blob) return '';

  const previous = state.imageBlobs.get(key);

  if (previous) {
    try {
      URL.revokeObjectURL(previous);
    } catch {}
  }

  const url = URL.createObjectURL(blob);

  state.imageBlobs.set(key, url);
  touch(key, url);
  evictIfNeeded();

  return url;
}

export function revokeImageObjectUrl(id) {
  const key = String(id || '');
  const url = state.imageBlobs.get(key);

  if (url) {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  }

  state.imageBlobs.delete(key);
  lru.delete(key);
}

export function revokeAllImageObjectUrls() {
  for (const url of state.imageBlobs.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  }

  state.imageBlobs.clear();
  lru.clear();
}