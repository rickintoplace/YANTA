// ============================================================
// YANTA Sync2 — Cloud storage compaction
//
// Goal:
// - Reduce append-only Sync2 object growth.
// - Upload a fresh encrypted full state snapshot.
// - Delete update packs that are covered by the fresh snapshot.
// - Keep only a small number of recent snapshots.
// - Optionally create emergency headroom by deleting old vault updates first.
//
// Safety model:
// - This only manipulates encrypted Sync2 remote objects.
// - It never decrypts or sends plaintext.
// - A fresh local full snapshot is uploaded before broad cleanup.
// - If the vault is already full, old vault updates can be deleted first
//   to make room for the fresh snapshot.
// ============================================================

import {
  state,
  store,
} from '../core.js';

import {
  vaultNotesMap,
  vaultFoldersMap,
  vaultImagesMap,
  vaultEventsMap,
  vaultCalendarCategoriesMap,
  vaultTombstonesMap,
} from './vault-doc.js';

import {
  uploadVaultSnapshot,
  uploadNoteSnapshot,
} from './snapshots.js';

import {
  uploadMissingAssets,
} from './assets.js';

import {
  sync2LocalVaultContentFingerprint,
  sync2NoteContentFingerprint,
} from './app-engine.js';

import {
  uploadVaultHead,
  uploadNoteHead,
  pruneSeenUpdatesCoveredByHeads,
  collectHeadCoveredSeenEntries,
} from './heads.js';

import {
  docUpdatesPrefix,
  docHeadsPrefix,
  docSnapshotsPrefix,
} from './ids.js';

const DEFAULT_MIN_HEADROOM_BYTES = 3 * 1024 * 1024;
const DEFAULT_KEEP_SNAPSHOTS_PER_DOC = 2;

function isObjectTooLargeError(err) {
  return (
    err?.status === 413 ||
    err?.code === 'EOBJECT_TOO_LARGE' ||
    err?.serverCode === 'object_too_large' ||
    /object_too_large|object too large|content too large/i.test(err?.message || '')
  );
}

async function markCoveredBoth(engine, key, value) {
  if (!key) return;

  try {
    await engine.localState?.set?.(key, value);
  } catch (err) {
    console.warn('[YANTA Sync2] could not write compaction local marker', key, err);
  }

  try {
    await store.settings.set(key, value);
  } catch (err) {
    console.warn('[YANTA Sync2] could not write compaction settings marker', key, err);
  }
}

function objectKind(path = '') {
  const p = String(path || '');

  if (p.includes('/vault/heads/')) return 'vault-head';
  if (p.includes('/vault/updates/')) return 'vault-update';
  if (p.includes('/vault/snapshots/')) return 'vault-snapshot';

  if (p.includes('/docs/') && p.includes('/heads/')) return 'note-head';
  if (p.includes('/docs/') && p.includes('/updates/')) return 'note-update';
  if (p.includes('/docs/') && p.includes('/snapshots/')) return 'note-snapshot';

  if (p.includes('/assets/')) return 'asset';

  return 'other';
}

