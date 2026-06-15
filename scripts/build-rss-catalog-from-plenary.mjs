#!/usr/bin/env node

// ============================================================
// Build YANTA RSS catalog from plenaryapp/awesome-rss-feeds snapshot
//
// Usage:
//   node scripts/build-rss-catalog-from-plenary.mjs vendor/awesome-rss-feeds src/rss/rss-catalog.js
//
// Input:
//   Plenary repo snapshot with OPML files under recommended/ and countries/
//
// Output:
//   ESM module exporting RSS_CATALOG.
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';

const inputDir = path.resolve(process.argv[2] || 'vendor/awesome-rss-feeds');
const outputFile = path.resolve(process.argv[3] || 'src/rss/rss-catalog.js');

const SKIP_PATH_PARTS = new Set([
  '.git',
  'node_modules',
]);

const COUNTRY_DIR_NAMES = new Set([
  'countries',
  'country',
]);

const RECOMMENDED_DIR_NAMES = new Set([
  'recommended',
  'recommendations',
]);

const CATEGORY_ALIASES = {
  'android-development': ['androiddev', 'android dev', 'android development'],
  'ios-development': ['iosdev', 'ios dev', 'ios development', 'swift'],
  'ui-ux': ['ui', 'ux', 'uiux', 'design'],
  'web-development': ['webdev', 'web dev', 'frontend', 'front-end'],
  'business-economy': ['business', 'economy', 'finance'],
  'personal-finance': ['personal finance', 'investing', 'money'],
  'tech': ['technology'],
  'programming': ['coding', 'software', 'dev', 'developer'],
};

