// ============================================================
// YANTA Sync2 — Remote snapshot helpers
//
// Snapshots are full Yjs state-as-update payloads.
// They are stored encrypted in the same provider-independent object store.
//
// Remote paths:
//   yanta-sync-v1/vault/snapshots/<deviceId>-<seq>.ysnap.enc
//   yanta-sync-v1/docs/<remoteDocId>/snapshots/<deviceId>-<seq>.ysnap.enc
// ============================================================

import * as Y from 'yjs';

import {
  encryptBytes,
  decryptBytes,
} from './crypto.js';

import {
  vaultSnapshotPath,
  docSnapshotPath,
  vaultSnapshotsPrefix,
  docSnapshotsPrefix,
} from './ids.js';

import {
  encodeVaultState,
  applyVaultUpdate,
} from './vault-doc.js';

import {
  getNoteDoc,
  encodeNoteState,
} from '../yjs.js';

function sortEntriesOldestFirst(entries) {
  return [...entries].sort((a, b) => {
    const au = Number(a.updated || 0);
    const bu = Number(b.updated || 0);

    return au - bu || String(a.path).localeCompare(String(b.path));
  });
}

export async function uploadVaultSnapshot(engine, {
  full = true,
} = {}) {
  const seq = await engine.nextSeq();
  const path = vaultSnapshotPath(engine.deviceId, seq);
  const plain = encodeVaultState();

  const encrypted = await encryptBytes(
    engine.keys.contentKey,
    plain,
    path
  );

  await engine.remote.put(path, encrypted, { ifAbsent: true });
  await engine.markSeen(path, { type: 'vault-snapshot', own: true });

  return {
    path,
    seq,
    size: encrypted.byteLength,
    full,
  };
}

export async function uploadNoteSnapshot(engine, noteId, {
  full = true,
} = {}) {
  const entry = getNoteDoc(noteId);
  await entry.ready;

  const seq = await engine.nextSeq();

  const path = await docSnapshotPath(
    engine.keys.nameKey,
    noteId,
    engine.deviceId,
    seq
  );

  const plain = encodeNoteState(noteId);

  const encrypted = await encryptBytes(
    engine.keys.contentKey,
    plain,
    path
  );

  await engine.remote.put(path, encrypted, { ifAbsent: true });
  await engine.markSeen(path, { type: 'note-snapshot', noteId, own: true });

  return {
    path,
    seq,
    noteId,
    size: encrypted.byteLength,
    full,
  };
}

export async function downloadVaultSnapshots(engine) {
  const entries = sortEntriesOldestFirst(
    await engine.remote.list(vaultSnapshotsPrefix())
  );

  let applied = 0;

  for (const entry of entries) {
    if (await engine.hasSeen(entry.path)) continue;

    const encrypted = await engine.remote.get(entry.path);

    const plain = await decryptBytes(
      engine.keys.contentKey,
      encrypted,
      entry.path
    );

    applyVaultUpdate(plain, 'sync2-remote');

    await engine.markSeen(entry.path, {
      type: 'vault-snapshot',
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

export async function downloadNoteSnapshots(engine, noteId) {
  const prefix = await docSnapshotsPrefix(engine.keys.nameKey, noteId);

  const entries = sortEntriesOldestFirst(
    await engine.remote.list(prefix)
  );

  let applied = 0;

  if (!entries.length) {
    return {
      noteId,
      applied,
      entries: 0,
    };
  }

  await engine.observeNote(noteId);

  const { doc } = getNoteDoc(noteId);

  for (const entry of entries) {
    if (await engine.hasSeen(entry.path)) continue;

    const encrypted = await engine.remote.get(entry.path);

    const plain = await decryptBytes(
      engine.keys.contentKey,
      encrypted,
      entry.path
    );

    Y.applyUpdate(doc, plain, 'sync2-remote');

    await engine.markSeen(entry.path, {
      type: 'note-snapshot',
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