// ============================================================
// YANTA — Citation resolvers
// Client-only, no server crawler, no cheerio.
// Reliable paths:
// - DOI: Crossref -> DataCite fallback
// - PMID / PMCID: EuropePMC -> DOI upgrade via Crossref if possible
// - ISBN: OpenLibrary
// - YouTube URL: oEmbed best-effort
// - Generic URL: manual webpage fallback, because browser CORS prevents
//   reliable client-side metadata extraction from arbitrary websites.
// ============================================================

import { escapeHtml } from './core.js';

const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest';

export function stripTags(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '');
  return tmp.textContent || tmp.innerText || '';
}

export function cleanDOI(input) {
  const s = String(input || '').trim();
  if (!s) return '';

  const x = s
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim();

  const m = x.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
  return m ? m[0].replace(/[.,;:)]+$/g, '') : '';
}

export function extractPMID(input) {
  const s = String(input || '');
  const m =
    s.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i) ||
    s.match(/\bPMID[:\s]*([0-9]{4,})\b/i) ||
    s.match(/^\s*(\d{6,9})\s*$/);

  return m ? m[1] : '';
}

export function extractPMCID(input) {
  const s = String(input || '');
  const m = s.match(/\bPMC\d+\b/i);
  return m ? m[0].toUpperCase() : '';
}

export function extractISBN(input) {
  const s = String(input || '').replace(/ISBN(?:-1[03])?:?/i, ' ');
  const m = s.match(/\b(?:97[89][-\s]?)?(?:\d[-\s]?){9,12}[\dX]\b/i);
  if (!m) return '';
  const clean = m[0].replace(/[-\s]/g, '').toUpperCase();
  return clean.length === 10 || clean.length === 13 ? clean : '';
}

export function isUrlLike(s) {
  return /^https?:\/\//i.test(String(s || '').trim());
}

export function normUrl(u) {
  try {
    return new URL(u).toString();
  } catch {
    return String(u || '').trim();
  }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function cleanText(x) {
  return stripTags(Array.isArray(x) ? x[0] : (x || '')).trim();
}

function issuedYearFromParts(parts) {
  const p = parts?.[0];
  return p?.[0] ? String(p[0]) : '';
}

function dateFromParts(parts) {
  const p = parts?.[0];
  if (!p?.[0]) return '';
  const y = String(p[0]).padStart(4, '0');
  const m = p[1] ? String(p[1]).padStart(2, '0') : '';
  const d = p[2] ? String(p[2]).padStart(2, '0') : '';
  if (y && m && d) return `${y}-${m}-${d}`;
  if (y && m) return `${y}-${m}-01`;
  return y;
}

function typeFromCrossref(t) {
  const m = {
    'journal-article': 'journal-article',
    'book': 'book',
    'monograph': 'book',
    'book-chapter': 'book-chapter',
    'proceedings-article': 'journal-article',
    'posted-content': 'other',
    'report': 'other',
    'dissertation': 'other',
    'dataset': 'other',
  };

  return m[t] || 'other';
}

function cslTypeFromYantaType(t) {
  const m = {
    'journal-article': 'article-journal',
    'book': 'book',
    'edited-book': 'book',
    'book-chapter': 'chapter',
    'website': 'webpage',
    'video': 'video',
    'post-weblog': 'post-weblog',
    'social-post': 'post',
    'other': 'document',
  };

  return m[t] || 'document';
}

function yantaTypeFromCSL(t) {
  const m = {
    'article-journal': 'journal-article',
    'book': 'book',
    'chapter': 'book-chapter',
    'webpage': 'website',
    'video': 'video',
    'post-weblog': 'post-weblog',
    'post': 'social-post',
    'document': 'other',
  };

  return m[t] || 'other';
}

export function parseLooseDate(s) {
  s = String(s || '').trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };

  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return { y: +m[1], mo: +m[2], d: 1 };

  m = s.match(/^(\d{4})$/);
  if (m) return { y: +m[1], mo: 1, d: 1, yearOnly: true };

  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    return { y, mo: +m[2], d: +m[1] };
  }

  return null;
}

