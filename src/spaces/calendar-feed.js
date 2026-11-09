// ============================================================
// YANTA Shared Spaces — calendar change feed (local only)
//
// Small per-space log of inbound changes ("Anna moved 'Standup'"),
// so the calendar can greet the user with what happened since their
// last look instead of nagging with notifications. Never synced.
// ============================================================

import { store } from '../core.js';
import { t } from '../i18n/index.js';

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

/*
  Consecutive changes by the same person of the same kind, close in
  time, read as one line ("Anna added 6 entries") — someone logging a
  week of days or importing a file is one thing that happened, not six.
  `entries` newest first; groups keep the newest entry's ts and eventId.
*/
const GROUP_GAP_MS = 60 * 60 * 1000;

export function groupCalendarFeed(entries, { gapMs = GROUP_GAP_MS } = {}) {
  const groups = [];
  for (const e of entries || []) {
    const action = e.action === 'added' ? 'added' : e.action === 'removed' ? 'removed' : 'changed';
    const last = groups.at(-1);
    if (last && last.actor === e.actor && last.action === action && last.oldestTs - Number(e.ts || 0) <= gapMs) {
      last.count += 1;
      last.oldestTs = Number(e.ts || 0);
      if (last.title !== e.title) last.sameTitle = false;
      continue;
    }
    groups.push({ ...e, action, count: 1, oldestTs: Number(e.ts || 0), sameTitle: true });
  }
  return groups;
}

/** One line for a group; `who` and `title` come prepared (escaped where HTML). */
export function calendarChangeLine(group, who, title) {
  if (group.count > 1 && group.sameTitle) return t(`calendarShare.changeRepeat.${group.action}`, { who, title, count: group.count });
  if (group.count > 1) return t(`calendarShare.changeGroup.${group.action}`, { who, count: group.count });
  return t(`calendarShare.change.${group.action}`, { who, title });
}
