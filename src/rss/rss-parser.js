// ============================================================
// YANTA Sources / RSS — feed parser
// Supports RSS 2.0, Atom, JSON Feed.
// Extracts clean images + audio/video enclosures.
// Filters tracking pixels / beacon images.
// ============================================================

function textOf(node) {
  return node?.textContent?.trim() || '';
}

function firstChildByLocalName(node, localName) {
  const wanted = String(localName || '').toLowerCase();

  for (const child of node?.children || []) {
    if (child.localName?.toLowerCase() === wanted) return child;
  }

  return null;
}

function firstText(node, names = []) {
  for (const name of names) {
    const child = firstChildByLocalName(node, name);
    const text = textOf(child);
    if (text) return text;
  }

  return '';
}

function firstAttr(node, selector, attr) {
  const el = node.querySelector(selector);
  return el?.getAttribute(attr) || '';
}

function parseDateMs(value) {
  const t = Date.parse(String(value || '').trim());
  return Number.isFinite(t) ? t : 0;
}

function htmlToText(html = '') {
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

function absolutizeUrl(raw, baseUrl = '') {
  try {
    return new URL(String(raw || '').trim(), baseUrl || location.href).href;
  } catch {
    return String(raw || '').trim();
  }
}

function stripTrackingParams(rawUrl) {
  try {
    const url = new URL(rawUrl);

    for (const key of [...url.searchParams.keys()]) {
      const k = key.toLowerCase();

      if (
        k.startsWith('utm_') ||
        k === 'fbclid' ||
        k === 'gclid' ||
        k === 'mc_cid' ||
        k === 'mc_eid' ||
        k === 'igshid'
      ) {
        url.searchParams.delete(key);
      }
    }

    return url.href;
  } catch {
    return rawUrl;
  }
}

function isLikelyTrackingImageUrl(rawUrl = '') {
  const s = String(rawUrl || '').trim();

  if (!s) return true;

  try {
    const url = new URL(s, location.href);
    const path = `${url.hostname}${url.pathname}`.toLowerCase();
    const qs = url.search.toLowerCase();

    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'data:') {
      return true;
    }

    if (
      path.includes('/_/stat') ||
      path.includes('/stat?') ||
      path.includes('/pixel') ||
      path.includes('pixel.') ||
      path.includes('/beacon') ||
      path.includes('/track') ||
      path.includes('/tracking') ||
      path.includes('/analytics') ||
      path.includes('/transparent') ||
      path.includes('/spacer') ||
      path.includes('/blank.') ||
      path.includes('/1x1') ||
      path.includes('doubleclick.net') ||
      path.includes('googletagmanager') ||
      path.includes('google-analytics') ||
      path.includes('facebook.com/tr') ||
      path.includes('medium.com/_/stat')
    ) {
      return true;
    }

    if (
      qs.includes('event=') ||
      qs.includes('clientviewed') ||
      qs.includes('postid=') ||
      qs.includes('referrersource=full_rss')
    ) {
      return true;
    }

    if (
      !/\.(png|jpe?g|gif|webp|avif|svg)(?:$|[?#])/i.test(url.href) &&
      (
        path.includes('stat') ||
        path.includes('track') ||
        path.includes('pixel') ||
        path.includes('beacon')
      )
    ) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

function imageLooksTinyOrTracking(img) {
  if (!img) return true;

  const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
  if (isLikelyTrackingImageUrl(src)) return true;

  const w = Number(img.getAttribute('width') || img.style?.width?.replace('px', '') || 0);
  const h = Number(img.getAttribute('height') || img.style?.height?.replace('px', '') || 0);

  if ((w && w <= 2) || (h && h <= 2)) return true;
  if (w === 1 && h === 1) return true;

  const alt = String(img.getAttribute('alt') || '').toLowerCase();
  if (alt.includes('tracking') || alt.includes('pixel')) return true;

  return false;
}

function findImageUrlFromHtml(html, baseUrl) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '');

  for (const img of tmp.querySelectorAll('img[src], img[data-src]')) {
    if (imageLooksTinyOrTracking(img)) continue;

    const raw =
      img.getAttribute('src') ||
      img.getAttribute('data-src') ||
      '';

    const url = absolutizeUrl(raw, baseUrl);

    if (!isLikelyTrackingImageUrl(url)) {
      return url;
    }
  }

  return '';
}

function mediaInfoFromElement(el, baseUrl) {
  if (!el) return null;

  const local = el.localName?.toLowerCase();
  const nodeName = el.nodeName?.toLowerCase();

  const url =
    el.getAttribute('url') ||
    el.getAttribute('href') ||
    el.getAttribute('src') ||
    '';

  if (!url) return null;

  const type =
    el.getAttribute('type') ||
    el.getAttribute('medium') ||
    '';

  const cleanUrl = absolutizeUrl(url, baseUrl);
  const lowerType = String(type || '').toLowerCase();

  const isMediaNode =
    nodeName === 'media:content' ||
    nodeName === 'media:thumbnail' ||
    local === 'content' ||
    local === 'thumbnail' ||
    local === 'enclosure' ||
    local === 'link';

  if (!isMediaNode) return null;

  if (
    lowerType.startsWith('audio/') ||
    lowerType === 'audio' ||
    /\.(mp3|m4a|aac|ogg|oga|opus|wav)(?:$|[?#])/i.test(cleanUrl)
  ) {
    return {
      mediaUrl: cleanUrl,
      mediaType: lowerType.startsWith('audio/') ? lowerType : 'audio/mpeg',
      imageUrl: '',
    };
  }

  if (
    lowerType.startsWith('video/') ||
    lowerType === 'video' ||
    /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(cleanUrl)
  ) {
    return {
      mediaUrl: cleanUrl,
      mediaType: lowerType.startsWith('video/') ? lowerType : 'video/mp4',
      imageUrl: '',
    };
  }

  if (
    lowerType.startsWith('image/') ||
    lowerType === 'image' ||
    local === 'thumbnail' ||
    nodeName === 'media:thumbnail' ||
    /\.(png|jpe?g|gif|webp|avif|svg)(?:$|[?#])/i.test(cleanUrl)
  ) {
    if (isLikelyTrackingImageUrl(cleanUrl)) return null;

    return {
      imageUrl: cleanUrl,
      mediaUrl: '',
      mediaType: '',
    };
  }

  return null;
}

function mediaDescriptionFromItem(item) {
  const el =
    [...item.querySelectorAll?.('*') || []].find((x) =>
      x.nodeName?.toLowerCase() === 'media:description' ||
      x.localName?.toLowerCase() === 'description'
    );

  return textOf(el);
}

function youtubeMetaFromItem(item) {
  const videoId =
    firstText(item, ['videoId']) ||
    [...item.querySelectorAll?.('*') || []].find((x) => x.nodeName?.toLowerCase() === 'yt:videoid')?.textContent?.trim() ||
    '';

  const channelId =
    firstText(item, ['channelId']) ||
    [...item.querySelectorAll?.('*') || []].find((x) => x.nodeName?.toLowerCase() === 'yt:channelid')?.textContent?.trim() ||
    '';

  return {
    videoId,
    channelId,
  };
}

function extractMediaFromXmlItem(item, baseUrl) {
  const out = {
    imageUrl: '',
    mediaUrl: '',
    mediaType: '',
    mediaDescription: '',
    videoId: '',
    channelId: '',
  };

  const yt = youtubeMetaFromItem(item);
  out.videoId = yt.videoId || '';
  out.channelId = yt.channelId || '';

  if (out.videoId) {
    out.mediaUrl = `https://www.youtube.com/watch?v=${out.videoId}`;
    out.mediaType = 'video/youtube';
  }

  out.mediaDescription = mediaDescriptionFromItem(item);

  const descendants = [
    ...item.children,
    ...item.querySelectorAll?.('*') || [],
  ];

  for (const el of descendants) {
    const info = mediaInfoFromElement(el, baseUrl);
    if (!info) continue;

    if (!out.mediaUrl && info.mediaUrl) {
      out.mediaUrl = info.mediaUrl;
      out.mediaType = info.mediaType || '';
    }

    if (!out.imageUrl && info.imageUrl) {
      out.imageUrl = info.imageUrl;
    }
  }

  return out;
}

function normalizeItem(raw = {}, baseUrl = '') {
  let url = absolutizeUrl(raw.url || '', baseUrl);
  url = stripTrackingParams(url);

  const summaryHtml = raw.summaryHtml || '';
  const contentHtml = raw.contentHtml || '';

  let imageUrl =
    raw.imageUrl ||
    findImageUrlFromHtml(contentHtml || summaryHtml, baseUrl);

  imageUrl = imageUrl && !isLikelyTrackingImageUrl(imageUrl)
    ? absolutizeUrl(imageUrl, baseUrl)
    : '';

  let mediaUrl = raw.mediaUrl || '';
  mediaUrl = mediaUrl ? absolutizeUrl(mediaUrl, baseUrl) : '';

  return {
    guid: String(raw.guid || url || raw.title || '').trim(),
    url,
    canonicalUrl: url,

    title: String(raw.title || 'Untitled').trim() || 'Untitled',
    author: String(raw.author || '').trim(),
    publishedAt: Number(raw.publishedAt || 0) || 0,

    summaryHtml,
    summaryText: raw.summaryText || htmlToText(summaryHtml).slice(0, 2200),

    contentHtml,
    contentText: raw.contentText || htmlToText(contentHtml).slice(0, 50000),

    imageUrl,

    mediaUrl,
    mediaType: raw.mediaType || '',
    mediaDescription: raw.mediaDescription || '',

    videoId: raw.videoId || '',
    channelId: raw.channelId || '',
  };
}

function parseRss(doc, { url }) {
  const channel = doc.querySelector('channel') || doc.documentElement;

  const feed = {
    title: firstText(channel, ['title']) || url,
    description: firstText(channel, ['description']),
    siteUrl: absolutizeUrl(firstText(channel, ['link']), url),
    feedUrl: url,
  };

  const items = [...doc.querySelectorAll('item')].map((item) => {
    const contentEncoded =
      [...item.children].find((el) =>
        el.localName?.toLowerCase() === 'encoded' ||
        el.nodeName?.toLowerCase() === 'content:encoded'
      );

    const description = firstText(item, ['description']);
    const content = textOf(contentEncoded) || description;

    const link =
      firstText(item, ['link']) ||
      firstText(item, ['guid']);

    const media = extractMediaFromXmlItem(item, url);

    return normalizeItem({
      guid: firstText(item, ['guid']) || link,
      url: link,
      title: firstText(item, ['title']),
      author: firstText(item, ['creator', 'author']),
      publishedAt: parseDateMs(firstText(item, ['pubDate', 'published', 'updated', 'date'])),
      summaryHtml: description,
      contentHtml: content,
      imageUrl: media.imageUrl,
      mediaUrl: media.mediaUrl,
      mediaType: media.mediaType,
      mediaDescription: media.mediaDescription,
      videoId: media.videoId,
      channelId: media.channelId,
    }, url);
  });

  return { feed, items };
}

function parseAtom(doc, { url }) {
  const root = doc.documentElement;

  const feed = {
    title: firstText(root, ['title']) || url,
    description: firstText(root, ['subtitle']),
    siteUrl:
      absolutizeUrl(firstAttr(root, 'link[rel="alternate"]', 'href') || firstAttr(root, 'link', 'href'), url),
    feedUrl: url,
  };

  const entries = [...root.children].filter((el) =>
    el.localName?.toLowerCase() === 'entry'
  );

  const items = entries.map((entry) => {
    const link =
      firstAttr(entry, 'link[rel="alternate"]', 'href') ||
      firstAttr(entry, 'link', 'href');

    const summary = firstText(entry, ['summary']);
    const content = firstText(entry, ['content']) || summary;

    const authorNode = firstChildByLocalName(entry, 'author');
    const author = firstText(authorNode, ['name']) || textOf(authorNode);

    const media = extractMediaFromXmlItem(entry, url);

    return normalizeItem({
      guid: firstText(entry, ['id']) || link,
      url: link,
      title: firstText(entry, ['title']),
      author,
      publishedAt: parseDateMs(firstText(entry, ['published', 'updated'])),
      summaryHtml: summary,
      contentHtml: content,
      imageUrl: media.imageUrl,
      mediaUrl: media.mediaUrl,
      mediaType: media.mediaType,
      mediaDescription: media.mediaDescription,
      videoId: media.videoId,
      channelId: media.channelId,
    }, url);
  });

  return { feed, items };
}

function mediaFromJsonItem(item = {}) {
  const out = {
    imageUrl: item.image || item.banner_image || '',
    mediaUrl: '',
    mediaType: '',
  };

  for (const att of item.attachments || []) {
    const url = att.url || '';
    const type = String(att.mime_type || att.type || '').toLowerCase();

    if (!url) continue;

    if (!out.mediaUrl && type.startsWith('audio/')) {
      out.mediaUrl = url;
      out.mediaType = type;
      continue;
    }

    if (!out.mediaUrl && type.startsWith('video/')) {
      out.mediaUrl = url;
      out.mediaType = type;
      continue;
    }

    if (!out.imageUrl && type.startsWith('image/')) {
      out.imageUrl = url;
    }
  }

  return out;
}

function parseJsonFeed(raw, { url }) {
  const json = JSON.parse(raw);

  const feed = {
    title: json.title || url,
    description: json.description || '',
    siteUrl: absolutizeUrl(json.home_page_url || '', url),
    feedUrl: url,
  };

  const items = (json.items || []).map((item) => {
    const media = mediaFromJsonItem(item);

    return normalizeItem({
      guid: item.id || item.url,
      url: item.url || item.external_url,
      title: item.title || item.summary || item.url,
      author: item.author?.name || '',
      publishedAt: parseDateMs(item.date_published || item.date_modified),
      summaryHtml: item.summary || '',
      contentHtml: item.content_html || item.content_text || item.summary || '',
      contentText: item.content_text || '',
      imageUrl: media.imageUrl,
      mediaUrl: media.mediaUrl,
      mediaType: media.mediaType,
    }, url);
  });

  return { feed, items };
}

export function parseFeed(rawText, { url = '' } = {}) {
  const raw = String(rawText || '').trim();

  if (!raw) {
    throw new Error('Feed is empty.');
  }

  if (raw.startsWith('{')) {
    return parseJsonFeed(raw, { url });
  }

  const doc = new DOMParser().parseFromString(raw, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new Error('Feed XML could not be parsed.');
  }

  const rootName = doc.documentElement?.localName?.toLowerCase();

  if (rootName === 'rss' || rootName === 'rdf') {
    return parseRss(doc, { url });
  }

  if (rootName === 'feed') {
    return parseAtom(doc, { url });
  }

  if (doc.querySelector('channel item')) {
    return parseRss(doc, { url });
  }

  throw new Error('Unsupported feed format.');
}