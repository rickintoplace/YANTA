// ============================================================
// YANTA Chat — Local IndexedDB store
//
// Local-only chat foundation:
// - kv: local settings/state, including encrypted Matrix device credentials
// - mediaIndex: AP6 attachment/media metadata
// - searchIndex: AP7 local full-text/search metadata
// - drafts: unsent room drafts
//
// Security:
// Matrix accessToken + deviceId are device-specific and are NEVER synced to
// the Vault. They are stored only in this device's IndexedDB, encrypted with
// the Sync2 contentKey.
//
// Wichtig:
// Credentials are device-specific (deviceId!) and are not synced through the
// Vault. Each device provisions its own Matrix device via password login.
// The Matrix password itself is Vault-synced encrypted (see matrix-crypto.js / S2).
// ============================================================

import {
  store,
  toast,
} from '../core.js';

import {
  deriveKeys,
  encryptJson,
  decryptJson,
  encryptedEnvelopeToString,
  encryptedEnvelopeFromString,
} from '../sync2/crypto.js';

import {
  getSync2SyncKey,
} from '../sync2/app-engine.js';

const DB_NAME = 'yanta-chat';
const DB_VERSION = 3;

const STORES = {
  kv: 'kv',
  mediaIndex: 'mediaIndex',
  mediaCache: 'mediaCache',
  searchIndex: 'searchIndex',
  drafts: 'drafts',
  archives: 'archives',
};

const CHAT_CREDENTIALS_KEY = 'chat.credentials.enc';
const CHAT_CREDENTIALS_AAD = 'yanta-chat-credentials-v1';

let dbPromise = null;

function reportStoreError(message, err) {
  console.warn('[YANTA Chat Store]', err);
  toast(message || 'Chat storage error', 'error');
}

function openChatDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORES.kv)) {
        db.createObjectStore(STORES.kv, {
          keyPath: 'key',
        });
      }

      if (!db.objectStoreNames.contains(STORES.mediaIndex)) {
        const s = db.createObjectStore(STORES.mediaIndex, {
          keyPath: 'id',
        });

        s.createIndex('roomId', 'roomId', { unique: false });
        s.createIndex('eventId', 'eventId', { unique: false });
        s.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (db.objectStoreNames.contains(STORES.mediaIndex)) {
        const s = req.transaction.objectStore(STORES.mediaIndex);

        if (!s.indexNames.contains('roomId')) {
          s.createIndex('roomId', 'roomId', { unique: false });
        }

        if (!s.indexNames.contains('eventId')) {
          s.createIndex('eventId', 'eventId', { unique: false });
        }

        if (!s.indexNames.contains('createdAt')) {
          s.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!s.indexNames.contains('ts')) {
          s.createIndex('ts', 'ts', { unique: false });
        }

        if (!s.indexNames.contains('kind')) {
          s.createIndex('kind', 'kind', { unique: false });
        }
      }

      if (!db.objectStoreNames.contains(STORES.mediaCache)) {
        const s = db.createObjectStore(STORES.mediaCache, {
          keyPath: 'id',
        });

        s.createIndex('roomId', 'roomId', { unique: false });
        s.createIndex('mxcUrl', 'mxcUrl', { unique: false });
        s.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
        s.createIndex('size', 'size', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.searchIndex)) {
        const s = db.createObjectStore(STORES.searchIndex, {
          keyPath: 'id',
        });

        s.createIndex('roomId', 'roomId', { unique: false });
        s.createIndex('eventId', 'eventId', { unique: false });
        s.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.drafts)) {
        const s = db.createObjectStore(STORES.drafts, {
          keyPath: 'roomId',
        });

        s.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.archives)) {
        const s = db.createObjectStore(STORES.archives, {
          keyPath: 'id',
        });

        s.createIndex('kind', 'kind', { unique: false });
        s.createIndex('importedAt', 'importedAt', { unique: false });
        s.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    req.onsuccess = () => {
      const db = req.result;

      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };

      resolve(db);
    };

    req.onerror = () => reject(req.error || new Error('Could not open Chat IndexedDB'));
    req.onblocked = () => reject(new Error('Chat IndexedDB upgrade is blocked by another tab'));
  });

  return dbPromise;
}

