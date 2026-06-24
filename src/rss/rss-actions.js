// ============================================================
// YANTA Sources / RSS — app actions
// ============================================================

import {
  uid,
  state,
  store,
  toast,
} from '../core.js';

import {
  getNoteDoc,
} from '../yjs.js';

import {
  renderTree,
} from '../tree.js';

import {
  getRssFeeds,
  upsertRssFeed,
  saveRssFeeds,
  getRssSettings,
} from './rss-settings.js';

import {
  parseFeed,
} from './rss-parser.js';

import {
  discoverRssFeeds,
  fetchRssFeed,
  searchRssSources,
  resolveYoutubeChannel,
  searchYoutubeChannels,
  getYoutubeVideosInfo,
  fetchYoutubeChannelVideos,
} from './rss-fetcher.js';

import {
  requireRssCloudAuth,
} from './rss-cloud-auth.js';

import {
  getRssItem,
  upsertRssItems,
  patchRssItem,
  listRssItems,
  pruneRssItems,
} from './rss-store.js';

function now() {
  return Date.now();
}

function base64Url(bytes) {
  let bin = '';
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  for (let i = 0; i < u8.length; i++) {
    bin += String.fromCharCode(u8[i]);
  }

  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function hashString(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return base64Url(new Uint8Array(digest)).slice(0, 32);
}

function isoDate(ms) {
  const t = Number(ms || 0);

  if (!t) return '';

  try {
    return new Date(t).toISOString();
  } catch {
    return '';
  }
}

function mdEscape(value = '') {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function stripHtml(html = '') {
  const tmp = document.createElement('div');

  tmp.innerHTML = String(html || '');

  tmp.querySelectorAll('script, style, noscript, iframe, object, embed').forEach((n) => n.remove());

  return (tmp.textContent || tmp.innerText || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function htmlToMarkdown(html = '') {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '');

  tmp.querySelectorAll('script, style, noscript, iframe, object, embed').forEach((n) => n.remove());

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const tag = node.tagName.toLowerCase();
    const children = [...node.childNodes].map(walk).join('');

    if (tag === 'br') return '\n';

    if (tag === 'p') return `\n\n${children.trim()}\n\n`;
    if (tag === 'div' || tag === 'section' || tag === 'article') return `\n${children.trim()}\n`;

    if (tag === 'h1') return `\n\n# ${children.trim()}\n\n`;
    if (tag === 'h2') return `\n\n## ${children.trim()}\n\n`;
    if (tag === 'h3') return `\n\n### ${children.trim()}\n\n`;
    if (tag === 'h4') return `\n\n#### ${children.trim()}\n\n`;
    if (tag === 'h5') return `\n\n##### ${children.trim()}\n\n`;
    if (tag === 'h6') return `\n\n###### ${children.trim()}\n\n`;

    if (tag === 'strong' || tag === 'b') return `**${children.trim()}**`;
    if (tag === 'em' || tag === 'i') return `*${children.trim()}*`;
    if (tag === 'code') return `\`${children.trim()}\``;
    if (tag === 'pre') return `\n\n\`\`\`\n${stripHtml(node.innerHTML)}\n\`\`\`\n\n`;

    if (tag === 'blockquote') {
      return `\n\n${children.trim().split('\n').map((l) => `> ${l}`).join('\n')}\n\n`;
    }

    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      const label = children.trim() || href;

      if (!href) return label;

      return `[${label}](${href})`;
    }

    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || 'image';

      if (!src) return '';

      return `\n\n![${mdEscape(alt)}](${src})\n\n`;
    }

    if (tag === 'ul') {
      return '\n' + [...node.children].map((li) => `- ${walk(li).trim()}`).join('\n') + '\n';
    }

    if (tag === 'ol') {
      return '\n' + [...node.children].map((li, i) => `${i + 1}. ${walk(li).trim()}`).join('\n') + '\n';
    }

    if (tag === 'li') return children;

    return children;
  };

  return walk(tmp)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function articleTextForMarkdown(item) {
  const contentMarkdown =
    item.contentHtml
      ? htmlToMarkdown(item.contentHtml)
      : '';

  const summaryMarkdown =
    item.summaryHtml
      ? htmlToMarkdown(item.summaryHtml)
      : '';

  const contentText = String(item.contentText || '').trim();
  const summaryText = String(item.summaryText || '').trim();

  return (
    contentMarkdown ||
    contentText ||
    summaryMarkdown ||
    summaryText ||
    ''
  ).trim();
}

function youtubeVideoIdFromUrl(raw = '') {
  const s = String(raw || '').trim();

  try {
    const u = new URL(s, location.href);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      return u.pathname.replace(/^\//, '').split('/')[0] || '';
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v') || '';

      const embed = u.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{6,})/);
      if (embed) return embed[1];

      const shorts = u.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{6,})/);
      if (shorts) return shorts[1];
    }
  } catch {}

  return '';
}

