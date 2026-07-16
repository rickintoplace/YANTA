// ============================================================
// YANTA Shared Spaces — calendar change feed (local only)
//
// Small per-space log of inbound changes ("Anna moved 'Standup'"),
// so the calendar can greet the user with what happened since their
// last look instead of nagging with notifications. Never synced.
// ============================================================

import { store } from '../core.js';

const FEED_CAP = 50;

function feedKey(spaceId) {
  return `calendar.space.${spaceId}.feed.v1`;
}

const cache = new Map(); // spaceId -> { entries, lastSeenAt }

async function loadFeed(spaceId) {
  if (cache.has(spaceId)) return cache.get(spaceId);

  const raw = await store.settings.get(feedKey(spaceId), null).catch(() => null);

  const feed = raw && typeof raw === 'object'
    ? {
        entries: Array.isArray(raw.entries) ? raw.entries : [],
        lastSeenAt: Number(raw.lastSeenAt || 0),
      }
    : { entries: [], lastSeenAt: 0 };

  cache.set(spaceId, feed);
  return feed;
}

function persist(spaceId) {
  const feed = cache.get(spaceId);
  if (!feed) return;

  store.settings.set(feedKey(spaceId), feed).catch(() => {});
}

/**
 * entry: { ts, actor, action: 'added'|'updated'|'removed', eventId,
 *          title, start }
 */
export async function appendCalendarFeed(spaceId, entries) {
  if (!entries?.length) return;

  const feed = await loadFeed(spaceId);

  feed.entries = [...feed.entries, ...entries].slice(-FEED_CAP);
  persist(spaceId);

  window.dispatchEvent(new CustomEvent('yanta-calendar-feed-updated', {
    detail: { spaceId },
  }));
}

export async function calendarFeedFor(spaceId) {
  return loadFeed(spaceId);
}

export async function unseenCalendarFeedCount(spaceId) {
  const feed = await loadFeed(spaceId);
  return feed.entries.filter((entry) => entry.ts > feed.lastSeenAt).length;
}

export async function markCalendarFeedSeen(spaceId) {
  const feed = await loadFeed(spaceId);
  feed.lastSeenAt = Date.now();
  persist(spaceId);
}

export async function clearCalendarFeed(spaceId) {
  cache.set(spaceId, { entries: [], lastSeenAt: 0 });

  try {
    await store.settings.set(feedKey(spaceId), null);
  } catch {}
}
