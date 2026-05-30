// ============================================================
// YANTA Sync2 — App Sync Engine
//
// Real app integration:
// - VaultDoc metadata updates
// - Note Y.Doc updates
// - encrypted provider-independent remote objects
// - persistent seen-state
// - remote snapshots
//
// Current scope:
// - vault metadata
// - note Yjs docs
// - debug IndexedDB fake remote
//
// Not yet included:
// - remote asset sync
// - compaction/GC
// - production UI
// - broker/cloud providers
// ============================================================

import * as Y from 'yjs';

import { $, state, store, toast } from '../core.js';
import { rebuildWikilinkIndex } from '../notes.js';
import { renderTree } from '../tree.js';

import {
  getNoteDoc,
  encodeNoteState,
} from '../yjs.js';

import {
  getVaultDoc,
  encodeVaultState,
  applyVaultUpdate,
  onVaultUpdate,
  vaultNotesMap,
  vaultFoldersMap,
  vaultImagesMap,
  vaultTombstonesMap,
  vaultJsonSnapshot,
  VAULT_ORIGINS,
  safeJsonClone,
} from './vault-doc.js';

import { IndexedDBObjectStore } from './indexeddb-object-store.js';
import { Sync2LocalStateStore } from './state.js';
import { BrokerObjectStore } from './broker-object-store.js';

import {
  deriveKeys,
  encryptBytes,
  decryptBytes,
  generateSyncKey,
  utf8Encode,
} from './crypto.js';

import {
  createDeviceId,
  createVaultId,
  bootstrapPath,
  vaultUpdatePath,
  docUpdatePath,
  vaultUpdatesPrefix,
  docUpdatesPrefix,
} from './ids.js';

import {
  createAndEncodeUpdatePack,
  decodePack,
} from './pack.js';

import {
  uploadVaultSnapshot,
  uploadNoteSnapshot,
  downloadVaultSnapshots,
  downloadNoteSnapshots,
} from './snapshots.js';
import {
  uploadMissingAssets,
  downloadMissingAssets,
  assetSyncDebugSnapshot,
} from './assets.js';

export const SYNC2_REMOTE_ORIGIN = 'sync2-remote';
export const SYNC2_LOCAL_ORIGIN = 'sync2-local';

const SYNC_KEY_SETTING = 'sync2.syncKey';
const LEGACY_DEBUG_SYNC_KEY_SETTING = 'sync2.debug.syncKey';
const DEVICE_ID_SETTING = 'sync2.deviceId';

function nowIso() {
  return new Date().toISOString();
}

function cleanUndefined(obj) {
  const out = {};

  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) out[k] = v;
  }

  return out;
}

function sanitizeNoteMeta(note) {
  if (!note || typeof note !== 'object') return null;

  return cleanUndefined({
    id: String(note.id || ''),
    title: String(note.title || 'Untitled'),
    type: String(note.type || 'markdown'),
    folderId: note.folderId || null,
    tags: Array.isArray(note.tags) ? [...note.tags].map(String) : [],
    pinned: !!note.pinned,
    icon: note.icon || undefined,
    color: note.color || undefined,
    created: Number(note.created || Date.now()),
    updated: Number(note.updated || Date.now()),
    bodyMigrated: note.bodyMigrated === true ? true : undefined,
  });
}

function sanitizeFolderMeta(folder) {
  if (!folder || typeof folder !== 'object') return null;

  return cleanUndefined({
    id: String(folder.id || ''),
    name: String(folder.name || 'Folder'),
    parentId: folder.parentId || null,
    icon: folder.icon || undefined,
    color: folder.color || undefined,
    created: Number(folder.created || Date.now()),
    updated: Number(folder.updated || folder.created || Date.now()),
  });
}

function sanitizeImageMeta(image) {
  if (!image || typeof image !== 'object') return null;

  const { blob, data, ...rest } = image;

  return cleanUndefined({
    id: String(rest.id || ''),
    name: rest.name ? String(rest.name) : undefined,
    size: Number(rest.size || 0),
    type: rest.type ? String(rest.type) : undefined,
    ts: Number(rest.ts || rest.updated || Date.now()),
    updated: Number(rest.updated || rest.ts || Date.now()),
  });
}

function preferIncoming(existing, incoming) {
  if (!existing) return true;

  const exUpdated = Number(existing.updated || existing.ts || existing.created || 0);
  const inUpdated = Number(incoming.updated || incoming.ts || incoming.created || 0);

  return inUpdated >= exUpdated;
}

