// ============================================================
// YANTA Sources / RSS — settings + synced feed subscriptions
//
// Storage strategy:
// - Feeds/settings in core store.settings -> synced with YANTA vault.
// - Items/content in rss-store.js -> local IndexedDB cache only.
// ============================================================

import {
  store,
} from '../core.js';

export const RSS_SETTINGS_KEY = 'rss.settings.v1';
export const RSS_FEEDS_KEY = 'rss.feeds.v1';

export const DEFAULT_RSS_SETTINGS = {
  enabled: true,

  fetchProvider: 'yanta-cloud', // yanta-cloud | direct

  refreshOnStartup: true,
  minRefreshIntervalMinutes: 30,

  showImages: true,
  useImageProxy: true,
  loadFullContentImages: false,

  stripTrackingParams: true,

  // YouTube-native behavior.
  youtubeHideShorts: true,
  youtubeShortMaxSeconds: 61,
  youtubeMorePageSize: 12,

  // local cache policy
  maxItemsPerFeed: 250,
  keepItemsDays: 180,
};

function now() {
  return Date.now();
}

function cleanUrl(value = '') {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function cleanString(value = '', max = 500) {
  return String(value || '').trim().slice(0, max);
}

function cleanTags(tags = []) {
  return Array.isArray(tags)
    ? [...new Set(tags.map((x) => String(x || '').trim().replace(/^#/, '').toLowerCase()).filter(Boolean))]
    : [];
}

function channelIdFromYoutubeFeedUrl(feedUrl = '') {
  try {
    const url = new URL(feedUrl);

    if (!/youtube\.com$/i.test(url.hostname.replace(/^www\./, ''))) {
      return '';
    }

    if (url.pathname === '/feeds/videos.xml') {
      return url.searchParams.get('channel_id') || '';
    }

    return '';
  } catch {
    return '';
  }
}

export function normalizeRssSettings(raw = {}) {
  const s = {
    ...DEFAULT_RSS_SETTINGS,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };

  s.enabled = s.enabled !== false;
  s.fetchProvider = s.fetchProvider === 'direct' ? 'direct' : 'yanta-cloud';
  s.refreshOnStartup = s.refreshOnStartup !== false;
  s.minRefreshIntervalMinutes = Math.max(5, Math.min(24 * 60, Number(s.minRefreshIntervalMinutes || 30)));
  s.showImages = s.showImages !== false;
  s.useImageProxy = s.useImageProxy !== false;
  s.loadFullContentImages = s.loadFullContentImages === true;
  s.stripTrackingParams = s.stripTrackingParams !== false;

  s.youtubeHideShorts = s.youtubeHideShorts !== false;
  s.youtubeShortMaxSeconds = Math.max(15, Math.min(300, Number(s.youtubeShortMaxSeconds || 61)));
  s.youtubeMorePageSize = Math.max(4, Math.min(24, Number(s.youtubeMorePageSize || 12)));

  s.maxItemsPerFeed = Math.max(25, Math.min(2000, Number(s.maxItemsPerFeed || 250)));
  s.keepItemsDays = Math.max(7, Math.min(3650, Number(s.keepItemsDays || 180)));

  return s;
}

export function normalizeRssFeed(raw = {}) {
  const feedUrl = cleanUrl(raw.feedUrl || raw.url || '');
  if (!feedUrl) return null;

  const id = cleanString(raw.id || 'rss_' + crypto.randomUUID().replace(/-/g, '').slice(0, 18), 80);

  const channelId =
    cleanString(raw.channelId || '', 120) ||
    channelIdFromYoutubeFeedUrl(feedUrl);

  const sourceKind =
    raw.sourceKind ||
    raw.kind ||
    (
      channelId || /youtube\.com\/feeds\/videos\.xml/i.test(feedUrl)
        ? 'youtube'
        : 'rss'
    );

  return {
    id,
    title: cleanString(raw.title || raw.name || feedUrl, 180),
    feedUrl,
    siteUrl: cleanUrl(raw.siteUrl || raw.homeUrl || '') || '',
    description: cleanString(raw.description || '', 500),

    folderId: raw.folderId || null,
    tags: cleanTags(raw.tags),

    icon: cleanString(raw.icon || (sourceKind === 'youtube' ? 'youtube' : 'rss'), 80),
    color: cleanString(raw.color || (sourceKind === 'youtube' ? '#ef4444' : '#f59e0b'), 40),

    enabled: raw.enabled !== false,

    sourceKind,
    channelId,
    youtubeNextPageToken: cleanString(raw.youtubeNextPageToken || '', 500),
    youtubePrevPageToken: cleanString(raw.youtubePrevPageToken || '', 500),
    lastYoutubeMoreAt: Number(raw.lastYoutubeMoreAt || 0) || 0,

    etag: cleanString(raw.etag || '', 500),
    lastModified: cleanString(raw.lastModified || '', 500),
    lastFetchedAt: Number(raw.lastFetchedAt || 0) || 0,
    lastError: cleanString(raw.lastError || '', 500),

    created: Number(raw.created || now()),
    updated: Number(raw.updated || now()),
  };
}

export function normalizeRssFeeds(raw = []) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();

  for (const item of list) {
    const feed = normalizeRssFeed(item);
    if (!feed) continue;

    const key = feed.feedUrl.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(feed);
  }

  return out.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
}

export async function getRssSettings() {
  const raw = await store.settings.get(RSS_SETTINGS_KEY, DEFAULT_RSS_SETTINGS);
  return normalizeRssSettings(raw);
}

export async function saveRssSettings(patch = {}) {
  const current = await getRssSettings();

  const next = normalizeRssSettings({
    ...current,
    ...patch,
  });

  await store.settings.set(RSS_SETTINGS_KEY, next);

  window.dispatchEvent(new CustomEvent('yanta-rss-settings-changed', {
    detail: next,
  }));

  return next;
}

export async function getRssFeeds() {
  const raw = await store.settings.get(RSS_FEEDS_KEY, []);
  return normalizeRssFeeds(raw);
}

export async function saveRssFeeds(feeds = []) {
  const next = normalizeRssFeeds(feeds);

  await store.settings.set(RSS_FEEDS_KEY, next);

  window.dispatchEvent(new CustomEvent('yanta-rss-feeds-changed', {
    detail: next,
  }));

  return next;
}

export async function upsertRssFeed(feedPatch = {}) {
  const feeds = await getRssFeeds();

  const normalized = normalizeRssFeed({
    ...feedPatch,
    updated: now(),
  });

  if (!normalized) {
    throw new Error('Invalid feed URL.');
  }

  const idx = feeds.findIndex((f) =>
    f.id === normalized.id ||
    f.feedUrl.toLowerCase() === normalized.feedUrl.toLowerCase()
  );

  if (idx >= 0) {
    feeds[idx] = normalizeRssFeed({
      ...feeds[idx],
      ...normalized,
      id: feeds[idx].id,
      created: feeds[idx].created,
      updated: now(),
    });
  } else {
    feeds.push(normalized);
  }

  return saveRssFeeds(feeds);
}

export async function deleteRssFeed(feedId) {
  const id = String(feedId || '');
  const feeds = await getRssFeeds();

  return saveRssFeeds(feeds.filter((f) => f.id !== id));
}