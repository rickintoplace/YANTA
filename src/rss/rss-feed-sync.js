// ============================================================
// YANTA Sources / RSS — subscriptions across devices
//
// The source list is part of the workspace, not of the browser that
// happened to add a feed: subscribing on the phone has to show up on the
// laptop. Items stay local (rss-store.js) — they are a rebuildable cache,
// and syncing article bodies would cost far more than re-fetching them.
//
// Storage shape: one VaultDoc record per feed, keyed by feed id, so two
// devices adding a source at the same time keep both. See
// vaultRssFeedsMap() for why this is not a single settings value.
//
// What travels is the subscription — the parts the user chose. Fetch
// bookkeeping (etag, lastFetchedAt, page tokens, lastError) is a property
// of the device that did the fetching: syncing it would rewrite the vault
// on every refresh cycle and hand other devices a validator they never
// sent.
// ============================================================

import {
  getVaultDoc,
  waitForVaultDoc,
  vaultRssFeedsMap,
  safeJsonClone,
} from '../sync2/vault-doc.js';

import {
  normalizeRssFeed,
  getRssFeeds,
  saveRssFeeds,
} from './rss-settings.js';

const RSS_FEED_SYNC_ORIGIN = 'yanta-rss-feed-sync';

// The subscription itself. Everything not listed here is device-local.
const SYNCED_FEED_FIELDS = [
  'id',
  'title',
  'feedUrl',
  'siteUrl',
  'description',
  'folderId',
  'tags',
  'icon',
  'color',
  'enabled',
  'sourceKind',
  'channelId',
  'created',
];

/*
  Until the first merge has run, this device does not yet know what the
  vault holds — so a save must never be read as "the user unsubscribed from
  everything that is not in this list".
*/
let mergedOnce = false;

function syncedFeedRecord(feed) {
  if (!feed?.id) return null;

  const record = {};

  for (const key of SYNCED_FEED_FIELDS) {
    const value = feed[key];
    if (value !== undefined) record[key] = value;
  }

  return record;
}

/** Same subscription, ignoring the `updated` tiebreaker. */
function sameSubscription(a, b) {
  if (!a || !b) return false;

  return SYNCED_FEED_FIELDS.every((key) =>
    JSON.stringify(a[key] ?? null) === JSON.stringify(b[key] ?? null));
}

function writeVaultRecords(mutate) {
  const doc = getVaultDoc();

  doc.transact(() => {
    mutate(vaultRssFeedsMap());
  }, RSS_FEED_SYNC_ORIGIN);
}

/**
 * Mirror the local subscription list into the vault.
 *
 * Writes only what actually differs, so a refresh cycle that merely updated
 * etags leaves the vault — and therefore the sync fingerprint — untouched.
 */
export function publishRssFeedsToVault(feeds = []) {
  const list = Array.isArray(feeds) ? feeds.filter((f) => f?.id) : [];
  const live = new Set(list.map((f) => String(f.id)));

  try {
    writeVaultRecords((map) => {
      for (const feed of list) {
        const record = syncedFeedRecord(feed);
        if (!record) continue;

        const stored = map.get(String(feed.id));

        if (stored && !stored.deleted && sameSubscription(stored, record)) continue;

        map.set(String(feed.id), safeJsonClone({
          ...record,
          deleted: false,
          updated: Number(feed.updated) || Date.now(),
        }));
      }

      if (!mergedOnce) return;

      /*
        Unsubscribing writes a soft-deleted record rather than dropping the
        key: another device still holding the source locally would otherwise
        re-add it on its next merge.
      */
      for (const [id, stored] of map) {
        if (live.has(String(id)) || stored?.deleted) continue;

        map.set(String(id), safeJsonClone({
          id: String(id),
          deleted: true,
          updated: Date.now(),
        }));
      }
    });
  } catch (err) {
    console.warn('[YANTA Sources] could not publish subscriptions to the vault', err);
  }
}

