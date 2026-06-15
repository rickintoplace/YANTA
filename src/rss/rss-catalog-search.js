// ============================================================
// YANTA Sources / RSS — local curated catalog search
// ============================================================

import {
  RSS_CATALOG,
  RSS_CATALOG_SOURCE,
  RSS_CATALOG_GENERATED_AT,
} from './rss-catalog.js';

const CATEGORY_META = {
  android: { label: 'Android', icon: 'smartphone', aliases: ['android'] },
  'android-development': { label: 'Android Development', icon: 'code-2', aliases: ['androiddev', 'android dev'] },
  apple: { label: 'Apple', icon: 'apple', aliases: ['mac', 'iphone', 'ios'] },
  architecture: { label: 'Architecture', icon: 'building-2', aliases: ['architecture'] },
  beauty: { label: 'Beauty', icon: 'sparkles', aliases: ['beauty'] },
  books: { label: 'Books', icon: 'book-open', aliases: ['book', 'reading'] },
  'business-economy': { label: 'Business & Economy', icon: 'briefcase-business', aliases: ['business', 'economy', 'finance'] },
  cars: { label: 'Cars', icon: 'car', aliases: ['auto', 'automotive'] },
  cricket: { label: 'Cricket', icon: 'activity', aliases: ['cricket'] },
  diy: { label: 'DIY', icon: 'hammer', aliases: ['diy', 'how to', 'maker'] },
  fashion: { label: 'Fashion', icon: 'shirt', aliases: ['fashion'] },
  food: { label: 'Food', icon: 'utensils', aliases: ['food', 'cooking', 'recipes'] },
  football: { label: 'Football', icon: 'circle-dot', aliases: ['football', 'soccer'] },
  funny: { label: 'Funny', icon: 'laugh', aliases: ['funny', 'humor', 'comics'] },
  gaming: { label: 'Gaming', icon: 'gamepad-2', aliases: ['games', 'gaming'] },
  history: { label: 'History', icon: 'landmark', aliases: ['history'] },
  'ios-development': { label: 'iOS Development', icon: 'code-2', aliases: ['iosdev', 'swift', 'ios dev'] },
  movies: { label: 'Movies', icon: 'clapperboard', aliases: ['film', 'movies', 'cinema'] },
  music: { label: 'Music', icon: 'music', aliases: ['music'] },
  news: { label: 'News', icon: 'newspaper', aliases: ['news', 'world news', 'local news'] },
  'personal-finance': { label: 'Personal finance', icon: 'wallet-cards', aliases: ['money', 'investing', 'finance'] },
  photography: { label: 'Photography', icon: 'camera', aliases: ['photo', 'photography'] },
  programming: { label: 'Programming', icon: 'code-2', aliases: ['coding', 'software', 'developer', 'dev'] },
  science: { label: 'Science', icon: 'flask-conical', aliases: ['science', 'research'] },
  space: { label: 'Space', icon: 'rocket', aliases: ['space', 'nasa', 'astronomy'] },
  sports: { label: 'Sports', icon: 'trophy', aliases: ['sports'] },
  startups: { label: 'Startups', icon: 'rocket', aliases: ['startup', 'startups', 'founder'] },
  tech: { label: 'Tech', icon: 'cpu', aliases: ['technology', 'tech'] },
  television: { label: 'Television', icon: 'tv', aliases: ['tv', 'television'] },
  tennis: { label: 'Tennis', icon: 'circle', aliases: ['tennis'] },
  travel: { label: 'Travel', icon: 'plane', aliases: ['travel'] },
  'ui-ux': { label: 'UI / UX', icon: 'layout-template', aliases: ['ui', 'ux', 'design', 'product design'] },
  'web-development': { label: 'Web Development', icon: 'globe', aliases: ['webdev', 'frontend', 'front-end', 'web dev'] },
};