function youtubeVideoMarkdown(item) {
  const videoId =
    item.videoId ||
    youtubeVideoIdFromUrl(item.mediaUrl || '') ||
    youtubeVideoIdFromUrl(item.url || '');

  if (!videoId) return '';

  return `![](${`https://www.youtube.com/watch?v=${videoId}`})`;
}

function audioMarkdown(item) {
  const mediaUrl = String(item.mediaUrl || '').trim();

  if (!mediaUrl) return '';

  if (
    String(item.mediaType || '').startsWith('audio/') ||
    /\.(mp3|m4a|aac|ogg|oga|opus|wav)(?:$|[?#])/i.test(mediaUrl)
  ) {
    return `![](${mediaUrl})`;
  }

  return '';
}

export function rssItemMarkdown(item, feed = null) {
  const sourceTitle = feed?.title || item.feedTitle || 'Source';
  const sourceUrl = item.url || feed?.siteUrl || feed?.feedUrl || '';

  const published = item.publishedAt
    ? isoDate(item.publishedAt).slice(0, 10)
    : '';

  const content = articleTextForMarkdown(item);
  const summary = String(item.summaryText || stripHtml(item.summaryHtml || '') || '').trim();

  const videoIdFromUrl = (raw = '') => {
    const s = String(raw || '').trim();

    try {
      const u = new URL(s, location.href);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();

      if (host === 'youtu.be') {
        return u.pathname.replace(/^\//, '').split('/')[0] || '';
      }

      if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
        if (u.pathname === '/watch') return u.searchParams.get('v') || '';

        const embed = u.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{6,})/);
        if (embed) return embed[1];

        const shorts = u.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{6,})/);
        if (shorts) return shorts[1];
      }
    } catch {}

    let m;

    if ((m = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/.exec(s))) {
      return m[1];
    }

    if ((m = /(?:youtube\.com|youtube-nocookie\.com)\/embed\/([a-zA-Z0-9_-]{6,})/.exec(s))) {
      return m[1];
    }

    if ((m = /youtube\.com\/shorts\/([a-zA-Z0-9_-]{6,})/.exec(s))) {
      return m[1];
    }

    return '';
  };

  const videoId =
    item.videoId ||
    videoIdFromUrl(item.mediaUrl || '') ||
    videoIdFromUrl(item.url || '');

  const isYoutube =
    !!videoId ||
    item.mediaType === 'video/youtube' ||
    /youtube\.com|youtu\.be/i.test(item.mediaUrl || item.url || '');

  const isAudio =
    String(item.mediaType || '').startsWith('audio/') ||
    /\.(mp3|m4a|aac|ogg|oga|opus|wav)(?:$|[?#])/i.test(item.mediaUrl || '');

  const isVideo =
    isYoutube ||
    String(item.mediaType || '').startsWith('video/') ||
    /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(item.mediaUrl || '');

  const lines = [];

  lines.push(`# ${item.title || 'Untitled'}`);
  lines.push('');

  lines.push('> [!info] Source');
  lines.push(`> ${sourceUrl ? `[${mdEscape(sourceTitle)}](${sourceUrl})` : sourceTitle}`);

  if (published) lines.push(`> Published: ${published}`);
  if (item.author) lines.push(`> Author: ${item.author}`);

  lines.push('');

  // Media first — this is what makes saved YouTube videos / podcasts feel native.
  if (isYoutube && videoId) {
    lines.push(`![](https://www.youtube.com/watch?v=${videoId})`);
    lines.push('');
  } else if (isAudio && item.mediaUrl) {
    lines.push(`![](${item.mediaUrl})`);
    lines.push('');
  } else if (isVideo && item.mediaUrl) {
    lines.push(`![](${item.mediaUrl})`);
    lines.push('');
  } else if (item.imageUrl) {
    lines.push(`![Article image](${item.imageUrl})`);
    lines.push('');
  }

  // Media notes get a timestamp area instead of a fake empty article.
  if (isYoutube || isAudio || isVideo) {
    lines.push('## Timestamps');
    lines.push('');
    lines.push('- 00:00 ');
    lines.push('');

    const description =
      item.mediaDescription ||
      content ||
      summary;

    if (description) {
      lines.push('## Description');
      lines.push('');
      lines.push(description);
      lines.push('');
    }
  } else {
    lines.push('## Notes');
    lines.push('');
    lines.push('- ');
    lines.push('');

    if (summary && content && summary !== content && !content.includes(summary)) {
      lines.push('## Summary');
      lines.push('');
      lines.push(summary);
      lines.push('');
    }

    lines.push('## Article');
    lines.push('');
    lines.push(content || '_No full article text was available in the feed item._');
    lines.push('');
  }

  if (item.mediaUrl && !isYoutube && !isAudio && !isVideo) {
    lines.push('## Media');
    lines.push('');
    lines.push(`[Open media](${item.mediaUrl})`);
    lines.push('');
  }

  if (sourceUrl) {
    lines.push('---');
    lines.push('');
    lines.push(`Original: [${sourceUrl}](${sourceUrl})`);
  }

  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

function isYoutubeFeed(feed = {}) {
  return (
    feed.sourceKind === 'youtube' ||
    !!feed.channelId ||
    /youtube\.com\/feeds\/videos\.xml/i.test(feed.feedUrl || '')
  );
}

function videoIdFromYoutubeUrl(raw = '') {
  const s = String(raw || '').trim();

  try {
    const url = new URL(s, location.href);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      return url.pathname.replace(/^\//, '').split('/')[0] || '';
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (url.pathname === '/watch') return url.searchParams.get('v') || '';

      const embed = url.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{6,})/);
      if (embed) return embed[1];

      const shorts = url.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{6,})/);
      if (shorts) return shorts[1];
    }
  } catch {}

  let m;

  if ((m = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/.exec(s))) {
    return m[1];
  }

  return '';
}