function docSnapshotGroup(path = '') {
  const m = String(path || '').match(/^yanta-sync-v1\/docs\/([^/]+)\/snapshots\//);

  return m ? `doc:${m[1]}` : '';
}

/*
  Deleting by object timestamps is not safe and is gone: "older than the
  newest head (of any device)" says nothing about whether that head
  contains the pack. A pack uploaded by another device between this
  device's pull and its head upload is in no head at all; deleting it
  lost the change whenever that device never got to upload its own head.
  Packs are only deleted when this device provably applied them before
  encoding its head (collectHeadCoveredSeenEntries), or when they belong
  to a permanently deleted note.
*/

function entryUpdated(entry) {
  return Number(entry?.updated || 0) || 0;
}

function entrySize(entry) {
  return Number(entry?.size || 0) || 0;
}

function sortOldestFirst(entries = []) {
  return [...entries].sort((a, b) =>
    entryUpdated(a) - entryUpdated(b) ||
    String(a.path || '').localeCompare(String(b.path || ''))
  );
}

function sortNewestFirst(entries = []) {
  return [...entries].sort((a, b) =>
    entryUpdated(b) - entryUpdated(a) ||
    String(b.path || '').localeCompare(String(a.path || ''))
  );
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

function localVaultContentVersion() {
  /*
    Version for Vault metadata snapshots/markers only.

    Do not use state.notes.updated here. Body edits update that value
    frequently, but note bodies are covered by note snapshots/updates,
    not by Vault metadata snapshots.
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

    for (const tombstone of vaultTombstonesMap().values()) {
      max = Math.max(max, sync2ObjectVersion(tombstone));
    }
  } catch {}

  return max;
}

function knownNoteIdsForSnapshots() {
  const ids = new Set();

  for (const [id, note] of state.notes) if (!note?.privateFolderId) ids.add(id);
  for (const id of vaultNotesMap().keys()) ids.add(id);

  for (const id of vaultTombstonesMap().keys()) {
    ids.delete(id);
  }

  return [...ids].filter(Boolean);
}

async function markLocalFullUpdateMarkersCovered(engine, noteIds = []) {
  if (!engine?.localState) return;

  /*
    Mark the fresh compacted snapshots as covering the current durable
    Vault metadata state.

    Critical:
    Routine sync uses the semantic fingerprint marker, not just a timestamp.
    We mirror markers into both:
    - engine.localState
    - store.settings

    This makes compaction stable across reload/provider runtime state.
  */
  const vaultVersion = localVaultContentVersion();
  const vaultFingerprint = await sync2LocalVaultContentFingerprint();

  if (vaultVersion > 0) {
    await markCoveredBoth(
      engine,
      'sync2.fullUpdateUploaded.vault.version',
      vaultVersion
    );
  }

  if (vaultFingerprint) {
    await markCoveredBoth(
      engine,
      'sync2.fullUpdateUploaded.vault.fingerprint',
      vaultFingerprint
    );
  }

  for (const noteId of noteIds) {
    const note =
      state.notes.get(noteId) ||
      vaultNotesMap().get(noteId);

    const version = sync2ObjectVersion(note);

    if (version > 0) {
      await markCoveredBoth(
        engine,
        `sync2.fullUpdateUploaded.note.${noteId}.version`,
        version
      );
    }

    const noteFingerprint = await sync2NoteContentFingerprint(noteId);

    if (noteFingerprint) {
      await markCoveredBoth(
        engine,
        `sync2.fullUpdateUploaded.note.${noteId}.fingerprint`,
        noteFingerprint
      );
    }
  }
}

async function deleteRemoteEntries(engine, entries = [], {
  phase = 'compactDelete',
  message = 'Deleting old sync objects…',
} = {}) {
  let deleted = 0;
  let bytes = 0;
  let current = 0;
  const total = entries.length;

  if (!total) {
    return {
      deleted,
      bytes,
    };
  }

  for (const entry of entries) {
    current++;

    engine.progress?.({
      phase,
      direction: 'up',
      detailed: true,
      current,
      total,
      message,
    });

    try {
      await engine.remote.delete(entry.path);
      engine.clearRemoteIndex?.();

      deleted++;
      bytes += entrySize(entry);
    } catch (err) {
      console.warn('[YANTA Sync2] compact delete failed', entry.path, err);
    }
  }

  return {
    deleted,
    bytes,
  };
}

async function createEmergencyHeadroom(engine, {
  minHeadroomBytes = DEFAULT_MIN_HEADROOM_BYTES,
} = {}) {
  const index = await engine.loadRemoteIndex({
    force: true,
  });

  // Packs the heads this device already uploaded contain.
  const coveredUpdates = sortOldestFirst(
    await collectHeadCoveredSeenEntries(engine, index || [], {
      vault: true,
      noteIds: null,
    })
  );

  const selected = [];
  let selectedBytes = 0;

  for (const entry of coveredUpdates) {
    selected.push(entry);
    selectedBytes += entrySize(entry);

    if (selectedBytes >= minHeadroomBytes) break;
  }

  if (!selected.length) {
    return {
      deleted: 0,
      bytes: 0,
    };
  }

  engine.progress?.({
    phase: 'compactHeadroom',
    direction: 'up',
    detailed: true,
    message: 'Creating safe upload headroom by pruning history already covered by heads…',
  });

  return deleteRemoteEntries(engine, selected, {
    phase: 'compactHeadroom',
    message: 'Creating safe headroom…',
  });
}

function cleanupPlanFromIndex(index = [], {
  keepSnapshotsPerDoc = DEFAULT_KEEP_SNAPSHOTS_PER_DOC,
} = {}) {
  const entries = index || [];

  const vaultSnapshots = sortNewestFirst(
    entries.filter((entry) => objectKind(entry.path) === 'vault-snapshot')
  );

  // Snapshot retention only; update packs are never deleted by timestamp.
  const deleteEntries = [];

  // Delete old vault snapshots, keep newest N.
  for (const entry of vaultSnapshots.slice(keepSnapshotsPerDoc)) {
    deleteEntries.push(entry);
  }

  const snapshotsByDoc = new Map();

  for (const entry of entries) {
    if (objectKind(entry.path) !== 'note-snapshot') continue;

    const group = docSnapshotGroup(entry.path);

    if (!group) continue;

    if (!snapshotsByDoc.has(group)) {
      snapshotsByDoc.set(group, []);
    }

    snapshotsByDoc.get(group).push(entry);
  }

  for (const list of snapshotsByDoc.values()) {
    for (const oldSnapshot of sortNewestFirst(list).slice(keepSnapshotsPerDoc)) {
      deleteEntries.push(oldSnapshot);
    }
  }

  const seen = new Set();

  return deleteEntries.filter((entry) => {
    if (!entry?.path) return false;
    if (seen.has(entry.path)) return false;

    seen.add(entry.path);
    return true;
  });
}

async function tombstonedNoteEntriesFromIndex(engine, index = []) {
  const prefixes = [];

  for (const [id, tombstone] of vaultTombstonesMap()) {
    if (tombstone?.type !== 'note') continue;

    prefixes.push(
      await docUpdatesPrefix(engine.keys.nameKey, id),
      await docHeadsPrefix(engine.keys.nameKey, id),
      await docSnapshotsPrefix(engine.keys.nameKey, id)
    );
  }

  if (!prefixes.length) return [];

  return sortOldestFirst(
    (index || []).filter((entry) =>
      prefixes.some((prefix) => String(entry.path || '').startsWith(prefix))
    )
  );
}

export async function compactYantaCloudStorage(engine, options = {}) {
  if (!engine) {
    throw new Error('Sync engine missing.');
  }

  /*
    Holds the sync lock for the whole run: a sync in this or another tab
    marking packs seen, or uploading from the outbox, while heads are
    encoded and covered packs deleted would delete what no head contains.
  */
  return engine.withSyncLock(() => compactLocked(engine, options));
}

async function compactLocked(engine, {
  emergencyHeadroom = true,
  minHeadroomBytes = DEFAULT_MIN_HEADROOM_BYTES,
  keepSnapshotsPerDoc = DEFAULT_KEEP_SNAPSHOTS_PER_DOC,
  dropCoveredLocalOutbox = true,
} = {}) {
  await engine.start();

  /*
    Old local builds may have queued huge VaultDoc full updates.
    They are superseded by the fresh compact heads/snapshots created below.
  */
  if (Array.isArray(engine.outbox) && engine.outbox.some((item) => item?.kind === 'vault')) {
    const before = engine.outbox.length;

    engine.outbox = engine.outbox.filter((item) => item?.kind !== 'vault');

    const dropped = before - engine.outbox.length;

    if (dropped > 0) {
      engine.progress?.({
        phase: 'compactOutbox',
        direction: 'up',
        detailed: true,
        message: `Dropped ${dropped} stale local vault metadata update${dropped === 1 ? '' : 's'} before compaction.`,
      });
    }
  }

  /*
    Safety first:
    Pull remote heads/updates before declaring old journals covered by new heads.
    If an old oversized local upload exists, app-engine continues the pull.
  */
  if (!engine.syncing) {
    try {
      engine.progress?.({
        phase: 'compactStart',
        direction: 'down',
        detailed: true,
        message: 'Synchronizing before storage optimization…',
      });

      await engine.syncNowLocked({
        verbose: false,
        pullSnapshots: true,
      });
    } catch (err) {
      if (!isObjectTooLargeError(err)) {
        throw err;
      }

      console.warn('[YANTA Sync2] pre-compaction sync had oversized upload but pull continued where possible', err);
    }
  }

  engine.progress?.({
    phase: 'compactStart',
    direction: 'up',
    detailed: true,
    message: 'Starting cloud storage optimization…',
  });

  /*
    Old local builds may have queued huge VaultDoc full updates.
    They are superseded by the fresh compact heads/snapshots created below.
  */
  if (Array.isArray(engine.outbox) && engine.outbox.some((item) => item?.kind === 'vault')) {
    const before = engine.outbox.length;

    engine.outbox = engine.outbox.filter((item) => item?.kind !== 'vault');

    const dropped = before - engine.outbox.length;

    if (dropped > 0) {
      engine.progress?.({
        phase: 'compactOutbox',
        direction: 'up',
        detailed: true,
        message: `Dropped ${dropped} oversized/stale local vault metadata update${dropped === 1 ? '' : 's'} before compaction.`,
      });
    }
  }

  await engine.loadRemoteIndex({
    force: true,
  });

  /*
    First create room only by deleting update history that is already covered
    by existing snapshots. Never delete unseen arbitrary note updates.
  */
  let headroom = {
    deleted: 0,
    bytes: 0,
  };

  if (emergencyHeadroom) {
    headroom = await createEmergencyHeadroom(engine, {
      minHeadroomBytes,
    });
  }

  const snapshotStartedAt = Date.now();

  /*
    Assets first. Asset migration may update Vault metadata.
    Therefore the Vault head/snapshot must be written after assets.
  */
  engine.progress?.({
    phase: 'compactAssets',
    direction: 'up',
    detailed: true,
    message: 'Ensuring encrypted assets are present…',
  });

  const assets = await uploadMissingAssets(engine);

  const noteIds = knownNoteIdsForSnapshots();

  /*
    Upload overwriteable latest heads.
    These are the SaaS-quality canonical latest states.
  */
  engine.progress?.({
    phase: 'compactHeads',
    direction: 'up',
    detailed: true,
    message: 'Uploading latest encrypted vault head…',
  });

  await uploadVaultHead(engine);

  let i = 0;

  for (const noteId of noteIds) {
    i++;

    engine.progress?.({
      phase: 'compactHeads',
      direction: 'up',
      detailed: true,
      current: i,
      total: noteIds.length,
      noteId,
      message: 'Uploading latest encrypted note heads…',
    });

    await engine.observeNote(noteId);
    await uploadNoteHead(engine, noteId);
  }

  /*
    Keep legacy snapshots for migration/repair compatibility.
    These are also used by older cleanup logic.
  */
  engine.progress?.({
    phase: 'compactSnapshots',
    direction: 'up',
    detailed: true,
    message: 'Uploading encrypted compatibility snapshots…',
  });

  await uploadVaultSnapshot(engine);

  i = 0;

  for (const noteId of noteIds) {
    i++;

    engine.progress?.({
      phase: 'compactSnapshots',
      direction: 'up',
      detailed: true,
      current: i,
      total: noteIds.length,
      noteId,
      message: 'Uploading compatibility note snapshots…',
    });

    await engine.observeNote(noteId);
    await uploadNoteSnapshot(engine, noteId);
  }

  await markLocalFullUpdateMarkersCovered(engine, noteIds);

  if (dropCoveredLocalOutbox && Array.isArray(engine.outbox)) {
    const before = engine.outbox.length;

    engine.outbox = engine.outbox.filter((item) =>
      Number(item?.created || 0) > snapshotStartedAt
    );

    const removed = before - engine.outbox.length;

    if (removed > 0) {
      engine.progress?.({
        phase: 'compactOutbox',
        direction: 'up',
        detailed: true,
        message: `Dropped ${removed} local queued update${removed === 1 ? '' : 's'} covered by fresh heads.`,
      });
    }
  }

  /*
    Delete all already-seen update journal entries covered by the heads we just
    uploaded. This is the important part for Note update history.
  */
  const journalCleanup = await pruneSeenUpdatesCoveredByHeads(engine, {
    noteIdsWithHeads: noteIds,
    vaultHeadUploaded: true,
    maxDeletes: 5000,
  });

  /*
    Trim old compatibility snapshots (keep the newest per doc).
  */
  const indexAfterSnapshots = await engine.loadRemoteIndex({
    force: true,
  });

  const deletePlan = cleanupPlanFromIndex(indexAfterSnapshots, {
    keepSnapshotsPerDoc,
  });

  const cleanup = await deleteRemoteEntries(engine, deletePlan, {
    phase: 'compactDelete',
    message: 'Deleting sync history covered by snapshots…',
  });

  /*
    Permanently deleted notes: their journal, heads and snapshots are
    garbage on every device (a tombstone always wins).
  */
  const indexAfterCleanup = await engine.loadRemoteIndex({
    force: true,
  });

  const orphanPlan = await tombstonedNoteEntriesFromIndex(engine, indexAfterCleanup);

  const orphanCleanup = await deleteRemoteEntries(engine, orphanPlan, {
    phase: 'compactDelete',
    message: 'Deleting sync data of deleted notes…',
  });

  await engine.loadRemoteIndex({
    force: true,
  });

  engine.progress?.({
    phase: 'compactComplete',
    status: 'done',
    direction: 'up',
    detailed: true,
    message: 'Cloud storage optimization complete.',
  });

  return {
    ok: true,

    headroom,

    heads: {
      vault: 1,
      notes: noteIds.length,
    },

    snapshots: {
      vault: 1,
      notes: noteIds.length,
    },

    assets,

    journalCleanup,
    cleanup,
    orphanCleanup,

    freedBytes:
      Number(headroom.bytes || 0) +
      Number(journalCleanup.bytes || 0) +
      Number(cleanup.bytes || 0) +
      Number(orphanCleanup.bytes || 0),
  };
}