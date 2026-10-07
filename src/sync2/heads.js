// ============================================================
// YANTA Sync2 — Latest Heads
//
// SaaS storage model:
// - Updates are a short sync journal.
// - Heads are overwritten full-state snapshots per device.
// - Once this device uploads a head, update packs it has already seen/applied
//   are covered and can be pruned safely.
//
// Safety:
// - Heads are encrypted full Yjs state-as-update payloads.
// - One head per device per doc avoids last-writer-loss between devices.
// - We never delete unseen update packs.
// ============================================================

import * as Y from 'yjs';

import {
  encryptBytes,
} from './crypto.js';

import {
  vaultHeadPath,
  vaultHeadsPrefix,
  docHeadPath,
  docHeadsPrefix,
} from './ids.js';

import {
  encodeVaultState,
  encodeCompactVaultState,
  applyVaultUpdate,
} from './vault-doc.js';

import {
  getNoteDoc,
  encodeNoteState,
} from '../yjs.js';

import {
  mapOrdered,
  runSyncDownload,
  SYNC2_DOWNLOAD_CONCURRENCY,
  SYNC2_NOTE_CONCURRENCY,
} from './download-pool.js';

function headSeenKey(path) {
  return `sync2.headSeen.${path}.etag`;
}

async function readLocalState(localState, key, fallback = '') {
  try {
    return String(await localState.get(key, fallback) || fallback);
  } catch {
    return fallback;
  }
}

async function writeLocalState(localState, key, value) {
  try {
    await localState.set(key, String(value || ''));
  } catch {}
}

function entryEtag(entry) {
  return String(entry?.etag || `${entry?.size || 0}:${entry?.updated || 0}`);
}

function isVaultUpdateSeenRecord(rec) {
  return (
    rec?.type === 'vault-update' ||
    rec?.type === 'vault-update-update' ||
    String(rec?.path || '').includes('/vault/updates/')
  );
}

function isNoteUpdateSeenRecord(rec) {
  return (
    rec?.type === 'note-update' ||
    rec?.type === 'note-update-update' ||
    String(rec?.path || '').includes('/docs/') &&
    String(rec?.path || '').includes('/updates/')
  );
}

function entrySize(entry) {
  return Number(entry?.size || 0) || 0;
}

/*
  When this device last encoded each of its heads. A head contains every
  update this device had applied before that moment, so a seen pack is
  covered by the head iff it was marked seen before the head was encoded.
  This — not object timestamps — is what makes deleting a pack safe.
*/
const HEAD_ENCODED_AT_VAULT_KEY = 'sync2.headEncodedAt.vault';

function noteHeadEncodedAtKey(noteId) {
  return `sync2.headEncodedAt.note.${noteId}`;
}

async function readHeadEncodedAt(localState, key) {
  try {
    return Number(await localState.get(key, 0)) || 0;
  } catch {
    return 0;
  }
}

export async function uploadVaultHead(engine) {
  const path = vaultHeadPath(engine.deviceId);
  const encodedAt = Date.now();
  const plain = encodeCompactVaultState();

  const encrypted = await encryptBytes(
    engine.keys.contentKey,
    plain,
    path
  );

  await engine.remote.put(path, encrypted);
  engine.clearRemoteIndex?.();

  await engine.markSeen(path, {
    type: 'vault-head',
    own: true,
  });

  await engine.localState.set(HEAD_ENCODED_AT_VAULT_KEY, encodedAt);

  return {
    path,
    size: encrypted.byteLength,
  };
}

export async function uploadNoteHead(engine, noteId) {
  const path = await docHeadPath(
    engine.keys.nameKey,
    noteId,
    engine.deviceId
  );

  const encodedAt = Date.now();
  const plain = encodeNoteState(noteId);

  const encrypted = await encryptBytes(
    engine.keys.contentKey,
    plain,
    path
  );

  await engine.remote.put(path, encrypted);
  engine.clearRemoteIndex?.();

  await engine.markSeen(path, {
    type: 'note-head',
    noteId,
    own: true,
  });

  await engine.localState.set(noteHeadEncodedAtKey(noteId), encodedAt);

  return {
    path,
    noteId,
    size: encrypted.byteLength,
  };
}