async function annotateYoutubeItems(items = [], settings = {}) {
  const youtubeItems = items.filter((item) =>
    item.videoId ||
    videoIdFromYoutubeUrl(item.url || item.mediaUrl || '')
  );

  if (!youtubeItems.length) return items;

  const ids = youtubeItems
    .map((item) => item.videoId || videoIdFromYoutubeUrl(item.url || item.mediaUrl || ''))
    .filter(Boolean);

  const infos = await getYoutubeVideosInfo(ids).catch(() => []);
  const byId = new Map(infos.map((x) => [x.videoId || x.id, x]));

  return items
    .map((item) => {
      const videoId =
        item.videoId ||
        videoIdFromYoutubeUrl(item.url || '') ||
        videoIdFromYoutubeUrl(item.mediaUrl || '');

      const info = byId.get(videoId);

      if (!videoId || !info) {
        return item;
      }

      return {
        ...item,
        videoId,
        mediaUrl: item.mediaUrl || info.url || `https://www.youtube.com/watch?v=${videoId}`,
        mediaType: 'video/youtube',
        mediaDescription: item.mediaDescription || info.description || '',
        imageUrl: item.imageUrl || info.thumbnail || '',
        publishedAt: item.publishedAt || Date.parse(info.publishedAt || '') || 0,
        youtubeDurationSeconds: Number(info.durationSeconds || 0) || 0,
        youtubeProbablyShort: !!info.probablyShort,
        channelId: item.channelId || info.channelId || '',
      };
    })
    .filter((item) => {
      if (!settings.youtubeHideShorts) return true;

      const seconds = Number(item.youtubeDurationSeconds || 0);

      if (item.youtubeProbablyShort) return false;

      if (
        seconds > 0 &&
        seconds <= Number(settings.youtubeShortMaxSeconds || 61)
      ) {
        return false;
      }

      const hay = [
        item.title || '',
        item.summaryText || '',
        item.contentText || '',
        item.mediaDescription || '',
      ].join('\n').toLowerCase();

      if (hay.includes('#shorts') || hay.includes('#short')) return false;

      return true;
    });
}

function youtubeVideoToRawItem(video, feed) {
  const videoId = video.videoId || video.id || '';

  return {
    // Important:
    // YouTube RSS Atom uses IDs like yt:video:VIDEO_ID.
    // Use the same stable guid here so load-more pages upsert/dedupe
    // against already imported RSS items.
    guid: videoId ? `yt:video:${videoId}` : (video.url || video.title || ''),
    url: video.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ''),
    canonicalUrl: video.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ''),
    title: video.title || 'YouTube video',
    author: video.channelTitle || feed.title || '',
    publishedAt: Date.parse(video.publishedAt || '') || 0,
    summaryHtml: '',
    summaryText: video.description || '',
    contentHtml: '',
    contentText: video.description || '',
    imageUrl: video.thumbnail || '',
    mediaUrl: video.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ''),
    mediaType: 'video/youtube',
    mediaDescription: video.description || '',
    videoId,
    channelId: video.channelId || feed.channelId || '',
    youtubeDurationSeconds: Number(video.durationSeconds || 0) || 0,
    youtubeProbablyShort: !!video.probablyShort,
  };
}