async function getOrCreateSyncKey() {
  let key = await store.settings.get(SYNC_KEY_SETTING, null);

  if (!key) {
    key = await store.settings.get(LEGACY_DEBUG_SYNC_KEY_SETTING, null);
  }

  if (!key) {
    key = generateSyncKey();
  }

  await store.settings.set(SYNC_KEY_SETTING, key);
  await store.settings.set(LEGACY_DEBUG_SYNC_KEY_SETTING, key);

  return key;
}

async function getOrCreateDeviceId() {
  let id = await store.settings.get(DEVICE_ID_SETTING, null);

  if (!id) {
    id = createDeviceId('app');
    await store.settings.set(DEVICE_ID_SETTING, id);
  }

  return id;
}

export class Sync2AppEngine {
  constructor({
    remote,
    localState,
    syncKey,
    deviceId,
    vaultId = createVaultId(),
    autoObserveNotes = true,
  }) {
    if (!remote) throw new Error('remote store required');
    if (!localState) throw new Error('localState store required');
    if (!syncKey) throw new Error('syncKey required');
    if (!deviceId) throw new Error('deviceId required');

    this.remote = remote;
    this.localState = localState;
    this.syncKey = syncKey;
    this.deviceId = deviceId;
    this.vaultId = vaultId;
    this.autoObserveNotes = autoObserveNotes;

    this.keys = null;

    this.started = false;
    this.syncing = false;

    this.seq = 0;
    this.outbox = [];

    this.unobserveVault = null;
    this.noteObservers = new Map();
  }

  async init() {
    await this.remote.init();
    await this.localState.init();

    this.keys = await deriveKeys(this.syncKey);

    this.seq = Number(await this.localState.get('seq', 0)) || 0;

    await this.ensureBootstrap();

    if (this.autoObserveNotes) {
      await this.observeAllKnownNotes();
    }
  }

  async start() {
    if (this.started) return;

    await this.init();

    this.observeVault();

    this.started = true;
  }

  stop() {
    if (this.unobserveVault) {
      this.unobserveVault();
      this.unobserveVault = null;
    }

    for (const [_noteId, rec] of this.noteObservers) {
      try {
        rec.doc.off('update', rec.handler);
      } catch {}
    }

    this.noteObservers.clear();
    this.started = false;
  }

  async hasSeen(path) {
    return this.localState.hasSeen(path);
  }

  async markSeen(path, extra = {}) {
    return this.localState.markSeen(path, extra);
  }

  observeVault() {
    if (this.unobserveVault) return;

    this.unobserveVault = onVaultUpdate((update, origin) => {
      if (origin === SYNC2_REMOTE_ORIGIN) return;
      if (origin === VAULT_ORIGINS.REMOTE) return;

      this.outbox.push({
        kind: 'vault',
        update: new Uint8Array(update),
        created: Date.now(),
      });
    });
  }

  async observeAllKnownNotes() {
    const ids = new Set();

    for (const id of state.notes.keys()) ids.add(id);
    for (const id of vaultNotesMap().keys()) ids.add(id);

    for (const id of ids) {
      await this.observeNote(id);
    }
  }

  async observeNote(noteId) {
    if (!noteId || this.noteObservers.has(noteId)) return;

    const entry = getNoteDoc(noteId);
    await entry.ready;

    const doc = entry.doc;

    const handler = (update, origin) => {
      if (origin === SYNC2_REMOTE_ORIGIN) return;
      if (origin === 'sync-folder') return;

      // If the note is tombstoned, do not queue body changes.
      if (vaultTombstonesMap().has(noteId)) return;

      this.outbox.push({
        kind: 'note',
        noteId,
        update: new Uint8Array(update),
        created: Date.now(),
      });
    };

    doc.on('update', handler);

    this.noteObservers.set(noteId, {
      doc,
      handler,
    });
  }

  async ensureBootstrap() {
    const path = bootstrapPath();
    const existing = await this.remote.stat(path);

    if (existing) return;

    const bootstrap = {
      format: 'yanta-sync',
      version: 1,
      vaultId: this.vaultId,
      created: nowIso(),
      encryption: {
        alg: 'AES-GCM',
        kdf: 'raw-256',
      },
    };

    try {
      await this.remote.put(
        path,
        utf8Encode(JSON.stringify(bootstrap, null, 2)),
        { ifAbsent: true }
      );
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
    }
  }

