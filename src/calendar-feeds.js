// ============================================================
// YANTA — subscribed calendars (fetched, never stored as events)
//
// Two kinds share one mechanism:
//   source = { type: 'feed', kind: 'ics', url }           any .ics / webcal link
//   source = { type: 'feed', kind: 'school', country, subdivision, lang }
//                                                         school holidays (OpenHolidays)
//
// The category (with its source) syncs like any calendar. What a feed
// contains does not: every device fetches it itself (through the YANTA
// API — browsers cannot read most calendar hosts) and keeps the result
// in local settings. Feeds can be large and change on their own; putting
// them into the vault would sync someone else's data back and forth.
//
// Public holidays stay offline (date-holidays, calendar-sources.js).
// ============================================================

import { store } from './core.js';
import { YANTA_CLOUD_BASE_URL } from './cloud/cloud-api.js';
import { parseIcsEvents } from './calendar-ics.js';
import { expandRecurringEvent, hasRecurrence, localDateKey } from './calendar-recurrence.js';

const CACHE_KEY = 'calendar.feeds.v1';
const ICS_MAX_AGE = 6 * 60 * 60 * 1000;
const SCHOOL_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_ERROR = 30 * 60 * 1000;
const MAX_EVENTS = 5000;

let cache = null; // catId -> { key, fetchedAt, events, error, etag, lastModified, name }
let loading = null;
const inflight = new Map();

function apiUrl(path) {
  return `${String(YANTA_CLOUD_BASE_URL || '/cloud-api').replace(/\/+$/, '')}${path}`;
}

function announce(reason) {
  window.dispatchEvent(new CustomEvent('yanta-calendar-updated', { detail: { reason } }));
}

function ensureCache() {
  if (cache) return cache;
  cache = {};
  if (!loading) {
    loading = store.settings.get(CACHE_KEY, null)
      .then((raw) => {
        if (raw && typeof raw === 'object') cache = { ...raw, ...cache };
        announce('feeds-loaded');
      })
      .catch(() => {});
  }
  return cache;
}

let saveTimer = null;
function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.settings.set(CACHE_KEY, cache || {}).catch(() => {}), 500);
}

/** What identifies a feed's content: a changed URL or region refetches. */
function feedKey(source) {
  if (source?.kind === 'ics') return `ics:${source.url || ''}`;
  if (source?.kind === 'school') return `school:${source.country || ''}:${source.subdivision || ''}:${source.lang || ''}`;
  return '';
}

export function sanitizeFeedSource(raw) {
  if (raw?.kind === 'ics') {
    const url = normalizeFeedUrl(raw.url);
    return url ? { type: 'feed', kind: 'ics', url } : undefined;
  }
  if (raw?.kind === 'school') {
    const country = String(raw.country || '').toUpperCase().slice(0, 3);
    if (!/^[A-Z]{2}$/.test(country)) return undefined;
    return {
      type: 'feed',
      kind: 'school',
      country,
      subdivision: raw.subdivision ? String(raw.subdivision).slice(0, 32) : null,
      lang: String(raw.lang || 'EN').toUpperCase().slice(0, 2),
    };
  }
  return undefined;
}

/** webcal:// → https://; anything else that is not http(s) is refused. */
export function normalizeFeedUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    if (!u.hostname.includes('.')) return '';
    return u.href;
  } catch {
    return '';
  }
}

// ---------------- fetching -------------------------------------------

