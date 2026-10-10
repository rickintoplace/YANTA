// ============================================================
// YANTA — Yjs persistence in IndexedDB, sealed while the lock is on
//
// A fork of y-indexeddb 9.0.12 (MIT, Kevin Jahns) with the same database
// layout — one database per doc, stores "updates" (auto-increment) and
// "custom" — so existing data loads unchanged. What differs: every update
// is sealed before it is written and opened after it is read
// (lock/at-rest.js). Sealing is async, which y-indexeddb's single-
// transaction read-apply-write cannot wait for, so:
//
// - Writes go through one queue per doc, in the order Yjs emitted them.
// - Reading collects keys and values in one transaction, opens them,
//   applies them, and remembers the highest key it applied. Trimming
//   deletes only below that key, so an update another tab added
//   meanwhile is never dropped.
// ============================================================

import * as Y from 'yjs';
import * as idb from 'lib0/indexeddb';
import { Observable } from 'lib0/observable';

import { openBytes, openValue, sealBytes, sealValue } from '../lock/at-rest.js';

const customStoreName = 'custom';
const updatesStoreName = 'updates';

export const PREFERRED_TRIM_SIZE = 500;

function readAllUpdates(db, fromKey) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([updatesStoreName], 'readonly');
    const store = tx.objectStore(updatesStoreName);
    const range = IDBKeyRange.lowerBound(fromKey, false);
    const keysReq = store.getAllKeys(range);
    const valuesReq = store.getAll(range);
    const countReq = store.count();

    tx.oncomplete = () => resolve({ keys: keysReq.result, values: valuesReq.result, count: countReq.result });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB read aborted'));
  });
}

function addUpdate(db, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([updatesStoreName], 'readwrite');
    tx.objectStore(updatesStoreName).add(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
  });
}

/** Seals one update the way this persistence stores it (for callers writing raw). */
export function sealUpdateFor(persistence, update) {
  return sealBytes(update, persistence.name);
}

/**
 * Reads updates stored since the last read (other tabs, a reload) and
 * applies them with the persistence as origin.
 */
export async function fetchUpdates(persistence, beforeApply = null) {
  const db = persistence.db;
  const { keys, values, count } = await readAllUpdates(db, persistence._dbref);
  // One unreadable record must not cost the whole note: skip it, loudly.
  // Without the key nothing is readable — then fail rather than show an
  // empty doc that something could take for "really empty".
  const updates = (await Promise.all(values.map((v) => openBytes(v, persistence.name).catch((err) => {
    if (err?.code === 'ELOCKED') throw err;
    console.error('[YANTA] Unreadable stored update skipped', persistence.name, err);
    return null;
  })))).filter(Boolean);

  if (persistence._destroyed) return;

  if (beforeApply) await beforeApply();

  Y.transact(persistence.doc, () => {
    for (const update of updates) Y.applyUpdate(persistence.doc, update);
  }, persistence, false);

  if (keys.length) persistence._dbref = keys[keys.length - 1] + 1;
  persistence._dbsize = count;
}

/** Writes the whole doc as one update and drops what it replaces. */
export async function storeState(persistence, forceStore = true) {
  await fetchUpdates(persistence);
  if (persistence._destroyed) return;
  if (!forceStore && persistence._dbsize < PREFERRED_TRIM_SIZE) return;

  const below = persistence._dbref;
  const sealed = await sealBytes(Y.encodeStateAsUpdate(persistence.doc), persistence.name);

  await persistence._enqueue(() => new Promise((resolve, reject) => {
    const tx = persistence.db.transaction([updatesStoreName], 'readwrite');
    const store = tx.objectStore(updatesStoreName);
    store.add(sealed);
    store.delete(IDBKeyRange.upperBound(below, true));
    const countReq = store.count();
    tx.oncomplete = () => { persistence._dbsize = countReq.result; resolve(); };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB trim aborted'));
  }));
}

export const clearDocument = (name) => idb.deleteDB(name);

export class IndexeddbPersistence extends Observable {
  constructor(name, doc) {
    super();
    this.doc = doc;
    this.name = name;
    this._dbref = 0;
    this._dbsize = 0;
    this._destroyed = false;
    this.db = null;
    this.synced = false;
    this._queue = Promise.resolve();

    this._db = idb.openDB(name, (db) =>
      idb.createStores(db, [
        ['updates', { autoIncrement: true }],
        ['custom'],
      ])
    );

    this.whenSynced = new Promise((resolve) => this.on('synced', () => resolve(this)));

    this._db.then(async (db) => {
      this.db = db;

      try {
        // What the doc held before loading (rare) is stored first, like
        // y-indexeddb — but not an empty doc, which y-indexeddb wrote on
        // every load.
        const initial = Y.encodeStateAsUpdate(doc);
        const storeInitial = initial.length > 2
          ? () => this._enqueue(async () => addUpdate(db, await sealBytes(initial, name)))
          : null;
        await fetchUpdates(this, storeInitial);
      } catch (err) {
        console.error('[YANTA] Could not load stored document', name, err);
        return;
      }

      if (this._destroyed) return;
      this.synced = true;
      this.emit('synced', [this]);
    });

    this._storeTimeout = 1000;
    this._storeTimeoutId = null;

    this._storeUpdate = (update, origin) => {
      if (!this.db || origin === this) return;

      const db = this.db;
      this._enqueue(async () => addUpdate(db, await sealBytes(update, name))).catch((err) => {
        console.error('[YANTA] Could not store document update', name, err);
      });

      if (++this._dbsize >= PREFERRED_TRIM_SIZE) {
        if (this._storeTimeoutId !== null) clearTimeout(this._storeTimeoutId);
        this._storeTimeoutId = setTimeout(() => {
          storeState(this, false).catch((err) => console.warn('[YANTA] Trim failed', name, err));
          this._storeTimeoutId = null;
        }, this._storeTimeout);
      }
    };

    doc.on('update', this._storeUpdate);
    this.destroy = this.destroy.bind(this);
    doc.on('destroy', this.destroy);
  }

  /** Runs writes one after another, in the order they were made. */
  _enqueue(fn) {
    const next = this._queue.catch(() => {}).then(fn);
    this._queue = next;
    return next;
  }

  /** Resolves once every write made so far has landed. */
  whenWritten() {
    return this._queue.catch(() => {});
  }

  destroy() {
    if (this._storeTimeoutId) clearTimeout(this._storeTimeoutId);
    this.doc.off('update', this._storeUpdate);
    this.doc.off('destroy', this.destroy);
    this._destroyed = true;

    // Pending writes finish before the database closes.
    return this._db.then(async (db) => {
      await this.whenWritten();
      db.close();
    });
  }

  clearData() {
    return this.destroy().then(() => {
      idb.deleteDB(this.name);
    });
  }

  get(key) {
    return this._db.then(async (db) => {
      const [custom] = idb.transact(db, [customStoreName], 'readonly');
      return openValue(await idb.get(custom, key), `${this.name}:custom`);
    });
  }

  set(key, value) {
    return this._db.then(async (db) => {
      const sealed = await sealValue(value, `${this.name}:custom`);
      const [custom] = idb.transact(db, [customStoreName]);
      return idb.put(custom, sealed, key);
    });
  }

  del(key) {
    return this._db.then((db) => {
      const [custom] = idb.transact(db, [customStoreName]);
      return idb.del(custom, key);
    });
  }
}
