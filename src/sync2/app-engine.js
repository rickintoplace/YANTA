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
  noteMarkdown,
} from '../yjs.js';

import {
  getVaultDoc,
  encodeVaultState,
  applyVaultUpdate,
  onVaultUpdate,
  vaultNotesMap,
  vaultFoldersMap,
  vaultImagesMap,
  vaultEventsMap,
  vaultCalendarCategoriesMap,
  vaultDevicesMap,
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
  syncKeyToBytes,
  sha256,
  base64UrlEncode,
} from './crypto.js';
import {
  createDeviceId,
  createVaultId,
  bootstrapPath,
  keyCheckPath,
  vaultUpdatePath,
  docUpdatePath,
  vaultUpdatesPrefix,
  vaultSnapshotsPrefix,
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

import { GoogleDriveObjectStore } from './google-drive-object-store.js';

import { YantaCloudObjectStore } from './yanta-cloud-object-store.js';

export const SYNC2_REMOTE_ORIGIN = 'sync2-remote';
export const SYNC2_LOCAL_ORIGIN = 'sync2-local';

// Local-only device presence/status updates.
// These should NOT create remote update packs on every sync cycle.
export const SYNC2_DEVICE_PRESENCE_ORIGIN = 'sync2-device-presence';

function emitSync2Progress(detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent('yanta-sync2-progress', {
      detail: {
        ts: Date.now(),
        provider: detail.provider || 'YANTA Cloud Sync',
        ...detail,
      },
    }));
  } catch {}
}

const SYNC_KEY_SETTING = 'sync2.syncKey';
const LEGACY_DEBUG_SYNC_KEY_SETTING = 'sync2.debug.syncKey';
const DEVICE_ID_SETTING = 'sync2.deviceId';

export async function getSync2SyncKey() {
  return getOrCreateSyncKey();
}

export async function setSync2SyncKey(syncKey) {
  syncKeyToBytes(syncKey);

  await store.settings.set(SYNC_KEY_SETTING, syncKey);
  await store.settings.set(LEGACY_DEBUG_SYNC_KEY_SETTING, syncKey);

  return syncKey;
}

export async function clearSync2SyncKeyForDebugOnly() {
  await store.settings.set(SYNC_KEY_SETTING, null);
  await store.settings.set(LEGACY_DEBUG_SYNC_KEY_SETTING, null);
}
function defaultDeviceName() {
  const ua = navigator.userAgent || '';
  const platform =
    navigator.userAgentData?.platform ||
    navigator.platform ||
    'Device';

  const mobile = /Android|iPhone|iPad|iPod/i.test(ua);

  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return mobile ? 'Android phone' : 'Android device';
  if (/Mac/i.test(platform)) return 'Mac';
  if (/Win/i.test(platform)) return 'Windows PC';
  if (/Linux/i.test(platform)) return 'Linux PC';

  return String(platform || 'Device');
}

async function getOrCreateDeviceName(deviceId) {
  const key = 'sync2.deviceName';
  let name = await store.settings.get(key, null);

  if (!name) {
    name = defaultDeviceName();
    await store.settings.set(key, name);
  }

  return name || deviceId;
}
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

function finiteNumberOrUndefined(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function seqFromRemoteObjectPath(path, deviceId) {
  const safeDevice = String(deviceId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const re = new RegExp(`${safeDevice}-(\\d{8,})\\.(?:ypack|ysnap)\\.enc$`);
  const m = String(path || '').match(re);

  if (!m) return 0;

  const n = Number(m[1]);

  return Number.isFinite(n) ? n : 0;
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

    // Dashboard layout/user preferences.
    dashboardOrder: finiteNumberOrUndefined(note.dashboardOrder),
    dashboardPinnedOrder: finiteNumberOrUndefined(note.dashboardPinnedOrder),
    dashboardHeightPx: finiteNumberOrUndefined(note.dashboardHeightPx),

    // Legacy compatibility. New code should prefer dashboardHeightPx.
    dashboardHeight: finiteNumberOrUndefined(note.dashboardHeight),

    hidden: note.hidden === true ? true : undefined,    archived: note.archived === true ? true : undefined,
    system: note.system === true ? true : undefined,
    aiBrain: note.aiBrain === true ? true : undefined,
    dashboardHidden: note.dashboardHidden === true ? true : undefined,
    hiddenFromDashboard: note.hiddenFromDashboard === true ? true : undefined,

    trashed: note.trashed === true ? true : undefined,
    deletedAt: finiteNumberOrUndefined(note.deletedAt),
    deletedBy: note.deletedBy ? String(note.deletedBy) : undefined,
    trashOriginalFolderId: note.trashOriginalFolderId || undefined,
    trashOriginalFolderPath: Array.isArray(note.trashOriginalFolderPath)
      ? note.trashOriginalFolderPath.map(String)
      : undefined,
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

    // Dashboard layout/user preferences.
    dashboardOrder: finiteNumberOrUndefined(folder.dashboardOrder),
    dashboardHeightPx: finiteNumberOrUndefined(folder.dashboardHeightPx),

    // Legacy compatibility. New code should prefer dashboardHeightPx.
    dashboardHeight: finiteNumberOrUndefined(folder.dashboardHeight),

    hidden: folder.hidden === true ? true : undefined,    archived: folder.archived === true ? true : undefined,
    system: folder.system === true ? true : undefined,
    aiBrain: folder.aiBrain === true ? true : undefined,
    dashboardHidden: folder.dashboardHidden === true ? true : undefined,
    hiddenFromDashboard: folder.hiddenFromDashboard === true ? true : undefined,

    trashed: folder.trashed === true ? true : undefined,
    deletedAt: finiteNumberOrUndefined(folder.deletedAt),
    deletedBy: folder.deletedBy ? String(folder.deletedBy) : undefined,
    trashOriginalParentId: folder.trashOriginalParentId || undefined,
    trashOriginalParentPath: Array.isArray(folder.trashOriginalParentPath)
      ? folder.trashOriginalParentPath.map(String)
      : undefined,
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

    // Asset-key architecture v2.
    encryptionVersion: Number(rest.encryptionVersion || 1),
    objectId: rest.objectId ? String(rest.objectId) : undefined,
    objectPath: rest.objectPath ? String(rest.objectPath) : undefined,
    keyVersion: Number(rest.keyVersion || 1),
    keyAlg: rest.keyAlg ? String(rest.keyAlg) : undefined,
    encryptedAssetKeyForVault: rest.encryptedAssetKeyForVault
      ? String(rest.encryptedAssetKeyForVault)
      : undefined,
  });
}

function preferIncoming(existing, incoming) {
  if (!existing) return true;

  const exUpdated = Number(existing.updated || existing.ts || existing.created || 0);
  const inUpdated = Number(incoming.updated || incoming.ts || incoming.created || 0);

  return inUpdated >= exUpdated;
}

function stableJsonStringifyForSync2(value) {
  if (value == null) return String(value);

  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(stableJsonStringifyForSync2).join(',') + ']';
  }

  const keys = Object.keys(value).sort();

  return '{' + keys
    .map((key) => JSON.stringify(key) + ':' + stableJsonStringifyForSync2(value[key]))
    .join(',') + '}';
}

