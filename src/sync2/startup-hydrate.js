// ============================================================
// YANTA Sync2 — startup hydration
//
// The VaultDoc (persisted by y-indexeddb) is the source of truth for
// vault metadata; the core IndexedDB stores are a cache. At boot the
// cache may lag behind — notes created on another device, a sync that
// stopped between applying vault updates and refreshing the cache — so
// state and cache are brought in line with the VaultDoc before the
// first render.
// ============================================================

import { state, store } from '../core.js';
import { rebuildWikilinkIndex } from '../notes.js';
import { revokeImageObjectUrl } from '../media/object-url-cache.js';

import {
  vaultNotesMap,
  vaultFoldersMap,
  vaultImagesMap,
  vaultTombstonesMap,
  safeJsonClone,
} from './vault-doc.js';

import {
  sanitizeNoteMeta,
  sanitizeFolderMeta,
  sanitizeImageMeta,
  jsonEqual,
} from './meta-sanitize.js';

export async function hydrateLocalMetadataFromVaultDocOnStartup() {
  const tombstones = vaultTombstonesMap();

  let changed = false;

  for (const [id, t] of tombstones) {
    if (t?.type === 'note') {
      if (state.notes.has(id) || state.searchIndex.has(id)) {
        changed = true;
      }

      state.notes.delete(id);
      state.searchIndex.delete(id);

      try {
        await store.notes.del(id);
      } catch {}
    }

    if (t?.type === 'folder') {
      if (state.folders.has(id) || state.expandedFolders.has(id)) {
        changed = true;
      }

      state.folders.delete(id);
      state.expandedFolders.delete(id);

      try {
        await store.folders.del(id);
      } catch {}
    }

    if (t?.type === 'image') {
      if (state.imagesMeta.has(id) || state.imageBlobs.has(id)) {
        changed = true;
      }

      state.imagesMeta.delete(id);

      revokeImageObjectUrl(id);

      try {
        await store.images.del(id);
      } catch {}
    }
  }

  for (const [id, raw] of vaultFoldersMap()) {
    if (tombstones.has(id)) continue;

    const next = sanitizeFolderMeta(raw);
    if (!next?.id) continue;

    const existing = state.folders.get(id);

    // Compared in sanitized form: local-only extras in the cached record
    // are not a difference worth a rewrite.
    if (!existing || !jsonEqual(sanitizeFolderMeta(existing), next)) {
      changed = true;
      state.folders.set(id, safeJsonClone(next));

      try {
        await store.folders.put(safeJsonClone(next));
      } catch {}
    }
  }

  for (const [id, raw] of vaultNotesMap()) {
    if (tombstones.has(id)) continue;

    const next = sanitizeNoteMeta(raw);
    if (!next?.id) continue;

    const existing = state.notes.get(id);

    if (!existing || !jsonEqual(sanitizeNoteMeta(existing), next)) {
      changed = true;
      state.notes.set(id, safeJsonClone(next));

      try {
        await store.notes.put(safeJsonClone(next));
      } catch {}
    }
  }

  for (const [id, raw] of vaultImagesMap()) {
    if (tombstones.has(id)) continue;

    const next = sanitizeImageMeta(raw);
    if (!next?.id) continue;

    const existing = state.imagesMeta.get(id);

    if (!existing || !jsonEqual(sanitizeImageMeta(existing), next)) {
      changed = true;
      state.imagesMeta.set(id, safeJsonClone(next));
    }
  }

  if (changed) {
    rebuildWikilinkIndex();
  }

  return {
    changed,
    notes: state.notes.size,
    folders: state.folders.size,
    images: state.imagesMeta.size,
  };
}
