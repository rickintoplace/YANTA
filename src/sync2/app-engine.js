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

import { $, state, store, toast, uid, isSpaceMountedNote, isPrivateItem, isPrivateCarrier } from '../core.js';
import { isNoteTitleFieldFocused, rebuildWikilinkIndex } from '../notes.js';
import { renderTree } from '../tree.js';

import {
  getNoteDoc,
  encodeNoteState,
  noteMarkdown,
  refreshLoadedNoteDocsFromStorage,
} from '../yjs.js';

import {
  getVaultDoc,
  encodeVaultState,
  encodeCompactVaultState,
  applyVaultUpdate,
  onVaultUpdate,
  vaultNotesMap,
  vaultFoldersMap,
  vaultImagesMap,
  vaultEventsMap,
  vaultCalendarCategoriesMap,
  vaultRssFeedsMap,
  vaultSpacesMap,
  vaultDevicesMap,
  vaultSettingsMap,
  VAULT_SYNCED_SETTING_KEYS,
  vaultTombstonesMap,
  vaultJsonSnapshot,
  VAULT_ORIGINS,
  safeJsonClone,
  refreshVaultDocFromStorage,
  isVaultPersistenceOrigin,
} from './vault-doc.js';

import { IndexedDBObjectStore } from './indexeddb-object-store.js';
import { Sync2LocalStateStore, createSeenBatch } from './state.js';
import { removeLocalSpaceRecordOnly } from './store-bridge.js';
import {
  sanitizeNoteMeta,
  sanitizeFolderMeta,
  sanitizeImageMeta,
} from './meta-sanitize.js';
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

import {
  uploadVaultHead,
  uploadNoteHead,
  downloadVaultHeads,
  downloadKnownNoteHeads,
  pruneSeenUpdatesCoveredByHeads,
  forgetSeenObjectsGoneFromRemote,
} from './heads.js';

import {
  uploadNotificationAckIfChanged,
  downloadNotificationAcks,
} from './notification-ack-sync.js';

import {
  mapOrdered,
  runSyncDownload,
  SYNC2_DOWNLOAD_CONCURRENCY,
  SYNC2_NOTE_CONCURRENCY,
} from './download-pool.js';

import {
  createVaultVersionCollector,
  collectVaultVersionsFromUpdate,
  reconcileVaultVersions,
} from './vault-version-guard.js';

export const SYNC2_REMOTE_ORIGIN = 'sync2-remote';
export const SYNC2_LOCAL_ORIGIN = 'sync2-local';

// Local-only device presence/status updates.
// These should NOT create remote update packs on every sync cycle.
export const SYNC2_DEVICE_PRESENCE_ORIGIN = 'sync2-device-presence';

// How often a device's coarse presence (lastSeenAt) may be written into the
// VaultDoc. Presence is called many times per sync; persisting each call grew
// the local CRDT history to megabytes and froze boot. 30 min keeps the
// device-list "last seen" useful while making history growth negligible.
const DEVICE_PRESENCE_PERSIST_MS = 30 * 60 * 1000;

/*
  One sync operation per origin at a time. Tabs (and an installed PWA
  window) share the device id, seq and seen-state through IndexedDB but
  each has its own in-memory VaultDoc and outbox; two of them syncing at
  once reused seq numbers, dropped their own updates as "already
  uploaded" and overwrote each other's heads.
*/
const SYNC2_LOCK_NAME = 'yanta-sync2';

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

const PREVIOUS_SYNC_KEY_SETTING = 'sync2.syncKey.previous';
const KEY_CHECK_PLAINTEXT = 'yanta-sync-key-ok-v1';

export async function setSync2SyncKey(syncKey) {
  syncKeyToBytes(syncKey);

  /*
    Keep the key being replaced. With zero knowledge nothing else can bring
    it back, and a mistaken import (wrong vault, wrong paste) would
    otherwise orphan everything encrypted with it.
  */
  const current = await storedSync2SyncKey();

  if (current && current !== syncKey) {
    await store.settings.set(PREVIOUS_SYNC_KEY_SETTING, {
      syncKey: current,
      replacedAt: Date.now(),
    });
  }

  await store.settings.set(SYNC_KEY_SETTING, syncKey);
  await store.settings.set(LEGACY_DEBUG_SYNC_KEY_SETTING, syncKey);

  return syncKey;
}

async function storedSync2SyncKey() {
  return (
    await store.settings.get(SYNC_KEY_SETTING, null) ||
    await store.settings.get(LEGACY_DEBUG_SYNC_KEY_SETTING, null) ||
    null
  );
}

/** True when this device already holds a sync key other than syncKey. */
export async function hasDifferentStoredSync2SyncKey(syncKey) {
  const current = await storedSync2SyncKey();
  return !!current && current !== syncKey;
}

function wrongSyncKeyError(cause = null) {
  const e = new Error(
    'Wrong Sync Key. This sync vault already contains encrypted YANTA data that this key cannot decrypt.'
  );

  e.code = 'EWRONGKEY';
  if (cause) e.cause = cause;

  return e;
}

/**
 * Check a sync key against a vault's key-check object, without storing
 * anything. Resolves 'match' or 'absent' (vault has no key check yet);
 * rejects with EWRONGKEY when the key cannot decrypt it. Any other error
 * (network, auth) propagates as is — it says nothing about the key.
 */
export async function checkSyncKeyAgainstRemote(remote, syncKey, {
  keys = null,
} = {}) {
  const path = keyCheckPath();
  const contentKey = (keys || await deriveKeys(syncKey)).contentKey;

  let encrypted;

  try {
    encrypted = await remote.get(path);
  } catch (err) {
    if (isMissingObjectError(err)) return 'absent';
    throw err;
  }

  let text = '';

  try {
    text = new TextDecoder().decode(await decryptBytes(contentKey, encrypted, path));
  } catch (err) {
    throw wrongSyncKeyError(err);
  }

  if (text !== KEY_CHECK_PLAINTEXT) {
    throw wrongSyncKeyError();
  }

  return 'match';
}

