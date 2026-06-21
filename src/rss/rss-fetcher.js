// ============================================================
// YANTA Sources / RSS — fetch provider
//
// Fetch strategy:
// - Cloud provider is the SaaS/default path.
// - It avoids browser CORS issues.
// - It enables privacy-protected RSS image loading.
// - Direct browser fetch remains as fallback for CORS-friendly feeds.
//
// YouTube:
// - Cloud resolves @handles/custom URLs with YouTube Data API v3.
// ============================================================

import {
  YANTA_CLOUD_BASE_URL,
} from '../cloud/cloud-api.js';

import {
  getRssSettings,
} from './rss-settings.js';

function apiUrl(path) {
  const base = String(YANTA_CLOUD_BASE_URL || '/cloud-api').replace(/\/+$/, '');
  const cleanPath = String(path || '').replace(/^\/+/, '');

  return `${base}/${cleanPath}`;
}

function cleanUrl(value = '') {
  try {
    const url = new URL(String(value || '').trim());

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '';
    }

    url.username = '';
    url.password = '';

    return url.href;
  } catch {
    return '';
  }
}

async function responseTextPreview(res) {
  try {
    const text = await res.text();
    return text.slice(0, 700);
  } catch {
    return '';
  }
}

async function readJsonResponse(res, fallbackMessage) {
  const contentType = res.headers.get('content-type') || '';

  if (!contentType.toLowerCase().includes('application/json')) {
    const preview = await responseTextPreview(res);

    const err = new Error(
      [
        fallbackMessage,
        '',
        `Expected JSON but received: ${contentType || 'unknown content-type'}`,
        '',
        'Response preview:',
        preview,
      ].join('\n')
    );

    err.code = 'ERSS_NON_JSON_RESPONSE';
    err.status = res.status;

    throw err;
  }

  try {
    return await res.json();
  } catch (parseErr) {
    const err = new Error(
      `${fallbackMessage}\n\nCould not parse JSON response: ${parseErr?.message || String(parseErr)}`
    );

    err.code = 'ERSS_INVALID_JSON';
    err.status = res.status;
    err.cause = parseErr;

    throw err;
  }
}

async function parseJsonError(res, fallback) {
  const contentType = res.headers.get('content-type') || '';

  if (contentType.toLowerCase().includes('application/json')) {
    try {
      const json = await res.json();

      return (
        json?.message ||
        json?.error?.message ||
        json?.error ||
        fallback
      );
    } catch {}
  }

  const preview = await responseTextPreview(res);

  return [
    fallback,
    '',
    `Non-JSON response: ${contentType || 'unknown content-type'}`,
    '',
    'Response preview:',
    preview,
  ].join('\n');
}

function assertCloudAuthError(res) {
  if (res.status !== 401) return;

  const err = new Error(
    'Sign in to YANTA Cloud to use privacy-protected Sources fetching.'
  );

  err.code = 'EAUTH_REQUIRED';
  err.status = 401;

  throw err;
}

