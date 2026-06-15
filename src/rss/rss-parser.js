// ============================================================
// YANTA Sources / RSS — feed parser
// Supports RSS 2.0, Atom, JSON Feed.
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
    return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
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
  
  function findImageUrlFromHtml(html, baseUrl) {
    const tmp = document.createElement('div');
    tmp.innerHTML = String(html || '');
  
    const img = tmp.querySelector('img[src]');
    if (!img) return '';
  
    return absolutizeUrl(img.getAttribute('src'), baseUrl);
  }
  
  function enclosureImageUrl(item, baseUrl) {
    for (const el of item.children || []) {
      const local = el.localName?.toLowerCase();
  
      if (local === 'enclosure' || local === 'thumbnail' || local === 'content') {
        const url = el.getAttribute('url') || el.getAttribute('href') || '';
        const type = el.getAttribute('type') || '';
  
        if (url && (!type || type.startsWith('image/'))) {
          return absolutizeUrl(url, baseUrl);
        }
      }
    }
  
    return '';
  }
  
  function normalizeItem(raw = {}, baseUrl = '') {
    let url = absolutizeUrl(raw.url || '', baseUrl);
    url = stripTrackingParams(url);
  
    const summaryHtml = raw.summaryHtml || '';
    const contentHtml = raw.contentHtml || '';
    const imageUrl =
      raw.imageUrl ||
      findImageUrlFromHtml(contentHtml || summaryHtml, baseUrl);
  
    return {
      guid: String(raw.guid || url || raw.title || '').trim(),
      url,
      canonicalUrl: url,
  
      title: String(raw.title || 'Untitled').trim() || 'Untitled',
      author: String(raw.author || '').trim(),
      publishedAt: Number(raw.publishedAt || 0) || 0,
  
      summaryHtml,
      summaryText: raw.summaryText || htmlToText(summaryHtml).slice(0, 2000),
  
      contentHtml,
      contentText: raw.contentText || htmlToText(contentHtml).slice(0, 12000),
  
      imageUrl: imageUrl ? absolutizeUrl(imageUrl, baseUrl) : '',
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
  
      return normalizeItem({
        guid: firstText(item, ['guid']) || link,
        url: link,
        title: firstText(item, ['title']),
        author: firstText(item, ['creator', 'author']),
        publishedAt: parseDateMs(firstText(item, ['pubDate', 'published', 'updated', 'date'])),
        summaryHtml: description,
        contentHtml: content,
        imageUrl: enclosureImageUrl(item, url),
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
  
      return normalizeItem({
        guid: firstText(entry, ['id']) || link,
        url: link,
        title: firstText(entry, ['title']),
        author,
        publishedAt: parseDateMs(firstText(entry, ['published', 'updated'])),
        summaryHtml: summary,
        contentHtml: content,
        imageUrl: enclosureImageUrl(entry, url),
      }, url);
    });
  
    return { feed, items };
  }
  
  function parseJsonFeed(raw, { url }) {
    const json = JSON.parse(raw);
  
    const feed = {
      title: json.title || url,
      description: json.description || '',
      siteUrl: absolutizeUrl(json.home_page_url || '', url),
      feedUrl: url,
    };
  
    const items = (json.items || []).map((item) => normalizeItem({
      guid: item.id || item.url,
      url: item.url || item.external_url,
      title: item.title || item.summary || item.url,
      author: item.author?.name || '',
      publishedAt: parseDateMs(item.date_published || item.date_modified),
      summaryHtml: item.summary || '',
      contentHtml: item.content_html || item.content_text || item.summary || '',
      contentText: item.content_text || '',
      imageUrl: item.image || item.banner_image || '',
    }, url));
  
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