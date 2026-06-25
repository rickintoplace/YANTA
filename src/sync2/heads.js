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
  decryptBytes,
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

export async function uploadVaultHead(engine) {
  const path = vaultHeadPath(engine.deviceId);
  const plain = encodeCompactVaultState();

  const encrypted = await encryptBytes(
    engine.keys.contentKey,
    plain,
    path
  );

  await engine.remote.put(path, encrypted, {
    ifAbsent: false,
  });

  engine.clearRemoteIndex?.();

  return {
    path,
    size: encrypted.byteLength,
  };
}

export async function uploadNoteHead(engine, noteId) {
  const entry = getNoteDoc(noteId);
  await entry.ready;

  const path = await docHeadPath(
    engine.keys.nameKey,
    noteId,
    engine.deviceId
  );

  const plain = encodeNoteState(noteId);

  const encrypted = await encryptBytes(
    engine.keys.contentKey,
    plain,
    path
  );

  await engine.remote.put(path, encrypted, {
    ifAbsent: false,
  });

  engine.clearRemoteIndex?.();

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

    const encrypted = await engine.remote.get(entry.path);

    const plain = await decryptBytes(
      engine.keys.contentKey,
      encrypted,
      entry.path
    );

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

  for (const entry of entries) {
    processed++;

    const etag = entryEtag(entry);
    const seenKey = headSeenKey(entry.path);
    const seenEtag = await readLocalState(engine.localState, seenKey, '');

    engine.progress?.({
      phase: 'downloadNoteHeads',
      direction: 'down',
      noteId,
      current: processed,
      total: entries.length,
    });

    if (etag && seenEtag === etag) continue;

    const encrypted = await engine.remote.get(entry.path);

    const plain = await decryptBytes(
      engine.keys.contentKey,
      encrypted,
      entry.path
    );

    updatesToApply.push(plain);
    seenWrites.push({
      key: seenKey,
      etag,
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

  for (const noteId of noteIds) {
    current++;

    engine.progress?.({
      phase: 'downloadNoteHeads',
      direction: 'down',
      current,
      total,
      noteId,
    });

    const res = await downloadNoteHeads(engine, noteId);

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

export async function pruneSeenUpdatesCoveredByHeads(engine, {
  noteIdsWithHeads = [],
  vaultHeadUploaded = false,
  maxDeletes = 2500,
} = {}) {
  const seen = typeof engine.localState?.listSeen === 'function'
    ? await engine.localState.listSeen()
    : [];

  if (!seen.length) {
    return {
      deleted: 0,
      bytes: 0,
    };
  }

  const noteSet = new Set(noteIdsWithHeads.map(String));

  const index = await engine.loadRemoteIndex({
    force: true,
  });

  const remoteByPath = new Map(
    (index || []).map((entry) => [entry.path, entry])
  );

  const candidates = [];

  for (const rec of seen) {
    const path = String(rec?.path || '');
    if (!path) continue;

    if (!remoteByPath.has(path)) continue;

    if (vaultHeadUploaded && isVaultUpdateSeenRecord(rec)) {
      candidates.push(remoteByPath.get(path));
      continue;
    }

    if (isNoteUpdateSeenRecord(rec)) {
      const noteId = String(rec.noteId || '');

      if (noteId && noteSet.has(noteId)) {
        candidates.push(remoteByPath.get(path));
      }
    }
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
    } catch (err) {
      console.warn('[YANTA Sync2] covered update prune failed', entry.path, err);
    }
  }

  return {
    deleted,
    bytes,
  };
}