async function normalizeFetchedItems(feed, parsed, settings = null) {
  const rssSettings = settings || await getRssSettings();

  let rawItems = parsed.items || [];

  if (isYoutubeFeed(feed)) {
    rawItems = await annotateYoutubeItems(rawItems, rssSettings);
  }

  const out = [];

  for (const raw of rawItems) {
    const basis = [
      feed.id,
      raw.guid || raw.url || raw.title,
    ].join('|');

    const id = 'rssitem_' + await hashString(basis);

    out.push({
      id,
      feedId: feed.id,
      feedTitle: parsed.feed?.title || feed.title,

      guid: raw.guid || raw.url || id,
      url: raw.url || '',
      canonicalUrl: raw.canonicalUrl || raw.url || '',

      title: raw.title || 'Untitled',
      author: raw.author || '',
      publishedAt: raw.publishedAt || 0,

      summaryHtml: raw.summaryHtml || '',
      summaryText: raw.summaryText || '',

      contentHtml: raw.contentHtml || '',
      contentText: raw.contentText || '',

      imageUrl: raw.imageUrl || '',

      mediaUrl: raw.mediaUrl || '',
      mediaType: raw.mediaType || '',
      mediaDescription: raw.mediaDescription || '',

      videoId: raw.videoId || '',
      channelId: raw.channelId || feed.channelId || '',
      youtubeDurationSeconds: Number(raw.youtubeDurationSeconds || 0) || 0,
      youtubeProbablyShort: !!raw.youtubeProbablyShort,

      read: false,
      starred: false,
      archived: false,
      savedNoteId: null,

      discoveredAt: now(),
    });
  }

  return out;
}

function youtubeChannelIdFromInput(raw = '') {
  const s = String(raw || '').trim();

  try {
    const u = new URL(s, location.href);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      if (u.pathname === '/feeds/videos.xml') {
        return u.searchParams.get('channel_id') || '';
      }

      const m = u.pathname.match(/^\/channel\/(UC[a-zA-Z0-9_-]{20,})/);
      if (m) return m[1];
    }
  } catch {}

  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(s)) {
    return s;
  }

  return '';
}

function youtubeFeedCandidateFromInput(input = '') {
  const channelId = youtubeChannelIdFromInput(input);

  if (!channelId) return null;

  return {
    title: 'YouTube Channel',
    feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
    siteUrl: `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`,
    description: '',
    source: 'youtube-native',
  };
}

function youtubeChannelCandidateFromResolved(res, originalInput = '') {
  const channel = res?.channel || null;
  const feed = res?.feed || null;

  if (!channel?.feedUrl && !feed?.feedUrl) return null;

  return {
    title: channel?.title || feed?.title || originalInput || 'YouTube Channel',
    feedUrl: channel?.feedUrl || feed?.feedUrl,
    siteUrl: channel?.siteUrl || feed?.siteUrl || '',
    description: channel?.description || feed?.description || '',
    imageUrl: channel?.thumbnail || feed?.imageUrl || '',
    channelId: channel?.channelId || channel?.id || '',
    source: 'youtube-data-api',
  };
}

function isProbablyYoutubeChannelInput(input = '') {
  const raw = String(input || '').trim();

  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(raw)) return true;
  if (/^@[\w.-]{2,}$/.test(raw)) return true;

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    if (host !== 'youtube.com' && host !== 'm.youtube.com') return false;

    return (
      /^\/@[^/]+/.test(url.pathname) ||
      /^\/channel\/UC[a-zA-Z0-9_-]{20,}/.test(url.pathname) ||
      /^\/user\/[^/]+/.test(url.pathname) ||
      /^\/c\/[^/]+/.test(url.pathname) ||
      url.pathname === '/feeds/videos.xml'
    );
  } catch {
    return false;
  }
}

async function resolveYoutubeCandidate(input) {
  if (!isProbablyYoutubeChannelInput(input)) return null;

  const resolved = await resolveYoutubeChannel(input, {
    includeVideos: true,
    limit: 12,
  });

  return youtubeChannelCandidateFromResolved(resolved, input);
}

function cleanUniversalSourceInput(input = '') {
  const raw = String(input || '').trim();

  if (!raw) {
    return {
      kind: 'empty',
      value: '',
    };
  }

  if (/^https?:\/\//i.test(raw)) {
    return {
      kind: 'url',
      value: raw,
    };
  }

  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(raw)) {
    return {
      kind: 'youtube-channel-id',
      value: raw,
    };
  }

  if (
    /^[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(raw) &&
    !/\s/.test(raw)
  ) {
    return {
      kind: 'url',
      value: `https://${raw}`,
    };
  }

  const mastodon = raw.match(/^@?([a-z0-9_]+)@([a-z0-9.-]+\.[a-z]{2,})$/i);

  if (mastodon) {
    return {
      kind: 'url',
      value: `https://${mastodon[2]}/@${mastodon[1]}`,
    };
  }

  const substack = raw.match(/^@?([a-z0-9-]+)\.substack$/i);

  if (substack) {
    return {
      kind: 'url',
      value: `https://${substack[1]}.substack.com`,
    };
  }

  return {
    kind: 'query',
    value: raw,
  };
}

