// ============================================================
// YANTA Shared Spaces — sync engine
//
// One engine per mounted space. Deliberately independent from the
// private-vault Sync2AppEngine: spaces have their own key material,
// their own remote container and no vault-doc coupling.
//
// Storage model (same shape as sync2/heads.js):
// - updates: short append-only journal, one encrypted pack per batch
// - heads:   one overwritten full-state snapshot per participant
// After uploading a head, a participant prunes its own covered
// update packs. This keeps the container small and — crucially —
// means a joiner can always restore the full document from the
// server even when every other participant is offline.
//
// Directions:
// - Writers observe the note's Y.Doc, batch local updates (debounced),
//   encrypt and upload them, then emit a poke.
// - Everyone pulls on poke / interval: fetch unseen encrypted heads +
//   updates, decrypt, merge, apply with the 'space-remote' origin.
// ============================================================

import * as Y from 'yjs';

import { encryptBytes, decryptBytes } from '../sync2/crypto.js';
import { createAndEncodeUpdatePack, decodePack } from '../sync2/pack.js';
import { getNoteDoc, encodeNoteState } from '../yjs.js';
import { store } from '../core.js';

import { deriveSpaceKeys } from './space-keys.js';
import {
  createParticipantId,
  spaceDocUpdatePath,
  spaceDocHeadPath,
  spaceDocPrefix,
  spaceDocUpdatesPrefix,
} from './space-ids.js';

export const SPACE_REMOTE_ORIGIN = 'space-remote';

const FLUSH_DEBOUNCE_MS = 1_500;
const HEAD_EVERY_N_PACKS = 24;
const HEAD_MAX_AGE_MS = 5 * 60 * 1_000;

function engineStateKey(spaceId) {
  return `space.${spaceId}.state`;
}

function entryEtag(entry) {
  return String(entry?.etag || `${entry?.size || 0}:${entry?.updated || 0}`);
}

export class SpaceEngine {
  constructor({ spaceId, rootKey, role, remote, onDidUpload = null, onDidApply = null }) {
    this.spaceId = String(spaceId);
    this.rootKey = rootKey;
    this.role = role;
    this.remote = remote;
    this.onDidUpload = onDidUpload;
    this.onDidApply = onDidApply;

    this.keys = null;
    this.state = null;

    // docId (= noteId for note spaces) -> { doc, handler, buffer }
    this.docs = new Map();

    this.flushTimer = null;
    this.flushing = null;
    this.pulling = null;
    this.pullAgain = false;
    this.destroyed = false;
  }

  get canWrite() {
    return this.role === 'owner' || this.role === 'write';
  }

  async init() {
    this.keys = await deriveSpaceKeys(this.rootKey);

    const saved = await store.settings.get(engineStateKey(this.spaceId), null);

    this.state = saved && saved.participantId
      ? saved
      : {
          participantId: createParticipantId(),
          seq: 0,
          seen: {},
          packsSinceHead: 0,
          lastHeadAt: 0,
        };

    if (!saved) {
      await this.persistState();
    }

    return this;
  }

  async persistState() {
    try {
      await store.settings.set(engineStateKey(this.spaceId), this.state);
    } catch {}
  }

  async forgetState() {
    try {
      await store.settings.set(engineStateKey(this.spaceId), null);
    } catch {}
  }

  // ---------------- doc attachment ------------------------------

  /**
   * Attach a local note doc under a space-stable remote key.
   *
   * Local note IDs differ between participants (recipients mount a
   * placeholder note), so remote paths are derived from `remoteKey`
   * — the same for everyone in the space — never from the local ID.
   */
  async attachDoc(noteId, remoteKey) {
    if (this.docs.has(noteId)) return;

    if (!remoteKey) {
      throw new Error('SpaceEngine.attachDoc requires a remoteKey');
    }

    const entry = getNoteDoc(noteId);
    await entry.ready;

    const record = {
      doc: entry.doc,
      remoteKey,
      handler: null,
      buffer: [],
    };

    if (this.canWrite) {
      record.handler = (update, origin) => {
        if (origin === SPACE_REMOTE_ORIGIN) return;
        record.buffer.push(new Uint8Array(update));
        this.scheduleFlush();
      };

      entry.doc.on('update', record.handler);
    }

    this.docs.set(noteId, record);
  }

  detach() {
    this.destroyed = true;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;

    for (const record of this.docs.values()) {
      if (record.handler) {
        try {
          record.doc.off('update', record.handler);
        } catch {}
      }
    }

    this.docs.clear();
  }

  // ---------------- upload path (writers) -----------------------