export async function discoverRssFeeds(inputUrl) {
  const url = cleanUrl(inputUrl);

  if (!url) {
    throw new Error('Enter a valid website or feed URL.');
  }

  const endpoint = new URL(apiUrl('/api/rss/discover'));
  endpoint.searchParams.set('url', url);

  const res = await fetch(endpoint.href, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  assertCloudAuthError(res);

  if (!res.ok) {
    throw new Error(
      await parseJsonError(
        res,
        `Feed discovery failed: HTTP ${res.status}`
      )
    );
  }

  const json = await readJsonResponse(
    res,
    `Feed discovery failed: HTTP ${res.status}`
  );

  return Array.isArray(json.feeds) ? json.feeds : [];
}

export async function searchRssSources(query, {
  limit = 8,
} = {}) {
  const q = String(query || '').trim();

  if (!q) {
    throw new Error('Enter a source name, website, domain or feed URL.');
  }

  const endpoint = new URL(apiUrl('/api/rss/search'));

  endpoint.searchParams.set('q', q);
  endpoint.searchParams.set(
    'limit',
    String(Math.max(1, Math.min(20, Number(limit || 8))))
  );

  const res = await fetch(endpoint.href, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  assertCloudAuthError(res);

  if (!res.ok) {
    throw new Error(
      await parseJsonError(
        res,
        `Source search failed: HTTP ${res.status}`
      )
    );
  }

  const json = await readJsonResponse(
    res,
    `Source search failed: HTTP ${res.status}`
  );

  return Array.isArray(json.feeds) ? json.feeds : [];
}

export async function resolveYoutubeChannel(input, {
  includeVideos = true,
  limit = 12,
} = {}) {
  const q = String(input || '').trim();

  if (!q) {
    throw new Error('Enter a YouTube channel URL, handle or channel ID.');
  }

  const endpoint = new URL(apiUrl('/api/youtube/resolve'));

  endpoint.searchParams.set('q', q);
  endpoint.searchParams.set('includeVideos', includeVideos ? '1' : '0');
  endpoint.searchParams.set('limit', String(Math.max(1, Math.min(24, Number(limit || 12)))));

  const res = await fetch(endpoint.href, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  assertCloudAuthError(res);

  if (!res.ok) {
    throw new Error(
      await parseJsonError(
        res,
        `YouTube channel lookup failed: HTTP ${res.status}`
      )
    );
  }

  return readJsonResponse(
    res,
    `YouTube channel lookup failed: HTTP ${res.status}`
  );
}

export async function searchYoutubeChannels(query, {
  limit = 6,
} = {}) {
  const q = String(query || '').trim();

  if (!q) return [];

  const endpoint = new URL(apiUrl('/api/youtube/search'));

  endpoint.searchParams.set('q', q);
  endpoint.searchParams.set('limit', String(Math.max(1, Math.min(12, Number(limit || 6)))));

  const res = await fetch(endpoint.href, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  assertCloudAuthError(res);

  if (!res.ok) {
    throw new Error(
      await parseJsonError(
        res,
        `YouTube search failed: HTTP ${res.status}`
      )
    );
  }

  const json = await readJsonResponse(
    res,
    `YouTube search failed: HTTP ${res.status}`
  );

  return Array.isArray(json.channels) ? json.channels : [];
}

async function fetchFeedDirect(feed) {
  const feedUrl = cleanUrl(feed?.feedUrl);

  if (!feedUrl) {
    throw new Error('Invalid feed URL.');
  }

  const headers = {
    Accept: [
      'application/rss+xml',
      'application/atom+xml',
      'application/feed+json',
      'application/json',
      'application/xml',
      'text/xml',
      '*/*',
    ].join(', '),
  };

  if (feed.etag) {
    headers['If-None-Match'] = feed.etag;
  }

  if (feed.lastModified) {
    headers['If-Modified-Since'] = feed.lastModified;
  }

  const res = await fetch(feedUrl, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    headers,
  });

  if (res.status === 304) {
    return {
      notModified: true,
    };
  }

  if (!res.ok) {
    throw new Error(`Direct feed fetch failed: HTTP ${res.status}`);
  }

  return {
    body: await res.text(),
    contentType: res.headers.get('content-type') || '',
    etag: res.headers.get('etag') || '',
    lastModified: res.headers.get('last-modified') || '',
    finalUrl: res.url || feedUrl,
  };
}

async function fetchFeedCloud(feed) {
  const feedUrl = cleanUrl(feed?.feedUrl);

  if (!feedUrl) {
    throw new Error('Invalid feed URL.');
  }

  const endpoint = new URL(apiUrl('/api/rss/fetch'));

  endpoint.searchParams.set('url', feedUrl);

  if (feed.etag) {
    endpoint.searchParams.set('etag', feed.etag);
  }

  if (feed.lastModified) {
    endpoint.searchParams.set('lastModified', feed.lastModified);
  }

  const res = await fetch(endpoint.href, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  assertCloudAuthError(res);

  if (!res.ok) {
    throw new Error(
      await parseJsonError(
        res,
        `Feed fetch failed: HTTP ${res.status}`
      )
    );
  }

  return readJsonResponse(
    res,
    `Feed fetch failed: HTTP ${res.status}`
  );
}

export async function fetchRssFeed(feed) {
  const settings = await getRssSettings();

  if (settings.fetchProvider === 'direct') {
    return fetchFeedDirect(feed);
  }

  try {
    return await fetchFeedCloud(feed);
  } catch (cloudErr) {
    if (cloudErr?.code === 'EAUTH_REQUIRED') {
      throw cloudErr;
    }

    try {
      return await fetchFeedDirect(feed);
    } catch {
      throw cloudErr;
    }
  }
}

export async function rssImageProxyUrl(rawUrl, settingsOverride = null) {
  const settings = settingsOverride || await getRssSettings();
  const url = cleanUrl(rawUrl);

  if (!url) return '';

  if (!settings.useImageProxy) {
    return url;
  }

  const endpoint = new URL(apiUrl('/api/rss/image'));
  endpoint.searchParams.set('url', url);

  return endpoint.href;
}

export async function getYoutubeVideosInfo(videoIds = []) {
  const ids = [...new Set(
    (Array.isArray(videoIds) ? videoIds : [])
      .map((x) => String(x || '').trim())
      .filter(Boolean)
  )].slice(0, 50);

  if (!ids.length) return [];

  const endpoint = new URL(apiUrl('/api/youtube/videos-info'));
  endpoint.searchParams.set('ids', ids.join(','));

  const res = await fetch(endpoint.href, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  assertCloudAuthError(res);

  if (!res.ok) {
    throw new Error(
      await parseJsonError(
        res,
        `YouTube video metadata failed: HTTP ${res.status}`
      )
    );
  }

  const json = await readJsonResponse(
    res,
    `YouTube video metadata failed: HTTP ${res.status}`
  );

  return Array.isArray(json.videos) ? json.videos : [];
}

export async function fetchYoutubeChannelVideos({
  channelId = '',
  pageToken = '',
  limit = 12,
} = {}) {
  const id = String(channelId || '').trim();

  if (!id) {
    throw new Error('YouTube channel id missing.');
  }

  const endpoint = new URL(apiUrl('/api/youtube/channel-videos'));

  endpoint.searchParams.set('channelId', id);
  endpoint.searchParams.set('limit', String(Math.max(1, Math.min(24, Number(limit || 12)))));

  if (pageToken) {
    endpoint.searchParams.set('pageToken', String(pageToken));
  }

  const res = await fetch(endpoint.href, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  assertCloudAuthError(res);

  if (!res.ok) {
    throw new Error(
      await parseJsonError(
        res,
        `YouTube videos load failed: HTTP ${res.status}`
      )
    );
  }

  return readJsonResponse(
    res,
    `YouTube videos load failed: HTTP ${res.status}`
  );
}