  async nextSeq() {
    this.seq += 1;
    await this.localState.set('seq', this.seq);
    await store.settings.set('sync2.seq', this.seq);
    return this.seq;
  }

  async pushFullStateNow({
    includeSnapshots = true,
  } = {}) {
    await this.start();

    if (includeSnapshots) {
      await uploadVaultSnapshot(this);

      const ids = new Set();

      for (const id of state.notes.keys()) ids.add(id);
      for (const id of vaultNotesMap().keys()) ids.add(id);

      for (const noteId of ids) {
        if (vaultTombstonesMap().has(noteId)) continue;

        await this.observeNote(noteId);
        await uploadNoteSnapshot(this, noteId);
      }
      await uploadMissingAssets(this);
    } else {
      this.outbox.push({
        kind: 'vault',
        update: encodeVaultState(),
        created: Date.now(),
        full: true,
      });

      const ids = new Set();

      for (const id of state.notes.keys()) ids.add(id);
      for (const id of vaultNotesMap().keys()) ids.add(id);

      for (const noteId of ids) {
        if (vaultTombstonesMap().has(noteId)) continue;

        await this.observeNote(noteId);

        this.outbox.push({
          kind: 'note',
          noteId,
          update: encodeNoteState(noteId),
          created: Date.now(),
          full: true,
        });
      }

      await this.uploadOutbox();
      await uploadMissingAssets(this);
    }

    toast('Sync2: full state snapshot pushed to debug remote', 'success');

    return this.status();
  }

  async syncNow({
    verbose = true,
    pullSnapshots = true,
  } = {}) {
    await this.start();

    if (this.syncing) return this.status();

    this.syncing = true;
    state.globalSyncStatus = 'syncing';

    try {
      await this.uploadOutbox();

      if (pullSnapshots) {
        await downloadVaultSnapshots(this);
      }

      await this.downloadVaultUpdates();

      this.hydrateAppStateFromVault();

      await downloadMissingAssets(this);

      await this.observeAllKnownNotes();

      if (pullSnapshots) {
        await this.downloadKnownNoteSnapshots();
      }

      await this.downloadKnownNoteUpdates();

      this.hydrateAppStateFromVault();

      await downloadMissingAssets(this);

      await this.uploadOutbox();
      await uploadMissingAssets(this);

      state.globalSyncStatus = 'synced';

      if (verbose) {
        toast('Sync2: sync complete', 'success');
      }

      return this.status();
    } catch (err) {
      console.error('Sync2 sync failed', err);

      state.globalSyncStatus = 'conflict';

      if (verbose) {
        toast('Sync2 failed: ' + (err?.message || String(err)), 'error');
      }

      throw err;
    } finally {
      this.syncing = false;
    }
  }

  async uploadOutbox() {
    while (this.outbox.length) {
      const item = this.outbox.shift();

      // Drop note updates if tombstoned before upload.
      if (item.kind === 'note' && vaultTombstonesMap().has(item.noteId)) {
        continue;
      }

      const seq = await this.nextSeq();

      let path;
      let docId;

      if (item.kind === 'vault') {
        path = vaultUpdatePath(this.deviceId, seq);
        docId = 'vault';
      } else if (item.kind === 'note') {
        path = await docUpdatePath(
          this.keys.nameKey,
          item.noteId,
          this.deviceId,
          seq
        );

        docId = item.noteId;
      } else {
        throw new Error(`Unknown outbox item kind: ${item.kind}`);
      }

      const packBytes = createAndEncodeUpdatePack({
        kind: item.kind,
        deviceId: this.deviceId,
        seq,
        docId,
        updates: [item.update],
        meta: {
          full: !!item.full,
          app: true,
        },
      });

      const encrypted = await encryptBytes(
        this.keys.contentKey,
        packBytes,
        path
      );

      try {
        await this.remote.put(path, encrypted, { ifAbsent: true });
      } catch (err) {
        if (err?.code === 'EEXIST') {
          await this.markSeen(path, {
            type: item.kind + '-update',
            own: true,
          });

          continue;
        }

        throw err;
      }

      await this.markSeen(path, {
        type: item.kind + '-update',
        own: true,
      });
    }
  }