export function formatDate(p, fmt = 'YYYY-MM-DD') {
  if (!p) return '';
  if (p.yearOnly) return String(p.y);

  const pad = (n) => String(n || 1).padStart(2, '0');

  if (fmt === 'DD.MM.YYYY') return `${pad(p.d)}.${pad(p.mo)}.${p.y}`;
  if (fmt === 'DD/MM/YYYY') return `${pad(p.d)}/${pad(p.mo)}/${p.y}`;
  if (fmt === 'MM/DD/YYYY') return `${pad(p.mo)}/${pad(p.d)}/${p.y}`;

  if (fmt === 'APA_LONG') {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return `${p.y}, ${months[Math.max(0, (p.mo || 1) - 1)]} ${p.d || 1}`;
  }

  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

export function modelToCSL(model, builderConfig = null) {
  const dateParts = (s) => {
    const p = parseLooseDate(s);
    if (!p) return undefined;
    if (p.yearOnly) return [[p.y]];
    return [[p.y, p.mo || 1, p.d || 1]];
  };

  const authors = (model.authors || [])
    .filter((a) => a && (a.family || a.literal))
    .map((a) => {
      if (a.literal && !a.family) return { literal: a.literal };
      const o = { family: a.family || a.literal || '' };
      if (a.given) o.given = a.given;
      return o;
    });

  const issued =
    dateParts(model.publishedDate) ||
    dateParts(model.year);

  const csl = {
    id: model.doi ? `doi:${model.doi}` : (model.url || model.key || model.title || `yanta-${Date.now()}`),
    type: cslTypeFromYantaType(model.type),
    title: model.title || undefined,
    subtitle: model.subtitle || undefined,
    author: authors.length ? authors : undefined,
    issued: issued ? { 'date-parts': issued } : undefined,
    accessed: dateParts(model.accessDate) ? { 'date-parts': dateParts(model.accessDate) } : undefined,

    'container-title': model.journal || model.siteName || undefined,
    volume: model.volume || undefined,
    issue: model.issue || undefined,
    page: model.pages || undefined,
    publisher: model.publisher || undefined,
    'publisher-place': model.place || undefined,

    URL: model.url || undefined,
    DOI: model.doi || undefined,
    ISBN: model.isbn || undefined,

    note: builderConfig
      ? `YANTA citation builder config:\n${JSON.stringify(builderConfig)}`
      : undefined,
  };

  for (const k of Object.keys(csl)) {
    if (csl[k] == null || csl[k] === '') delete csl[k];
  }

  return csl;
}

export function cslToModel(csl = {}) {
  const dateFromCsl = (date) => {
    const p = date?.['date-parts']?.[0];
    if (!p?.[0]) return '';
    if (!p[1]) return String(p[0]);
    if (!p[2]) return `${p[0]}-${String(p[1]).padStart(2, '0')}-01`;
    return `${p[0]}-${String(p[1]).padStart(2, '0')}-${String(p[2]).padStart(2, '0')}`;
  };

  return {
    type: yantaTypeFromCSL(csl.type),
    authors: (csl.author || []).map((a) => ({
      family: a.family || a.literal || '',
      given: a.given || '',
      literal: a.literal || '',
    })),
    year: dateFromCsl(csl.issued).slice(0, 4),
    publishedDate: dateFromCsl(csl.issued),
    title: csl.title || '',
    subtitle: csl.subtitle || '',
    journal: csl['container-title'] || '',
    siteName: csl['container-title'] || '',
    volume: csl.volume || '',
    issue: csl.issue || '',
    pages: csl.page || '',
    publisher: csl.publisher || '',
    place: csl['publisher-place'] || '',
    url: csl.URL || '',
    doi: csl.DOI || '',
    isbn: csl.ISBN || '',
    accessDate: dateFromCsl(csl.accessed) || todayISO(),
  };
}

async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: {
      Accept: 'application/json',
      ...(opts.headers || {}),
    },
  });

  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  return r.json();
}

export async function fetchCrossrefByDOI(doi) {
  const d = cleanDOI(doi);
  if (!d) throw new Error('Missing DOI');

  const url = `https://api.crossref.org/works/${encodeURIComponent(d)}`;
  const data = await fetchJSON(url);
  return data?.message || null;
}