/** checkSyncKeyAgainstRemote for a YANTA Cloud vault. */
export async function verifyYantaCloudSyncKey({
  baseUrl = '',
  vaultId = '',
  syncKey,
} = {}) {
  syncKeyToBytes(syncKey);

  const remote = new YantaCloudObjectStore({
    baseUrl,
    vaultId,
    deviceId: await getOrCreateDeviceId(),
  });

  await remote.init();

  return checkSyncKeyAgainstRemote(remote, syncKey);
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

function seqFromRemoteObjectPath(path, deviceId) {
  const safeDevice = String(deviceId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const re = new RegExp(`${safeDevice}-(\\d{8,})\\.(?:ypack|ysnap)\\.enc$`);
  const m = String(path || '').match(re);

  if (!m) return 0;

  const n = Number(m[1]);

  return Number.isFinite(n) ? n : 0;
}

function isMissingObjectError(err) {
  return err?.code === 'ENOENT' || err?.status === 404;
}

function isObjectTooLargeError(err) {
  return (
    err?.status === 413 ||
    err?.code === 'EOBJECT_TOO_LARGE' ||
    err?.serverCode === 'object_too_large' ||
    /object_too_large|object too large|content too large/i.test(err?.message || '')
  );
}

async function readCacheById(cacheStore) {
  try {
    const rows = await cacheStore.all();
    return new Map((rows || []).map((row) => [row.id, row]));
  } catch {
    return new Map();
  }
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
  /*
    Timestamps must not define durable Vault metadata equality.

    Why:
    - note.updated changes on note body edits, but note bodies sync via note docs.
    - created/ts/deletedAt can be regenerated/imported/migrated without changing
      the durable meaning of the object.
    - If any timestamp is included here, routine sync can create infinite
      append-only Vault update history.
  */
  'created',
  'updated',
  'updatedAt',
  'savedAt',
  'ts',
  'deletedAt',

  /*
    Public share / publish state is not Vault metadata content.
    It is either local UI state or server-side publication state.
  */
  'publicShare',
  'share',
  'shareId',
  'shareKey',
  'url',
  'lastPublishedAt',
  'lastPayloadHash',
  'missingAssets',

  /*
    Device/presence/status fields must never make the durable vault dirty.
  */
  'lastSeenAt',
  'lastOpenedAt',
  'lastSyncStartedAt',
  'lastSyncAt',
  'lastPushAt',
  'lastPullAt',
  'lastPushCount',
  'lastPullCount',
  'lastError',
  'lastErrorAt',
  'syncStatus',
  'seq',
  'provider',
  'userAgent',
  'platform',
  'current',
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
 * - Devices are intentionally excluded (their notification acks sync as
 *   dedicated per-device objects — see notification-ack-sync.js).
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
    rssFeeds: {},
    spaces: {},
    tombstones: {},
    settings: {},
  };

  /*
    Every synced map must be in here: a vault update whose map is missing
    leaves the fingerprint unchanged, is dropped as "redundant" and never
    uploaded. Shared-space records (the only copy of their keys) were
    missing, so a new share reached other devices only if something else
    in the vault happened to change too.

    A partial snapshot could match the last uploaded fingerprint and get a
    real change skipped, so any failure yields no fingerprint at all.
  */
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

    for (const [id, feed] of vaultRssFeedsMap()) {
      snapshot.rssFeeds[id] = stripVolatileVaultFingerprintFields(feed);
    }

    for (const [id, space] of vaultSpacesMap()) {
      snapshot.spaces[id] = stripVolatileVaultFingerprintFields(space);
    }

    for (const [id, tombstone] of vaultTombstonesMap()) {
      snapshot.tombstones[id] = stripVolatileVaultFingerprintFields(tombstone);
    }

    for (const [key, value] of vaultSettingsMap()) {
      if (!VAULT_SYNCED_SETTING_KEYS.has(String(key))) continue;

      snapshot.settings[String(key)] =
        stripVolatileVaultFingerprintFields(value);
    }
  } catch (err) {
    console.warn('[YANTA Sync2] vault fingerprint unavailable', err);
    return '';
  }

  const stable = stableJsonStringifyForSync2(snapshot);
  const digest = await sha256(utf8Encode(stable));

  return `sha256:${base64UrlEncode(digest)}`;
}

export async function sync2NoteContentFingerprint(noteId) {
  if (!noteId) return '';

  try {
    const entry = getNoteDoc(noteId);
    await entry.ready;

    const update = encodeNoteState(noteId);
    const digest = await sha256(update);

    return `sha256:${base64UrlEncode(digest)}`;
  } catch {
    return '';
  }
}

function noteFingerprintMarkerKey(noteId) {
  return `sync2.fullUpdateUploaded.note.${noteId}.fingerprint`;
}

function legacyNoteVersionMarkerKey(noteId) {
  return `sync2.fullUpdateUploaded.note.${noteId}.version`;
}

async function readSync2Marker(localState, key, fallback = '') {
  let value = '';

  try {
    value = String(await localState.get(key, '') || '');
  } catch {}

  if (value) return value;

  /*
    Durable fallback:
    localState lives in the provider-specific Sync2 IndexedDB.
    store.settings lives in YANTA's normal DB and survives a wider range of
    runtime/provider state resets.

    For SaaS reliability, important upload coverage markers are mirrored.
  */
  try {
    value = String(await store.settings.get(key, '') || '');
  } catch {}

  if (value) {
    try {
      await localState.set(key, value);
    } catch {}

    return value;
  }

  return String(fallback || '');
}

async function writeSync2Marker(localState, key, value) {
  const clean = String(value ?? '');

  try {
    await localState.set(key, clean);
  } catch (err) {
    console.warn('[YANTA Sync2] could not write local marker', key, err);
  }

  try {
    await store.settings.set(key, clean);
  } catch (err) {
    console.warn('[YANTA Sync2] could not write settings marker', key, err);
  }

  return clean;
}

async function deleteSync2Marker(localState, key) {
  try {
    await localState.delete(key);
  } catch {}

  try {
    await store.settings.set(key, null);
  } catch {}
}

async function currentNoteFingerprintMarker(localState, noteId) {
  const fingerprint = await sync2NoteContentFingerprint(noteId);
  const markerKey = noteFingerprintMarkerKey(noteId);

  let lastFingerprint = await readSync2Marker(localState, markerKey, '');

  /*
    Migration compatibility:
    Older builds used note.updated timestamps as full-update markers.
    If that marker already covers the current metadata version, initialize
    the content fingerprint marker without uploading a redundant full note.
  */
  if (!lastFingerprint) {
    const note =
      state.notes.get(noteId) ||
      vaultNotesMap().get(noteId);

    const currentVersion = sync2ObjectVersion(note);

    const legacyVersion =
      Number(
        await readSync2Marker(
          localState,
          legacyNoteVersionMarkerKey(noteId),
          0
        )
      ) || 0;

    if (
      fingerprint &&
      currentVersion > 0 &&
      legacyVersion >= currentVersion
    ) {
      await writeSync2Marker(localState, markerKey, fingerprint);
      lastFingerprint = fingerprint;
    }
  }

  return {
    markerKey,
    fingerprint,
    lastFingerprint,
  };
}

