// ============================================================
// YANTA Shared Spaces — share health
//
// Why this exists:
// A space is zero-knowledge. Its keys live only in the participant's
// own storage, so the server can never hand them back. Before space
// records travelled with the vault (see vault-doc.js `spaces`), losing
// local browser storage orphaned every share the device owned — and it
// did so SILENTLY: the shared calendar kept working locally, kept
// accepting entries, and nothing ever reached the other side again.
//
// Durable records prevent that going forward. This module covers the
// case where it happens anyway — a share created before the fix, a
// restore from a backup that predates it, a partial wipe — by asking
// the one party that still knows the share exists: the server.
//
// The server knows a space's id, type and source id, but never its
// keys. So it can tell us "you still own an active share of category X"
// while we can no longer open it. That difference is exactly what has
// to be reported instead of failing quietly.
// ============================================================

import { state, store } from '../core.js';
import { YANTA_CLOUD_BASE_URL } from '../cloud/cloud-api.js';
import { fetchWithRetry, errorFromResponse } from '../cloud/cloud-fetch.js';

import {
  vaultCalendarCategoriesMap,
  vaultFoldersMap,
  vaultNotesMap,
} from '../sync2/vault-doc.js';

const NOTIFIED_SETTING = 'spaces.brokenNotified.v1';

/*
  Result of the last reconciliation. Render paths read this synchronously
  (an event chip cannot await a fetch), so it is a plain array that is
  replaced wholesale.
*/
let brokenList = [];
let lastCheckedAt = 0;
let checking = null;

export function brokenShares() {
  return brokenList;
}

export function hasBrokenShares() {
  return brokenList.length > 0;
}

/**
 * Is this calendar category one whose sharing is broken on this device?
 * Used by the calendar to mark entries that look shared but are not
 * going anywhere.
 */
export function brokenShareForCategory(categoryId) {
  const id = String(categoryId || '');
  if (!id) return null;

  return brokenList.find(
    (b) => b.sourceType === 'calendar' && b.sourceId === id
  ) || null;
}

export function brokenShareForFolder(folderId) {
  const id = String(folderId || '');
  if (!id) return null;

  return brokenList.find(
    (b) => b.sourceType === 'folder' && b.sourceId === id
  ) || null;
}

function apiUrl(path) {
  return `${String(YANTA_CLOUD_BASE_URL || '/cloud-api').replace(/\/+$/, '')}${path}`;
}

/*
  A name the user recognises. The server only knows the source id; the
  matching object usually still exists locally — that is the whole point,
  the calendar is still there, it just is not shared any more.

  The VaultDoc is consulted before in-memory state: this runs during boot
  and after sync, when the vault is already hydrated but the calendar and
  tree modules may not have populated their state maps yet. Getting this
  wrong means telling someone "sharing stopped for the calendar 'a
  calendar'", which is worse than useless.
*/
function fromVaultMap(readMap, id, field) {
  try {
    const value = readMap().get(id);
    const name = value?.[field];

    return typeof name === 'string' && name.trim() ? name.trim() : '';
  } catch {
    return '';
  }
}

function labelForSource(sourceType, sourceId) {
  const id = String(sourceId || '');
  if (!id) return '';

  if (sourceType === 'calendar') {
    return fromVaultMap(vaultCalendarCategoriesMap, id, 'name')
      || state.calendarCategories.get(id)?.name
      || 'a calendar';
  }

  if (sourceType === 'folder') {
    return fromVaultMap(vaultFoldersMap, id, 'name')
      || state.folders.get(id)?.name
      || 'a folder';
  }

  return fromVaultMap(vaultNotesMap, id, 'title')
    || state.notes.get(id)?.title
    || 'a note';
}

/**
 * Compare the shares the server still lists against the ones this device
 * can actually open.
 *
 * Never throws: this is a diagnostic, and a failed check must not break
 * boot or sync. It simply leaves the previous result in place.
 */
