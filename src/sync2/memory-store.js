// ============================================================
// YANTA Sync2 — MemoryObjectStore
//
// Debug/test implementation of RemoteObjectStore.
// Simulates a cloud bucket in memory.
// ============================================================

import {
  RemoteObjectStore,
  assertSafeRemotePath,
  normalizeRemotePath,
  bytesFromData,
  remoteEntrySort,
} from './object-store.js';

function makeEtag(bytes, updated) {
  // Debug-only etag. Not cryptographic.
  return `${bytes.length}-${updated}`;
}

export class MemoryObjectStore extends RemoteObjectStore {
  constructor(initial = null) {
    super();

    // path -> { data: Uint8Array, updated:number, etag:string }
    this.objects = new Map();

    if (initial instanceof MemoryObjectStore) {
      for (const [path, rec] of initial.objects) {
        this.objects.set(path, {
          data: new Uint8Array(rec.data),
          updated: rec.updated,
          etag: rec.etag,
        });
      }
    } else if (initial && typeof initial === 'object') {
      for (const [path, data] of Object.entries(initial)) {
        const bytes = data instanceof Uint8Array
          ? data
          : new TextEncoder().encode(String(data));

        const updated = Date.now();

        this.objects.set(normalizeRemotePath(path), {
          data: new Uint8Array(bytes),
          updated,
          etag: makeEtag(bytes, updated),
        });
      }
    }
  }

  async init() {}

  async list(prefix = '') {
    const cleanPrefix = normalizeRemotePath(prefix);
    const out = [];

    for (const [path, rec] of this.objects) {
      if (cleanPrefix && !path.startsWith(cleanPrefix)) continue;

      out.push({
        path,
        size: rec.data.byteLength,
        updated: rec.updated,
        etag: rec.etag,
      });
    }

    return out.sort(remoteEntrySort);
  }

  async get(path) {
    const p = assertSafeRemotePath(path);
    const rec = this.objects.get(p);

    if (!rec) {
      const err = new Error(`Remote object not found: ${p}`);
      err.code = 'ENOENT';
      throw err;
    }

    return new Uint8Array(rec.data);
  }

  async put(path, data, options = {}) {
    const p = assertSafeRemotePath(path);
    const bytes = await bytesFromData(data);

    if (options.ifAbsent && this.objects.has(p)) {
      const err = new Error(`Remote object already exists: ${p}`);
      err.code = 'EEXIST';
      throw err;
    }

    const updated = Date.now();

    this.objects.set(p, {
      data: new Uint8Array(bytes),
      updated,
      etag: makeEtag(bytes, updated),
    });
  }

  async delete(path) {
    const p = assertSafeRemotePath(path);
    this.objects.delete(p);
  }

  async stat(path) {
    const p = assertSafeRemotePath(path);
    const rec = this.objects.get(p);

    if (!rec) return null;

    return {
      path: p,
      size: rec.data.byteLength,
      updated: rec.updated,
      etag: rec.etag,
    };
  }

  dumpText() {
    const out = [];

    for (const [path, rec] of [...this.objects].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(`${path} (${rec.data.byteLength} bytes)`);
    }

    return out.join('\n');
  }

  clone() {
    return new MemoryObjectStore(this);
  }
}