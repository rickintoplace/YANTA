// ============================================================
// YANTA Sources / RSS — fetch provider
//
// Fetch strategy:
// - Cloud provider is the SaaS/default path.
// - It avoids browser CORS issues.
// - It enables privacy-protected RSS image loading.
// - Direct browser fetch remains as fallback for CORS-friendly feeds.
//
// Important:
// Do NOT build API URLs with new URL('/api/..', base),
// because that would drop '/cloud-api' from same-origin proxy bases.
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
  
  /**
   * Discover RSS/Atom/JSON feeds from a website or feed URL.
   *
   * Uses YANTA Cloud because website/feed discovery usually fails in-browser
   * due to CORS.
   */
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
  
  /**
   * Fetch a feed by configured provider.
   *
   * Default SaaS path:
   *   Cloud fetch -> reliable CORS-free feed loading.
   *
   * Fallback:
   *   If cloud fetch fails for availability/config reasons, direct browser fetch
   *   may still work for CORS-friendly feeds.
   */
  export async function fetchRssFeed(feed) {
    const settings = await getRssSettings();
  
    if (settings.fetchProvider === 'direct') {
      return fetchFeedDirect(feed);
    }
  
    try {
      return await fetchFeedCloud(feed);
    } catch (cloudErr) {
      // Auth errors should be shown directly. Direct fallback would hide the
      // actual SaaS requirement and usually still fail on CORS.
      if (cloudErr?.code === 'EAUTH_REQUIRED') {
        throw cloudErr;
      }
  
      // Direct fallback is useful for development or if the cloud proxy is
      // temporarily unavailable and the feed supports CORS.
      try {
        return await fetchFeedDirect(feed);
      } catch {
        throw cloudErr;
      }
    }
  }
  
  /**
   * Build a privacy-protected image URL for RSS thumbnails/content.
   *
   * Images are not stored in YANTA Cloud Storage. This only returns a proxy URL.
   */
  export async function rssImageProxyUrl(rawUrl) {
    const settings = await getRssSettings();
    const url = cleanUrl(rawUrl);
  
    if (!url) return '';
  
    if (!settings.useImageProxy) {
      return url;
    }
  
    const endpoint = new URL(apiUrl('/api/rss/image'));
    endpoint.searchParams.set('url', url);
  
    return endpoint.href;
  }