  async downloadVaultUpdates() {
    const entries = await this.remote.list(vaultUpdatesPrefix());

    let applied = 0;

    for (const entry of entries) {
      if (await this.hasSeen(entry.path)) continue;

      const encrypted = await this.remote.get(entry.path);

      const plain = await decryptBytes(
        this.keys.contentKey,
        encrypted,
        entry.path
      );

      const pack = decodePack(plain);

      if (pack.kind !== 'vault') {
        await this.markSeen(entry.path, {
          type: 'ignored',
        });

        continue;
      }

      for (const update of pack.updates) {
        applyVaultUpdate(update, SYNC2_REMOTE_ORIGIN);
      }

      await this.markSeen(entry.path, {
        type: 'vault-update',
        size: entry.size,
        etag: entry.etag,
      });

      applied++;
    }

    return {
      applied,
      entries: entries.length,
    };
  }

  async downloadKnownNoteSnapshots() {
    const ids = new Set();

    for (const id of state.notes.keys()) ids.add(id);
    for (const id of vaultNotesMap().keys()) ids.add(id);

    let applied = 0;

    for (const noteId of ids) {
      if (vaultTombstonesMap().has(noteId)) continue;

      const res = await downloadNoteSnapshots(this, noteId);
      applied += res.applied;
    }

    return { applied };
  }

  async downloadKnownNoteUpdates() {
    const ids = new Set();

    for (const id of state.notes.keys()) ids.add(id);
    for (const id of vaultNotesMap().keys()) ids.add(id);

    let applied = 0;

    for (const noteId of ids) {
      if (vaultTombstonesMap().has(noteId)) continue;

      const res = await this.downloadNoteUpdates(noteId);
      applied += res.applied;
    }

    return { applied };
  }

  async downloadNoteUpdates(noteId) {
    const prefix = await docUpdatesPrefix(this.keys.nameKey, noteId);
    const entries = await this.remote.list(prefix);

    let applied = 0;

    if (!entries.length) {
      return {
        noteId,
        applied,
        entries: 0,
      };
    }

    await this.observeNote(noteId);

    const { doc } = getNoteDoc(noteId);

    for (const entry of entries) {
      if (await this.hasSeen(entry.path)) continue;

      if (vaultTombstonesMap().has(noteId)) {
        await this.markSeen(entry.path, {
          type: 'skipped-tombstoned-note-update',
          noteId,
        });

        continue;
      }

      const encrypted = await this.remote.get(entry.path);

      const plain = await decryptBytes(
        this.keys.contentKey,
        encrypted,
        entry.path
      );

      const pack = decodePack(plain);

      if (pack.kind !== 'note') {
        await this.markSeen(entry.path, {
          type: 'ignored',
          noteId,
        });

        continue;
      }

      for (const update of pack.updates) {
        Y.applyUpdate(doc, update, SYNC2_REMOTE_ORIGIN);
      }

      await this.markSeen(entry.path, {
        type: 'note-update',
        noteId,
        size: entry.size,
        etag: entry.etag,
      });

      applied++;
    }

    return {
      noteId,
      applied,
      entries: entries.length,
    };
  }

  hydrateAppStateFromVault() {
    const tombstones = vaultTombstonesMap();

    // Tombstones first.
    for (const [id, t] of tombstones) {
      const type = t?.type;

      if (type === 'note') {
        state.notes.delete(id);
        state.searchIndex.delete(id);
      } else if (type === 'folder') {
        state.folders.delete(id);
        state.expandedFolders.delete(id);
      } else if (type === 'image') {
        state.imagesMeta.delete(id);

        const url = state.imageBlobs.get(id);

        if (url) {
          try {
            URL.revokeObjectURL(url);
          } catch {}
        }

        state.imageBlobs.delete(id);
      }
    }

    // Notes.
    for (const [id, raw] of vaultNotesMap()) {
      if (tombstones.has(id)) continue;

      const incoming = sanitizeNoteMeta(raw);
      if (!incoming?.id) continue;

      const existing = state.notes.get(id);

      if (preferIncoming(existing, incoming)) {
        state.notes.set(id, safeJsonClone(incoming));
      }
    }

    // Folders.
    for (const [id, raw] of vaultFoldersMap()) {
      if (tombstones.has(id)) continue;

      const incoming = sanitizeFolderMeta(raw);
      if (!incoming?.id) continue;

      const existing = state.folders.get(id);

      if (preferIncoming(existing, incoming)) {
        state.folders.set(id, safeJsonClone(incoming));
      }
    }

    // Images metadata only; blobs come later in PR 4b.
    for (const [id, raw] of vaultImagesMap()) {
      if (tombstones.has(id)) continue;

      const incoming = sanitizeImageMeta(raw);
      if (!incoming?.id) continue;

      const existing = state.imagesMeta.get(id);

      if (preferIncoming(existing, incoming)) {
        state.imagesMeta.set(id, safeJsonClone(incoming));
      }
    }

    rebuildWikilinkIndex();
    renderTree();

    window.dispatchEvent(new CustomEvent('yanta-vault-hydrated'));

    const current = state.currentNoteId
      ? state.notes.get(state.currentNoteId)
      : null;

    if (current) {
      const titleEl = $('noteTitle');

      if (titleEl && titleEl.value !== (current.title || '')) {
        titleEl.value = current.title || '';
      }
    }
  }