const COUNTRY_META = {
  australia: { label: 'Australia', icon: 'map-pin', aliases: ['australia', 'au'] },
  bangladesh: { label: 'Bangladesh', icon: 'map-pin', aliases: ['bangladesh', 'bd'] },
  brazil: { label: 'Brazil', icon: 'map-pin', aliases: ['brazil', 'brasil', 'br'] },
  canada: { label: 'Canada', icon: 'map-pin', aliases: ['canada', 'ca'] },
  germany: { label: 'Germany', icon: 'map-pin', aliases: ['germany', 'deutschland', 'de'] },
  spain: { label: 'Spain', icon: 'map-pin', aliases: ['spain', 'españa', 'es'] },
  france: { label: 'France', icon: 'map-pin', aliases: ['france', 'fr'] },
  'united-kingdom': { label: 'United Kingdom', icon: 'map-pin', aliases: ['uk', 'gb', 'britain', 'united kingdom', 'england'] },
  'hong-kong-sar-china': { label: 'Hong Kong', icon: 'map-pin', aliases: ['hong kong', 'hk'] },
  indonesia: { label: 'Indonesia', icon: 'map-pin', aliases: ['indonesia', 'id'] },
  ireland: { label: 'Ireland', icon: 'map-pin', aliases: ['ireland', 'ie'] },
  india: { label: 'India', icon: 'map-pin', aliases: ['india', 'in'] },
  iran: { label: 'Iran', icon: 'map-pin', aliases: ['iran', 'ir'] },
  italy: { label: 'Italy', icon: 'map-pin', aliases: ['italy', 'italia', 'it'] },
  japan: { label: 'Japan', icon: 'map-pin', aliases: ['japan', 'jp'] },
  'myanmar-burma': { label: 'Myanmar', icon: 'map-pin', aliases: ['myanmar', 'burma'] },
  mexico: { label: 'Mexico', icon: 'map-pin', aliases: ['mexico', 'mx'] },
  nigeria: { label: 'Nigeria', icon: 'map-pin', aliases: ['nigeria', 'ng'] },
  philippines: { label: 'Philippines', icon: 'map-pin', aliases: ['philippines', 'ph'] },
  pakistan: { label: 'Pakistan', icon: 'map-pin', aliases: ['pakistan', 'pk'] },
  poland: { label: 'Poland', icon: 'map-pin', aliases: ['poland', 'pl'] },
  russia: { label: 'Russia', icon: 'map-pin', aliases: ['russia', 'ru'] },
  ukraine: { label: 'Ukraine', icon: 'map-pin', aliases: ['ukraine', 'ua'] },
  'united-states': { label: 'United States', icon: 'map-pin', aliases: ['usa', 'us', 'united states', 'america'] },
  'south-africa': { label: 'South Africa', icon: 'map-pin', aliases: ['south africa', 'za'] },
};

function normalize(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value = '') {
  return normalize(value).replace(/\s+/g, '-');
}