async function txStore(storeName, mode = 'readonly') {
  const db = await openChatDb();
  const tx = db.transaction(storeName, mode);

  return {
    tx,
    store: tx.objectStore(storeName),
  };
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

function cleanCredentialInput(credentials = {}) {
  const out = {
    homeserverUrl: String(credentials.homeserverUrl || credentials.baseUrl || '').trim(),
    userId: String(credentials.userId || credentials.matrixUserId || '').trim(),
    deviceId: String(credentials.deviceId || '').trim(),
    accessToken: String(credentials.accessToken || '').trim(),
  };

  if (!out.homeserverUrl) throw new Error('Matrix homeserverUrl missing');
  if (!out.userId) throw new Error('Matrix userId missing');
  if (!out.deviceId) throw new Error('Matrix deviceId missing');
  if (!out.accessToken) throw new Error('Matrix accessToken missing');

  return out;
}

/**
 * Small IndexedDB key/value facade for Chat-local state.
 */
export const chatSettings = {
  /**
   * Reads a Chat-local value.
   */
  async get(key, fallback = null) {
    try {
      const { store: s } = await txStore(STORES.kv);
      const row = await requestToPromise(s.get(String(key)));

      return row ? row.value : fallback;
    } catch (err) {
      reportStoreError('Could not read Chat setting.', err);
      return fallback;
    }
  },

  /**
   * Writes a Chat-local value.
   */
  async set(key, value) {
    try {
      const { tx, store: s } = await txStore(STORES.kv, 'readwrite');

      if (value === undefined || value === null) {
        s.delete(String(key));
      } else {
        s.put({
          key: String(key),
          value,
          updatedAt: Date.now(),
        });
      }

      await txDone(tx);
      return value;
    } catch (err) {
      reportStoreError('Could not write Chat setting.', err);
      throw err;
    }
  },

  /**
   * Deletes a Chat-local value.
   */
  async del(key) {
    return this.set(key, null);
  },

  /**
   * Returns true when a Chat-local key exists.
   */
  async has(key) {
    try {
      const { store: s } = await txStore(STORES.kv);
      const row = await requestToPromise(s.get(String(key)));

      return !!row;
    } catch (err) {
      reportStoreError('Could not read Chat setting.', err);
      return false;
    }
  },
};

async function contentKeyForChatCredentials() {
  const syncKey = await getSync2SyncKey();
  const keys = await deriveKeys(syncKey);

  return keys.contentKey;
}

/**
 * Stores device-local Matrix credentials encrypted with the Sync2 contentKey.
 *
 * Credentials are intentionally stored in the app settings store under
 * chat.credentials.enc for migration compatibility, not in the synced VaultDoc.
 */
export async function setChatCredentials(credentials) {
  try {
    const clean = cleanCredentialInput(credentials);
    const contentKey = await contentKeyForChatCredentials();

    const encrypted = await encryptJson(
      contentKey,
      {
        ...clean,
        savedAt: Date.now(),
      },
      CHAT_CREDENTIALS_AAD
    );

    const envelope = encryptedEnvelopeToString(encrypted);

    // Primary location requested by AP3.
    await store.settings.set(CHAT_CREDENTIALS_KEY, envelope);

    // Mirror into yanta-chat/kv so AP6/AP7 tools can inspect local Chat state.
    await chatSettings.set(CHAT_CREDENTIALS_KEY, envelope);

    return clean;
  } catch (err) {
    reportStoreError('Could not save Chat credentials.', err);
    throw err;
  }
}

/**
 * Reads and decrypts device-local Matrix credentials.
 */
export async function getChatCredentials() {
  try {
    const envelope =
      await store.settings.get(CHAT_CREDENTIALS_KEY, null) ||
      await chatSettings.get(CHAT_CREDENTIALS_KEY, null);

    if (!envelope) return null;

    const contentKey = await contentKeyForChatCredentials();

    const credentials = await decryptJson(
      contentKey,
      encryptedEnvelopeFromString(envelope),
      CHAT_CREDENTIALS_AAD
    );

    return cleanCredentialInput(credentials);
  } catch (err) {
    reportStoreError('Could not unlock Chat credentials.', err);

    /*
      Do not auto-delete here. A failed decrypt can also mean the Sync2 key is
      not loaded yet. matrix-session.js decides whether credentials are stale.
    */
    return null;
  }
}

/**
 * Returns true when encrypted Matrix credentials exist locally.
 */
export async function hasEncryptedChatCredentials() {
  try {
    const fromSettings = await store.settings.get(CHAT_CREDENTIALS_KEY, null);
    if (fromSettings) return true;

    return chatSettings.has(CHAT_CREDENTIALS_KEY);
  } catch (err) {
    reportStoreError('Could not check Chat credentials.', err);
    return false;
  }
}

/**
 * Clears device-local Matrix credentials.
 */
export async function clearChatCredentials() {
  try {
    await store.settings.set(CHAT_CREDENTIALS_KEY, null);
    await chatSettings.del(CHAT_CREDENTIALS_KEY);

    return true;
  } catch (err) {
    reportStoreError('Could not clear Chat credentials.', err);
    throw err;
  }
}

/**
 * Generic local Chat object store helper.
 */
export function createChatObjectStore(storeName) {
  if (!Object.values(STORES).includes(storeName)) {
    throw new Error(`Unknown Chat object store: ${storeName}`);
  }

  return {
    /**
     * Reads one object by key.
     */
    async get(id, fallback = null) {
      try {
        const { store: s } = await txStore(storeName);
        const row = await requestToPromise(s.get(String(id)));

        return row || fallback;
      } catch (err) {
        reportStoreError(`Could not read Chat ${storeName}.`, err);
        return fallback;
      }
    },

    /**
     * Writes one object.
     */
    async put(value) {
      try {
        const { tx, store: s } = await txStore(storeName, 'readwrite');
        s.put(value);
        await txDone(tx);

        return value;
      } catch (err) {
        reportStoreError(`Could not write Chat ${storeName}.`, err);
        throw err;
      }
    },

    /**
     * Deletes one object by key.
     */
    async del(id) {
      try {
        const { tx, store: s } = await txStore(storeName, 'readwrite');
        s.delete(String(id));
        await txDone(tx);

        return true;
      } catch (err) {
        reportStoreError(`Could not delete Chat ${storeName}.`, err);
        throw err;
      }
    },

    /**
     * Lists all objects in this store.
     */
    async all() {
      try {
        const { store: s } = await txStore(storeName);
        return await requestToPromise(s.getAll());
      } catch (err) {
        reportStoreError(`Could not list Chat ${storeName}.`, err);
        return [];
      }
    },

    /**
     * Scans this object store/index with an IndexedDB cursor.
     *
     * Return false from onValue to stop early.
     */
    async cursor({
      indexName = '',
      query = null,
      direction = 'next',
      onValue,
    } = {}) {
      if (typeof onValue !== 'function') {
        throw new Error('cursor onValue callback missing');
      }

      try {
        const { tx, store: s } = await txStore(storeName);
        const source = indexName ? s.index(indexName) : s;

        await new Promise((resolve, reject) => {
          const req = source.openCursor(query, direction);

          req.onsuccess = () => {
            const cursor = req.result;

            if (!cursor) {
              resolve();
              return;
            }

            const keepGoing = onValue(cursor.value, cursor);

            if (keepGoing === false) {
              resolve();
              return;
            }

            cursor.continue();
          };

          req.onerror = () => reject(req.error || new Error('IndexedDB cursor failed'));
          tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
        });

        return true;
      } catch (err) {
        reportStoreError(`Could not scan Chat ${storeName}.`, err);
        throw err;
      }
    },

    /**
     * Clears this local Chat store.
     */
    async clear() {
      try {
        const { tx, store: s } = await txStore(storeName, 'readwrite');
        s.clear();
        await txDone(tx);

        return true;
      } catch (err) {
        reportStoreError(`Could not clear Chat ${storeName}.`, err);
        throw err;
      }
    },
  };
}

/**
 * Chat-local IndexedDB facade.
 */
export const chatStore = {
  dbName: DB_NAME,
  settings: chatSettings,
  mediaIndex: createChatObjectStore(STORES.mediaIndex),
  mediaCache: createChatObjectStore(STORES.mediaCache),
  searchIndex: createChatObjectStore(STORES.searchIndex),
  drafts: createChatObjectStore(STORES.drafts),
  archives: createChatObjectStore(STORES.archives),
  
  /**
   * Opens the Chat IndexedDB database.
   */
  async init() {
    try {
      return await openChatDb();
    } catch (err) {
      reportStoreError('Could not open Chat storage.', err);
      throw err;
    }
  },

  /**
   * Debug-only complete local Chat storage wipe.
   */
  async clearAllForDebugOnly() {
    try {
      const db = await openChatDb();

      await Promise.all(Object.values(STORES).map((name) => {
        const tx = db.transaction(name, 'readwrite');
        tx.objectStore(name).clear();
        return txDone(tx);
      }));

      await store.settings.set(CHAT_CREDENTIALS_KEY, null);

      return true;
    } catch (err) {
      reportStoreError('Could not clear Chat storage.', err);
      throw err;
    }
  },
};