function jsonEqualForSync2(a, b) {
  try {
    return stableJsonStringifyForSync2(a) === stableJsonStringifyForSync2(b);
  } catch {
    return false;
  }
}

function sync2ObjectVersion(obj) {
  if (!obj || typeof obj !== 'object') return 0;

  return Math.max(
    Number(obj.updated || 0),
    Number(obj.created || 0),
    Number(obj.ts || 0),
    Number(obj.deletedAt || 0)
  ) || 0;
}

function sync2LocalVaultContentVersion() {
  /*
    This version is for VaultDoc metadata reliability only.

    Do NOT derive it from state.notes.updated:
    - state.notes.updated changes on note-body edits.
    - note bodies sync via per-note Y.Doc updates.
    - using note.updated here turns ordinary typing into full Vault metadata
      updates and causes massive "Vault Update History" growth.

    Instead, inspect the actual VaultDoc maps that represent durable
    vault-wide metadata.
  */
  let max = 0;

  try {
    for (const note of vaultNotesMap().values()) {
      max = Math.max(max, sync2ObjectVersion(note));
    }

    for (const folder of vaultFoldersMap().values()) {
      max = Math.max(max, sync2ObjectVersion(folder));
    }

    for (const image of vaultImagesMap().values()) {
      max = Math.max(max, sync2ObjectVersion(image));
    }

    for (const ev of vaultEventsMap().values()) {
      max = Math.max(max, sync2ObjectVersion(ev));
    }

    for (const cat of vaultCalendarCategoriesMap().values()) {
      max = Math.max(max, sync2ObjectVersion(cat));
    }

    for (const t of vaultTombstonesMap().values()) {
      max = Math.max(max, sync2ObjectVersion(t));
    }
  } catch {}

  return max;
}

const SYNC2_VAULT_FINGERPRINT_VOLATILE_KEYS = new Set([
  // note.updated changes on body edits, but note bodies sync via note docs.
  // Therefore updated-only changes must not create Vault metadata history.
  'updated',

  // Device/presence/status fields must never make the durable vault dirty.
  'lastSeenAt',
  'lastOpenedAt',
  'lastSyncStartedAt',
  'lastSyncAt',
  'lastPushAt',
  'lastPullAt',
  'lastError',
  'lastErrorAt',
  'syncStatus',
  'seq',
]);

function stripVolatileVaultFingerprintFields(value) {
  if (value == null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(stripVolatileVaultFingerprintFields);
  }

  const out = {};

  for (const [key, val] of Object.entries(value || {})) {
    if (SYNC2_VAULT_FINGERPRINT_VOLATILE_KEYS.has(key)) continue;

    out[key] = stripVolatileVaultFingerprintFields(val);
  }

  return out;
}

/**
 * Semantic fingerprint of durable Vault metadata.
 *
 * Critical:
 * - Devices are intentionally excluded.
 * - updated-only metadata changes are ignored.
 * - Note bodies are intentionally excluded; they sync via per-note Y.Doc updates.
 *
 * This is used to decide whether a full Vault metadata update is actually
 * needed during routine sync.
 */
export async function sync2LocalVaultContentFingerprint() {
  const snapshot = {
    notes: {},
    folders: {},
    images: {},
    events: {},
    calendarCategories: {},
    tombstones: {},
  };

  try {
    for (const [id, note] of vaultNotesMap()) {
      snapshot.notes[id] = stripVolatileVaultFingerprintFields(note);
    }

    for (const [id, folder] of vaultFoldersMap()) {
      snapshot.folders[id] = stripVolatileVaultFingerprintFields(folder);
    }

    for (const [id, image] of vaultImagesMap()) {
      snapshot.images[id] = stripVolatileVaultFingerprintFields(image);
    }

    for (const [id, ev] of vaultEventsMap()) {
      snapshot.events[id] = stripVolatileVaultFingerprintFields(ev);
    }

    for (const [id, cat] of vaultCalendarCategoriesMap()) {
      snapshot.calendarCategories[id] = stripVolatileVaultFingerprintFields(cat);
    }

    for (const [id, tombstone] of vaultTombstonesMap()) {
      snapshot.tombstones[id] = stripVolatileVaultFingerprintFields(tombstone);
    }
  } catch {}

  const stable = stableJsonStringifyForSync2(snapshot);
  const digest = await sha256(utf8Encode(stable));

  return `sha256:${base64UrlEncode(digest)}`;
}

const SYNC2_VAULT_FINGERPRINT_MARKER_KEY =
  'sync2.fullUpdateUploaded.vault.fingerprint';

const SYNC2_LEGACY_VAULT_VERSION_MARKER_KEY =
  'sync2.fullUpdateUploaded.vault.version';

async function currentVaultFingerprintMarker(localState) {
  const fingerprint = await sync2LocalVaultContentFingerprint();

  let lastFingerprint =
    String(await localState.get(SYNC2_VAULT_FINGERPRINT_MARKER_KEY, '') || '');

  /*
    Migration compatibility:
    If an older timestamp marker already covers the current semantic vault
    version, initialize the new fingerprint marker without uploading anything.
  */
  if (!lastFingerprint) {
    const legacyLastVaultVersion =
      Number(await localState.get(SYNC2_LEGACY_VAULT_VERSION_MARKER_KEY, 0)) || 0;

    const currentVaultVersion = sync2LocalVaultContentVersion();

    if (
      fingerprint &&
      currentVaultVersion > 0 &&
      legacyLastVaultVersion >= currentVaultVersion
    ) {
      await localState.set(SYNC2_VAULT_FINGERPRINT_MARKER_KEY, fingerprint);
      lastFingerprint = fingerprint;
    }
  }

  return {
    markerKey: SYNC2_VAULT_FINGERPRINT_MARKER_KEY,
    fingerprint,
    lastFingerprint,
  };
}

function ensureOutboxMarker(item, markerKey, markerValue) {
  if (!item || !markerKey) return;

  if (!Array.isArray(item.afterUploadLocalStateSet)) {
    item.afterUploadLocalStateSet = [];
  }

  const exists = item.afterUploadLocalStateSet.some((m) =>
    m &&
    m.key === markerKey &&
    String(m.value ?? '') === String(markerValue ?? '')
  );

  if (!exists) {
    item.afterUploadLocalStateSet.push({
      key: markerKey,
      value: markerValue,
    });
  }
}