  async status() {
    return {
      deviceId: this.deviceId,
      seq: this.seq,
      outbox: this.outbox.length,
      seen: await this.localState.seenCount(),
      started: this.started,
      syncing: this.syncing,
      notes: state.notes.size,
      folders: state.folders.size,
      images: state.imagesMeta.size,
      vault: vaultJsonSnapshot(),
    };
  }
}

/**
 * Debug app runtime.
 *
 * Persistent:
 * - sync key in store.settings
 * - device id in store.settings
 * - fake remote in IndexedDB
 * - seen-state in IndexedDB
 */
export async function createSync2DebugAppRuntime() {
  const syncKey = await getOrCreateSyncKey();
  const deviceId = await getOrCreateDeviceId();

  const remote = new IndexedDBObjectStore({
    dbName: 'yanta-sync2-debug-remote',
  });

  const localState = new Sync2LocalStateStore({
    dbName: 'yanta-sync2-state',
  });

  const engine = new Sync2AppEngine({
    remote,
    localState,
    syncKey,
    deviceId,
  });

  await engine.start();

  return {
    engine,
    remote,
    localState,
    syncKey,
    deviceId,

    async syncNow(options) {
      return engine.syncNow(options);
    },

    async pushFullStateNow(options) {
      return engine.pushFullStateNow(options);
    },

    async uploadAssetsNow() {
      return uploadMissingAssets(engine);
    },

    async downloadAssetsNow() {
      return downloadMissingAssets(engine);
    },

    async assetDebugSnapshot() {
      return assetSyncDebugSnapshot(engine);
    },

    async dumpRemote() {
      return remote.dumpText();
    },

    async clearRemoteForDebugOnly() {
      await remote.clear();
      toast('Sync2 debug remote cleared', 'success');
    },

    async clearSeenForDebugOnly() {
      await localState.clearSeen();
      toast('Sync2 seen-state cleared', 'success');
    },

    async clearLocalSync2StateForDebugOnly() {
      await localState.clearAllForDebugOnly();
      toast('Sync2 local state cleared', 'success');
    },

    async status() {
      return engine.status();
    },
  };
}

export async function createSync2BrokerAppRuntime({
  baseUrl = 'http://localhost:8787',
  token = '',
  stateDbName = 'yanta-sync2-state-broker',
} = {}) {
  const syncKey = await getOrCreateSyncKey();
  const deviceId = await getOrCreateDeviceId();

  const remote = new BrokerObjectStore({
    baseUrl,
    token,
  });

  const localState = new Sync2LocalStateStore({
    dbName: stateDbName,
  });

  const engine = new Sync2AppEngine({
    remote,
    localState,
    syncKey,
    deviceId,
  });

  await engine.start();

  return {
    engine,
    remote,
    localState,
    syncKey,
    deviceId,
    baseUrl,

    async syncNow(options) {
      return engine.syncNow(options);
    },

    async pushFullStateNow(options) {
      return engine.pushFullStateNow(options);
    },

    async uploadAssetsNow() {
      return uploadMissingAssets(engine);
    },

    async downloadAssetsNow() {
      return downloadMissingAssets(engine);
    },

    async assetDebugSnapshot() {
      return assetSyncDebugSnapshot(engine);
    },

    async dumpRemote() {
      const entries = await remote.list('');
      return entries.map((e) => `${e.path} (${e.size} bytes)`).join('\n');
    },

    async clearSeenForDebugOnly() {
      await localState.clearSeen();
      toast('Sync2 broker seen-state cleared', 'success');
    },

    async status() {
      return engine.status();
    },
  };
}