async function addRssFeedCandidate(candidate, {
  originalInput = '',
  folderId = null,
  tags = [],
} = {}) {
  if (!candidate) {
    throw new Error('No RSS/Atom/JSON feed found.');
  }

  const feedUrl = candidate.feedUrl || candidate.url;

  if (!feedUrl) {
    throw new Error('Source result has no feed URL.');
  }

  const isYoutube = candidate.source === 'youtube-data-api' || candidate.channelId;

  await upsertRssFeed({
    title: candidate.title || feedUrl || originalInput,
    feedUrl,
    siteUrl: candidate.siteUrl || '',
    description: candidate.description || '',
    folderId,
    tags: isYoutube ? [...new Set([...tags, 'youtube', 'video'])] : tags,
    icon: isYoutube ? 'play' : 'rss',
    color: isYoutube ? '#ef4444' : '#f59e0b',
    sourceKind: isYoutube ? 'youtube' : 'rss',
    channelId: candidate.channelId || '',
  });

  const feeds = await getRssFeeds();
  const feed = feeds.find((f) =>
    f.feedUrl.toLowerCase() === String(feedUrl).toLowerCase()
  );

  if (feed) {
    try {
      await refreshRssFeed(feed.id, {
        force: true,
      });
    } catch (err) {
      /*
        Important UX:
        Adding a source should be durable even if the first fetch fails
        because the feed is temporarily unavailable, huge, rate-limited,
        or malformed. The source stays in the subscription list with
        lastError so the user/AI can retry later.
      */
      feed.lastError = err?.message || String(err);
      feed.updated = now();

      const feedsAfterError = await getRssFeeds();
      const idx = feedsAfterError.findIndex((f) => f.id === feed.id);

      if (idx >= 0) {
        feedsAfterError[idx] = {
          ...feedsAfterError[idx],
          lastError: feed.lastError,
          updated: feed.updated,
        };

        await saveRssFeeds(feedsAfterError);
      }
    }
  }

  const latestFeeds = await getRssFeeds();
  return latestFeeds.find((f) => f.id === feed?.id) || feed || null;
}

export async function findRssSourceCandidates(input, {
  limit = 8,
} = {}) {
  await requireRssCloudAuth();

  const normalized = cleanUniversalSourceInput(input);

  if (!normalized.value) {
    throw new Error('Enter a source name, website, domain, YouTube channel or feed URL.');
  }

  const youtubeExact = await resolveYoutubeCandidate(input).catch(() => null);

  if (youtubeExact) {
    return [youtubeExact];
  }

  if (normalized.kind === 'url') {
    return discoverRssFeeds(normalized.value);
  }

  const max = Math.max(1, Math.min(20, Number(limit || 8)));

  const settled = await Promise.allSettled([
    searchRssSources(normalized.value, {
      limit: max,
    }),
    searchYoutubeChannels(normalized.value, {
      limit: Math.min(6, max),
    }),
  ]);

  const out = [];

  const rss = settled[0];
  if (rss.status === 'fulfilled') {
    out.push(...rss.value);
  }

  const yt = settled[1];
  if (yt.status === 'fulfilled') {
    for (const channel of yt.value || []) {
      if (!channel?.feedUrl) continue;

      out.push({
        title: channel.title || 'YouTube Channel',
        feedUrl: channel.feedUrl,
        siteUrl: channel.siteUrl || '',
        description: channel.description || '',
        imageUrl: channel.thumbnail || '',
        channelId: channel.channelId || channel.id || '',
        source: 'youtube-data-api',
      });
    }
  }

  return out.slice(0, max);
}

export async function addRssFeedFromUniversalInput(input, {
  folderId = null,
  tags = [],
} = {}) {
  const youtubeExact = await resolveYoutubeCandidate(input).catch(() => null);

  if (youtubeExact) {
    return addRssFeedCandidate(youtubeExact, {
      originalInput: input,
      folderId,
      tags: [...new Set([...tags, 'youtube', 'video'])],
    });
  }

  const candidates = await findRssSourceCandidates(input, {
    limit: 8,
  });

  const first = candidates[0];

  if (!first) {
    throw new Error('No RSS/Atom/JSON/YouTube source found. Try a website URL, feed URL, YouTube channel URL, @handle or channel ID.');
  }

  return addRssFeedCandidate(first, {
    originalInput: input,
    folderId,
    tags: first.source === 'youtube-data-api'
      ? [...new Set([...tags, 'youtube', 'video'])]
      : tags,
  });
}

export async function addRssFeedFromUrl(inputUrl, {
  folderId = null,
  tags = [],
} = {}) {
  const yt = youtubeFeedCandidateFromInput(inputUrl);

  if (yt) {
    return addRssFeedCandidate(yt, {
      originalInput: inputUrl,
      folderId,
      tags: [...tags, 'youtube', 'video'],
    });
  }

  await requireRssCloudAuth();

  const candidates = await discoverRssFeeds(inputUrl);
  const first = candidates[0];

  if (!first) {
    throw new Error('No RSS/Atom/JSON feed found.');
  }

  return addRssFeedCandidate(first, {
    originalInput: inputUrl,
    folderId,
    tags,
  });
}

