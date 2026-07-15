// ============================================================
// YANTA Shared Spaces — SpaceObjectStore
//
// RemoteObjectStore implementation for a shared space container on
// the YANTA Cloud worker (/api/spaces/:id/storage/*).
//
// Auth is whichever the caller has:
// - session cookie (owner or invited member) — sent automatically
// - read/write bearer tokens (link shares) — sent as headers
//
// The worker only ever sees encrypted blobs; keys stay client-side.
// ============================================================

import {
  RemoteObjectStore,
  assertSafeRemotePath,
  normalizeRemotePath,
  bytesFromData,
  remoteEntrySort,
} from '../sync2/object-store.js';

import { YANTA_CLOUD_BASE_URL } from '../cloud/cloud-api.js';
import { fetchWithRetry, errorFromResponse } from '../cloud/cloud-fetch.js';

export class SpaceObjectStore extends RemoteObjectStore {
  constructor({
    spaceId,
    readToken = '',
    writeToken = '',
    baseUrl = YANTA_CLOUD_BASE_URL,
  } = {}) {
    super();

    if (!spaceId) {
      throw new Error('SpaceObjectStore requires a spaceId');
    }

    this.spaceId = String(spaceId);
    this.readToken = String(readToken || '');
    this.writeToken = String(writeToken || '');
    this.baseUrl = String(baseUrl || '/cloud-api').replace(/\/+$/, '');
  }

  headers(extra = {}) {
    const h = { ...extra };
    if (this.readToken) h['x-yanta-space-read-token'] = this.readToken;
    if (this.writeToken) h['x-yanta-space-write-token'] = this.writeToken;
    return h;
  }

  url(resource, params = {}) {
    const url = new URL(
      `${this.baseUrl}/api/spaces/${encodeURIComponent(this.spaceId)}/storage/${resource}`,
      location.origin
    );

    for (const [key, value] of Object.entries(params || {})) {
      if (value == null || value === '') continue;
      url.searchParams.set(key, String(value));
    }

    return url.href;
  }

  async index() {
    const res = await fetchWithRetry(
      this.url('index'),
      {
        method: 'GET',
        credentials: 'include',
        headers: this.headers(),
      },
      { label: 'Space index' }
    );

    if (!res.ok) {
      throw await errorFromResponse(res, 'Space index failed');
    }

    const json = await res.json();
    return (json.entries || []).sort(remoteEntrySort);
  }

  async list(prefix = '') {
    const res = await fetchWithRetry(
      this.url('list', { prefix: normalizeRemotePath(prefix) }),
      {
        method: 'GET',
        credentials: 'include',
        headers: this.headers(),
      },
      { label: 'Space list' }
    );

    if (!res.ok) {
      throw await errorFromResponse(res, 'Space list failed');
    }

    const json = await res.json();
    return (json.entries || []).sort(remoteEntrySort);
  }

  async get(path) {
    const p = assertSafeRemotePath(path);

    const res = await fetchWithRetry(
      this.url('object', { path: p }),
      {
        method: 'GET',
        credentials: 'include',
        headers: this.headers(),
      },
      { label: 'Space get' }
    );

    if (res.status === 404) {
      const err = new Error(`Space object not found: ${p}`);
      err.code = 'ENOENT';
      throw err;
    }

    if (!res.ok) {
      throw await errorFromResponse(res, 'Space get failed');
    }

    return new Uint8Array(await res.arrayBuffer());
  }

  async put(path, data, options = {}) {
    const p = assertSafeRemotePath(path);
    const bytes = await bytesFromData(data);

    const res = await fetchWithRetry(
      this.url('object', {
        path: p,
        ifAbsent: options.ifAbsent ? '1' : '',
      }),
      {
        method: 'PUT',
        credentials: 'include',
        headers: this.headers({ 'content-type': 'application/octet-stream' }),
        body: bytes,
      },
      { label: 'Space put' }
    );

    if (res.status === 409) {
      const err = await errorFromResponse(res, 'Space put rejected');

      // The server demands a head + prune before accepting more journal
      // packs; the engine handles this by compacting and retrying.
      err.code = err.serverCode === 'compaction_required'
        ? 'ECOMPACTION_REQUIRED'
        : 'EEXIST';

      throw err;
    }

    if (!res.ok) {
      throw await errorFromResponse(res, 'Space put failed');
    }

    try {
      const json = await res.json();
      return json.entry || null;
    } catch {
      return null;
    }
  }

  async delete(path) {
    const p = assertSafeRemotePath(path);

    const res = await fetchWithRetry(
      this.url('object', { path: p }),
      {
        method: 'DELETE',
        credentials: 'include',
        headers: this.headers(),
      },
      { label: 'Space delete' }
    );

    if (!res.ok) {
      throw await errorFromResponse(res, 'Space delete failed');
    }
  }

  async stat(path) {
    const p = assertSafeRemotePath(path);

    const res = await fetchWithRetry(
      this.url('stat', { path: p }),
      {
        method: 'GET',
        credentials: 'include',
        headers: this.headers(),
      },
      { label: 'Space stat' }
    );

    if (!res.ok) {
      throw await errorFromResponse(res, 'Space stat failed');
    }

    const json = await res.json();
    return json.entry || null;
  }
}
