// ============================================================
// YANTA Sync2 — notification ack objects
//
// A device's notification ack ("my native alarm scheduler knows
// these reminder versions", written into its vault device record
// by notification-sync-status.js) must reach every other device —
// the dashboard and the event editor show reminders as uncovered
// until it arrives.
//
// It syncs as a dedicated per-device overwritten object instead of
// riding the vault update/head pipeline, because that pipeline is
// wrong for it in two ways:
// - Vault heads / compacted updates are fresh Y.Docs, so map-key
//   conflicts resolve by random clientID, not recency — an older
//   ack copy can permanently shadow a newer one.
// - The durable vault fingerprint deliberately excludes devices,
//   so ack-only update packs are dropped as redundant and heads
//   never carry them.
// One object per device means a single writer per path; receivers
// merge by ack.updatedAt, which is deterministic and self-healing.
// ============================================================

import {
  encryptBytes,
  decryptBytes,
  utf8Encode,
  utf8Decode,
} from './crypto.js';

import {
  notificationAckPath,
  notificationAcksPrefix,
} from './ids.js';

import {
  getVaultDoc,
  vaultDevicesMap,
  safeJsonClone,
  VAULT_ORIGINS,
} from './vault-doc.js';

const UPLOAD_MARKER_KEY = 'sync2.notificationAck.lastUploadedBody';

function ackSeenKey(path) {
  return `sync2.ackSeen.${path}.etag`;
}

function entryEtag(entry) {
  return String(entry?.etag || `${entry?.size || 0}:${entry?.updated || 0}`);
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

/**
 * Upload this device's current notification ack when it changed
 * since the last upload. One overwritten object per device — no
 * journal growth, nothing for head pruning to swallow.
 */
export async function uploadNotificationAckIfChanged(engine) {
  const record = vaultDevicesMap().get(engine.deviceId);
  const ack = record?.notificationSync;

  if (!ack) {
    return { uploaded: 0 };
  }

  const body = JSON.stringify({
    v: 1,
    deviceId: engine.deviceId,
    name: String(record.name || ''),
    ack: safeJsonClone(ack),
  });

  const last = await readLocalState(engine.localState, UPLOAD_MARKER_KEY, '');
  if (last === body) {
    return { uploaded: 0 };
  }

  const path = notificationAckPath(engine.deviceId);

  const encrypted = await encryptBytes(
    engine.keys.contentKey,
    utf8Encode(body),
    path
  );

  await engine.remote.put(path, encrypted);
  engine.clearRemoteIndex?.();

  await writeLocalState(engine.localState, UPLOAD_MARKER_KEY, body);

  return { uploaded: 1 };
}

/**
 * Pull the other devices' ack objects and fold newer acks into the
 * local vault devices map, so the existing consumers (dashboard info
 * panel, event editor device rows) and their map observers keep
 * working unchanged. Applied with remote origin — never queued back
 * into the outbox.
 */
export async function downloadNotificationAcks(engine) {
  const entries = await engine.listRemote(notificationAcksPrefix());
  const ownPath = notificationAckPath(engine.deviceId);

  let applied = 0;

  for (const entry of entries) {
    // This device is the only writer of its own ack object.
    if (entry.path === ownPath) continue;

    const etag = entryEtag(entry);
    const seenKey = ackSeenKey(entry.path);
    const seenEtag = await readLocalState(engine.localState, seenKey, '');

    if (etag && seenEtag === etag) continue;

    let payload = null;

    try {
      const encrypted = await engine.remote.get(entry.path);

      const plain = await decryptBytes(
        engine.keys.contentKey,
        encrypted,
        entry.path
      );

      payload = JSON.parse(utf8Decode(plain));
    } catch (err) {
      console.warn('[YANTA Sync2] notification ack unreadable', entry.path, err);
      continue;
    }

    if (applyRemoteNotificationAck(payload)) {
      applied++;
    }

    await writeLocalState(engine.localState, seenKey, etag);
  }

  return {
    applied,
    entries: entries.length,
  };
}

function applyRemoteNotificationAck(payload) {
  const deviceId = String(payload?.deviceId || '');
  const ack = payload?.ack;

  if (payload?.v !== 1 || !deviceId || !ack || typeof ack !== 'object') {
    return false;
  }

  const devices = vaultDevicesMap();
  const existing = devices.get(deviceId) || null;

  // Single writer per device + timestamp merge: never regress an ack.
  const incomingAt = Number(ack.updatedAt || 0);
  const currentAt = Number(existing?.notificationSync?.updatedAt || 0);

  if (incomingAt <= currentAt) return false;

  getVaultDoc().transact(() => {
    devices.set(deviceId, {
      ...(existing ? safeJsonClone(existing) : { created: Date.now() }),
      id: deviceId,
      name: String(payload.name || existing?.name || '') || deviceId,
      notificationSync: safeJsonClone(ack),
    });
  }, VAULT_ORIGINS.REMOTE);

  return true;
}