export async function refreshRssFeed(feedId, {
  force = false,
} = {}) {
  await requireRssCloudAuth();

  const settings = await getRssSettings();
  const feeds = await getRssFeeds();
  const feed = feeds.find((f) => f.id === feedId);

  if (!feed) throw new Error('Feed not found.');
  if (!feed.enabled && !force) return { feedId, skipped: true };

  const minMs = Number(settings.minRefreshIntervalMinutes || 30) * 60000;

  if (!force && feed.lastFetchedAt && Date.now() - feed.lastFetchedAt < minMs) {
    return {
      feedId,
      skipped: true,
      reason: 'fresh',
    };
  }

  try {
    const fetched = await fetchRssFeed(feed);

    if (fetched.notModified) {
      feed.lastFetchedAt = now();
      feed.lastError = '';

      await saveRssFeeds(feeds);

      return {
        feedId,
        notModified: true,
        count: 0,
      };
    }

    const parsed = parseFeed(fetched.body, {
      url: fetched.finalUrl || feed.feedUrl,
    });

    feed.title = parsed.feed.title || feed.title;
    feed.description = parsed.feed.description || feed.description || '';
    feed.siteUrl = parsed.feed.siteUrl || feed.siteUrl || '';
    feed.feedUrl = fetched.finalUrl || feed.feedUrl;
    feed.etag = fetched.etag || '';
    feed.lastModified = fetched.lastModified || '';
    feed.lastFetchedAt = now();
    feed.lastError = '';
    feed.updated = now();

    const items = await normalizeFetchedItems(feed, parsed, settings);

    await upsertRssItems(items);
    await saveRssFeeds(feeds);

    await pruneRssItems({
      maxItemsPerFeed: settings.maxItemsPerFeed,
      keepItemsDays: settings.keepItemsDays,
    });

    window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
      detail: {
        feedId,
        count: items.length,
      },
    }));

    return {
      feedId,
      count: items.length,
    };
  } catch (err) {
    feed.lastFetchedAt = now();
    feed.lastError = err?.message || String(err);
    feed.updated = now();

    await saveRssFeeds(feeds);

    window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
      detail: {
        feedId,
        error: feed.lastError,
      },
    }));

    throw err;
  }
}

function rssItemDedupeKey(item = {}) {
  const videoId =
    item.videoId ||
    videoIdFromYoutubeUrl(item.url || '') ||
    videoIdFromYoutubeUrl(item.mediaUrl || '');

  if (videoId) return `yt:${videoId}`;

  const url =
    item.canonicalUrl ||
    item.url ||
    item.mediaUrl ||
    '';

  if (url) return `url:${String(url).trim().toLowerCase()}`;

  const guid = item.guid || item.id || '';

  if (guid) return `guid:${String(guid).trim().toLowerCase()}`;

  return `title:${String(item.feedId || '')}:${String(item.title || '').trim().toLowerCase()}`;
}

export async function loadMoreRssFeedItems(feedId) {
  await requireRssCloudAuth();

  const settings = await getRssSettings();
  const feeds = await getRssFeeds();
  const feed = feeds.find((f) => f.id === feedId);

  if (!feed) throw new Error('Feed not found.');

  if (!isYoutubeFeed(feed)) {
    throw new Error('Load more is currently available for YouTube sources.');
  }

  if (!feed.channelId) {
    throw new Error('This YouTube source has no channel id. Re-add the channel once.');
  }

  const minMs = 20_000;

  if (feed.lastYoutubeMoreAt && Date.now() - feed.lastYoutubeMoreAt < minMs) {
    throw new Error('Please wait a few seconds before loading more videos.');
  }

  /*
    Existing local cache state.
    Critical: compare stable display identity, not just IndexedDB id.
    Old cached RSS items and YouTube Data API load-more items may have
    different item IDs, but same yt:VIDEO_ID.
  */
  const existing = await listRssItems({
    feedId: feed.id,
    unreadOnly: false,
    starredOnly: false,
    archived: true,
    limit: 100000,
  });

  const seenKeys = new Set(existing.map(rssItemDedupeKey));

  let pageToken = feed.youtubeNextPageToken || '';
  let nextPageToken = pageToken || '';
  let pagesTried = 0;
  let skippedDuplicates = 0;
  let skippedShorts = 0;
  let newItems = [];

  /*
    Ratelimit-schonend:
    - normally one API page per click
    - if token missing/stale and first page is duplicate, scan a few pages
      to reach genuinely older videos
  */
  const maxPagesToScan = pageToken ? 2 : 5;

  while (pagesTried < maxPagesToScan) {
    const page = await fetchYoutubeChannelVideos({
      channelId: feed.channelId,
      pageToken,
      limit: settings.youtubeMorePageSize || 12,
    });

    pagesTried++;

    nextPageToken = page.nextPageToken || '';

    let rawItems = (page.videos || []).map((video) => youtubeVideoToRawItem(video, feed));

    if (settings.youtubeHideShorts) {
      const before = rawItems.length;

      rawItems = rawItems.filter((item) => {
        const seconds = Number(item.youtubeDurationSeconds || 0);

        if (item.youtubeProbablyShort) return false;

        if (
          seconds > 0 &&
          seconds <= Number(settings.youtubeShortMaxSeconds || 61)
        ) {
          return false;
        }

        const hay = [
          item.title || '',
          item.summaryText || '',
          item.contentText || '',
          item.mediaDescription || '',
        ].join('\n').toLowerCase();

        return !hay.includes('#shorts') && !hay.includes('#short');
      });

      skippedShorts += before - rawItems.length;
    }

    const parsedLike = {
      feed: {
        title: page.channel?.title || feed.title,
      },
      items: rawItems,
    };

    const normalized = await normalizeFetchedItems(feed, parsedLike, settings);

    const pageNewItems = [];

    for (const item of normalized) {
      const key = rssItemDedupeKey(item);

      if (seenKeys.has(key)) {
        skippedDuplicates++;
        continue;
      }

      seenKeys.add(key);
      pageNewItems.push(item);
    }

    if (pageNewItems.length) {
      newItems = pageNewItems;
      break;
    }

    if (!nextPageToken) {
      break;
    }

    pageToken = nextPageToken;
  }

  if (newItems.length) {
    await upsertRssItems(newItems);
  }

  feed.youtubeNextPageToken = nextPageToken || '';
  feed.youtubePrevPageToken = '';
  feed.lastYoutubeMoreAt = now();
  feed.lastError = '';
  feed.updated = now();

  await saveRssFeeds(feeds);

  window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
    detail: {
      feedId,
      count: newItems.length,
      loadedMore: true,
      skippedDuplicates,
      skippedShorts,
      pagesTried,
    },
  }));

  return {
    feedId,
    count: newItems.length,
    hasMore: !!feed.youtubeNextPageToken,
    skippedDuplicates,
    skippedShorts,
    pagesTried,
  };
}