export async function downloadVaultHeads(engine) {
  const entries = await engine.listRemote(vaultHeadsPrefix());

  let applied = 0;
  let processed = 0;

  engine.progress?.({
    phase: 'downloadVaultHeads',
    direction: 'down',
    current: 0,
    total: entries.length,
    message: 'Checking latest vault heads…',
  });

  for (const entry of entries) {
    processed++;

    const etag = entryEtag(entry);
    const seenKey = headSeenKey(entry.path);
    const seenEtag = await readLocalState(engine.localState, seenKey, '');

    engine.progress?.({
      phase: 'downloadVaultHeads',
      direction: 'down',
      current: processed,
      total: entries.length,
    });

    if (etag && seenEtag === etag) continue;

    // null: missing or unreadable — skipped, retried next sync.
    const plain = await engine.fetchAndDecrypt(entry.path);
    if (plain == null) continue;

    engine.noteIncomingVaultBytes?.(plain);
    applyVaultUpdate(plain, 'sync2-remote');

    await writeLocalState(engine.localState, seenKey, etag);

    applied++;
  }

  return {
    applied,
    entries: entries.length,
  };
}

export async function downloadNoteHeads(engine, noteId) {
  const prefix = await docHeadsPrefix(engine.keys.nameKey, noteId);
  const entries = await engine.listRemote(prefix);

  if (!entries.length) {
    return {
      noteId,
      applied: 0,
      entries: 0,
    };
  }

  await engine.observeNote(noteId);

  const { doc } = getNoteDoc(noteId);

  let applied = 0;
  let processed = 0;

  const updatesToApply = [];
  const seenWrites = [];

  engine.progress?.({
    phase: 'downloadNoteHeads',
    direction: 'down',
    noteId,
    current: 0,
    total: entries.length,
  });

  const pending = [];

  for (const entry of entries) {
    const etag = entryEtag(entry);
    const seenKey = headSeenKey(entry.path);
    const seenEtag = await readLocalState(engine.localState, seenKey, '');

    if (etag && seenEtag === etag) {
      processed++;
      continue;
    }

    pending.push({
      entry,
      etag,
      seenKey,
    });
  }

  for await (const { item, value: plain } of mapOrdered(
    pending,
    (task) => engine.fetchAndDecrypt(task.entry.path),
    {
      limit: SYNC2_DOWNLOAD_CONCURRENCY,
      run: runSyncDownload,
    }
  )) {
    processed++;

    engine.progress?.({
      phase: 'downloadNoteHeads',
      direction: 'down',
      noteId,
      current: processed,
      total: entries.length,
    });

    if (plain == null) continue;

    updatesToApply.push(plain);
    seenWrites.push({
      key: item.seenKey,
      etag: item.etag,
    });

    applied++;
  }

  if (updatesToApply.length) {
    const merged =
      updatesToApply.length === 1
        ? updatesToApply[0]
        : Y.mergeUpdates(updatesToApply);

    Y.applyUpdate(doc, merged, 'sync2-remote');
  }

  for (const item of seenWrites) {
    await writeLocalState(engine.localState, item.key, item.etag);
  }

  return {
    noteId,
    applied,
    entries: entries.length,
  };
}

export async function downloadKnownNoteHeads(engine, noteIds = []) {
  let applied = 0;
  let entries = 0;
  const appliedNoteIds = new Set();

  let current = 0;
  const total = noteIds.length;

  engine.progress?.({
    phase: 'downloadNoteHeads',
    direction: 'down',
    current,
    total,
    message: 'Checking latest note heads…',
  });

  for await (const { item: noteId, value: res } of mapOrdered(
    noteIds,
    (id) => downloadNoteHeads(engine, id),
    {
      limit: SYNC2_NOTE_CONCURRENCY,
    }
  )) {
    current++;

    engine.progress?.({
      phase: 'downloadNoteHeads',
      direction: 'down',
      current,
      total,
      noteId,
    });

    applied += res.applied;
    entries += res.entries;

    if (res.applied > 0) {
      appliedNoteIds.add(noteId);
    }
  }

  return {
    applied,
    entries,
    noteIds: [...appliedNoteIds],
  };
}

/**
 * Remote update packs this device's uploaded heads provably contain:
 * seen (applied) by this device before the covering head was encoded.
 *
 * vault: consider vault update packs.
 * noteIds: note ids whose packs to consider; null = every note that has
 *   a recorded head.
 */