async function getJson(path) {
  let res;
  try {
    res = await fetch(apiUrl(path), { credentials: 'include' });
  } catch {
    const err = new Error('offline');
    err.code = 'offline';
    throw err;
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(json?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = res.status === 401 ? 'signed-out' : json?.error || 'failed';
    throw err;
  }
  return json;
}

function calendarName(body) {
  const m = /^X-WR-CALNAME(?:;[^:]*)?:(.*)$/im.exec(body || '');
  return m ? m[1].trim().replace(/\\([,;\\])/g, '$1').slice(0, 80) : '';
}

/** Fetch and parse an .ics link. Used to preview before subscribing too. */
export async function fetchIcsFeed(url, { etag = '', lastModified = '' } = {}) {
  const q = new URLSearchParams({ url });
  if (etag) q.set('etag', etag);
  if (lastModified) q.set('lastModified', lastModified);
  const json = await getJson(`/api/calendar/feed?${q}`);
  if (json?.notModified) return { notModified: true };

  const parsed = parseIcsEvents(json.body || '');
  const events = parsed
    .filter((e) => e.status !== 'cancelled')
    .slice(0, MAX_EVENTS)
    .map((e, i) => ({
      uid: `${e.externalUid || 'e'}#${i}`,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: !!e.allDay,
      location: e.location || '',
      description: e.description || '',
      recurrence: e.recurrence || null,
      recurrenceExceptions: e.recurrenceExceptions || [],
      recurrenceOverrides: e.recurrenceOverrides || {},
    }));

  return {
    events,
    name: calendarName(json.body),
    etag: json.etag || '',
    lastModified: json.lastModified || '',
  };
}

function pickName(names, lang) {
  if (!Array.isArray(names) || !names.length) return '';
  return (names.find((n) => String(n.language).toUpperCase() === lang) || names[0])?.text || '';
}

async function fetchSchoolFeed(source) {
  const year = new Date().getFullYear();
  const q = new URLSearchParams({
    countryIsoCode: source.country,
    languageIsoCode: source.lang,
    validFrom: `${year - 1}-01-01`,
    validTo: `${year + 1}-12-31`,
  });
  if (source.subdivision) q.set('subdivisionCode', source.subdivision);
  const list = await getJson(`/api/calendar/openholidays/SchoolHolidays?${q}`);

  const events = (Array.isArray(list) ? list : [])
    // A subdivision's own holidays and the nationwide ones.
    .filter((h) => !source.subdivision || h.nationwide || (h.subdivisions || []).some((s) => s.code === source.subdivision || String(source.subdivision).startsWith(`${s.code}-`)))
    .map((h) => ({
      uid: h.id,
      title: pickName(h.name, source.lang) || 'School holidays',
      start: h.startDate,
      end: h.endDate && h.endDate !== h.startDate ? h.endDate : null,
      allDay: true,
      location: '',
      description: '',
    }));

  return { events };
}

/** Countries and regions for the school-holiday picker. */
export async function schoolHolidayRegions(country, lang) {
  const list = await getJson(`/api/calendar/openholidays/Subdivisions?${new URLSearchParams({ countryIsoCode: country, languageIsoCode: lang })}`);
  return (Array.isArray(list) ? list : []).map((s) => ({
    code: s.code,
    isoCode: s.isoCode || '',
    shortName: s.shortName || '',
    name: pickName(s.name, lang) || s.code,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function schoolHolidayCountries(lang) {
  const list = await getJson(`/api/calendar/openholidays/Countries?${new URLSearchParams({ languageIsoCode: lang })}`);
  return (Array.isArray(list) ? list : []).map((c) => c.isoCode);
}

// ---------------- state ----------------------------------------------

export function feedStatus(categoryId) {
  const entry = ensureCache()[categoryId];
  if (!entry) return { state: 'loading' };
  if (entry.error && !entry.events?.length) return { state: 'error', error: entry.error, at: entry.errorAt };
  return { state: entry.error ? 'stale' : 'ok', error: entry.error || null, fetchedAt: entry.fetchedAt, count: entry.events?.length || 0 };
}

export async function refreshFeed(cat, { force = false } = {}) {
  const source = cat?.source;
  const key = feedKey(source);
  if (!key) return null;
  if (inflight.has(cat.id)) return inflight.get(cat.id);

  const c = ensureCache();
  const prev = c[cat.id]?.key === key ? c[cat.id] : null;

  const job = (async () => {
    try {
      const result = source.kind === 'ics'
        ? await fetchIcsFeed(source.url, force ? {} : { etag: prev?.etag, lastModified: prev?.lastModified })
        : await fetchSchoolFeed(source);

      if (result.notModified && prev) {
        c[cat.id] = { ...prev, fetchedAt: Date.now(), error: null };
      } else {
        c[cat.id] = {
          key,
          fetchedAt: Date.now(),
          events: result.events,
          name: result.name || '',
          etag: result.etag || '',
          lastModified: result.lastModified || '',
          error: null,
        };
      }
    } catch (err) {
      c[cat.id] = {
        ...(prev || { key, events: [] }),
        error: err?.code === 'offline' || err?.code === 'signed-out' ? err.code : (err?.message || 'failed'),
        errorAt: Date.now(),
      };
    } finally {
      inflight.delete(cat.id);
    }
    persistSoon();
    announce('feed-refreshed');
    return c[cat.id];
  })();

  inflight.set(cat.id, job);
  return job;
}

let refreshTimer = null;

/** Refresh what is stale, a moment after render — never during it. */
function scheduleStaleRefresh(categories) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (document.visibilityState === 'hidden') return;
    const c = ensureCache();
    for (const cat of categories) {
      const entry = c[cat.id];
      const key = feedKey(cat.source);
      const maxAge = cat.source.kind === 'school' ? SCHOOL_MAX_AGE : ICS_MAX_AGE;
      const stale = !entry || entry.key !== key ||
        (entry.error ? Date.now() - (entry.errorAt || 0) > RETRY_AFTER_ERROR : Date.now() - (entry.fetchedAt || 0) > maxAge);
      if (stale) refreshFeed(cat);
    }
  }, 400);
}

/** A feed fetched for its preview becomes the cache — no second fetch. */
export function seedFeed(cat, feed) {
  const key = feedKey(cat?.source);
  if (!key || !feed?.events) return;
  ensureCache()[cat.id] = {
    key,
    fetchedAt: Date.now(),
    events: feed.events,
    name: feed.name || '',
    etag: feed.etag || '',
    lastModified: feed.lastModified || '',
    error: null,
  };
  persistSoon();
  announce('feed-refreshed');
}

export function forgetFeed(categoryId) {
  const c = ensureCache();
  if (!c[categoryId]) return;
  delete c[categoryId];
  persistSoon();
}

// ---------------- events for a range ---------------------------------

function addDaysKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return localDateKey(date);
}

function startMs(ev) {
  const s = String(ev.start || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`).getTime() : new Date(s).getTime();
}

/*
  Source events are handed out in the FullCalendar shape the other
  generated sources use: all-day end exclusive.
*/
function toSourceEvent(cat, ev, idSuffix) {
  const allDay = !!ev.allDay;
  const start = allDay ? localDateKey(ev.start) : ev.start;
  const end = allDay
    ? addDaysKey(localDateKey(ev.end || ev.start), 1)
    : ev.end || null;

  return {
    id: `src:${cat.id}:feed:${idSuffix}`,
    title: ev.title || '',
    start,
    end,
    allDay,
    categoryId: cat.id,
    color: cat.color || undefined,
    location: ev.location || '',
    description: ev.description || '',
    status: 'confirmed',
    readonly: true,
    generated: true,
    source: { type: 'feed', kind: cat.source.kind },
  };
}

export function feedEventsForRange(categories, rangeStart, rangeEnd) {
  const feeds = categories.filter((cat) => cat?.source?.type === 'feed' && cat.visible !== false);
  if (!feeds.length) return [];

  const c = ensureCache();
  scheduleStaleRefresh(feeds);

  const from = rangeStart.getTime();
  const to = rangeEnd.getTime();
  const out = [];

  for (const cat of feeds) {
    const entry = c[cat.id];
    if (!entry?.events?.length || entry.key !== feedKey(cat.source)) continue;

    for (const ev of entry.events) {
      if (ev.recurrence && hasRecurrence(ev)) {
        const master = { ...ev, id: ev.uid };
        for (const occ of expandRecurringEvent(master, rangeStart, rangeEnd, { maxOccurrences: 400 })) {
          out.push(toSourceEvent(cat, occ, `${ev.uid}@${localDateKey(occ.start)}${occ.allDay ? '' : `T${new Date(occ.start).getTime()}`}`));
        }
        continue;
      }

      const s = startMs(ev);
      if (!Number.isFinite(s)) continue;
      const e = ev.end
        ? (ev.allDay ? startMs({ start: addDaysKey(localDateKey(ev.end), 1) }) : new Date(ev.end).getTime())
        : s + (ev.allDay ? 86400000 : 3600000);
      if (e <= from || s >= to) continue;
      out.push(toSourceEvent(cat, ev, ev.uid));
    }
  }

  return out;
}
