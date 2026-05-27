// ============================================================
// YANTA Sync2 — IndexedDBObjectStore
//
// Persistent fake-remote store backed by its own IndexedDB database.
// This simulates a cloud object bucket in the browser without any provider.
//
// Good for:
// - app-level Sync2 integration
// - reload-safe fake remote
// - future capsule/export tests
//
// It deliberately uses a separate DB so core.js DB migrations are not needed.
// ============================================================

import {
  RemoteObjectStore,
  assertSafeRemotePath,
  normalizeRemotePath,
  bytesFromData,
  remoteEntrySort,
} from './object-store.js';

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

function makeEtag(bytes, updated) {
  return `${bytes.byteLength}-${updated}`;
}

export class IndexedDBObjectStore extends RemoteObjectStore {
  constructor({
    dbName = 'yanta-sync2-remote-debug',
    dbVersion = 1,
    storeName = 'objects',
  } = {}) {
    super();

    this.dbName = dbName;
    this.dbVersion = dbVersion;
    this.storeName = storeName;
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);

      req.onupgradeneeded = () => {
        const db = req.result;

        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'path' });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return this.db;
  }

  objectStore(mode = 'readonly') {
    if (!this.db) {
      throw new Error('IndexedDBObjectStore not initialized');
    }

    return this.db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  async list(prefix = '') {
    await this.init();

    const cleanPrefix = normalizeRemotePath(prefix);
    const store = this.objectStore('readonly');

    const all = await reqToPromise(store.getAll());

    return all
      .filter((rec) => !cleanPrefix || rec.path.startsWith(cleanPrefix))
      .map((rec) => ({
        path: rec.path,
        size: rec.size || rec.data?.byteLength || 0,
        updated: rec.updated || 0,
        etag: rec.etag,
      }))
      .sort(remoteEntrySort);
  }

  async get(path) {
    await this.init();

    const p = assertSafeRemotePath(path);
    const rec = await reqToPromise(this.objectStore('readonly').get(p));

    if (!rec) {
      const err = new Error(`Remote object not found: ${p}`);
      err.code = 'ENOENT';
      throw err;
    }

    return new Uint8Array(rec.data);
  }

  async put(path, data, options = {}) {
    await this.init();

    const p = assertSafeRemotePath(path);
    const bytes = await bytesFromData(data);

    const tx = this.db.transaction(this.storeName, 'readwrite');
    const store = tx.objectStore(this.storeName);

    if (options.ifAbsent) {
      const existing = await reqToPromise(store.get(p));

      if (existing) {
        tx.abort();

        const err = new Error(`Remote object already exists: ${p}`);
        err.code = 'EEXIST';
        throw err;
      }
    }

    const updated = Date.now();

    store.put({
      path: p,
      data: new Uint8Array(bytes),
      size: bytes.byteLength,
      updated,
      etag: makeEtag(bytes, updated),
    });

    await txDone(tx);
  }

  async delete(path) {
    await this.init();

    const p = assertSafeRemotePath(path);
    const tx = this.db.transaction(this.storeName, 'readwrite');

    tx.objectStore(this.storeName).delete(p);

    await txDone(tx);
  }

  async stat(path) {
    await this.init();

    const p = assertSafeRemotePath(path);
    const rec = await reqToPromise(this.objectStore('readonly').get(p));

    if (!rec) return null;

    return {
      path: rec.path,
      size: rec.size || rec.data?.byteLength || 0,
      updated: rec.updated || 0,
      etag: rec.etag,
    };
  }

  async clear() {
    await this.init();

    const tx = this.db.transaction(this.storeName, 'readwrite');

    tx.objectStore(this.storeName).clear();

    await txDone(tx);
  }

  async dumpText() {
    const entries = await this.list('');

    return entries
      .map((e) => `${e.path} (${e.size} bytes)`)
      .join('\n');
  }
}