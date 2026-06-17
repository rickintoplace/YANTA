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

const DEFAULT_MIN_HEADROOM_BYTES = 3 * 1024 * 1024;
const DEFAULT_KEEP_SNAPSHOTS_PER_DOC = 2;

function objectKind(path = '') {
  const p = String(path || '');

  if (p.includes('/vault/updates/')) return 'vault-update';
  if (p.includes('/vault/snapshots/')) return 'vault-snapshot';
  if (p.includes('/docs/') && p.includes('/updates/')) return 'note-update';
  if (p.includes('/docs/') && p.includes('/snapshots/')) return 'note-snapshot';
  if (p.includes('/assets/')) return 'asset';

  return 'other';
}

function docSnapshotGroup(path = '') {
  const m = String(path || '').match(/^yanta-sync-v1\/docs\/([^/]+)\/snapshots\//);

  return m ? `doc:${m[1]}` : '';
}

function docUpdateGroup(path = '') {
  const m = String(path || '').match(/^yanta-sync-v1\/docs\/([^/]+)\/updates\//);

  return m ? `doc:${m[1]}` : '';
}

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

  for (const id of state.notes.keys()) ids.add(id);
  for (const id of vaultNotesMap().keys()) ids.add(id);

  for (const id of vaultTombstonesMap().keys()) {
    ids.delete(id);
  }

  return [...ids].filter(Boolean);
}

async function markLocalFullUpdateMarkersCovered(engine, noteIds = []) {
  if (!engine?.localState) return;

  const vaultVersion = localVaultContentVersion();

  if (vaultVersion > 0) {
    await engine.localState.set(
      'sync2.fullUpdateUploaded.vault.version',
      vaultVersion
    );
  }

  for (const noteId of noteIds) {
    const note =
      state.notes.get(noteId) ||
      vaultNotesMap().get(noteId);

    const version = sync2ObjectVersion(note);

    if (!version) continue;

    await engine.localState.set(
      `sync2.fullUpdateUploaded.note.${noteId}.version`,
      version
    );
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

  const vaultUpdates = sortOldestFirst(
    (index || []).filter((entry) => objectKind(entry.path) === 'vault-update')
  );

  let selected = [];
  let selectedBytes = 0;

  for (const entry of vaultUpdates) {
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
    message: `Creating upload headroom by pruning old vault updates…`,
  });

  return deleteRemoteEntries(engine, selected, {
    phase: 'compactHeadroom',
    message: 'Creating headroom…',
  });
}

function cleanupPlanFromIndex(index = [], {
  keepSnapshotsPerDoc = DEFAULT_KEEP_SNAPSHOTS_PER_DOC,
} = {}) {
  const entries = index || [];

  const vaultSnapshots = sortNewestFirst(
    entries.filter((entry) => objectKind(entry.path) === 'vault-snapshot')
  );

  const latestVaultSnapshotUpdated = entryUpdated(vaultSnapshots[0]);

  const deleteEntries = [];

  if (latestVaultSnapshotUpdated > 0) {
    for (const entry of entries) {
      if (
        objectKind(entry.path) === 'vault-update' &&
        entryUpdated(entry) <= latestVaultSnapshotUpdated
      ) {
        deleteEntries.push(entry);
      }
    }
  }

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

  const latestSnapshotUpdatedByDoc = new Map();

  for (const [group, list] of snapshotsByDoc) {
    const sorted = sortNewestFirst(list);

    latestSnapshotUpdatedByDoc.set(group, entryUpdated(sorted[0]));

    for (const oldSnapshot of sorted.slice(keepSnapshotsPerDoc)) {
      deleteEntries.push(oldSnapshot);
    }
  }

  for (const entry of entries) {
    if (objectKind(entry.path) !== 'note-update') continue;

    const group = docUpdateGroup(entry.path);
    const latestSnapshotUpdated = latestSnapshotUpdatedByDoc.get(group) || 0;

    if (latestSnapshotUpdated > 0 && entryUpdated(entry) <= latestSnapshotUpdated) {
      deleteEntries.push(entry);
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

export async function compactYantaCloudStorage(engine, {
  emergencyHeadroom = true,
  minHeadroomBytes = DEFAULT_MIN_HEADROOM_BYTES,
  keepSnapshotsPerDoc = DEFAULT_KEEP_SNAPSHOTS_PER_DOC,
  dropCoveredLocalOutbox = true,
} = {}) {
  if (!engine) {
    throw new Error('Sync engine missing.');
  }

  await engine.start();

  engine.progress?.({
    phase: 'compactStart',
    direction: 'up',
    detailed: true,
    message: 'Starting cloud storage compaction…',
  });

  await engine.loadRemoteIndex({
    force: true,
  });

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

  engine.progress?.({
    phase: 'compactSnapshots',
    direction: 'up',
    detailed: true,
    message: 'Uploading fresh encrypted vault snapshot…',
  });

  await uploadVaultSnapshot(engine);

  const noteIds = knownNoteIdsForSnapshots();

  let i = 0;

  for (const noteId of noteIds) {
    i++;

    engine.progress?.({
      phase: 'compactSnapshots',
      direction: 'up',
      detailed: true,
      current: i,
      total: noteIds.length,
      noteId,
      message: 'Uploading fresh encrypted note snapshots…',
    });

    await engine.observeNote(noteId);
    await uploadNoteSnapshot(engine, noteId);
  }

  engine.progress?.({
    phase: 'compactAssets',
    direction: 'up',
    detailed: true,
    message: 'Ensuring encrypted assets are present…',
  });

  const assets = await uploadMissingAssets(engine);

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
        message: `Dropped ${removed} local queued update${removed === 1 ? '' : 's'} covered by fresh snapshots.`,
      });
    }
  }

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

  await engine.loadRemoteIndex({
    force: true,
  });

  engine.progress?.({
    phase: 'compactComplete',
    status: 'done',
    direction: 'up',
    detailed: true,
    message: 'Cloud storage compaction complete.',
  });

  return {
    ok: true,
    headroom,
    snapshots: {
      vault: 1,
      notes: noteIds.length,
    },
    assets,
    cleanup,
    freedBytes: Number(headroom.bytes || 0) + Number(cleanup.bytes || 0),
  };
}