  scheduleFlush() {
    if (this.flushTimer || this.destroyed) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch((err) => {
        console.warn('[YANTA Spaces] flush failed', err);
      });
    }, FLUSH_DEBOUNCE_MS);
  }

  async flush() {
    if (!this.canWrite || this.destroyed) return;

    if (this.flushing) {
      await this.flushing;
      return this.flush();
    }

    this.flushing = this.flushNow();

    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  async flushNow() {
    let uploaded = false;

    for (const [, record] of this.docs) {
      if (!record.buffer.length) continue;

      const updates = record.buffer;
      record.buffer = [];

      const merged = updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);

      this.state.seq += 1;

      const path = await spaceDocUpdatePath(
        this.keys.nameKey,
        record.remoteKey,
        this.state.participantId,
        this.state.seq
      );

      const pack = createAndEncodeUpdatePack({
        kind: 'space-doc-update',
        deviceId: this.state.participantId,
        seq: this.state.seq,
        docId: record.remoteKey,
        updates: [merged],
      });

      const encrypted = await encryptBytes(this.keys.contentKey, pack, path);

      try {
        const entry = await this.remote.put(path, encrypted);
        this.state.seen[path] = entry ? entryEtag(entry) : 'own';
        this.state.packsSinceHead += 1;
        uploaded = true;
      } catch (err) {
        // Put the batch back so nothing is lost; retry on next change/poll.
        record.buffer = [merged, ...record.buffer];
        this.state.seq -= 1;
        await this.persistState();
        throw err;
      }
    }

    if (!uploaded) return;

    const headDue =
      this.state.packsSinceHead >= HEAD_EVERY_N_PACKS ||
      Date.now() - (this.state.lastHeadAt || 0) > HEAD_MAX_AGE_MS;

    if (headDue) {
      await this.uploadHeads().catch((err) => {
        console.warn('[YANTA Spaces] head upload failed', err);
      });
    }

    await this.persistState();
    this.onDidUpload?.();
  }

  /**
   * Upload a full-state head per attached doc, then prune this
   * participant's own update packs that the head now covers.
   */
  async uploadHeads() {
    if (!this.canWrite) return;

    const coveredSeq = this.state.seq;

    for (const [noteId, record] of this.docs) {
      const path = await spaceDocHeadPath(
        this.keys.nameKey,
        record.remoteKey,
        this.state.participantId
      );

      const plain = encodeNoteState(noteId);
      const encrypted = await encryptBytes(this.keys.contentKey, plain, path);
      const entry = await this.remote.put(path, encrypted);

      this.state.seen[path] = entry ? entryEtag(entry) : 'own';
      await this.pruneOwnCoveredUpdates(record.remoteKey, coveredSeq);
    }

    this.state.packsSinceHead = 0;
    this.state.lastHeadAt = Date.now();
    await this.persistState();
  }

  async pruneOwnCoveredUpdates(remoteKey, coveredSeq) {
    const prefix = await spaceDocUpdatesPrefix(this.keys.nameKey, remoteKey);
    const marker = `${this.state.participantId}-`;

    let entries = [];

    try {
      entries = await this.remote.list(prefix);
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = String(entry.path || '').slice(prefix.length);
      if (!name.startsWith(marker)) continue;

      const seq = Number(name.slice(marker.length).split('.')[0]);
      if (!Number.isFinite(seq) || seq > coveredSeq) continue;

      try {
        await this.remote.delete(entry.path);
        delete this.state.seen[entry.path];
      } catch {}
    }
  }

  /**
   * Make sure the full current state exists on the server. Called on
   * mount by the owner so a share is restorable the moment it exists.
   */
  async ensureHeads() {
    if (!this.canWrite) return;

    for (const [noteId, record] of this.docs) {
      const path = await spaceDocHeadPath(
        this.keys.nameKey,
        record.remoteKey,
        this.state.participantId
      );

      const existing = await this.remote.stat(path).catch(() => null);
      if (existing) continue;

      const plain = encodeNoteState(noteId);
      const encrypted = await encryptBytes(this.keys.contentKey, plain, path);
      const entry = await this.remote.put(path, encrypted);
      this.state.seen[path] = entry ? entryEtag(entry) : 'own';
    }

    this.state.lastHeadAt = Date.now();
    await this.persistState();
  }

  // ---------------- download path (everyone) --------------------

  async pull() {
    if (this.destroyed) return;

    if (this.pulling) {
      this.pullAgain = true;
      return this.pulling;
    }

    this.pulling = this.pullNow();

    try {
      await this.pulling;
    } finally {
      this.pulling = null;

      if (this.pullAgain && !this.destroyed) {
        this.pullAgain = false;
        await this.pull();
      }
    }
  }

  async pullNow() {
    let index = [];

    try {
      index = await this.remote.index();
    } catch (err) {
      console.warn('[YANTA Spaces] index failed', err);
      return;
    }

    for (const [noteId, record] of this.docs) {
      const prefix = await spaceDocPrefix(this.keys.nameKey, record.remoteKey);

      const fresh = index.filter((entry) => {
        const path = String(entry.path || '');
        if (!path.startsWith(prefix)) return false;
        return this.state.seen[path] !== entryEtag(entry);
      });

      if (!fresh.length) continue;

      const updates = [];
      const seenWrites = [];

      for (const entry of fresh) {
        let plain = null;

        try {
          const encrypted = await this.remote.get(entry.path);
          plain = await decryptBytes(this.keys.contentKey, encrypted, entry.path);
        } catch (err) {
          if (err?.code === 'ENOENT') {
            // Pruned between index and get — treat as seen.
            seenWrites.push({ path: entry.path, etag: entryEtag(entry) });
            continue;
          }
          console.warn('[YANTA Spaces] pull object failed', entry.path, err);
          continue;
        }

        if (entry.path.includes('/updates/')) {
          try {
            const pack = decodePack(plain);
            for (const u of pack.updates || []) updates.push(u);
          } catch (err) {
            console.warn('[YANTA Spaces] bad update pack', entry.path, err);
          }
        } else {
          // Heads are raw full-state updates.
          updates.push(plain);
        }

        seenWrites.push({ path: entry.path, etag: entryEtag(entry) });
      }

      if (updates.length) {
        const merged = updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);
        Y.applyUpdate(record.doc, merged, SPACE_REMOTE_ORIGIN);
        this.onDidApply?.(noteId);
      }

      for (const write of seenWrites) {
        this.state.seen[write.path] = write.etag;
      }
    }

    // Drop seen entries whose objects no longer exist (pruned journal),
    // so the map cannot grow without bound.
    const alive = new Set(index.map((entry) => String(entry.path || '')));

    for (const path of Object.keys(this.state.seen)) {
      if (!alive.has(path)) delete this.state.seen[path];
    }

    await this.persistState();
  }
}