function outboxHasUploadMarker(outbox, markerKey, markerValue) {
  return outbox.some((item) =>
    Array.isArray(item.afterUploadLocalStateSet) &&
    item.afterUploadLocalStateSet.some((m) =>
      m &&
      m.key === markerKey &&
      String(m.value ?? '') === String(markerValue ?? '')
    )
  );
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
    this.uploadBlockedUntil = 0;
    this.uploading = false;
    this.remoteSeqCatchupDone = false;
    this.suppressVaultOutboxDepth = 0;
    this.remoteIndex = null;

    this.seq = 0;
    this.outbox = [];

    this.unobserveVault = null;
    this.noteObservers = new Map();
  }

  progress(detail = {}) {
    emitSync2Progress({
      vaultId: this.vaultId,
      deviceId: this.deviceId,
      provider: this.remote?.constructor?.name || 'Sync',
      ...detail,
    });
  }

  async withVaultOutboxSuppressed(fn) {
    this.suppressVaultOutboxDepth++;

    try {
      return await fn();
    } finally {
      this.suppressVaultOutboxDepth = Math.max(
        0,
        this.suppressVaultOutboxDepth - 1
      );
    }
  }

  clearRemoteIndex() {
    this.remoteIndex = null;
  }

  async loadRemoteIndex({
    force = false,
  } = {}) {
    if (!force && this.remoteIndex) {
      return this.remoteIndex;
    }

    if (typeof this.remote?.index === 'function') {
      const entries = await this.remote.index();

      this.remoteIndex = Array.isArray(entries)
        ? entries
        : [];

      return this.remoteIndex;
    }

    this.remoteIndex = null;
    return null;
  }

  async listRemote(prefix = '') {
    const index = await this.loadRemoteIndex();

    if (index) {
      const cleanPrefix = String(prefix || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+/g, '/');

      return index
        .filter((entry) =>
          !cleanPrefix ||
          String(entry.path || '').startsWith(cleanPrefix)
        )
        .sort((a, b) => String(a.path).localeCompare(String(b.path)));
    }

    return this.remote.list(prefix);
  }

  async statRemote(path) {
    const index = await this.loadRemoteIndex();

    if (index) {
      const cleanPath = String(path || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+/g, '/');

      return index.find((entry) => entry.path === cleanPath) || null;
    }

    return this.remote.stat(path);
  }

  async commitSeq(seq) {
    this.seq = seq;
    await this.localState.set('seq', this.seq);
    await store.settings.set('sync2.seq', this.seq);
    return this.seq;
  }

  async catchUpSeqFromRemoteOwnObjects({
    force = false,
  } = {}) {
    if (this.remoteSeqCatchupDone && !force) return this.seq;

    let maxRemoteSeq = 0;

    try {
      const vaultUpdates = await this.listRemote(vaultUpdatesPrefix());

      for (const entry of vaultUpdates || []) {
        maxRemoteSeq = Math.max(
          maxRemoteSeq,
          seqFromRemoteObjectPath(entry.path, this.deviceId)
        );
      }
    } catch (err) {
      console.warn('[YANTA Sync2] could not list vault update seq', err);
    }

    try {
      const vaultSnapshots = await this.listRemote(vaultSnapshotsPrefix());

      for (const entry of vaultSnapshots || []) {
        maxRemoteSeq = Math.max(
          maxRemoteSeq,
          seqFromRemoteObjectPath(entry.path, this.deviceId)
        );
      }
    } catch (err) {
      console.warn('[YANTA Sync2] could not list vault snapshot seq', err);
    }

    if (maxRemoteSeq > this.seq) {
      await this.commitSeq(maxRemoteSeq);
    }

    this.remoteSeqCatchupDone = true;

    return this.seq;
  }

  markUploadRateLimited(err) {
    const retryMs =
      Number(err?.retryAfterMs || 0) > 0
        ? Number(err.retryAfterMs)
        : 5 * 60 * 1000;

    this.uploadBlockedUntil = Date.now() + retryMs;

    this.progress({
      phase: 'error',
      status: 'error',
      direction: 'up',
      message: `Upload rate limited. Retrying in ${Math.ceil(retryMs / 1000)}s.`,
    });
  }

  markUploadBlocked(err) {
    if (err?.status === 429 || err?.code === 'ERATE_LIMIT') {
      this.markUploadRateLimited(err);
      return;
    }

    if (err?.code === 'EQUOTA') {
      const retryMs =
        Number(err?.retryAfterMs || 0) > 0
          ? Number(err.retryAfterMs)
          : 60 * 60 * 1000;

      this.uploadBlockedUntil = Date.now() + retryMs;

      this.progress({
        phase: 'error',
        status: 'error',
        direction: 'up',
        message: 'Cloud storage quota exceeded. Run cloud storage compaction or upgrade storage.',
      });

      return;
    }

    this.uploadBlockedUntil = 0;
  }

  assertUploadNotBlocked() {
    if (!this.uploadBlockedUntil) return;

    const waitMs = this.uploadBlockedUntil - Date.now();

    if (waitMs <= 0) {
      this.uploadBlockedUntil = 0;
      return;
    }

    const err = new Error(
      `Cloud upload is rate limited. Retrying in ${Math.ceil(waitMs / 1000)}s.`
    );

    err.code = 'ERATE_LIMIT';
    err.status = 429;
    err.retryAfterMs = waitMs;

    throw err;
  }

  async init() {
    await this.remote.init();
    await this.localState.init();
  
    this.keys = await deriveKeys(this.syncKey);
  
    this.seq = Number(await this.localState.get('seq', 0)) || 0;
  
    await this.ensureBootstrap();
    await this.ensureKeyCheck();

    await this.catchUpSeqFromRemoteOwnObjects();
  
    if (this.autoObserveNotes) {
      await this.observeAllKnownNotes();
    }
  }

  async start() {
    if (this.started) return;
  
    await this.init();
  
    this.observeVault();
  
    this.started = true;
  
    await this.updateDeviceRecord({
      lastOpenedAt: Date.now(),
      syncStatus: 'ready',
    });
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

    /*
      stop() cannot abort already running fetches, but it must make the
      engine reusable after a reload/debug stop. Existing in-flight promises
      may still settle, so normal production code should prefer page reload
      after manual stop during debugging.
    */
    this.started = false;
    this.syncing = false;
    this.uploading = false;
  }

  async hasSeen(path) {
    return this.localState.hasSeen(path);
  }

  async markSeen(path, extra = {}) {
    return this.localState.markSeen(path, extra);
  }

  async updateDeviceRecord(patch = {}, {
    queue = false,
  } = {}) {
    const doc = getVaultDoc();
    const devices = vaultDevicesMap();

    const existing = devices.get(this.deviceId) || {};
    const name = await getOrCreateDeviceName(this.deviceId);

    const next = cleanUndefined({
      ...safeJsonClone(existing),
      id: this.deviceId,
      name,
      current: true,
      provider: this.remote?.constructor?.name || 'remote',
      userAgent: navigator.userAgent || '',
      platform: navigator.userAgentData?.platform || navigator.platform || '',
      created: existing.created || Date.now(),
      updated: Date.now(),
      lastSeenAt: Date.now(),
      seq: this.seq,
      ...patch,
    });

    /*
      Default queue=false:
      Sync status / heartbeat / lastSeenAt must not cause remote writes.
      They are useful locally for UI, but if they are queued, each sync
      creates a new Vault update and therefore another sync cycle.
      
      Full snapshots still include this local device record because it is
      stored in the VaultDoc before encodeVaultState().
    */
    doc.transact(() => {
      devices.set(this.deviceId, next);
    }, queue ? SYNC2_LOCAL_ORIGIN : SYNC2_DEVICE_PRESENCE_ORIGIN);

    return next;
  }

  async ensureKeyCheck() {
    const path = keyCheckPath();
    const existing = await this.remote.stat(path);
  
    if (!existing) {
      const encrypted = await encryptBytes(
        this.keys.contentKey,
        utf8Encode('yanta-sync-key-ok-v1'),
        path
      );
  
      try {
        await this.remote.put(path, encrypted, { ifAbsent: true });
      } catch (err) {
        if (err?.code !== 'EEXIST') throw err;
      }
  
      return;
    }
  
    try {
      const encrypted = await this.remote.get(path);
  
      const plain = await decryptBytes(
        this.keys.contentKey,
        encrypted,
        path
      );
  
      const text = new TextDecoder().decode(plain);
  
      if (text !== 'yanta-sync-key-ok-v1') {
        throw new Error('Wrong Sync Key');
      }
    } catch (err) {
      const e = new Error(
        'Wrong Sync Key. Google Drive already contains encrypted YANTA Sync data that cannot be decrypted with this local key.'
      );
  
      e.code = 'EWRONGKEY';
      e.cause = err;
  
      throw e;
    }
  }

  observeVault() {
    if (this.unobserveVault) return;

    this.unobserveVault = onVaultUpdate((update, origin) => {
      if (origin === SYNC2_REMOTE_ORIGIN) return;
      if (origin === VAULT_ORIGINS.REMOTE) return;

      // Device heartbeat/status changes are local presence, not durable
      // user content. If we queue them, every sync creates another sync.
      if (origin === SYNC2_DEVICE_PRESENCE_ORIGIN) return;

      /*
        Wichtig:
        Während Remote-Hydration/Persistenz schreiben wir lokale IndexedDB-
        Caches neu. Der Store-Bridge kann daraus VaultDoc-Updates mit
        origin sync2-store-bridge erzeugen. Diese Updates sind aber nur
        Nebenwirkungen des Pulls und dürfen NICHT wieder hochgeladen werden.
      */
      if (this.suppressVaultOutboxDepth > 0) return;

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

  async applyOutboxUploadMarkers(item) {
    const markers = Array.isArray(item?.afterUploadLocalStateSet)
      ? item.afterUploadLocalStateSet
      : [];

    if (!markers.length) return;

    for (const marker of markers) {
      if (!marker?.key) continue;

      try {
        await this.localState.set(marker.key, marker.value);
      } catch (err) {
        console.warn('[YANTA Sync2] could not apply upload marker', marker, err);
      }
    }
  }

  async queueChangedLocalStateUpdates({
    reason = 'sync',
    maxNoteFullUpdates = 120,
  } = {}) {
    /*
      Reliability layer:
      Observers only capture updates that happen after observeVault()/observeNote()
      are installed. If a note or vault metadata changed before the engine was
      observing it, the delta may never enter outbox.

      Therefore, before each sync, queue full update packs for local content whose
      local version is newer than the last successfully uploaded full-update marker.

      These are NOT snapshots. They go through the normal update-pack path, so
      remote routine sync with pullSnapshots=false still receives them via
      downloadNoteUpdates()/downloadVaultUpdates().
    */

    await this.observeAllKnownNotes();

    const {
      markerKey: vaultMarkerKey,
      fingerprint: vaultFingerprint,
      lastFingerprint: lastVaultFingerprint,
    } = await currentVaultFingerprintMarker(this.localState);

    let vaultQueued = false;

    if (
      vaultFingerprint &&
      vaultFingerprint !== lastVaultFingerprint &&
      !outboxHasUploadMarker(this.outbox, vaultMarkerKey, vaultFingerprint)
    ) {
      this.outbox.push({
        kind: 'vault',
        update: encodeVaultState(),
        created: Date.now(),
        full: true,
        reason,
        afterUploadLocalStateSet: [
          {
            key: vaultMarkerKey,
            value: vaultFingerprint,
          },
        ],
      });

      vaultQueued = true;

      this.progress({
        phase: 'uploadOutbox',
        direction: 'up',
        message: 'Queued full vault metadata update.',
      });
    }

    const noteIds = new Set();

    for (const id of state.notes.keys()) noteIds.add(id);
    for (const id of vaultNotesMap().keys()) noteIds.add(id);

    let queuedNotes = 0;

    for (const noteId of noteIds) {
      if (!noteId) continue;
      if (vaultTombstonesMap().has(noteId)) continue;

      const note =
        state.notes.get(noteId) ||
        vaultNotesMap().get(noteId);

      const version = sync2ObjectVersion(note);

      if (!version) continue;

      const markerKey = `sync2.fullUpdateUploaded.note.${noteId}.version`;
      const lastVersion =
        Number(await this.localState.get(markerKey, 0)) || 0;

      if (version <= lastVersion) continue;

      if (outboxHasUploadMarker(this.outbox, markerKey, version)) {
        continue;
      }

      if (queuedNotes >= maxNoteFullUpdates) {
        this.progress({
          phase: 'uploadOutbox',
          direction: 'up',
          message: `Queued ${queuedNotes} changed note full updates. Remaining notes will be queued on next sync.`,
        });

        break;
      }

      try {
        await this.observeNote(noteId);

        this.outbox.push({
          kind: 'note',
          noteId,
          update: encodeNoteState(noteId),
          created: Date.now(),
          full: true,
          reason,
          afterUploadLocalStateSet: [
            {
              key: markerKey,
              value: version,
            },
          ],
        });

        queuedNotes++;
      } catch (err) {
        console.warn('[YANTA Sync2] could not queue full note update', noteId, err);
      }
    }

    if (queuedNotes > 0) {
      this.progress({
        phase: 'uploadOutbox',
        direction: 'up',
        message: `Queued ${queuedNotes} changed note update${queuedNotes === 1 ? '' : 's'}.`,
      });
    }

    return {
      vaultQueued,
      noteQueued: queuedNotes,
    };
  }

  async pushFullStateNow({
    includeSnapshots = true,
    verbose = true,
  } = {}) {
    await this.start();

    this.progress({
      phase: 'start',
      direction: 'up',
      detailed: true,
      message: 'Preparing full encrypted snapshot…',
    });

    const ids = new Set();

    for (const id of state.notes.keys()) ids.add(id);
    for (const id of vaultNotesMap().keys()) ids.add(id);

    const noteIds = [...ids].filter((noteId) => !vaultTombstonesMap().has(noteId));

    if (includeSnapshots) {
      this.progress({
        phase: 'uploadVaultSnapshot',
        direction: 'up',
        current: 0,
        total: 1,
      });

      await uploadVaultSnapshot(this);

      this.progress({
        phase: 'uploadVaultSnapshot',
        direction: 'up',
        current: 1,
        total: 1,
      });

      let i = 0;

      for (const noteId of noteIds) {
        i++;

        this.progress({
          phase: 'uploadNoteSnapshots',
          direction: 'up',
          current: i,
          total: noteIds.length,
          noteId,
        });

        await this.observeNote(noteId);
        await uploadNoteSnapshot(this, noteId);
      }

      this.progress({
        phase: 'uploadAssets',
        direction: 'up',
        detailed: true,
        message: 'Checking image and drawing assets…',
      });

      await uploadMissingAssets(this);
    } else {
      this.outbox.push({
        kind: 'vault',
        update: encodeVaultState(),
        created: Date.now(),
        full: true,
      });

      let i = 0;

      for (const noteId of noteIds) {
        i++;

        this.progress({
          phase: 'uploadNoteSnapshots',
          direction: 'up',
          current: i,
          total: noteIds.length,
          noteId,
        });

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

      this.progress({
        phase: 'uploadAssets',
        direction: 'up',
        detailed: true,
        message: 'Checking image and drawing assets…',
      });

      await uploadMissingAssets(this);
    }

    this.progress({
      phase: 'finalize',
      direction: 'up',
      message: 'Uploading final device state…',
    });

    await this.uploadOutbox();

    this.progress({
      phase: 'complete',
      status: 'done',
      direction: 'up',
      message: 'Full encrypted snapshot uploaded.',
    });

    if (verbose) {
      toast('Sync: full state snapshot pushed', 'success');
    }

    return this.status();
  }

  async syncNow({
    verbose = true,
    pullSnapshots = true,
  } = {}) {
    await this.start();
  
    this.clearRemoteIndex();

    this.progress({
      phase: 'init',
      message: 'Loading remote index…',
    });

    await this.loadRemoteIndex({
      force: true,
    });

    this.progress({
      phase: 'start',
      message: 'Starting sync…',
    });

    if (this.syncing) return this.status();
  
    this.syncing = true;
    state.globalSyncStatus = 'syncing';
  
    let vaultUpdates = {
      applied: 0,
    };
  
    let noteUpdates = {
      applied: 0,
    };

    const appliedRemoteNoteBodyIds = new Set();
  
    try {
      await this.updateDeviceRecord({
        syncStatus: 'syncing',
        lastSyncStartedAt: Date.now(),
        lastSeenAt: Date.now(),
        lastError: '',
      });

      await this.queueChangedLocalStateUpdates({
        reason: 'syncNow',
      });

      this.progress({
        phase: 'uploadOutbox',
        direction: 'up',
        message: 'Uploading queued changes…',
      });
  
      const firstPush = await this.uploadOutbox();
  
      if (firstPush.uploaded > 0) {
        // Queue this info for the final upload. Do not immediately upload again.
        await this.updateDeviceRecord({
          lastPushAt: Date.now(),
          lastPushCount: firstPush.uploaded,
        });
      }
  
      if (pullSnapshots) {

        this.progress({
          phase: 'downloadVaultSnapshots',
          direction: 'down',
          message: 'Checking vault snapshots…',
        });

        const vaultSnapshots = await downloadVaultSnapshots(this);
  
        if (vaultSnapshots.applied > 0) {
          await this.updateDeviceRecord({
            lastPullAt: Date.now(),
            lastPullCount: vaultSnapshots.applied,
          });
        }
      }
  
      this.progress({
        phase: 'downloadVaultUpdates',
        direction: 'down',
        message: 'Checking vault updates…',
      });

      vaultUpdates = await this.downloadVaultUpdates();
  
      if (vaultUpdates.applied > 0) {
        await this.updateDeviceRecord({
          lastPullAt: Date.now(),
          lastPullCount: vaultUpdates.applied,
        });
      }
  
      await this.withVaultOutboxSuppressed(async () => {
        this.hydrateAppStateFromVault();
        await this.persistVaultMetadataToLocalCache();

        this.progress({
          phase: 'downloadAssets',
          direction: 'down',
          message: 'Checking missing assets…',
        });

        await downloadMissingAssets(this);
      });
  
      await this.observeAllKnownNotes();
  
      if (pullSnapshots) {

        this.progress({
          phase: 'downloadNoteSnapshots',
          direction: 'down',
          message: 'Checking note snapshots…',
        });

        const noteSnapshots = await this.downloadKnownNoteSnapshots();

        for (const noteId of noteSnapshots.noteIds || []) {
          appliedRemoteNoteBodyIds.add(noteId);
        }
  
        if (noteSnapshots.applied > 0) {
          await this.updateDeviceRecord({
            lastPullAt: Date.now(),
            lastPullCount:
              Number(vaultUpdates?.applied || 0) +
              Number(noteSnapshots?.applied || 0),
          });
        }
      }
  
      this.progress({
        phase: 'downloadNoteUpdates',
        direction: 'down',
        message: 'Checking note updates…',
      });

      noteUpdates = await this.downloadKnownNoteUpdates();

      for (const noteId of noteUpdates.noteIds || []) {
        appliedRemoteNoteBodyIds.add(noteId);
      }
  
      if (noteUpdates.applied > 0) {
        await this.updateDeviceRecord({
          lastPullAt: Date.now(),
          lastPullCount:
            Number(vaultUpdates?.applied || 0) +
            Number(noteUpdates?.applied || 0),
        });
      }
  
      await this.withVaultOutboxSuppressed(async () => {
        this.hydrateAppStateFromVault();
        await this.persistVaultMetadataToLocalCache();

        this.progress({
          phase: 'downloadAssets',
          direction: 'down',
          message: 'Checking missing assets…',
        });

        await downloadMissingAssets(this);
      });

      if (appliedRemoteNoteBodyIds.size > 0) {
        await this.notifyRemoteNoteBodiesApplied(appliedRemoteNoteBodyIds, {
          reason: 'sync2-note-bodies-pulled',
        });
      }
  
      await this.updateDeviceRecord({
        syncStatus: 'synced',
        lastSyncAt: Date.now(),
        lastSeenAt: Date.now(),
        lastError: '',
        lastErrorAt: null,
      });
  
      const finalPush = await this.uploadOutbox();
  
      if (finalPush.uploaded > 0) {
        // Do not call updateDeviceRecord here again, otherwise it would queue
        // another vault update directly after the final upload.
        // The next sync cycle will update lastPushCount again if needed.
      }
  
      await uploadMissingAssets(this);
  
      state.globalSyncStatus = 'synced';
  
      if (verbose) {
        toast('Sync complete', 'success');
      }
  
      this.progress({
        phase: 'complete',
        status: 'done',
        message: 'Sync complete.',
      });

      return this.status();
    } catch (err) {
      console.error('Sync2 sync failed', err);

      this.progress({
        phase: 'error',
        status: 'error',
        message: err?.message || String(err),
      });
  
      state.globalSyncStatus = 'conflict';
  
      await this.updateDeviceRecord({
        syncStatus: 'error',
        lastError: err?.message || String(err),
        lastErrorAt: Date.now(),
        lastSeenAt: Date.now(),
      }).catch(() => {});
  
      /*
        Kein best-effort uploadOutbox bei Rate Limit.
        Sonst hämmert der Client nach einem 429 direkt weiter und erzeugt
        object?path=...00001202, 00001203, ...
      */
      if (
        err?.status !== 429 &&
        err?.code !== 'ERATE_LIMIT' &&
        err?.code !== 'EQUOTA'
      ) {
        try {
          await this.uploadOutbox();
        } catch {}
      }
  
      if (verbose) {
        toast('Sync2 failed: ' + (err?.message || String(err)), 'error');
      }
  
      throw err;
    } finally {
      this.syncing = false;
    }
  }

  async dropRedundantVaultOutboxUpdates() {
    /*
      Critical SaaS storage guard:
      VaultDoc can receive local no-op / volatile updates through observers
      before the routine sync fingerprint check runs.
      
      Example sources:
      - dashboard render/cache writes
      - note.updated-only body freshness
      - focus/sync status side effects
      - hydration side effects

      If the semantic durable Vault fingerprint is unchanged, queued Vault
      updates do not represent user data and must not be uploaded.
    */

    if (!Array.isArray(this.outbox) || !this.outbox.some((item) => item?.kind === 'vault')) {
      return {
        dropped: 0,
      };
    }

    const {
      fingerprint,
      lastFingerprint,
    } = await currentVaultFingerprintMarker(this.localState);

    if (!fingerprint || fingerprint !== lastFingerprint) {
      return {
        dropped: 0,
      };
    }

    const before = this.outbox.length;

    this.outbox = this.outbox.filter((item) => item?.kind !== 'vault');

    const dropped = before - this.outbox.length;

    if (dropped > 0) {
      this.progress?.({
        phase: 'uploadOutbox',
        direction: 'up',
        detailed: false,
        message: `Dropped ${dropped} redundant vault metadata update${dropped === 1 ? '' : 's'}.`,
      });
    }

    return {
      dropped,
    };
  }

  async tagVaultOutboxUpdatesWithCurrentFingerprint() {
    /*
      Direct VaultDoc observer updates do not necessarily carry the marker
      that queueChangedLocalStateUpdates() adds to full updates.

      If we upload a real Vault metadata update, mark the current semantic
      fingerprint as covered after upload. Otherwise the next routine sync
      may upload another full Vault update for the same state.
    */

    if (!Array.isArray(this.outbox) || !this.outbox.some((item) => item?.kind === 'vault')) {
      return;
    }

    const {
      markerKey,
      fingerprint,
    } = await currentVaultFingerprintMarker(this.localState);

    if (!fingerprint) return;

    for (const item of this.outbox) {
      if (item?.kind !== 'vault') continue;

      ensureOutboxMarker(item, markerKey, fingerprint);
    }
  }

  compactOutboxForUpload() {
    /*
      storage optimization:
      During editing, observers may queue many small Yjs updates. Uploading
      each as its own encrypted object creates unnecessary object count and
      history growth.

      Yjs updates for the same document are commutative and can be merged
      safely. We merge:
      - all queued Vault updates into one Vault update pack
      - all queued Note updates per noteId into one Note update pack

      This does NOT drop changes. It only reduces transport/object overhead.
    */

    if (!Array.isArray(this.outbox) || this.outbox.length < 2) {
      return {
        before: this.outbox?.length || 0,
        after: this.outbox?.length || 0,
        compacted: 0,
      };
    }

    const groups = new Map();
    const passthrough = [];

    const groupKeyFor = (item) => {
      if (item?.kind === 'vault') return 'vault';
      if (item?.kind === 'note' && item.noteId) return `note:${item.noteId}`;
      return '';
    };

    this.outbox.forEach((item, index) => {
      const key = groupKeyFor(item);

      if (!key) {
        passthrough.push({
          index,
          item,
        });
        return;
      }

      let group = groups.get(key);

      if (!group) {
        group = {
          key,
          firstIndex: index,
          kind: item.kind,
          noteId: item.noteId || null,
          items: [],
        };

        groups.set(key, group);
      }

      group.items.push(item);
    });

    const compactedEntries = [];

    for (const group of groups.values()) {
      if (group.items.length === 1) {
        compactedEntries.push({
          index: group.firstIndex,
          item: group.items[0],
        });

        continue;
      }

      const updates = group.items
        .map((item) => item.update)
        .filter((update) => update && update.byteLength);

      if (!updates.length) continue;

      const markers = [];

      for (const item of group.items) {
        if (Array.isArray(item.afterUploadLocalStateSet)) {
          markers.push(...item.afterUploadLocalStateSet);
        }
      }

      const reasons = [
        ...new Set(
          group.items
            .map((item) => item.reason)
            .filter(Boolean)
            .map(String)
        ),
      ];

      const mergedUpdate =
        updates.length === 1
          ? updates[0]
          : Y.mergeUpdates(updates);

      compactedEntries.push({
        index: group.firstIndex,
        item: {
          kind: group.kind,
          noteId: group.noteId || undefined,
          update: mergedUpdate,
          created: Math.min(...group.items.map((item) => Number(item.created || Date.now()))),
          full: group.items.some((item) => item.full === true),
          reason: reasons.length ? reasons.join('+') : undefined,
          afterUploadLocalStateSet: markers.length ? markers : undefined,
          coalesced: group.items.length,
        },
      });
    }

    const next = [
      ...compactedEntries,
      ...passthrough,
    ]
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.item);

    const before = this.outbox.length;
    const after = next.length;

    this.outbox = next;

    if (before !== after) {
      this.progress?.({
        phase: 'uploadOutbox',
        direction: 'up',
        detailed: false,
        message: `Coalesced ${before} queued changes into ${after} upload pack${after === 1 ? '' : 's'}.`,
      });
    }

    return {
      before,
      after,
      compacted: before - after,
    };
  }

  async uploadOutbox() {
    if (this.uploading) {
      return {
        uploaded: 0,
        busy: true,
      };
    }

    this.assertUploadNotBlocked();

    this.uploading = true;

    try {
      await this.catchUpSeqFromRemoteOwnObjects();

      /*
        Important:
        Some code paths can still create VaultDoc updates for volatile/no-op
        metadata changes. Drop them right before upload if the durable Vault
        fingerprint did not change.
      */
      await this.dropRedundantVaultOutboxUpdates();

      this.compactOutboxForUpload();

      /*
        If a real Vault update remains, tag it with the current semantic
        fingerprint so future routine syncs know this Vault state is covered.
      */
      await this.tagVaultOutboxUpdatesWithCurrentFingerprint();

      let uploaded = 0;

      const total = this.outbox.length;
      let processed = 0;

      if (total > 0) {
        this.progress({
          phase: 'uploadOutbox',
          direction: 'up',
          current: 0,
          total,
        });
      }

      while (this.outbox.length) {
        this.assertUploadNotBlocked();

        /*
          Nicht shift() bevor der Upload erfolgreich war.
          Bei 429/Netzwerkfehler bleibt das Item in der Outbox.
        */
        const item = this.outbox[0];
        processed++;

        /*
          New vault items may have been appended while uploadOutbox() is
          already running. Apply the same redundant-update guard per item.
        */
        if (item.kind === 'vault') {
          const {
            markerKey,
            fingerprint,
            lastFingerprint,
          } = await currentVaultFingerprintMarker(this.localState);

          if (fingerprint && fingerprint === lastFingerprint) {
            this.outbox.shift();

            this.progress({
              phase: 'uploadOutbox',
              direction: 'up',
              current: Math.min(processed, total),
              total,
              message: 'Skipped redundant vault metadata update.',
            });

            continue;
          }

          if (fingerprint) {
            ensureOutboxMarker(item, markerKey, fingerprint);
          }
        }
        
        if (item.kind === 'note' && vaultTombstonesMap().has(item.noteId)) {
          this.outbox.shift();

          this.progress({
            phase: 'uploadOutbox',
            direction: 'up',
            current: Math.min(processed, total),
            total,
            noteId: item.noteId || null,
            message: 'Skipped tombstoned note update.',
          });

          continue;
        }

        const seq = this.seq + 1;

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
          this.outbox.shift();
          throw new Error(`Unknown outbox item kind: ${item.kind}`);
        }

        this.progress({
          phase: 'uploadOutbox',
          direction: 'up',
          current: Math.min(processed, total),
          total,
          noteId: item.noteId || null,
          message: item.kind === 'vault'
            ? 'Uploading vault update…'
            : 'Uploading note update…',
        });

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
          this.clearRemoteIndex();

          await this.commitSeq(seq);

          await this.markSeen(path, {
            type: item.kind + '-update',
            own: true,
          });

          await this.applyOutboxUploadMarkers(item);

          this.outbox.shift();
          uploaded++;
        } catch (err) {
          if (err?.code === 'EEXIST') {
            /*
              Remote hat diese Sequenz schon. Das passiert nach alten
              fehlgeschlagenen/retry-lastigen Sessions. Seq committen,
              Item aus Outbox entfernen und weiter.
            */
            await this.commitSeq(seq);

            await this.markSeen(path, {
              type: item.kind + '-update',
              own: true,
              existedRemote: true,
            });

            await this.applyOutboxUploadMarkers(item);

            this.outbox.shift();
            continue;
          }

          if (
            err?.status === 429 ||
            err?.code === 'ERATE_LIMIT' ||
            err?.code === 'EQUOTA'
          ) {
            this.markUploadBlocked(err);
          }

          throw err;
        }
      }

      if (total > 0) {
        this.progress({
          phase: 'uploadOutbox',
          direction: 'up',
          current: total,
          total,
          message: `${uploaded} update${uploaded === 1 ? '' : 's'} uploaded.`,
        });
      }

      return { uploaded };
    } finally {
      this.uploading = false;
    }
  }

  async downloadVaultUpdates() {
    const entries = await this.listRemote(vaultUpdatesPrefix());

    let applied = 0;
    let processed = 0;

    this.progress({
      phase: 'downloadVaultUpdates',
      direction: 'down',
      current: 0,
      total: entries.length,
    });

    for (const entry of entries) {
      processed++;

      if (await this.hasSeen(entry.path)) {
        this.progress({
          phase: 'downloadVaultUpdates',
          direction: 'down',
          current: processed,
          total: entries.length,
          message: 'Already seen.',
        });

        continue;
      }

      this.progress({
        phase: 'downloadVaultUpdates',
        direction: 'down',
        current: processed,
        total: entries.length,
        message: 'Downloading vault update…',
      });

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

    const noteIds = [...ids].filter((noteId) => !vaultTombstonesMap().has(noteId));

    let applied = 0;
    let processed = 0;
    const appliedNoteIds = new Set();

    this.progress({
      phase: 'downloadNoteSnapshots',
      direction: 'down',
      current: 0,
      total: noteIds.length,
    });

    for (const noteId of noteIds) {
      processed++;

      this.progress({
        phase: 'downloadNoteSnapshots',
        direction: 'down',
        current: processed,
        total: noteIds.length,
        noteId,
      });

      const res = await downloadNoteSnapshots(this, noteId);

      applied += res.applied;

      if (res.applied > 0) {
        appliedNoteIds.add(noteId);
      }
    }

    return {
      applied,
      noteIds: [...appliedNoteIds],
    };
  }

  async downloadKnownNoteUpdates() {
    const ids = new Set();

    for (const id of state.notes.keys()) ids.add(id);
    for (const id of vaultNotesMap().keys()) ids.add(id);

    const noteIds = [...ids].filter((noteId) => !vaultTombstonesMap().has(noteId));

    let applied = 0;
    let processed = 0;
    const appliedNoteIds = new Set();

    this.progress({
      phase: 'downloadNoteUpdates',
      direction: 'down',
      current: 0,
      total: noteIds.length,
    });

    for (const noteId of noteIds) {
      processed++;

      this.progress({
        phase: 'downloadNoteUpdates',
        direction: 'down',
        current: processed,
        total: noteIds.length,
        noteId,
      });

      const res = await this.downloadNoteUpdates(noteId);

      applied += res.applied;

      if (res.applied > 0) {
        appliedNoteIds.add(noteId);
      }
    }

    return {
      applied,
      noteIds: [...appliedNoteIds],
    };
  }

  async downloadNoteUpdates(noteId) {
    const prefix = await docUpdatesPrefix(this.keys.nameKey, noteId);
    const entries = await this.listRemote(prefix);

    this.progress({
      phase: 'downloadNoteUpdates',
      direction: 'down',
      noteId,
      total: entries.length,
      current: 0,
    });

    if (!entries.length) {
      return {
        noteId,
        applied: 0,
        entries: 0,
      };
    }

    await this.observeNote(noteId);

    const { doc } = getNoteDoc(noteId);

    let processed = 0;
    let appliedPacks = 0;

    const updatesToApply = [];
    const seenToMark = [];

    for (const entry of entries) {
      processed++;

      this.progress({
        phase: 'downloadNoteUpdates',
        direction: 'down',
        noteId,
        current: processed,
        total: entries.length,
      });

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

      for (const update of pack.updates || []) {
        if (update?.byteLength) {
          updatesToApply.push(update);
        }
      }

      seenToMark.push({
        path: entry.path,
        entry,
      });

      appliedPacks++;
    }

    /*
      UX/performance:
      Apply all unseen note updates as ONE merged Yjs update.
      This prevents the remote UI from visibly replaying individual
      keystrokes after sync.
    */
    if (updatesToApply.length) {
      const merged = updatesToApply.length === 1
        ? updatesToApply[0]
        : Y.mergeUpdates(updatesToApply);

      Y.applyUpdate(doc, merged, SYNC2_REMOTE_ORIGIN);
    }

    for (const item of seenToMark) {
      await this.markSeen(item.path, {
        type: 'note-update',
        noteId,
        size: item.entry.size,
        etag: item.entry.etag,
      });
    }

    return {
      noteId,
      applied: appliedPacks,
      entries: entries.length,
    };
  }

  async notifyRemoteNoteBodiesApplied(noteIds, {
    reason = 'sync2-note-bodies-applied',
  } = {}) {
    const ids = [...new Set([...noteIds || []].map(String))]
      .filter((id) => id && state.notes.has(id));

    if (!ids.length) return;

    const remoteBodyAppliedAt = Date.now();
    const localMetadataWrites = [];

    for (const noteId of ids) {
      const note = state.notes.get(noteId);
      if (!note) continue;

      let md = '';

      try {
        md = noteMarkdown(noteId);
      } catch {}

      state.searchIndex.set(
        noteId,
        [
          note.title || '',
          (note.tags || []).join(' '),
          md || '',
        ].join(' ').toLowerCase()
      );

      /*
        Keep local UI/cache freshness on devices that pulled remote body
        changes. This updated-only store write is safe because store-bridge
        now ignores volatile-only VaultDoc changes.
      */
      const nextUpdated = Math.max(
        Number(note.updated || 0),
        remoteBodyAppliedAt
      );

      if (nextUpdated !== Number(note.updated || 0)) {
        note.updated = nextUpdated;

        localMetadataWrites.push(
          store.notes.put(safeJsonClone(note)).catch((err) => {
            console.warn('[YANTA Sync2] could not update pulled note timestamp', noteId, err);
          })
        );
      }
    }

    if (localMetadataWrites.length) {
      await Promise.all(localMetadataWrites);
    }

    try {
      rebuildWikilinkIndex();
    } catch {}

    try {
      renderTree();
    } catch {}

    for (const noteId of ids) {
      window.dispatchEvent(new CustomEvent('yanta-note-updated', {
        detail: {
          noteId,
          reason,
          source: 'sync2',
        },
      }));

      window.dispatchEvent(new CustomEvent('yanta-calendar-markdown-changed', {
        detail: {
          noteId,
          reason,
          source: 'sync2',
        },
      }));
    }

    window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
      detail: {
        reason,
        source: 'sync2',
        changed: true,
        noteIds: ids,
      },
    }));
  }

  hydrateAppStateFromVault() {
    const tombstones = vaultTombstonesMap();

    let changed = false;

    // Tombstones first.
    for (const [id, t] of tombstones) {
      const type = t?.type;

      if (type === 'note') {
        if (state.notes.has(id) || state.searchIndex.has(id)) {
          changed = true;
        }

        state.notes.delete(id);
        state.searchIndex.delete(id);
      } else if (type === 'folder') {
        if (state.folders.has(id) || state.expandedFolders.has(id)) {
          changed = true;
        }

        state.folders.delete(id);
        state.expandedFolders.delete(id);
      } else if (type === 'image') {
        if (state.imagesMeta.has(id) || state.imageBlobs.has(id)) {
          changed = true;
        }

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
        const next = safeJsonClone(incoming);

        if (!jsonEqualForSync2(existing, next)) {
          changed = true;
        }

        state.notes.set(id, next);
      }
    }

    // Folders.
    for (const [id, raw] of vaultFoldersMap()) {
      if (tombstones.has(id)) continue;

      const incoming = sanitizeFolderMeta(raw);
      if (!incoming?.id) continue;

      const existing = state.folders.get(id);

      if (preferIncoming(existing, incoming)) {
        const next = safeJsonClone(incoming);

        if (!jsonEqualForSync2(existing, next)) {
          changed = true;
        }

        state.folders.set(id, next);
      }
    }

    // Images metadata only; blobs come later through asset sync.
    for (const [id, raw] of vaultImagesMap()) {
      if (tombstones.has(id)) continue;

      const incoming = sanitizeImageMeta(raw);
      if (!incoming?.id) continue;

      const existing = state.imagesMeta.get(id);

      if (preferIncoming(existing, incoming)) {
        const next = safeJsonClone(incoming);

        if (!jsonEqualForSync2(existing, next)) {
          changed = true;
        }

        state.imagesMeta.set(id, next);
      }
    }

    if (changed) {
      rebuildWikilinkIndex();
      renderTree();
    }

    window.dispatchEvent(new CustomEvent('yanta-vault-hydrated', {
      detail: {
        source: 'sync',
        changed,
      },
    }));

    const current = state.currentNoteId
      ? state.notes.get(state.currentNoteId)
      : null;

    if (current) {
      const titleEl = $('noteTitle');

      if (titleEl && titleEl.value !== (current.title || '')) {
        titleEl.value = current.title || '';
      }
    }

    return {
      changed,
    };
  }

  async persistVaultMetadataToLocalCache() {
    const tombstones = vaultTombstonesMap();
  
    for (const [id, t] of tombstones) {
      if (t?.type === 'note') {
        state.notes.delete(id);
        state.searchIndex.delete(id);
  
        try {
          await store.notes.del(id);
        } catch {}
      }
  
      if (t?.type === 'folder') {
        state.folders.delete(id);
        state.expandedFolders.delete(id);
  
        try {
          await store.folders.del(id);
        } catch {}
      }
  
      if (t?.type === 'image') {
        state.imagesMeta.delete(id);
  
        const url = state.imageBlobs.get(id);
  
        if (url) {
          try {
            URL.revokeObjectURL(url);
          } catch {}
        }
  
        state.imageBlobs.delete(id);
  
        try {
          await store.images.del(id);
        } catch {}
      }
    }
  
    for (const [id, raw] of vaultNotesMap()) {
      if (tombstones.has(id)) continue;
  
      const incoming = sanitizeNoteMeta(raw);
      if (!incoming?.id) continue;
  
      const existingState = state.notes.get(id);
      const nextNote = safeJsonClone(incoming);

      state.notes.set(id, nextNote);

      if (!jsonEqualForSync2(existingState, nextNote)) {
        try {
          await store.notes.put(safeJsonClone(nextNote));
        } catch {}
      }
    }
  
    for (const [id, raw] of vaultFoldersMap()) {
      if (tombstones.has(id)) continue;
  
      const incoming = sanitizeFolderMeta(raw);
      if (!incoming?.id) continue;
  
      const existingState = state.folders.get(id);
      const nextFolder = safeJsonClone(incoming);

      state.folders.set(id, nextFolder);

      if (!jsonEqualForSync2(existingState, nextFolder)) {
        try {
          await store.folders.put(safeJsonClone(nextFolder));
        } catch {}
      }
    }
  
    for (const [id, raw] of vaultImagesMap()) {
      if (tombstones.has(id)) continue;
  
      const incoming = sanitizeImageMeta(raw);
      if (!incoming?.id) continue;
  
      state.imagesMeta.set(id, safeJsonClone(incoming));
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

export async function createSync2GoogleDriveAppRuntime({
  clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID,
  googlePrompt = '',
  stateDbName = 'yanta-sync2-state-google-drive',
} = {}) {
  if (!clientId) {
    throw new Error('Google Drive clientId missing');
  }

  const syncKey = await getOrCreateSyncKey();
  const deviceId = await getOrCreateDeviceId();

  const remote = new GoogleDriveObjectStore({
    clientId,
    initialPrompt: googlePrompt,
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
    provider: 'google-drive',

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

export async function createSync2YantaCloudAppRuntime({
  baseUrl = '',
  vaultId = '',
  stateDbName = 'yanta-sync2-state-yanta-cloud',
} = {}) {
  if (!vaultId) {
    throw new Error('YANTA Cloud vaultId missing');
  }

  const syncKey = await getOrCreateSyncKey();
  const deviceId = await getOrCreateDeviceId();

  const remote = new YantaCloudObjectStore({
    baseUrl,
    vaultId,
    deviceId,
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
    vaultId,
    provider: 'yanta-cloud',

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

    async status() {
      return engine.status();
    },
  };
}