export async function refreshAllRssFeeds({
  force = false,
} = {}) {
  await requireRssCloudAuth();

  const feeds = await getRssFeeds();
  const out = [];

  for (const feed of feeds) {
    try {
      out.push(await refreshRssFeed(feed.id, { force }));
    } catch (err) {
      out.push({
        feedId: feed.id,
        error: err?.message || String(err),
      });
    }
  }

  window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
    detail: {
      all: true,
    },
  }));

  return out;
}

export async function markRssItemRead(itemId, read = true) {
  const item = await patchRssItem(itemId, {
    read: !!read,
  });

  window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
    detail: {
      itemId,
      localOnly: true,
    },
  }));

  return item;
}

export async function toggleRssItemStar(itemId) {
  const item = await getRssItem(itemId);

  if (!item) throw new Error('RSS item not found.');

  const next = await patchRssItem(itemId, {
    starred: !item.starred,
  });

  window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
    detail: {
      itemId,
      localOnly: true,
    },
  }));

  return next;
}

export async function archiveRssItem(itemId, archived = true) {
  const item = await patchRssItem(itemId, {
    archived: !!archived,
    read: true,
  });

  window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
    detail: {
      itemId,
      localOnly: true,
    },
  }));

  return item;
}

export async function saveRssItemAsNote(itemId, {
  folderId = undefined,
} = {}) {
  const item = await getRssItem(itemId);

  if (!item) throw new Error('RSS item not found.');

  const feeds = await getRssFeeds();
  const feed = feeds.find((f) => f.id === item.feedId);

  const id = uid();

  const isYoutube = !!(
    item.videoId ||
    String(item.mediaType || '') === 'video/youtube' ||
    /youtube\.com|youtu\.be/i.test(item.url || item.mediaUrl || '')
  );

  const note = {
    id,
    title: item.title || 'Article',
    type: 'markdown',
    folderId: folderId !== undefined ? folderId : (feed?.folderId || null),
    tags: [...new Set([
      'rss',
      'source',
      ...(isYoutube ? ['youtube', 'video'] : []),
      ...(String(item.mediaType || '').startsWith('audio/') ? ['podcast', 'audio'] : []),
      ...(feed?.tags || []),
    ])],
    pinned: false,
    icon: isYoutube ? 'play' : String(item.mediaType || '').startsWith('audio/') ? 'podcast' : feed?.icon || 'rss',
    color: isYoutube ? '#ef4444' : String(item.mediaType || '').startsWith('audio/') ? '#22c55e' : feed?.color || '#f59e0b',
    created: now(),
    updated: now(),
  };

  state.notes.set(id, note);
  await store.notes.put(note);

  const entry = getNoteDoc(id);
  await entry.ready;

  const body = rssItemMarkdown(item, feed);

  entry.doc.getText('markdown').insert(0, body);

  state.searchIndex.set(
    id,
    [
      note.title || '',
      (note.tags || []).join(' '),
      body,
    ].join(' ').toLowerCase()
  );

  await patchRssItem(itemId, {
    read: true,
    savedNoteId: id,
  });

  renderTree();

  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: {
      noteId: id,
      reason: 'rss-save-as-note',
      source: 'rss',
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
    detail: {
      reason: 'rss-save-as-note',
      noteId: id,
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
    detail: {
      itemId,
      savedNoteId: id,
      localOnly: true,
    },
  }));

  toast('Saved source item as note', 'success');

  return note;
}