/**
 * The same feed added independently on two devices arrives as two records.
 *
 * The older one wins, with the id as tiebreaker — both are identical on
 * every device, so all of them converge on the same survivor without having
 * to agree on anything first.
 */
function dropDuplicateFeedUrls(feeds) {
  const byUrl = new Map();
  const dropped = [];

  const olderWins = (a, b) =>
    (Number(a.created || 0) - Number(b.created || 0)) ||
    String(a.id).localeCompare(String(b.id));

  for (const feed of feeds) {
    const key = String(feed.feedUrl || '').toLowerCase();
    const rival = byUrl.get(key);

    if (!rival) {
      byUrl.set(key, feed);
      continue;
    }

    const winner = olderWins(feed, rival) <= 0 ? feed : rival;

    byUrl.set(key, winner);
    dropped.push(winner === feed ? rival : feed);
  }

  return {
    feeds: [...byUrl.values()],
    dropped,
  };
}

/**
 * Reconcile the vault's subscriptions with this device's list.
 *
 * Per feed the newer `updated` wins; a soft-deleted record removes the feed
 * locally. Anything this device has that the vault does not is treated as a
 * local addition and published — which is also what migrates a workspace
 * that subscribed to everything before sources ever synced.
 */
export async function mergeRssFeedsFromVault() {
  await waitForVaultDoc();

  const local = await getRssFeeds();
  const byId = new Map(local.map((feed) => [String(feed.id), feed]));
  const removed = new Set();

  for (const [rawId, stored] of vaultRssFeedsMap()) {
    const id = String(rawId);

    if (stored?.deleted) {
      // A tombstone only wins while it is the newer statement about the feed:
      // re-adding the same source on another device must survive.
      const mine = byId.get(id);

      if (!mine || Number(stored.updated || 0) >= Number(mine.updated || 0)) {
        byId.delete(id);
        removed.add(id);
      }

      continue;
    }

    const incoming = normalizeRssFeed({
      ...stored,
      id,
      updated: Number(stored?.updated) || 0,
    });

    if (!incoming) continue;

    const mine = byId.get(id);

    if (!mine || Number(incoming.updated || 0) > Number(mine.updated || 0)) {
      // Keep this device's fetch bookkeeping; only the subscription travels.
      byId.set(id, {
        ...(mine || {}),
        ...incoming,
      });
    }
  }

  const { feeds, dropped } = dropDuplicateFeedUrls([...byId.values()]);

  mergedOnce = true;

  if (dropped.length) {
    writeVaultRecords((map) => {
      for (const feed of dropped) {
        map.set(String(feed.id), safeJsonClone({
          id: String(feed.id),
          deleted: true,
          updated: Date.now(),
        }));
      }
    });
  }

  const changed =
    removed.size > 0 ||
    dropped.length > 0 ||
    feeds.length !== local.length ||
    feeds.some((feed) => {
      const mine = local.find((f) => f.id === feed.id);
      return !mine || !sameSubscription(mine, feed);
    });

  if (changed) {
    // Re-enters through yanta-rss-feeds-changed, which is what pushes a
    // local-only subscription up into the vault.
    await saveRssFeeds(feeds);
  } else {
    publishRssFeedsToVault(feeds);
  }

  return feeds;
}

let installed = false;

/**
 * Merge once at boot, again whenever a sync brings in new vault state, and
 * publish every local change.
 *
 * Publishing hangs off the existing yanta-rss-feeds-changed event rather
 * than a call inside saveRssFeeds(): the settings module stays the plain
 * store it is, with no import back into this one.
 */
export function setupRssFeedSync() {
  if (installed) return;
  installed = true;

  const merge = () => {
    mergeRssFeedsFromVault().catch((err) => {
      console.warn('[YANTA Sources] subscription merge failed', err);
    });
  };

  window.addEventListener('yanta-rss-feeds-changed', (e) => {
    publishRssFeedsToVault(e.detail);
  });

  window.addEventListener('yanta-vault-hydrated', merge);

  merge();
}