export async function reconcileOwnedSpaces({ force = false } = {}) {
  if (checking) return checking;

  if (!force && lastCheckedAt && Date.now() - lastCheckedAt < 60_000) {
    return brokenList;
  }

  checking = (async () => {
    let owned = [];

    try {
      const res = await fetchWithRetry(apiUrl('/api/spaces'), {
        method: 'GET',
        credentials: 'include',
      }, { label: 'List shared spaces', attempts: 2 });

      if (!res.ok) throw await errorFromResponse(res, 'Could not list shared spaces');

      const json = await res.json();
      owned = Array.isArray(json?.owned) ? json.owned : [];
    } catch {
      /*
        Offline, signed out, or the API is down. Not knowing is not the
        same as "nothing is broken", so the previous result stands.
      */
      return brokenList;
    }

    let localRecords = [];

    try {
      localRecords = await store.spaces.all();
    } catch {
      return brokenList;
    }

    const localIds = new Set(localRecords.map((r) => String(r?.spaceId || '')));

    const next = [];

    for (const space of owned) {
      if (String(space?.status || '') !== 'active') continue;

      const spaceId = String(space?.id || '');
      if (!spaceId || localIds.has(spaceId)) continue;

      const sourceType = String(space?.sourceType || 'note');
      const sourceId = String(space?.sourceId || '');

      next.push({
        spaceId,
        sourceType,
        sourceId,
        createdAt: Number(space?.createdAt || 0),
        objectCount: Number(space?.objectCount || 0),
        label: labelForSource(sourceType, sourceId),
      });
    }

    const changed =
      next.length !== brokenList.length ||
      next.some((b, i) => b.spaceId !== brokenList[i]?.spaceId);

    brokenList = next;
    lastCheckedAt = Date.now();

    if (changed) {
      try {
        window.dispatchEvent(new CustomEvent('yanta-space-health-changed', {
          detail: { broken: next.length },
        }));
      } catch {}
    }

    return brokenList;
  })();

  try {
    return await checking;
  } finally {
    checking = null;
  }
}

/**
 * Which broken shares has the user not been told about yet?
 * Reporting is per space and once — a permanent nag would be worse than
 * the inline markers that stay visible anyway.
 */
export async function unreportedBrokenShares() {
  if (!brokenList.length) return [];

  let notified = [];

  try {
    notified = await store.settings.get(NOTIFIED_SETTING, []);
  } catch {
    notified = [];
  }

  const seen = new Set(Array.isArray(notified) ? notified : []);

  return brokenList.filter((b) => !seen.has(b.spaceId));
}

export async function markBrokenSharesReported(spaceIds = []) {
  const ids = spaceIds.map((id) => String(id || '')).filter(Boolean);
  if (!ids.length) return;

  let notified = [];

  try {
    notified = await store.settings.get(NOTIFIED_SETTING, []);
  } catch {
    notified = [];
  }

  const merged = [...new Set([
    ...(Array.isArray(notified) ? notified : []),
    ...ids,
  ])];

  try {
    await store.settings.set(NOTIFIED_SETTING, merged);
  } catch {}
}

/**
 * Forget a broken share for good: the server drops the orphaned space
 * (its encrypted objects are unreadable to everyone but the members who
 * still hold keys) and it stops being reported.
 */
export async function discardBrokenShare(spaceId) {
  const id = String(spaceId || '');
  if (!id) return false;

  try {
    const res = await fetchWithRetry(apiUrl(`/api/spaces/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      credentials: 'include',
    }, { label: 'Delete shared space', attempts: 2 });

    if (!res.ok) throw await errorFromResponse(res, 'Could not delete shared space');
  } catch {
    return false;
  }

  brokenList = brokenList.filter((b) => b.spaceId !== id);

  try {
    window.dispatchEvent(new CustomEvent('yanta-space-health-changed', {
      detail: { broken: brokenList.length },
    }));
  } catch {}

  return true;
}