const SYNC2_VAULT_FINGERPRINT_MARKER_KEY =
  'sync2.fullUpdateUploaded.vault.fingerprint';

const SYNC2_LEGACY_VAULT_VERSION_MARKER_KEY =
  'sync2.fullUpdateUploaded.vault.version';

const SYNC2_VAULT_HEAD_FINGERPRINT_MARKER_KEY =
  'sync2.headUploaded.vault.fingerprint';

function noteHeadFingerprintMarkerKey(noteId) {
  return `sync2.headUploaded.note.${noteId}.fingerprint`;
}

async function currentVaultFingerprintMarker(localState) {
  const fingerprint = await sync2LocalVaultContentFingerprint();

  let lastFingerprint =
    await readSync2Marker(
      localState,
      SYNC2_VAULT_FINGERPRINT_MARKER_KEY,
      ''
    );

  /*
    Migration compatibility:
    If an older timestamp marker already covers the current semantic vault
    version, initialize the new fingerprint marker without uploading anything.
  */
  if (!lastFingerprint) {
    const legacyLastVaultVersion =
      Number(
        await readSync2Marker(
          localState,
          SYNC2_LEGACY_VAULT_VERSION_MARKER_KEY,
          0
        )
      ) || 0;

    const currentVaultVersion = sync2LocalVaultContentVersion();

    if (
      fingerprint &&
      currentVaultVersion > 0 &&
      legacyLastVaultVersion >= currentVaultVersion
    ) {
      await writeSync2Marker(
        localState,
        SYNC2_VAULT_FINGERPRINT_MARKER_KEY,
        fingerprint
      );

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

    this.syncQueued = false;

    // path -> { reason, message, at } for objects downloads had to skip.
    this.skippedObjects = new Map();

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
    // Never move backwards: a reused seq collides with an existing object.
    this.seq = Math.max(this.seq, Number(seq) || 0);
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

    const message =
      'Cloud storage limit reached. Optimize cloud storage or upgrade to YANTA Plus.';

    this.progress({
      phase: 'error',
      status: 'error',
      direction: 'up',
      message,
    });

    try {
      window.dispatchEvent(new CustomEvent('yanta-cloud-quota-blocked', {
        detail: {
          message,
          status: err?.status || 403,
          code: err?.code || '',
          serverCode: err?.serverCode || '',
          response: err?.response || null,
          maxBytes: err?.response?.maxBytes || 0,
          maxObjects: err?.response?.maxObjects || 0,
          retryAfterMs: retryMs,
        },
      }));
    } catch {}

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

  /**
   * Run fn holding the origin-wide sync lock. Not reentrant: code running
   * under the lock calls the *Locked variants, never a public entry point.
   */
  async withSyncLock(fn) {
    const locks = globalThis.navigator?.locks;

    const run = async () => {
      await this.adoptSharedLocalState();
      return fn();
    };

    if (typeof locks?.request !== 'function') {
      return run();
    }

    return locks.request(SYNC2_LOCK_NAME, run);
  }

  /*
    Take over what other tabs of this origin did since this tab last held
    the lock: their seq, the paths they marked seen, and their local
    VaultDoc/note edits (persisted to IndexedDB, but not in this tab's
    in-memory docs).
  */
  async adoptSharedLocalState() {
    try {
      const storedSeq = Number(await this.localState.get('seq', 0)) || 0;

      if (storedSeq > this.seq) {
        this.seq = storedSeq;
      }

      await this.localState.reloadSeenCache?.();
    } catch (err) {
      console.warn('[YANTA Sync2] could not adopt shared sync state', err);
    }

    try {
      await refreshVaultDocFromStorage();
      await refreshLoadedNoteDocsFromStorage();
    } catch (err) {
      console.warn('[YANTA Sync2] could not refresh local docs from storage', err);
    }
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

    /*
      Defensive startup guard:
      Old builds may have left redundant Vault updates in memory before all
      observers/markers were fully stable. Drop them as soon as the engine starts.
    */
    await this.dropRedundantVaultOutboxUpdates().catch(() => {});
    await this.dropRedundantNoteOutboxUpdates().catch(() => {});
  
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

  /**
   * Vault version guard hook: download paths (heads, snapshots,
   * update packs) report every incoming vault payload here before
   * applying it, so reconcileVaultVersions() can restore entries
   * the CRDT merge left stale. No-op outside a pull cycle.
   */
  noteIncomingVaultBytes(bytes) {
    if (!this.activeVersionGuard) return;

    collectVaultVersionsFromUpdate(this.activeVersionGuard, bytes);
  }

  async hasSeen(path) {
    return this.localState.hasSeen(path);
  }

  async markSeen(path, extra = {}) {
    return this.localState.markSeen(path, extra);
  }

  async markManySeen(entries, extra = {}) {
    if (!entries?.length) return;
    return this.localState.markManySeen(entries, extra);
  }

  /*
    The latency-bound half of every download loop, isolated so it can be
    handed to the parallel pool. Decoding and applying stays with the
    caller, which keeps it sequential and in list order.
  */
  /*
    Returns null for an object that cannot be used, instead of throwing:
    - missing: listed, but deleted meanwhile (other devices prune their
      journals all the time, so this is routine with several devices);
    - unreadable: does not decrypt or decode (truncated upload, written
      with another key).
    One such object used to abort every sync before heads were uploaded,
    stalling the device for good. Callers skip null and do NOT mark the
    path seen — nothing was applied, so nothing may treat it as covered.
    Network errors still throw: they would hit every object alike.
  */
  async fetchAndDecrypt(path) {
    let encrypted;

    try {
      encrypted = await this.remote.get(path);
    } catch (err) {
      if (isMissingObjectError(err)) {
        this.noteSkippedObject(path, 'missing', err);
        return null;
      }

      throw err;
    }

    try {
      return await decryptBytes(
        this.keys.contentKey,
        encrypted,
        path
      );
    } catch (err) {
      this.noteSkippedObject(path, 'unreadable', err);
      return null;
    }
  }

  noteSkippedObject(path, reason, err = null) {
    const known = this.skippedObjects.get(path);

    this.skippedObjects.set(path, {
      reason,
      message: err?.message || String(err || ''),
      at: Date.now(),
    });

    if (!known && reason !== 'missing') {
      console.warn(`[YANTA Sync2] skipped ${reason} remote object`, path, err);
    }
  }

  decodePackOrSkip(path, plain) {
    try {
      return decodePack(plain);
    } catch (err) {
      this.noteSkippedObject(path, 'unreadable', err);
      return null;
    }
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

    // Freshest record is always available in memory for local UI, even when we
    // decide not to persist it below.
    this.localDeviceRecord = next;

    /*
      Presence/status must not accumulate CRDT history.

      updateDeviceRecord is called many times per sync cycle (status
      transitions, lastSeenAt, seq). Every Yjs write is persisted locally by
      y-indexeddb regardless of origin, so writing on each call grew the
      VaultDoc history to megabytes and froze boot for ~17s while y-indexeddb
      replayed it. These fields never sync as update packs anyway
      (SYNC2_DEVICE_PRESENCE_ORIGIN is excluded from the outbox).

      So only touch the persisted Yjs record when it actually matters:
        - an explicit durable/queued write,
        - a durable identity field changed (name, created, …),
        - the device record does not exist yet, or
        - the coarse presence-heartbeat window elapsed, so full snapshots still
          carry a roughly-current lastSeenAt for the device-list UI.
      Otherwise the update stays in memory only.
    */
    const durableChanged =
      stableJsonStringifyForSync2(stripVolatileVaultFingerprintFields(existing)) !==
      stableJsonStringifyForSync2(stripVolatileVaultFingerprintFields(next));

    const heartbeatDue =
      (Date.now() - Number(existing.lastSeenAt || 0)) > DEVICE_PRESENCE_PERSIST_MS;

    const shouldPersist =
      queue || durableChanged || heartbeatDue || !devices.has(this.deviceId);

    if (shouldPersist) {
      /*
        Full snapshots still include this local device record because it is
        stored in the VaultDoc before encodeVaultState().
      */
      doc.transact(() => {
        devices.set(this.deviceId, next);
      }, queue ? SYNC2_LOCAL_ORIGIN : SYNC2_DEVICE_PRESENCE_ORIGIN);
    }

    return next;
  }

  /*
    Only a key that fails to decrypt the key check is a wrong key. A failed
    download used to be reported as one too — right next to the button
    that deletes the cloud vault.
  */
  async ensureKeyCheck() {
    const status = await checkSyncKeyAgainstRemote(this.remote, this.syncKey, {
      keys: this.keys,
    });

    if (status === 'match') return;

    const path = keyCheckPath();

    const encrypted = await encryptBytes(
      this.keys.contentKey,
      utf8Encode(KEY_CHECK_PLAINTEXT),
      path
    );

    try {
      await this.remote.put(path, encrypted, { ifAbsent: true });
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;

      // Another device created it first: this key must still match it.
      await checkSyncKeyAgainstRemote(this.remote, this.syncKey, {
        keys: this.keys,
      });
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

      // Notification acks travel as dedicated per-device objects
      // (notification-ack-sync.js), never as vault update packs.
      if (origin === 'native-notification-ack') return;

      // Another tab's edits, read back from IndexedDB. That tab uploads
      // them; if it never does, this tab's head and the fingerprint
      // markers still carry them.
      if (isVaultPersistenceOrigin(origin)) return;

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

    for (const [id, note] of state.notes) if (!isPrivateItem(note)) ids.add(id);
    for (const id of vaultNotesMap().keys()) ids.add(id);

    for (const id of ids) {
      await this.observeNote(id);
    }
  }

  async observeNote(noteId) {
    if (!noteId || this.noteObservers.has(noteId)) return;

    // Space-mounted notes are synced by their SpaceEngine — keeping
    // them out here prevents shared content from leaking into the
    // user's private vault storage.
    if (isSpaceMountedNote(state.notes.get(noteId))) return;
    // Notes of a private folder travel only sealed, in its carrier.
    if (isPrivateItem(state.notes.get(noteId))) return;

    const entry = getNoteDoc(noteId);
    await entry.ready;

    /*
      Re-check after the await: the per-note download loops run several
      notes concurrently, so a second call for the same note can arrive
      while this one waits for IndexedDB persistence. Registering the
      update handler twice would queue every local edit into the outbox
      twice.
    */
    if (this.noteObservers.has(noteId)) return;

    const doc = entry.doc;

    const handler = (update, origin) => {
      if (origin === SYNC2_REMOTE_ORIGIN) return;
      if (origin === 'sync-folder') return;
      if (origin === entry.persistence) return;

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

      await writeSync2Marker(
        this.localState,
        marker.key,
        marker.value
      );
    }
  }

  async markCurrentVaultFingerprintCovered({
    reason = 'sync-complete',
    verbose = false,
  } = {}) {
    const {
      markerKey,
      fingerprint,
      lastFingerprint,
    } = await currentVaultFingerprintMarker(this.localState);

    if (!fingerprint) {
      return {
        changed: false,
        fingerprint: '',
      };
    }

    if (fingerprint === lastFingerprint) {
      return {
        changed: false,
        fingerprint,
      };
    }

    await writeSync2Marker(
      this.localState,
      markerKey,
      fingerprint
    );

    if (verbose) {
      this.progress?.({
        phase: 'finalize',
        direction: 'sync',
        message: 'Marked current vault metadata as synchronized.',
        reason,
      });
    }

    return {
      changed: true,
      fingerprint,
    };
  }

  async uploadChangedHeadsNow({
    reason = 'sync',
    maxNoteHeads = 80,
    pruneCoveredUpdates = true,
  } = {}) {
    /*
      Latest-head maintenance:
      - Upload overwriteable full-state heads for changed docs.
      - Heads do not increase object count over time.
      - After a head is uploaded, update packs already seen/applied by this
        device are safely covered and can be pruned.
    */

    await this.observeAllKnownNotes();

    let vaultHeadUploaded = false;
    const noteIdsWithHeads = [];

    const vaultFingerprint = await sync2LocalVaultContentFingerprint();
    const lastVaultHeadFingerprint = await readSync2Marker(
      this.localState,
      SYNC2_VAULT_HEAD_FINGERPRINT_MARKER_KEY,
      ''
    );

    if (vaultFingerprint && vaultFingerprint !== lastVaultHeadFingerprint) {
      this.progress({
        phase: 'uploadVaultHead',
        direction: 'up',
        detailed: true,
        message: 'Uploading latest encrypted vault head…',
        reason,
      });

      await uploadVaultHead(this);

      await writeSync2Marker(
        this.localState,
        SYNC2_VAULT_HEAD_FINGERPRINT_MARKER_KEY,
        vaultFingerprint
      );

      /*
        The latest head also covers the current full-update reliability marker.
        This prevents a redundant full vault update on the next sync.
      */
      await writeSync2Marker(
        this.localState,
        SYNC2_VAULT_FINGERPRINT_MARKER_KEY,
        vaultFingerprint
      );

      vaultHeadUploaded = true;
    }

    const noteIds = new Set();

    for (const [id, note] of state.notes) if (!isPrivateItem(note)) noteIds.add(id);
    for (const id of vaultNotesMap().keys()) noteIds.add(id);

    let uploadedNotes = 0;

    for (const noteId of noteIds) {
      if (!noteId) continue;
      if (vaultTombstonesMap().has(noteId)) continue;
      if (uploadedNotes >= maxNoteHeads) break;

      const fingerprint = await sync2NoteContentFingerprint(noteId);
      if (!fingerprint) continue;

      const markerKey = noteHeadFingerprintMarkerKey(noteId);

      const lastHeadFingerprint = await readSync2Marker(
        this.localState,
        markerKey,
        ''
      );

      if (fingerprint === lastHeadFingerprint) continue;

      this.progress({
        phase: 'uploadNoteHead',
        direction: 'up',
        detailed: uploadedNotes === 0,
        current: uploadedNotes + 1,
        total: Math.min(maxNoteHeads, noteIds.size),
        noteId,
        message: 'Uploading latest encrypted note head…',
        reason,
      });

      await uploadNoteHead(this, noteId);

      await writeSync2Marker(
        this.localState,
        markerKey,
        fingerprint
      );

      /*
        The latest head also covers the current full-note reliability marker.
        This prevents redundant full note update packs.
      */
      await writeSync2Marker(
        this.localState,
        noteFingerprintMarkerKey(noteId),
        fingerprint
      );

      noteIdsWithHeads.push(noteId);
      uploadedNotes++;
    }

    let prune = {
      deleted: 0,
      bytes: 0,
    };

    if (
      pruneCoveredUpdates &&
      (
        vaultHeadUploaded ||
        noteIdsWithHeads.length > 0
      )
    ) {
      prune = await pruneSeenUpdatesCoveredByHeads(this, {
        noteIdsWithHeads,
        vaultHeadUploaded,
      });
    }

    if (
      vaultHeadUploaded ||
      noteIdsWithHeads.length ||
      prune.deleted
    ) {
      this.progress({
        phase: 'headsComplete',
        status: 'done',
        direction: 'up',
        detailed: false,
        message:
          `Latest heads updated` +
          `${noteIdsWithHeads.length ? ` · ${noteIdsWithHeads.length} note${noteIdsWithHeads.length === 1 ? '' : 's'}` : ''}` +
          `${prune.deleted ? ` · pruned ${prune.deleted} covered update${prune.deleted === 1 ? '' : 's'}` : ''}.`,
        reason,
      });
    }

    return {
      vaultHeadUploaded,
      noteHeadsUploaded: noteIdsWithHeads.length,
      noteIdsWithHeads,
      prune,
    };
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
        update: encodeCompactVaultState(),
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

    for (const [id, note] of state.notes) if (!isPrivateItem(note)) noteIds.add(id);
    for (const id of vaultNotesMap().keys()) noteIds.add(id);

    let queuedNotes = 0;

    for (const noteId of noteIds) {
      if (!noteId) continue;
      if (vaultTombstonesMap().has(noteId)) continue;

      const {
        markerKey,
        fingerprint,
        lastFingerprint,
      } = await currentNoteFingerprintMarker(this.localState, noteId);

      if (!fingerprint) continue;

      if (fingerprint === lastFingerprint) continue;

      if (outboxHasUploadMarker(this.outbox, markerKey, fingerprint)) {
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
              value: fingerprint,
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

  async pushFullStateNow(options = {}) {
    return this.withSyncLock(() => this.pushFullStateNowLocked(options));
  }

  async pushFullStateNowLocked({
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

    for (const [id, note] of state.notes) if (!isPrivateItem(note)) ids.add(id);
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
        update: encodeCompactVaultState(),
        created: Date.now(),
        full: true,
        compact: true,
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

  async syncNow(options = {}) {
    // A sync already running or waiting in this tab covers this request.
    if (this.syncing || this.syncQueued) return this.status();

    this.syncQueued = true;

    try {
      return await this.withSyncLock(() => {
        this.syncQueued = false;
        return this.syncNowLocked(options);
      });
    } finally {
      this.syncQueued = false;
    }
  }

  async syncNowLocked({
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

    // What this device had before the pull, to spot notes deleted elsewhere.
    const notesBeforePull = new Map(
      [...state.notes].filter(([id]) => !vaultTombstonesMap().has(id))
    );
  
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
  
      let firstPush = {
        uploaded: 0,
      };

      try {
        firstPush = await this.uploadOutbox();
      } catch (err) {
        if (!isObjectTooLargeError(err)) {
          throw err;
        }

        console.warn('[YANTA Sync2] upload skipped because one object is too large; continuing pull', err);

        this.progress({
          phase: 'uploadOutbox',
          status: 'error',
          direction: 'up',
          message: 'One local sync object is too large. Continuing download first…',
        });
      }

      /*
        Notification acks are per-device overwritten objects outside the
        update/head pipeline (see notification-ack-sync.js). Push ours,
        pull the others' — cheap no-ops when nothing changed.
      */
      const ackUp = await uploadNotificationAckIfChanged(this);
      const ackDown = await downloadNotificationAcks(this);

      this.notificationAckSync = {
        uploaded: ackUp.uploaded,
        applied: ackDown.applied,
      };

      /*
        Vault version guard: remember the newest version of every
        guarded vault entry across the local state and everything this
        pull applies, then repair stale CRDT merge winners afterwards.
      */
      this.activeVersionGuard = createVaultVersionCollector();

      this.progress({
        phase: 'downloadVaultHeads',
        direction: 'down',
        message: 'Checking latest vault heads…',
      });

      const vaultHeads = await downloadVaultHeads(this);

      if (vaultHeads.applied > 0) {
        await this.updateDeviceRecord({
          lastPullAt: Date.now(),
          lastPullCount: vaultHeads.applied,
        });
      }
  
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

      /*
        Outside the outbox suppression on purpose: a restore is a real
        local write that must propagate, so every device converges on
        the newest version instead of a random CRDT merge winner.
      */
      const versionRestores = reconcileVaultVersions(
        this.activeVersionGuard,
        SYNC2_LOCAL_ORIGIN
      );

      this.activeVersionGuard = null;

      if (versionRestores > 0) {
        console.info(
          '[YANTA Sync2] vault version guard restored stale entries:',
          versionRestores
        );
      }

      // Before hydration drops them from state.
      await this.rescueNotesDeletedElsewhere(notesBeforePull);

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

      this.progress({
        phase: 'downloadNoteHeads',
        direction: 'down',
        message: 'Checking latest note heads…',
      });

      {
        const ids = new Set();

        for (const [id, note] of state.notes) if (!isPrivateItem(note)) ids.add(id);
        for (const id of vaultNotesMap().keys()) ids.add(id);

        const noteIds = [...ids].filter((noteId) =>
          !vaultTombstonesMap().has(noteId)
        );

        const noteHeads = await downloadKnownNoteHeads(this, noteIds);

        for (const noteId of noteHeads.noteIds || []) {
          appliedRemoteNoteBodyIds.add(noteId);
        }

        if (noteHeads.applied > 0) {
          await this.updateDeviceRecord({
            lastPullAt: Date.now(),
            lastPullCount:
              Number(vaultUpdates?.applied || 0) +
              Number(noteHeads?.applied || 0),
          });
        }
      }
  
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
  
      let finalPush = {
        uploaded: 0,
      };

      try {
        finalPush = await this.uploadOutbox();
      } catch (err) {
        if (!isObjectTooLargeError(err)) {
          throw err;
        }

        console.warn('[YANTA Sync2] final upload skipped because one object is too large', err);

        this.progress({
          phase: 'uploadOutbox',
          status: 'error',
          direction: 'up',
          message: 'Local upload still has an oversized object. Download completed; upload will retry after compaction.',
        });
      }

      if (finalPush.uploaded > 0) {
        // Do not call updateDeviceRecord here again, otherwise it would queue
        // another vault update directly after the final upload.
        // The next sync cycle will update lastPushCount again if needed.
      }
  
    await uploadMissingAssets(this);

    /*
      Latest-head storage model:
      Upload overwriteable encrypted full-state heads after a successful
      pull/push cycle. Then prune update packs this device has already seen,
      because the new heads cover them.
    */
    await this.uploadChangedHeadsNow({
      reason: 'syncNow-complete',
      maxNoteHeads: 80,
      pruneCoveredUpdates: true,
    });

    /*
      Compatibility guard for the existing reliability marker.
    */
    await this.markCurrentVaultFingerprintCovered({
      reason: 'syncNow-complete',
    });

    await forgetSeenObjectsGoneFromRemote(this).catch((err) => {
      console.warn('[YANTA Sync2] could not trim seen-state', err);
    });

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
      this.activeVersionGuard = null;
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

  async dropRedundantNoteOutboxUpdates() {
    /*
      Critical loop guard:
      If a note update is queued but the current note Y.Doc fingerprint is
      already marked as uploaded, the queued update is redundant.

      This can happen after remote apply / hydration side effects or after
      observer updates that were already covered by a snapshot/full update.
    */

    if (!Array.isArray(this.outbox) || !this.outbox.some((item) => item?.kind === 'note')) {
      return {
        dropped: 0,
      };
    }

    const next = [];
    let dropped = 0;

    for (const item of this.outbox) {
      if (item?.kind !== 'note' || !item.noteId) {
        next.push(item);
        continue;
      }

      const {
        fingerprint,
        lastFingerprint,
      } = await currentNoteFingerprintMarker(this.localState, item.noteId);

      if (fingerprint && fingerprint === lastFingerprint) {
        dropped++;
        continue;
      }

      next.push(item);
    }

    this.outbox = next;

    if (dropped > 0) {
      this.progress?.({
        phase: 'uploadOutbox',
        direction: 'up',
        detailed: false,
        message: `Dropped ${dropped} redundant note update${dropped === 1 ? '' : 's'}.`,
      });
    }

    return {
      dropped,
    };
  }

  async tagNoteOutboxUpdatesWithCurrentFingerprints() {
    /*
      Direct note observer updates normally do not carry full-update markers.
      If we upload them successfully, mark the current Y.Doc fingerprint as
      covered so the next routine sync does not upload a redundant full note.
    */

    if (!Array.isArray(this.outbox) || !this.outbox.some((item) => item?.kind === 'note')) {
      return;
    }

    const noteIds = [
      ...new Set(
        this.outbox
          .filter((item) => item?.kind === 'note' && item.noteId)
          .map((item) => String(item.noteId))
      ),
    ];

    const markersByNoteId = new Map();

    for (const noteId of noteIds) {
      const {
        markerKey,
        fingerprint,
      } = await currentNoteFingerprintMarker(this.localState, noteId);

      if (!fingerprint) continue;

      markersByNoteId.set(noteId, {
        markerKey,
        fingerprint,
      });
    }

    for (const item of this.outbox) {
      if (item?.kind !== 'note' || !item.noteId) continue;

      const marker = markersByNoteId.get(String(item.noteId));
      if (!marker) continue;

      ensureOutboxMarker(item, marker.markerKey, marker.fingerprint);
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
      await this.dropRedundantNoteOutboxUpdates();

      this.compactOutboxForUpload();

      /*
        If real updates remain, tag them with current semantic/content
        fingerprints so future routine syncs know this state is covered.
      */
      await this.tagVaultOutboxUpdatesWithCurrentFingerprint();
      await this.tagNoteOutboxUpdatesWithCurrentFingerprints();

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
          New local updates can arrive while uploadOutbox() is already running.
          Coalesce again before taking the next item so continued typing does
          not become one remote object per keystroke / short pause.
        */
        if (this.outbox.length > 1) {
          this.compactOutboxForUpload();
        }

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

        if (item.kind === 'note' && item.noteId) {
          const {
            markerKey,
            fingerprint,
            lastFingerprint,
          } = await currentNoteFingerprintMarker(this.localState, item.noteId);

          if (fingerprint && fingerprint === lastFingerprint) {
            this.outbox.shift();

            this.progress({
              phase: 'uploadOutbox',
              direction: 'up',
              current: Math.min(processed, total),
              total,
              noteId: item.noteId || null,
              message: 'Skipped redundant note update.',
            });

            continue;
          }

          if (fingerprint) {
            ensureOutboxMarker(item, markerKey, fingerprint);
          }
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

          await this.markSeen(path, cleanUndefined({
            type: item.kind + '-update',
            own: true,
            noteId: item.kind === 'note' ? item.noteId : undefined,
          }));

          await this.applyOutboxUploadMarkers(item);

          this.outbox.shift();
          uploaded++;
        } catch (err) {
          if (err?.code === 'EEXIST') {
            /*
              Something else already wrote this seq (another tab, or our own
              earlier upload whose response was lost). Skip the seq and
              retry the item. Never mark the existing object seen or drop
              the item: neither was ever applied/uploaded by this tab, and
              treating them as such silently lost both updates.
            */
            await this.commitSeq(seq);

            item.seqCollisions = (item.seqCollisions || 0) + 1;

            if (item.seqCollisions > 100) {
              throw err;
            }

            continue;
          }

          if (
            isObjectTooLargeError(err) &&
            item.kind === 'vault' &&
            item.compactRetry !== true
          ) {
            console.warn('[YANTA Sync2] vault update too large; retrying with compact vault state', {
              path,
              seq,
              bytes: encrypted?.byteLength || 0,
            });

            item.update = encodeCompactVaultState();
            item.full = true;
            item.compact = true;
            item.compactRetry = true;
            item.reason = [item.reason, 'compact-vault-retry']
              .filter(Boolean)
              .join('+');

            /*
              Do not consume seq. Do not shift item.
              Retry the same outbox item with compact data.
            */
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

    const pending = [];

    for (const entry of entries) {
      if (await this.hasSeen(entry.path)) {
        processed++;
        continue;
      }

      pending.push(entry);
    }

    this.progress({
      phase: 'downloadVaultUpdates',
      direction: 'down',
      current: processed,
      total: entries.length,
      message: 'Already seen.',
    });

    const seen = createSeenBatch(this);

    /*
      Fetch and decrypt in parallel, apply strictly in list order.
      Vault updates are last-write-wins, so the apply order decides the
      outcome and must stay exactly what the sequential version produced.
    */
    for await (const { item: entry, value: plain } of mapOrdered(
      pending,
      (item) => this.fetchAndDecrypt(item.path),
      {
        limit: SYNC2_DOWNLOAD_CONCURRENCY,
        run: runSyncDownload,
      }
    )) {
      processed++;

      this.progress({
        phase: 'downloadVaultUpdates',
        direction: 'down',
        current: processed,
        total: entries.length,
        message: 'Downloading vault update…',
      });

      if (plain == null) continue;

      const pack = this.decodePackOrSkip(entry.path, plain);
      if (!pack) continue;

      if (pack.kind !== 'vault') {
        await seen.add({
          path: entry.path,
          type: 'ignored',
        });

        continue;
      }

      for (const update of pack.updates) {
        this.noteIncomingVaultBytes(update);
        applyVaultUpdate(update, SYNC2_REMOTE_ORIGIN);
      }

      await seen.add({
        path: entry.path,
        type: 'vault-update',
        size: entry.size,
        etag: entry.etag,
      });

      applied++;
    }

    await seen.flush();

    return {
      applied,
      entries: entries.length,
    };
  }

  async downloadKnownNoteSnapshots() {
    const ids = new Set();

    for (const [id, note] of state.notes) if (!isPrivateItem(note)) ids.add(id);
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

    /*
      Notes are processed several at a time; their object fetches still
      queue on the shared download limiter. No limiter slot is held here,
      otherwise an outer note would wait for inner fetches that can never
      start.
    */
    for await (const { item: noteId, value: res } of mapOrdered(
      noteIds,
      (id) => downloadNoteSnapshots(this, id),
      {
        limit: SYNC2_NOTE_CONCURRENCY,
      }
    )) {
      processed++;

      this.progress({
        phase: 'downloadNoteSnapshots',
        direction: 'down',
        current: processed,
        total: noteIds.length,
        noteId,
      });

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

    for (const [id, note] of state.notes) if (!isPrivateItem(note)) ids.add(id);
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

    for await (const { item: noteId, value: res } of mapOrdered(
      noteIds,
      (id) => this.downloadNoteUpdates(id),
      {
        limit: SYNC2_NOTE_CONCURRENCY,
      }
    )) {
      processed++;

      this.progress({
        phase: 'downloadNoteUpdates',
        direction: 'down',
        current: processed,
        total: noteIds.length,
        noteId,
      });

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

    const pending = [];

    for (const entry of entries) {
      if (await this.hasSeen(entry.path)) {
        processed++;
        continue;
      }

      if (vaultTombstonesMap().has(noteId)) {
        processed++;

        seenToMark.push({
          path: entry.path,
          type: 'skipped-tombstoned-note-update',
          noteId,
        });

        continue;
      }

      pending.push(entry);
    }

    for await (const { item: entry, value: plain } of mapOrdered(
      pending,
      (item) => this.fetchAndDecrypt(item.path),
      {
        limit: SYNC2_DOWNLOAD_CONCURRENCY,
        run: runSyncDownload,
      }
    )) {
      processed++;

      this.progress({
        phase: 'downloadNoteUpdates',
        direction: 'down',
        noteId,
        current: processed,
        total: entries.length,
      });

      if (plain == null) continue;

      const pack = this.decodePackOrSkip(entry.path, plain);
      if (!pack) continue;

      if (pack.kind !== 'note') {
        seenToMark.push({
          path: entry.path,
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
        type: 'note-update',
        noteId,
        size: entry.size,
        etag: entry.etag,
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

    await this.markManySeen(seenToMark);

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
        Important:
        Do NOT update note.updated here.
        
        This function runs after remote note body updates were applied.
        If we set note.updated = Date.now() and persist it, the reliability
        layer may interpret that as a local change and upload a redundant
        full note update. With multiple devices this becomes a ping-pong loop.
        
        The body itself is already updated in the Y.Doc. Search/UI can refresh
        without writing local metadata.
      */
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

  /*
    Edit vs. delete: a permanent delete is final, but work this device did on
    the note after the delete (its local `updated` is newer than the
    tombstone — body edits bump it) must not vanish with it. Such a note is
    copied, body and drawings included, into a new "(recovered)" note that
    syncs like any other. A device that merely had the note lets it go.
  */
  async rescueNotesDeletedElsewhere(notesBeforePull) {
    const tombstones = vaultTombstonesMap();
    const rescued = [];

    for (const [id, note] of notesBeforePull) {
      const tombstone = tombstones.get(id);
      if (tombstone?.type !== 'note') continue;
      if (Number(note?.updated || 0) <= Number(tombstone.deletedAt || 0)) continue;

      try {
        const source = getNoteDoc(id);
        await source.ready;

        const copyId = uid();
        const folderId =
          note.folderId &&
          state.folders.has(note.folderId) &&
          !tombstones.has(note.folderId)
            ? note.folderId
            : null;

        const copy = {
          ...sanitizeNoteMeta(note),
          id: copyId,
          title: `${note.title || 'Untitled'} (recovered)`,
          folderId,
          created: Date.now(),
          updated: Date.now(),
          trashed: undefined,
          deletedAt: undefined,
          deletedBy: undefined,
          publicShare: undefined,
        };

        state.notes.set(copyId, copy);
        await store.notes.put(copy);

        await this.observeNote(copyId);

        const target = getNoteDoc(copyId);
        await target.ready;

        Y.applyUpdate(target.doc, Y.encodeStateAsUpdate(source.doc), SYNC2_LOCAL_ORIGIN);

        rescued.push({ from: id, to: copyId, title: copy.title });
      } catch (err) {
        console.warn('[YANTA Sync2] could not rescue note deleted elsewhere', id, err);
      }
    }

    if (!rescued.length) return rescued;

    // A notice must never fail the sync.
    try {
      toast(
        rescued.length === 1
          ? `A note you changed was deleted on another device. Your version was kept as "${rescued[0].title}".`
          : `${rescued.length} notes you changed were deleted on another device. Your versions were kept as "(recovered)" copies.`,
        'info'
      );
    } catch {}

    try {
      window.dispatchEvent(new CustomEvent('yanta-notes-rescued', {
        detail: { rescued },
      }));
    } catch {}

    return rescued;
  }

  /*
    The VaultDoc is the source of truth for metadata; state mirrors it.

    Why no newest-wins check here: note.updated is bumped by body edits that
    never reach the vault, so a local "newer" timestamp says nothing about
    the metadata. Stale CRDT merge winners are repaired before this runs, by
    the vault version guard.
  */
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

      // A private folder's carrier stays out of app state (core.js).
      if (isPrivateCarrier(incoming)) continue;

      const existing = state.notes.get(id);
      const next = safeJsonClone(incoming);

      if (!jsonEqualForSync2(existing, next)) {
        changed = true;
      }

      state.notes.set(id, next);
    }

    // Folders.
    for (const [id, raw] of vaultFoldersMap()) {
      if (tombstones.has(id)) continue;

      const incoming = sanitizeFolderMeta(raw);
      if (!incoming?.id) continue;

      const existing = state.folders.get(id);
      const next = safeJsonClone(incoming);

      if (!jsonEqualForSync2(existing, next)) {
        changed = true;
      }

      state.folders.set(id, next);
    }

    // Images metadata only; blobs come later through asset sync.
    for (const [id, raw] of vaultImagesMap()) {
      if (tombstones.has(id)) continue;

      const incoming = sanitizeImageMeta(raw);
      if (!incoming?.id) continue;

      const existing = state.imagesMeta.get(id);
      const next = safeJsonClone(incoming);

      if (!jsonEqualForSync2(existing, next)) {
        changed = true;
      }

      state.imagesMeta.set(id, next);
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

    /*
      Adopt a remotely changed title into the open note — unless the user is
      writing in it.

      The title field autosaves on a debounce, so between a keystroke and the
      store write the vault legitimately still holds the previous title. A
      hydration landing in that window used to rewrite the field back to it,
      and the save that fired afterwards then persisted the old title: the
      edit was not just visually reverted, it was lost.
    */
    if (current && !isNoteTitleFieldFocused()) {
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
  
    /*
      Compare against the stored cache records, not against state:
      hydrateAppStateFromVault() has already put the vault values into
      state, so a state comparison never saw a difference and the cache
      kept the old values. At the next boot that stale cache was seeded
      back into the vault and reverted remote renames/trash everywhere.
    */
    const cachedNotes = await readCacheById(store.notes);
    const cachedFolders = await readCacheById(store.folders);

    for (const [id, raw] of vaultNotesMap()) {
      if (tombstones.has(id)) continue;
  
      const incoming = sanitizeNoteMeta(raw);
      if (!incoming?.id) continue;
  
      const nextNote = safeJsonClone(incoming);

      if (!isPrivateCarrier(nextNote)) state.notes.set(id, nextNote);

      const cached = cachedNotes.get(id);

      if (!cached || !jsonEqualForSync2(sanitizeNoteMeta(cached), nextNote)) {
        try {
          await store.notes.put(safeJsonClone(nextNote));
        } catch {}
      }
    }
  
    for (const [id, raw] of vaultFoldersMap()) {
      if (tombstones.has(id)) continue;
  
      const incoming = sanitizeFolderMeta(raw);
      if (!incoming?.id) continue;
  
      const nextFolder = safeJsonClone(incoming);

      state.folders.set(id, nextFolder);

      const cached = cachedFolders.get(id);

      if (!cached || !jsonEqualForSync2(sanitizeFolderMeta(cached), nextFolder)) {
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

    await this.persistVaultSpacesToLocalStore();
  }

  /*
    Shared-space records travel with the vault so a device that lost its
    local storage — or a brand new one — gets its shares back instead of
    silently orphaning them.

    Announces arrivals rather than mounting them here: mounting belongs to
    the spaces layer, and pulling it into the sync engine would tie the
    engine to the whole space/Matrix stack.
  */
  async persistVaultSpacesToLocalStore() {
    const records = vaultSpacesMap();
    const tombstones = vaultTombstonesMap();

    const added = [];
    const removed = [];

    // Stopped shares first, so a tombstone always beats a stale record.
    for (const [id, t] of tombstones) {
      if (t?.type !== 'space') continue;

      /*
        A device that had the space mounted may have re-put its live
        record before the tombstone reached it. The tombstone wins on
        read, but leaving the entry would keep the keys of a stopped
        share in the synced vault forever. Every device runs this, so
        the deletion converges.
      */
      if (records.has(id)) {
        try {
          getVaultDoc().transact(() => {
            records.delete(id);
          }, SYNC2_REMOTE_ORIGIN);
        } catch {}
      }

      let existing = null;

      try {
        existing = await store.spaces.get(id);
      } catch {
        continue;
      }

      if (!existing) continue;

      try {
        // The tombstone is already in the vault; only drop the local copy.
        await removeLocalSpaceRecordOnly(id);
        removed.push(id);
      } catch {}
    }

    for (const [id, raw] of records) {
      const spaceId = String(raw?.spaceId || id || '').trim();
      if (!spaceId || tombstones.has(spaceId)) continue;

      let existing = null;

      try {
        existing = await store.spaces.get(spaceId);
      } catch {
        continue;
      }

      const next = safeJsonClone(raw);
      if (!next || jsonEqualForSync2(existing, next)) continue;

      try {
        await store.spaces.put(next);
        added.push(spaceId);
      } catch {}
    }

    if (!added.length && !removed.length) return;

    try {
      window.dispatchEvent(new CustomEvent('yanta-vault-spaces-changed', {
        detail: { added, removed },
      }));
    } catch {}
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