export async function appendRssItemToCurrentNote(itemId) {
  if (!state.currentNoteId) {
    throw new Error('Open a note first.');
  }

  const item = await getRssItem(itemId);

  if (!item) throw new Error('RSS item not found.');

  const feeds = await getRssFeeds();
  const feed = feeds.find((f) => f.id === item.feedId);

  const ytext = getNoteDoc(state.currentNoteId).doc.getText('markdown');

  const full = rssItemMarkdown(item, feed)
    .replace(/^#\s+/, '## ')
    .trim();

  const prefix = ytext.length > 0 && !ytext.toString().endsWith('\n')
    ? '\n\n'
    : '';

  ytext.insert(ytext.length, prefix + full + '\n');

  await patchRssItem(itemId, {
    read: true,
  });

  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: {
      noteId: state.currentNoteId,
      reason: 'rss-append',
      source: 'rss',
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
    detail: {
      itemId,
      localOnly: true,
    },
  }));

  toast('Added source item to current note', 'success');
}

// AI action wrappers

function compactRssFeedForAi(feed) {
  if (!feed) return null;

  return {
    id: feed.id,
    title: feed.title,
    feedUrl: feed.feedUrl,
    siteUrl: feed.siteUrl || '',
    description: feed.description || '',
    sourceKind: feed.sourceKind || '',
    channelId: feed.channelId || '',
    tags: feed.tags || [],
    icon: feed.icon || '',
    color: feed.color || '',
    enabled: feed.enabled !== false,
    lastFetchedAt: feed.lastFetchedAt ? new Date(feed.lastFetchedAt).toISOString() : null,
    lastError: feed.lastError || '',
  };
}

export async function rssAddSourceAction({
  input = '',
  url = '',
  query = '',
  channel = '',
  folderId = null,
  tags = [],
} = {}) {
  const sourceInput = String(input || url || channel || query || '').trim();

  if (!sourceInput) {
    throw new Error('Source input is required. Provide a website URL, feed URL, YouTube channel URL, @handle, channel ID or search query.');
  }

  const feed = await addRssFeedFromUniversalInput(sourceInput, {
    folderId,
    tags: Array.isArray(tags) ? tags.map(String) : [],
  });

  return {
    ok: true,
    source: compactRssFeedForAi(feed),
    message: feed
      ? `Added source: ${feed.title || feed.feedUrl}`
      : 'Source added.',
  };
}

export async function rssSearchItemsAction(args = {}) {
  const items = await listRssItems({
    query: args.query || '',
    unreadOnly: args.unreadOnly !== false,
    starredOnly: !!args.starredOnly,
    archived: !!args.includeArchived,
    since: args.since || '',
    limit: args.limit || 20,
  });

  return {
    count: items.length,
    items: items.map((item) => ({
      id: item.id,
      feedId: item.feedId,
      feedTitle: item.feedTitle,
      title: item.title,
      author: item.author,
      url: item.url,
      publishedAt: item.publishedAt ? new Date(item.publishedAt).toISOString() : null,
      summary: item.summaryText || item.contentText?.slice(0, 800) || '',
      mediaUrl: item.mediaUrl || '',
      mediaType: item.mediaType || '',
      videoId: item.videoId || '',
      channelId: item.channelId || '',
      read: !!item.read,
      starred: !!item.starred,
      savedNoteId: item.savedNoteId || null,
    })),
  };
}

export async function rssReadItemAction({ itemId } = {}) {
  const item = await getRssItem(itemId);

  if (!item) throw new Error('RSS item not found.');

  return {
    id: item.id,
    feedId: item.feedId,
    feedTitle: item.feedTitle,
    title: item.title,
    author: item.author,
    url: item.url,
    publishedAt: item.publishedAt ? new Date(item.publishedAt).toISOString() : null,
    summaryText: item.summaryText || '',
    contentText: item.contentText || '',
    fullText: item.contentText || stripHtml(item.contentHtml || '') || item.summaryText || '',
    mediaUrl: item.mediaUrl || '',
    mediaType: item.mediaType || '',
    videoId: item.videoId || '',
    channelId: item.channelId || '',
    read: !!item.read,
    starred: !!item.starred,
    savedNoteId: item.savedNoteId || null,
  };
}

export async function rssSaveItemAsNoteAction(args = {}) {
  return saveRssItemAsNote(args.itemId, {
    folderId: args.folderId,
  });
}

export async function rssMarkItemReadAction({ itemId, read = true } = {}) {
  return markRssItemRead(itemId, read);
}