export async function fetchDataCiteByDOI(doi) {
  const d = cleanDOI(doi);
  if (!d) throw new Error('Missing DOI');

  const url = `https://api.datacite.org/dois/${encodeURIComponent(d)}`;
  const data = await fetchJSON(url);
  return data?.data || null;
}

export async function fetchEuropePMCByPMID(pmid) {
  const q = `EXT_ID:${encodeURIComponent(String(pmid))}%20AND%20SRC:MED`;
  const url = `${EPMC}/search?query=${q}&format=json&pageSize=1&resultType=core`;
  const data = await fetchJSON(url);
  return data?.resultList?.result?.[0] || null;
}

export async function fetchEuropePMCByPMCID(pmcid) {
  const q = `PMCID:${encodeURIComponent(String(pmcid))}`;
  const url = `${EPMC}/search?query=${q}&format=json&pageSize=1&resultType=core`;
  const data = await fetchJSON(url);
  return data?.resultList?.result?.[0] || null;
}

export function mapCrossrefToModel(msg) {
  const issued = msg.issued?.['date-parts'];
  const published = msg.published?.['date-parts'] || msg['published-print']?.['date-parts'] || msg['published-online']?.['date-parts'];

  return {
    type: typeFromCrossref(msg.type || 'journal-article'),
    authors: (msg.author || []).map((a) => ({
      family: a.family || '',
      given: a.given || '',
    })),
    year: issuedYearFromParts(issued || published),
    publishedDate: dateFromParts(issued || published),
    title: cleanText(msg.title),
    subtitle: cleanText(msg.subtitle),
    journal: cleanText(msg['container-title']),
    siteName: '',
    volume: String(msg.volume || ''),
    issue: String(msg.issue || ''),
    pages: msg.page || '',
    publisher: cleanText(msg.publisher),
    place: msg['publisher-location'] || '',
    url: msg.URL || (msg.DOI ? `https://doi.org/${msg.DOI}` : ''),
    doi: msg.DOI || '',
    isbn: Array.isArray(msg.ISBN) ? msg.ISBN[0] : (msg.ISBN || ''),
    accessDate: todayISO(),
    resolver: 'crossref',
  };
}

export function mapDataCiteToModel(entry) {
  const a = entry?.attributes || {};
  const creators = a.creators || [];

  const authors = creators.map((c) => {
    if (c.familyName || c.givenName) {
      return { family: c.familyName || c.name || '', given: c.givenName || '' };
    }
    return { family: c.name || '', given: '' };
  });

  const title =
    (a.titles || []).find((t) => t.title)?.title ||
    '';

  const pubDate = a.publicationYear ? String(a.publicationYear) : '';

  return {
    type: 'other',
    authors,
    year: pubDate,
    publishedDate: pubDate,
    title,
    subtitle: '',
    journal: '',
    siteName: '',
    volume: '',
    issue: '',
    pages: '',
    publisher: a.publisher || '',
    place: '',
    url: a.url || (a.doi ? `https://doi.org/${a.doi}` : ''),
    doi: a.doi || '',
    isbn: '',
    accessDate: todayISO(),
    resolver: 'datacite',
  };
}

export function mapEpmcToModel(rr) {
  if (!rr) return null;

  const authors = (rr.authorList?.author || []).map((a) => ({
    family: a.lastName || '',
    given: a.firstName || '',
  }));

  return {
    type: 'journal-article',
    authors,
    year: rr.pubYear ? String(rr.pubYear) : '',
    publishedDate: rr.firstPublicationDate || rr.electronicPublicationDate || rr.pubYear || '',
    title: stripTags(rr.title || ''),
    subtitle: '',
    journal: rr.journalTitle || rr.journalInfo?.journal?.title || '',
    siteName: '',
    volume: rr.journalVolume || '',
    issue: rr.issue || '',
    pages: rr.pageInfo || '',
    publisher: '',
    place: '',
    url: rr.fullTextUrlList?.fullTextUrl?.[0]?.url || rr.authorManuscriptUrl || rr.url || '',
    doi: rr.doi || '',
    isbn: '',
    accessDate: todayISO(),
    resolver: 'europepmc',
  };
}