export async function collectHeadCoveredSeenEntries(engine, index, {
  vault = true,
  noteIds = null,
} = {}) {
  const seen = typeof engine.localState?.listSeen === 'function'
    ? await engine.localState.listSeen()
    : [];

  if (!seen.length || !index?.length) return [];

  const remoteByPath = new Map(index.map((entry) => [entry.path, entry]));
  const noteSet = noteIds ? new Set([...noteIds].map(String)) : null;

  const vaultEncodedAt = vault
    ? await readHeadEncodedAt(engine.localState, HEAD_ENCODED_AT_VAULT_KEY)
    : 0;

  const noteEncodedAt = new Map();

  const encodedAtForNote = async (noteId) => {
    if (!noteEncodedAt.has(noteId)) {
      noteEncodedAt.set(
        noteId,
        await readHeadEncodedAt(engine.localState, noteHeadEncodedAtKey(noteId))
      );
    }

    return noteEncodedAt.get(noteId);
  };

  const covered = [];

  for (const rec of seen) {
    const path = String(rec?.path || '');
    const entry = remoteByPath.get(path);
    if (!entry) continue;

    const seenAt = Number(rec.seenAt || 0);
    if (!seenAt) continue;

    if (isVaultUpdateSeenRecord(rec)) {
      if (vaultEncodedAt && seenAt < vaultEncodedAt) covered.push(entry);
      continue;
    }

    if (isNoteUpdateSeenRecord(rec)) {
      const noteId = String(rec.noteId || '');
      if (!noteId) continue;
      if (noteSet && !noteSet.has(noteId)) continue;

      // Skipped (never applied) packs are covered by nothing.
      if (rec.type === 'skipped-tombstoned-note-update') continue;

      const encodedAt = await encodedAtForNote(noteId);

      if (encodedAt && seenAt < encodedAt) covered.push(entry);
    }
  }

  return covered;
}

export async function pruneSeenUpdatesCoveredByHeads(engine, {
  noteIdsWithHeads = [],
  vaultHeadUploaded = false,
  maxDeletes = 2500,
} = {}) {
  const index = await engine.loadRemoteIndex({
    force: true,
  });

  const candidates = await collectHeadCoveredSeenEntries(engine, index, {
    vault: vaultHeadUploaded,
    noteIds: noteIdsWithHeads,
  });

  if (!candidates.length) {
    return {
      deleted: 0,
      bytes: 0,
    };
  }

  const unique = [];
  const uniquePaths = new Set();

  for (const entry of candidates) {
    if (!entry?.path || uniquePaths.has(entry.path)) continue;

    uniquePaths.add(entry.path);
    unique.push(entry);

    if (unique.length >= maxDeletes) break;
  }

  let deleted = 0;
  let bytes = 0;
  let current = 0;
  const deletedPaths = [];

  for (const entry of unique) {
    current++;

    engine.progress?.({
      phase: 'pruneCoveredUpdates',
      direction: 'up',
      detailed: unique.length > 50,
      current,
      total: unique.length,
      message: 'Pruning sync journal covered by latest heads…',
    });

    try {
      await engine.remote.delete(entry.path);
      engine.clearRemoteIndex?.();

      deleted++;
      bytes += entrySize(entry);
      deletedPaths.push(entry.path);
    } catch (err) {
      console.warn('[YANTA Sync2] covered update prune failed', entry.path, err);
    }
  }

  // Gone for good (seq numbers are never reused): stop tracking them.
  await engine.localState.deleteSeen?.(deletedPaths);

  return {
    deleted,
    bytes,
  };
}

/*
  Seen records of update packs and snapshots other devices have deleted
  meanwhile. Without this the seen store only ever grew, and it is read in
  full at boot and on every prune. Needs a complete remote index; without
  one (Google Drive) nothing is dropped. Dropping a record for an object
  that does still exist only costs a re-download: applying is idempotent.
*/
export async function forgetSeenObjectsGoneFromRemote(engine) {
  if (typeof engine.localState?.listSeen !== 'function') return 0;

  const index = await engine.loadRemoteIndex({ force: true });
  if (!Array.isArray(index)) return 0;

  const present = new Set(index.map((entry) => entry.path));
  const seen = await engine.localState.listSeen();

  const gone = seen
    .map((rec) => String(rec?.path || ''))
    .filter((path) =>
      path &&
      !present.has(path) &&
      (path.includes('/updates/') || path.includes('/snapshots/'))
    );

  return engine.localState.deleteSeen?.(gone) || 0;
}
