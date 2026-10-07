// ============================================================
// YANTA Sync2 — vault version guard
//
// Vault heads and compacted update packs are encoded from fresh
// Y.Docs, so concurrent writes to the same map key resolve by
// random clientID, not by recency: a stale copy of an entry can
// permanently shadow a newer one after a pull (and every device
// republishes its own copy in its head, so staleness spreads).
// A rename made on the desktop could silently revert on the phone,
// a reminder vanish, an unsubscribed feed come back.
//
// The guard tracks the newest version (by `updated`) of every
// entry in the guarded maps seen during a pull — the local pre-pull
// state plus every incoming payload, probed in a throwaway doc —
// and re-asserts entries the CRDT merge left stale as a normal
// local write: causally after every integrated item, so it wins
// deterministically here and, via the queued update, everywhere.
//
// Entries without an `updated` stamp are not guarded. Tombstones
// are add-only and need no guard; they always beat a version.
// ============================================================

import * as Y from 'yjs';

import {
  getVaultDoc,
  vaultMap,
  vaultTombstonesMap,
  safeJsonClone,
} from './vault-doc.js';

/*
  Every synced vault map whose values carry an `updated` stamp.
  If a new synced entity map is added to the VaultDoc, add it here.
*/
const GUARDED_MAPS = Object.freeze([
  'notes',
  'folders',
  'images',
  'events',
  'calendarCategories',
  'rssFeeds',
  'spaces',
]);

function noteMapVersions(collector, name, entries) {
  const bucket = collector.get(name);

  for (const [id, value] of entries) {
    if (!value || typeof value !== 'object') continue;

    const updated = Number(value.updated || 0);
    if (!updated) continue;

    const key = String(id);
    const prev = bucket.get(key);

    if (!prev || updated > prev.updated) {
      bucket.set(key, {
        updated,
        value: safeJsonClone(value),
      });
    }
  }
}

/**
 * Start a collection for one pull cycle, seeded with the local
 * pre-pull state (the local copy may already be the newest).
 */
export function createVaultVersionCollector() {
  const collector = new Map(GUARDED_MAPS.map((name) => [name, new Map()]));

  try {
    for (const name of GUARDED_MAPS) {
      noteMapVersions(collector, name, vaultMap(name).entries());
    }
  } catch {}

  return collector;
}

/**
 * Record the entry versions carried by an incoming vault payload
 * (update pack content, head, or snapshot) before it is applied.
 */
export function collectVaultVersionsFromUpdate(collector, updateBytes) {
  if (!collector || !updateBytes) return;

  try {
    const probe = new Y.Doc({ gc: true });

    Y.applyUpdate(probe, updateBytes);

    for (const name of GUARDED_MAPS) {
      noteMapVersions(collector, name, probe.getMap(name).entries());
    }

    probe.destroy();
  } catch {}
}

/**
 * After all pulls: re-assert every entry whose merged value is older
 * than the newest version seen. Returns the number of restores.
 */
export function reconcileVaultVersions(collector, origin) {
  if (!collector) return 0;

  const tombstones = vaultTombstonesMap();
  const restores = [];

  for (const name of GUARDED_MAPS) {
    const map = vaultMap(name);

    for (const [id, newest] of collector.get(name)) {
      // Deletions win over any version.
      if (tombstones.has(id)) continue;

      const current = map.get(id);

      if (Number(current?.updated || 0) >= newest.updated) continue;

      restores.push({ map, id, value: newest.value });
    }
  }

  if (!restores.length) return 0;

  getVaultDoc().transact(() => {
    for (const restore of restores) {
      restore.map.set(restore.id, safeJsonClone(restore.value));
    }
  }, origin);

  return restores.length;
}