export async function resolveDOI(doi) {
  const d = cleanDOI(doi);
  if (!d) throw new Error('No DOI found');

  try {
    const msg = await fetchCrossrefByDOI(d);
    if (msg) return mapCrossrefToModel(msg);
  } catch {}

  try {
    const dc = await fetchDataCiteByDOI(d);
    if (dc) return mapDataCiteToModel(dc);
  } catch {}

  return {
    type: 'other',
    authors: [],
    year: '',
    publishedDate: '',
    title: `DOI ${d}`,
    subtitle: '',
    journal: '',
    siteName: '',
    volume: '',
    issue: '',
    pages: '',
    publisher: '',
    place: '',
    url: `https://doi.org/${d}`,
    doi: d,
    isbn: '',
    accessDate: todayISO(),
    resolver: 'doi-fallback',
  };
}

export async function resolvePMID(pmid) {
  const rr = await fetchEuropePMCByPMID(pmid);
  let model = mapEpmcToModel(rr);

  if (model?.doi) {
    try {
      const upgraded = await resolveDOI(model.doi);
      upgraded.url = upgraded.url || model.url;
      return upgraded;
    } catch {}
  }

  if (!model) throw new Error('No PMID metadata found');
  return model;
}

export async function resolvePMCID(pmcid) {
  const rr = await fetchEuropePMCByPMCID(pmcid);
  let model = mapEpmcToModel(rr);

  if (model?.doi) {
    try {
      const upgraded = await resolveDOI(model.doi);
      upgraded.url = upgraded.url || model.url;
      return upgraded;
    } catch {}
  }

  if (!model) throw new Error('No PMCID metadata found');
  return model;
}

async function resolveISBN(isbn) {
  const clean = extractISBN(isbn);
  if (!clean) throw new Error('No ISBN found');

  const book = await fetchJSON(`https://openlibrary.org/isbn/${encodeURIComponent(clean)}.json`);

  let authors = [];

  if (Array.isArray(book.authors)) {
    const fetched = await Promise.all(
      book.authors.slice(0, 8).map(async (a) => {
        try {
          const au = await fetchJSON(`https://openlibrary.org${a.key}.json`);
          return au?.name || '';
        } catch {
          return '';
        }
      })
    );

    authors = fetched.filter(Boolean).map((name) => parseAuthorName(name));
  }

  const year =
    String(book.publish_date || '').match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/)?.[0] ||
    '';

  return {
    type: 'book',
    authors,
    year,
    publishedDate: year,
    title: book.title || `ISBN ${clean}`,
    subtitle: book.subtitle || '',
    journal: '',
    siteName: '',
    volume: '',
    issue: '',
    pages: book.number_of_pages ? String(book.number_of_pages) : '',
    publisher: Array.isArray(book.publishers) ? book.publishers[0] : '',
    place: Array.isArray(book.publish_places) ? book.publish_places[0] : '',
    url: `https://openlibrary.org/isbn/${clean}`,
    doi: '',
    isbn: clean,
    accessDate: todayISO(),
    resolver: 'openlibrary',
  };
}

function parseAuthorName(name) {
  const s = String(name || '').trim();
  if (!s) return { family: '', given: '' };

  if (s.includes(',')) {
    const [family, ...rest] = s.split(',');
    return { family: family.trim(), given: rest.join(',').trim() };
  }

  const parts = s.split(/\s+/);
  if (parts.length === 1) return { family: s, given: '' };

  return {
    family: parts.pop(),
    given: parts.join(' '),
  };
}

function isYouTubeUrl(u) {
  try {
    const x = new URL(u);
    const h = x.hostname.replace(/^www\./, '').toLowerCase();
    return h === 'youtube.com' || h === 'youtu.be' || h === 'm.youtube.com';
  } catch {
    return false;
  }
}