function decodeXmlEntities(value = '') {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripXmlComments(text = '') {
  return String(text || '').replace(/<!--[\s\S]*?-->/g, '');
}

function attrsFromTag(tag = '') {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

  let m;

  while ((m = re.exec(tag)) !== null) {
    attrs[m[1]] = decodeXmlEntities(m[3] ?? m[4] ?? '');
  }

  return attrs;
}

function cleanUrl(value = '') {
  const raw = decodeXmlEntities(value).trim();

  if (!raw) return '';

  try {
    const url = new URL(raw);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';

    url.username = '';
    url.password = '';

    return url.href;
  } catch {
    return '';
  }
}

function hostnameFromUrl(value = '') {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function slugify(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function titleCaseFromSlug(slug = '') {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function cleanTitle(value = '', fallback = '') {
  return decodeXmlEntities(value || fallback)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function fileStem(filePath) {
  return path.basename(filePath).replace(/\.opml$/i, '');
}

function pathParts(filePath) {
  return filePath.split(path.sep).filter(Boolean);
}

function inferFacetFromPath(filePath) {
  const rel = path.relative(inputDir, filePath);
  const parts = pathParts(rel);
  const lower = parts.map((p) => p.toLowerCase());

  const stem = fileStem(filePath);
  const stemSlug = slugify(stem);

  const isCountry = lower.some((p) => COUNTRY_DIR_NAMES.has(p));
  const isRecommended = lower.some((p) => RECOMMENDED_DIR_NAMES.has(p));

  if (isCountry) {
    return {
      countries: [stemSlug],
      categories: ['news'],
      tags: ['country', stemSlug],
    };
  }

  if (isRecommended) {
    return {
      countries: [],
      categories: [stemSlug],
      tags: ['recommended', stemSlug, ...(CATEGORY_ALIASES[stemSlug] || []).map(slugify)],
    };
  }

  return {
    countries: [],
    categories: [stemSlug],
    tags: [stemSlug],
  };
}

/**
 * Lightweight OPML parser.
 *
 * We intentionally avoid dependencies. OPML here is simple enough:
 * <outline text="..." title="..." xmlUrl="..." htmlUrl="..." />
 *
 * Nested categories are tracked by stack.
 */
function parseOpmlOutlines(text, sourceFile) {
  const clean = stripXmlComments(text);
  const out = [];

  const stack = [];
  const tagRe = /<\s*(\/?)\s*outline\b([^>]*?)(\/?)\s*>/gi;

  let m;

  while ((m = tagRe.exec(clean)) !== null) {
    const closing = !!m[1];
    const rawAttrs = m[2] || '';
    const selfClosing = !!m[3] || /\/\s*$/.test(rawAttrs);

    if (closing) {
      stack.pop();
      continue;
    }

    const attrs = attrsFromTag(rawAttrs);
    const xmlUrl = cleanUrl(attrs.xmlUrl || attrs.xmlurl || attrs.feedUrl || attrs.feedurl || '');

    const title =
      cleanTitle(attrs.title || attrs.text || attrs.name || '', xmlUrl || fileStem(sourceFile));

    const htmlUrl = cleanUrl(attrs.htmlUrl || attrs.htmlurl || attrs.siteUrl || attrs.siteurl || '');

    if (xmlUrl) {
      out.push({
        title,
        feedUrl: xmlUrl,
        siteUrl: htmlUrl,
        opmlCategories: stack.map((x) => slugify(x)).filter(Boolean),
      });
    } else if (!selfClosing) {
      const label = cleanTitle(attrs.title || attrs.text || attrs.name || '', '');
      stack.push(label);
    }
  }

  return out;
}

async function walk(dir) {
  const entries = await fs.readdir(dir, {
    withFileTypes: true,
  });

  const files = [];

  for (const entry of entries) {
    if (SKIP_PATH_PARTS.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walk(full));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.opml')) {
      files.push(full);
    }
  }

  return files;
}

function recordId(feedUrl) {
  const host = hostnameFromUrl(feedUrl);
  const pathPart = (() => {
    try {
      return slugify(new URL(feedUrl).pathname || '');
    } catch {
      return '';
    }
  })();

  return slugify([host, pathPart].filter(Boolean).join('-')) || slugify(feedUrl);
}

function mergeRecords(existing, incoming) {
  return {
    ...existing,

    title:
      existing.title && existing.title.length <= incoming.title.length
        ? existing.title
        : incoming.title,

    siteUrl: existing.siteUrl || incoming.siteUrl || '',
    description: existing.description || incoming.description || '',

    categories: [...new Set([
      ...(existing.categories || []),
      ...(incoming.categories || []),
    ])].sort(),

    countries: [...new Set([
      ...(existing.countries || []),
      ...(incoming.countries || []),
    ])].sort(),

    tags: [...new Set([
      ...(existing.tags || []),
      ...(incoming.tags || []),
    ])].sort(),

    sources: [...new Set([
      ...(existing.sources || []),
      ...(incoming.sources || []),
    ])].sort(),
  };
}

async function main() {
  const opmlFiles = await walk(inputDir);
  const byFeedUrl = new Map();

  for (const file of opmlFiles) {
    const text = await fs.readFile(file, 'utf8');
    const inferred = inferFacetFromPath(file);
    const rel = path.relative(inputDir, file).replace(/\\/g, '/');

    const outlines = parseOpmlOutlines(text, file);

    for (const item of outlines) {
      const feedUrl = cleanUrl(item.feedUrl);
      if (!feedUrl) continue;

      const domain = hostnameFromUrl(item.siteUrl || feedUrl);

      const categories = [...new Set([
        ...inferred.categories,
        ...(item.opmlCategories || []),
      ].filter(Boolean))].sort();

      const countries = [...new Set(inferred.countries.filter(Boolean))].sort();

      const tags = [...new Set([
        ...inferred.tags,
        ...categories,
        ...countries,
        domain,
      ].filter(Boolean).map(slugify))].sort();

      const rec = {
        id: recordId(feedUrl),
        title: cleanTitle(item.title, domain || feedUrl),
        feedUrl,
        siteUrl: item.siteUrl || '',
        domain,
        description: '',
        language: '',
        categories,
        countries,
        tags,
        source: 'plenaryapp-awesome-rss-feeds',
        sources: [rel],
      };

      const key = feedUrl.toLowerCase();
      const existing = byFeedUrl.get(key);

      byFeedUrl.set(key, existing ? mergeRecords(existing, rec) : rec);
    }
  }

  const catalog = [...byFeedUrl.values()]
    .filter((x) => x.feedUrl && x.title)
    .sort((a, b) =>
      String(a.title || '').localeCompare(String(b.title || '')) ||
      String(a.feedUrl || '').localeCompare(String(b.feedUrl || ''))
    )
    .map((item, index) => ({
      ...item,
      id: item.id || `rss-catalog-${index}`,
    }));

  await fs.mkdir(path.dirname(outputFile), {
    recursive: true,
  });

  const payload = `// ============================================================
// YANTA Sources / RSS — generated curated catalog
//
// Generated by:
//   scripts/build-rss-catalog-from-plenary.mjs
//
// Source:
//   https://github.com/plenaryapp/awesome-rss-feeds
// License:
//   CC0-1.0
//
// Do not edit manually. Re-run npm run build:rss-catalog.
// ============================================================

export const RSS_CATALOG_GENERATED_AT = ${JSON.stringify(new Date().toISOString())};

export const RSS_CATALOG_SOURCE = Object.freeze({
  name: 'plenaryapp/awesome-rss-feeds',
  url: 'https://github.com/plenaryapp/awesome-rss-feeds',
  license: 'CC0-1.0',
});

export const RSS_CATALOG = ${JSON.stringify(catalog, null, 2)};
`;

  await fs.writeFile(outputFile, payload, 'utf8');

  console.log(`Wrote ${catalog.length} RSS catalog entries to ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});