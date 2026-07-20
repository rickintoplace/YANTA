// ============================================================
// YANTA Sources / RSS — local item cache
//
// Local-only IndexedDB.
// Does not affect Sync2 / Cloud storage.
// ============================================================

const DB_NAME = 'yanta-rss';
const DB_VERSION = 1;

let dbPromise = null;

function openRssDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains('items')) {
        const s = db.createObjectStore('items', { keyPath: 'id' });
        s.createIndex('feedId', 'feedId', { unique: false });
        s.createIndex('publishedAt', 'publishedAt', { unique: false });
        s.createIndex('discoveredAt', 'discoveredAt', { unique: false });
        s.createIndex('read', 'read', { unique: false });
        s.createIndex('starred', 'starred', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('RSS IndexedDB transaction aborted'));
  });
}

function now() {
  return Date.now();
}

export async function getRssItem(itemId) {
  const db = await openRssDb();
  return reqToPromise(db.transaction('items').objectStore('items').get(String(itemId || '')));
}

export async function putRssItem(item) {
  const db = await openRssDb();
  const tx = db.transaction('items', 'readwrite');

  tx.objectStore('items').put({
    ...item,
    updatedAt: now(),
  });

  await txDone(tx);
}

export async function upsertRssItems(items = []) {
  if (!items.length) return 0;

  const db = await openRssDb();
  const tx = db.transaction('items', 'readwrite');
  const store = tx.objectStore('items');

  let count = 0;

  for (const item of items) {
    if (!item?.id) continue;

    const existing = await reqToPromise(store.get(item.id));

    store.put({
      ...(existing || {}),
      ...item,

      // Preserve user state.
      read: existing?.read === true ? true : item.read === true,
      starred: existing?.starred === true ? true : item.starred === true,
      archived: existing?.archived === true ? true : item.archived === true,
      savedNoteId: existing?.savedNoteId || item.savedNoteId || null,

      discoveredAt: existing?.discoveredAt || item.discoveredAt || now(),
      updatedAt: now(),
    });

    count++;
  }

  await txDone(tx);
  return count;
}

export async function patchRssItem(itemId, patch = {}) {
  const item = await getRssItem(itemId);
  if (!item) return null;

  const next = {
    ...item,
    ...patch,
    updatedAt: now(),
  };

  await putRssItem(next);
  return next;
}

export async function listRssItems({
  feedId = '',
  unreadOnly = false,
  starredOnly = false,
  archived = false,
  query = '',
  since = '',
  limit = 100,
} = {}) {
  const db = await openRssDb();
  const all = await reqToPromise(db.transaction('items').objectStore('items').getAll());

  const q = String(query || '').trim().toLowerCase();
  const max = Math.max(1, Math.min(1000, Number(limit || 100)));
  const sinceMs = since ? Date.parse(since) : 0;

  return all
    .filter((item) => {
      if (feedId && item.feedId !== feedId) return false;
      if (unreadOnly && item.read === true) return false;
      if (starredOnly && item.starred !== true) return false;
      if (!archived && item.archived === true) return false;
      if (sinceMs && Number(item.publishedAt || item.discoveredAt || 0) < sinceMs) return false;

      if (q) {
        const hay = [
          item.title || '',
          item.author || '',
          item.feedTitle || '',
          item.summaryText || '',
          item.contentText || '',
          item.url || '',
        ].join(' ').toLowerCase();

        if (!hay.includes(q)) return false;
      }

      return true;
    })
    .sort((a, b) =>
      Number(b.publishedAt || b.discoveredAt || 0) -
      Number(a.publishedAt || a.discoveredAt || 0)
    )
    .slice(0, max);
}

export async function countUnreadRssItems() {
  const items = await listRssItems({
    unreadOnly: true,
    limit: 100000,
  });

  return items.length;
}

export async function deleteRssItemsByFeed(feedId) {
  const db = await openRssDb();
  const tx = db.transaction('items', 'readwrite');
  const index = tx.objectStore('items').index('feedId');

  let removed = 0;

  await new Promise((resolve, reject) => {
    const req = index.openCursor(IDBKeyRange.only(String(feedId || '')));

    req.onsuccess = () => {
      const cursor = req.result;

      if (!cursor) {
        resolve();
        return;
      }

      cursor.delete();
      removed++;
      cursor.continue();
    };

    req.onerror = () => reject(req.error);
  });

  await txDone(tx);
  return removed;
}

// Reconciles the local item cache against the current source list, e.g.
// after a source was removed on another synced device. Cheap in the
// common case: only the distinct feedId values are scanned, not every item.
export async function pruneOrphanedRssItems(validFeedIds = []) {
  const db = await openRssDb();
  const valid = new Set(validFeedIds);

  const cachedFeedIds = await new Promise((resolve, reject) => {
    const ids = [];
    const req = db.transaction('items').objectStore('items')
      .index('feedId')
      .openKeyCursor(null, 'nextunique');

    req.onsuccess = () => {
      const cursor = req.result;

      if (!cursor) {
        resolve(ids);
        return;
      }

      ids.push(cursor.key);
      cursor.continue();
    };

    req.onerror = () => reject(req.error);
  });

  const orphanFeedIds = cachedFeedIds.filter((feedId) => !valid.has(feedId));
  if (!orphanFeedIds.length) return 0;

  let removed = 0;
  for (const feedId of orphanFeedIds) {
    removed += await deleteRssItemsByFeed(feedId);
  }

  return removed;
}

export async function pruneRssItems({
  maxItemsPerFeed = 250,
  keepItemsDays = 180,
} = {}) {
  const db = await openRssDb();
  const all = await reqToPromise(db.transaction('items').objectStore('items').getAll());

  const byFeed = new Map();
  const cutoff = Date.now() - Math.max(1, Number(keepItemsDays || 180)) * 86400000;

  for (const item of all) {
    if (!byFeed.has(item.feedId)) byFeed.set(item.feedId, []);
    byFeed.get(item.feedId).push(item);
  }

  const removeIds = new Set();

  for (const list of byFeed.values()) {
    list.sort((a, b) =>
      Number(b.publishedAt || b.discoveredAt || 0) -
      Number(a.publishedAt || a.discoveredAt || 0)
    );

    list.forEach((item, index) => {
      const ts = Number(item.publishedAt || item.discoveredAt || 0);

      const userImportant =
        item.starred === true ||
        item.savedNoteId ||
        item.read !== true;

      if (index >= maxItemsPerFeed && !userImportant) {
        removeIds.add(item.id);
      }

      if (ts && ts < cutoff && !userImportant) {
        removeIds.add(item.id);
      }
    });
  }

  if (!removeIds.size) return 0;

  const tx = db.transaction('items', 'readwrite');
  const store = tx.objectStore('items');

  for (const id of removeIds) {
    store.delete(id);
  }

  await txDone(tx);
  return removeIds.size;
}