async function resolveYouTube(url) {
  const u = normUrl(url);
  const ep = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`;
  const o = await fetchJSON(ep);

  return {
    type: 'video',
    authors: o?.author_name ? [{ family: String(o.author_name), given: '' }] : [],
    year: '',
    publishedDate: '',
    title: o?.title || u,
    subtitle: '',
    journal: '',
    siteName: 'YouTube',
    volume: '',
    issue: '',
    pages: '',
    publisher: 'YouTube',
    place: '',
    url: u,
    doi: '',
    isbn: '',
    accessDate: todayISO(),
    resolver: 'youtube-oembed',
  };
}

export async function resolveURL(url) {
  const u = normUrl(url);

  const doi = cleanDOI(u);
  if (doi) return resolveDOI(doi);

  if (isYouTubeUrl(u)) {
    try {
      return await resolveYouTube(u);
    } catch {}
  }

  let title = u;

  try {
    const parsed = new URL(u);
    title = parsed.hostname.replace(/^www\./, '') + parsed.pathname;
  } catch {}

  return {
    type: 'website',
    authors: [],
    year: '',
    publishedDate: '',
    title,
    subtitle: '',
    journal: '',
    siteName: (() => {
      try {
        return new URL(u).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })(),
    volume: '',
    issue: '',
    pages: '',
    publisher: '',
    place: '',
    url: u,
    doi: '',
    isbn: '',
    accessDate: todayISO(),
    resolver: 'url-manual',
    warning: 'Generic website metadata cannot be fetched reliably in-browser without a server-side metadata proxy. Please verify author/title/date manually.',
  };
}

export async function resolveCitation(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Enter DOI, PMID, PMCID, ISBN or URL');

  const pmcid = extractPMCID(raw);
  if (pmcid) return resolvePMCID(pmcid);

  const pmid = extractPMID(raw);
  if (pmid && /^PMID/i.test(raw)) return resolvePMID(pmid);

  const doi = cleanDOI(raw);
  if (doi) return resolveDOI(doi);

  const isbn = extractISBN(raw);
  if (isbn) {
    try {
      return await resolveISBN(isbn);
    } catch {}
  }

  if (isUrlLike(raw)) return resolveURL(raw);

  return {
    type: 'other',
    authors: [],
    year: '',
    publishedDate: '',
    title: raw,
    subtitle: '',
    journal: '',
    siteName: '',
    volume: '',
    issue: '',
    pages: '',
    publisher: '',
    place: '',
    url: '',
    doi: '',
    isbn: '',
    accessDate: todayISO(),
    resolver: 'manual',
  };
}

export function parseAuthorsInput(s) {
  return String(s || '')
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.includes(',')) {
        const [family, ...rest] = part.split(',');
        return {
          family: family.trim(),
          given: rest.join(',').trim(),
        };
      }

      return parseAuthorName(part);
    })
    .filter((a) => a.family || a.given);
}

export function authorsToInput(authors = []) {
  return authors
    .map((a) => {
      const fam = a.family || a.literal || '';
      const giv = a.given || '';
      return giv ? `${fam}, ${giv}` : fam;
    })
    .filter(Boolean)
    .join('; ');
}

function initials(given) {
  return String(given || '')
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((x) => x[0]?.toUpperCase() + '.')
    .join(' ');
}

function formatName(author, mode = 'initials') {
  const family = author.family || author.literal || '';
  const given = author.given || '';

  if (mode === 'first_last') return [given, family].filter(Boolean).join(' ');
  if (mode === 'last_first') return given ? `${family}, ${given}` : family;

  const ini = initials(given);
  return ini ? `${family}, ${ini}` : family;
}

function joinNames(list, sep = ', ', lastSep = ', & ') {
  const arr = list.filter(Boolean);
  if (!arr.length) return '';
  if (arr.length === 1) return arr[0];

  const last = arr[arr.length - 1];
  return arr.slice(0, -1).join(sep) + lastSep + last;
}

function cleanPages(p) {
  return String(p || '').replace(/(\d)\s*-\s*(\d)/g, '$1–$2');
}

function ensurePeriod(s) {
  s = String(s || '').trim();
  if (!s) return '';
  return /[.!?]$/.test(s) ? s : s + '.';
}

function italic(s) {
  return s ? `<i>${escapeHtml(s)}</i>` : '';
}

function esc(s) {
  return escapeHtml(String(s || ''));
}

export function formatCitation(model, style = 'apa') {
  if (!model) return '';

  const authors = model.authors || [];
  const year = model.year || (model.publishedDate || '').slice(0, 4) || 'n.d.';
  const title = model.title || '';
  const journal = model.journal || model.siteName || '';
  const vol = model.volume || '';
  const issue = model.issue || '';
  const pages = cleanPages(model.pages || '');
  const doiUrl = model.doi ? `https://doi.org/${model.doi}` : '';
  const url = doiUrl || model.url || '';

  if (style === 'harvard') {
    const a = joinNames(authors.map((x) => formatName(x, 'last_first')), ', ', ' and ') || model.publisher || model.siteName || 'Anon.';
    let out = `${esc(a)} (${esc(year)}) ${esc(ensurePeriod(title))} `;

    if (model.type === 'journal-article') {
      if (journal) out += `${italic(journal)}, `;
      if (vol) out += `<b>${esc(vol)}</b>`;
      if (issue) out += `(${esc(issue)})`;
      if (pages) out += `, pp. ${esc(pages)}. `;
      else out += '. ';
    } else if (model.type === 'book') {
      if (model.publisher) out += `${esc(model.publisher)}. `;
    } else {
      if (journal) out += `${esc(journal)}. `;
    }

    if (url) out += `Available at: ${esc(url)}.`;
    return out.trim();
  }

  if (style === 'de') {
    const a = joinNames(authors.map((x) => formatName(x, 'last_first')), '; ', '; ') || model.publisher || model.siteName || 'o. A.';
    let out = `<b>${esc(a)}</b>: ${esc(ensurePeriod(title))} `;

    if (model.type === 'journal-article') {
      if (journal) out += `In: ${italic(journal)} `;
      if (year) out += `(${esc(year)}), `;
      if (vol) out += `${esc(vol)}`;
      if (issue) out += `(${esc(issue)}), `;
      if (pages) out += `${esc(pages)}. `;
    } else if (model.type === 'book') {
      if (model.place) out += `${esc(model.place)}: `;
      if (model.publisher) out += `${esc(model.publisher)}, `;
      out += `${esc(year)}. `;
    } else {
      if (journal) out += `${esc(journal)}. `;
      if (year && model.type !== 'website') out += `${esc(year)}. `;
    }

    if (url) out += `URL: ${esc(url)}.`;
    if (model.accessDate && model.type !== 'journal-article') out += ` Zugriff: ${esc(model.accessDate)}.`;
    return out.trim();
  }

  // APA-like default.
  const a = joinNames(authors.map((x) => formatName(x, 'initials')), ', ', ', & ') || model.publisher || model.siteName || 'Anonymous';

  if (model.type === 'video') {
    const date = model.publishedDate || year;
    return [
      `${esc(a)} (${esc(date || 'n.d.')}).`,
      `${italic(title)}`,
      `[Video].`,
      model.siteName ? `${esc(model.siteName)}.` : '',
      url ? esc(url) : '',
    ].filter(Boolean).join(' ').trim();
  }

  if (model.type === 'website' || model.type === 'post-weblog' || model.type === 'social-post') {
    return [
      `${esc(a)} (${esc(year)}).`,
      italic(title),
      journal ? `${esc(journal)}.` : '',
      url ? esc(url) : '',
    ].filter(Boolean).join(' ').trim();
  }

  if (model.type === 'book') {
    return [
      `${esc(a)} (${esc(year)}).`,
      italic(title) + '.',
      model.publisher ? `${esc(model.publisher)}.` : '',
      url ? esc(url) : '',
    ].filter(Boolean).join(' ').trim();
  }

  let out = `${esc(a)} (${esc(year)}). ${esc(ensurePeriod(title))} `;

  if (journal) out += `${italic(journal)}`;
  if (journal && (vol || issue || pages)) out += ', ';
  if (vol) out += italic(vol);
  if (issue) out += `(${esc(issue)})`;
  if (pages) out += `, ${esc(pages)}`;
  if (journal || vol || issue || pages) out += '. ';
  if (url) out += esc(url);

  return out.trim();
}