function titleCaseFromSlug(slug = '') {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function tokens(value = '') {
  return normalize(value).split(/\s+/).filter(Boolean);
}

function compactDomain(value = '') {
  return String(value || '')
    .replace(/^www\./, '')
    .toLowerCase();
}

function categoryMeta(id) {
  return CATEGORY_META[id] || {
    label: titleCaseFromSlug(id),
    icon: 'rss',
    aliases: [],
  };
}

function countryMeta(id) {
  return COUNTRY_META[id] || {
    label: titleCaseFromSlug(id),
    icon: 'map-pin',
    aliases: [],
  };
}

function feedSearchText(feed) {
  const categories = (feed.categories || [])
    .flatMap((id) => [id, categoryMeta(id).label, ...(categoryMeta(id).aliases || [])]);

  const countries = (feed.countries || [])
    .flatMap((id) => [id, countryMeta(id).label, ...(countryMeta(id).aliases || [])]);

  return normalize([
    feed.title,
    feed.domain,
    feed.feedUrl,
    feed.siteUrl,
    feed.description,
    ...(feed.tags || []),
    ...categories,
    ...countries,
  ].filter(Boolean).join(' '));
}

function scoreText(hay, q) {
  if (!q) return 0;

  if (hay === q) return 1000;
  if (hay.startsWith(q)) return 700;
  if (hay.includes(q)) return 300;

  const qTokens = tokens(q);
  if (!qTokens.length) return 0;

  let matched = 0;

  for (const tok of qTokens) {
    if (hay.includes(tok)) matched++;
  }

  if (!matched) return 0;

  return matched * 60 + (matched === qTokens.length ? 90 : 0);
}

function scoreFeed(feed, query) {
  const q = normalize(query);

  if (!q) return 0;

  const title = normalize(feed.title);
  const domain = normalize(feed.domain);
  const hay = feedSearchText(feed);

  let score = 0;

  score += scoreText(title, q) * 1.35;
  score += scoreText(domain, q) * 1.15;
  score += scoreText(hay, q);

  if ((feed.categories || []).includes(q) || (feed.tags || []).includes(q)) {
    score += 450;
  }

  if ((feed.countries || []).includes(q)) {
    score += 450;
  }

  // Gentle boost for recommended/category catalog entries.
  if ((feed.tags || []).includes('recommended')) {
    score += 20;
  }

  return score;
}

function feedToCandidate(feed, {
  score = 0,
} = {}) {
  return {
    id: feed.id,
    title: feed.title,
    feedUrl: feed.feedUrl,
    siteUrl: feed.siteUrl || '',
    description: feed.description || '',
    domain: feed.domain || compactDomain(feed.siteUrl || feed.feedUrl),
    categories: feed.categories || [],
    countries: feed.countries || [],
    tags: feed.tags || [],
    source: feed.source || 'catalog',
    catalogScore: score,
  };
}

export function rssCatalogStats() {
  return {
    count: RSS_CATALOG.length,
    generatedAt: RSS_CATALOG_GENERATED_AT,
    source: RSS_CATALOG_SOURCE,
  };
}

export function searchRssCatalog(query, {
  limit = 12,
  includeZeroQuery = false,
} = {}) {
  const q = normalize(query);

  if (!q && !includeZeroQuery) return [];

  const max = Math.max(1, Math.min(100, Number(limit || 12)));

  return RSS_CATALOG
    .map((feed) => ({
      feed,
      score: q ? scoreFeed(feed, q) : 1,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      String(a.feed.title || '').localeCompare(String(b.feed.title || ''))
    )
    .slice(0, max)
    .map((x) => feedToCandidate(x.feed, {
      score: x.score,
    }));
}

export function listRssCatalogCategories() {
  const counts = new Map();

  for (const feed of RSS_CATALOG) {
    for (const id of feed.categories || []) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([id, count]) => ({
      id,
      type: 'category',
      count,
      ...categoryMeta(id),
    }))
    .sort((a, b) =>
      b.count - a.count ||
      a.label.localeCompare(b.label)
    );
}

export function listRssCatalogCountries() {
  const counts = new Map();

  for (const feed of RSS_CATALOG) {
    for (const id of feed.countries || []) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([id, count]) => ({
      id,
      type: 'country',
      count,
      ...countryMeta(id),
    }))
    .sort((a, b) =>
      a.label.localeCompare(b.label)
    );
}

export function searchRssCatalogFacets(query, {
  limit = 8,
} = {}) {
  const q = normalize(query);

  if (!q) {
    return [
      ...listRssCatalogCategories().slice(0, limit),
      ...listRssCatalogCountries().slice(0, limit),
    ].slice(0, limit);
  }

  const facetScore = (facet) => {
    const hay = normalize([
      facet.id,
      facet.label,
      ...(facet.aliases || []),
    ].join(' '));

    return scoreText(hay, q);
  };

  return [
    ...listRssCatalogCategories(),
    ...listRssCatalogCountries(),
  ]
    .map((facet) => ({
      ...facet,
      score: facetScore(facet),
    }))
    .filter((facet) => facet.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      b.count - a.count ||
      a.label.localeCompare(b.label)
    )
    .slice(0, Math.max(1, Math.min(30, Number(limit || 8))));
}

export function feedsForRssCatalogFacet(facet, {
  limit = 200,
} = {}) {
  const type = facet?.type || facet?.kind || '';
  const id = facet?.id || '';

  if (!type || !id) return [];

  const max = Math.max(1, Math.min(1000, Number(limit || 200)));

  return RSS_CATALOG
    .filter((feed) => {
      if (type === 'category') return (feed.categories || []).includes(id);
      if (type === 'country') return (feed.countries || []).includes(id);
      return false;
    })
    .sort((a, b) =>
      String(a.title || '').localeCompare(String(b.title || ''))
    )
    .slice(0, max)
    .map(feedToCandidate);
}

export function labelForRssCatalogCategory(id) {
  return categoryMeta(id).label;
}

export function labelForRssCatalogCountry(id) {
  return countryMeta(id).label;
}

export function iconForRssCatalogFacet(facet) {
  if (!facet) return 'rss';

  if (facet.type === 'country') return countryMeta(facet.id).icon || 'map-pin';
  if (facet.type === 'category') return categoryMeta(facet.id).icon || 'rss';

  return 'rss';
}

export function isProbablyUrlOrDomain(value = '') {
  const raw = String(value || '').trim();

  return (
    /^https?:\/\//i.test(raw) ||
    (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(raw) && !/\s/.test(raw)) ||
    /^@?[a-z0-9_]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw) ||
    /^@?[a-z0-9-]+\.substack$/i.test(raw)
  );
}

export function domainForRssCandidate(candidate = {}) {
  return (
    candidate.domain ||
    compactDomain(candidate.siteUrl || candidate.feedUrl || candidate.url || '')
  );
}

export function primaryFacetLabelsForCandidate(candidate = {}) {
  const labels = [];

  for (const country of candidate.countries || []) {
    labels.push(countryMeta(country).label);
  }

  for (const category of candidate.categories || []) {
    labels.push(categoryMeta(category).label);
  }

  return labels;
}

export function knownSearchExamples() {
  return [
    'tech',
    'programming',
    'science',
    'news',
    'germany',
    'deutschland',
    'tagesschau',
    'zeit',
    'guardian',
    'nytimes',
    'hacker news',
    'android',
    'apple',
    'finance',
    'startups',
    'design',
    'ux',
    'food',
    'travel',
  ];
}