// ============================================================
// YANTA — Calendar dynamic source providers
//
// Currently implemented:
// - German public holidays via date-holidays
// - Custom date ranges via user-pasted JSON
//
// Design goal:
// Categories can have a source:
//   category.source = { type: 'holidays', country:'DE', state:'NI' }
//   category.source = { type: 'custom-dates', entries:[...] }
//
// The category is the synced/stored object.
// Events are generated dynamically for the visible FullCalendar range.
// ============================================================

import Holidays from 'date-holidays';

const holidayProviderCache = new Map();

function now() {
  return Date.now();
}

function cleanUndefined(obj) {
  const out = {};

  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) out[k] = v;
  }

  return out;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'item';
}

function localDateKey(value) {
  if (!value) return '';

  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }

  const d = value instanceof Date
    ? value
    : new Date(value);

  if (Number.isNaN(d.getTime())) return '';

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysKey(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;

  d.setDate(d.getDate() + days);

  return localDateKey(d);
}

function dateKeyToMs(dateKey) {
  const t = new Date(`${dateKey}T00:00:00`).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function eventIntersectsRange(startKey, endKeyExclusive, rangeStartMs, rangeEndMs) {
  const startMs = dateKeyToMs(startKey);

  if (!Number.isFinite(startMs)) return false;

  const endMs = endKeyExclusive
    ? dateKeyToMs(endKeyExclusive)
    : startMs + 86400000;

  if (!Number.isFinite(endMs)) return false;

  return endMs > rangeStartMs && startMs < rangeEndMs;
}

function categoriesArray(categories) {
  if (!categories) return [];
  if (Array.isArray(categories)) return categories;
  if (typeof categories.values === 'function') return [...categories.values()];
  return [];
}

// ------------------------------------------------------------
// Built-in German holiday sources
// ------------------------------------------------------------

export const DE_HOLIDAY_SOURCES = [
  {
    id: 'de',
    label: 'Deutschland — bundesweite Feiertage',
    name: 'Feiertage Deutschland',
    country: 'DE',
    state: null,
    region: null,
  },

  {
    id: 'de-bw',
    label: 'Baden-Württemberg',
    name: 'Feiertage Baden-Württemberg',
    country: 'DE',
    state: 'BW',
    region: null,
  },
  {
    id: 'de-by',
    label: 'Bayern',
    name: 'Feiertage Bayern',
    country: 'DE',
    state: 'BY',
    region: null,
  },
  {
    id: 'de-be',
    label: 'Berlin',
    name: 'Feiertage Berlin',
    country: 'DE',
    state: 'BE',
    region: null,
  },
  {
    id: 'de-bb',
    label: 'Brandenburg',
    name: 'Feiertage Brandenburg',
    country: 'DE',
    state: 'BB',
    region: null,
  },
  {
    id: 'de-hb',
    label: 'Bremen',
    name: 'Feiertage Bremen',
    country: 'DE',
    state: 'HB',
    region: null,
  },
  {
    id: 'de-hh',
    label: 'Hamburg',
    name: 'Feiertage Hamburg',
    country: 'DE',
    state: 'HH',
    region: null,
  },
  {
    id: 'de-he',
    label: 'Hessen',
    name: 'Feiertage Hessen',
    country: 'DE',
    state: 'HE',
    region: null,
  },
  {
    id: 'de-mv',
    label: 'Mecklenburg-Vorpommern',
    name: 'Feiertage Mecklenburg-Vorpommern',
    country: 'DE',
    state: 'MV',
    region: null,
  },
  {
    id: 'de-ni',
    label: 'Niedersachsen',
    name: 'Feiertage Niedersachsen',
    country: 'DE',
    state: 'NI',
    region: null,
  },
  {
    id: 'de-nw',
    label: 'Nordrhein-Westfalen',
    name: 'Feiertage Nordrhein-Westfalen',
    country: 'DE',
    state: 'NW',
    region: null,
  },
  {
    id: 'de-rp',
    label: 'Rheinland-Pfalz',
    name: 'Feiertage Rheinland-Pfalz',
    country: 'DE',
    state: 'RP',
    region: null,
  },
  {
    id: 'de-sl',
    label: 'Saarland',
    name: 'Feiertage Saarland',
    country: 'DE',
    state: 'SL',
    region: null,
  },
  {
    id: 'de-sn',
    label: 'Sachsen',
    name: 'Feiertage Sachsen',
    country: 'DE',
    state: 'SN',
    region: null,
  },
  {
    id: 'de-st',
    label: 'Sachsen-Anhalt',
    name: 'Feiertage Sachsen-Anhalt',
    country: 'DE',
    state: 'ST',
    region: null,
  },
  {
    id: 'de-sh',
    label: 'Schleswig-Holstein',
    name: 'Feiertage Schleswig-Holstein',
    country: 'DE',
    state: 'SH',
    region: null,
  },
  {
    id: 'de-th',
    label: 'Thüringen',
    name: 'Feiertage Thüringen',
    country: 'DE',
    state: 'TH',
    region: null,
  },
];

export function makeHolidayCategoryPatch(source, {
  color = '#fbbf24',
} = {}) {
  const src = {
    type: 'holidays',
    country: source.country || 'DE',
    state: source.state || null,
    region: source.region || null,
    language: 'de',
    types: ['public'],
    builtinId: source.id || null,
  };

  return {
    id: `cal_src_holidays_${slug(source.id || [src.country, src.state, src.region].filter(Boolean).join('_'))}`,
    name: source.name || source.label || 'Feiertage',
    color,
    visible: true,
    readonly: true,
    source: src,
    created: now(),
    updated: now(),
  };
}

// ------------------------------------------------------------
// Source sanitizing
// ------------------------------------------------------------

function sanitizeHolidaySource(raw) {
  return cleanUndefined({
    type: 'holidays',
    country: String(raw.country || 'DE').toUpperCase(),
    state: raw.state ? String(raw.state).toUpperCase() : null,
    region: raw.region ? String(raw.region) : null,
    language: raw.language || 'de',
    types: Array.isArray(raw.types) && raw.types.length
      ? raw.types.map(String)
      : ['public'],
    builtinId: raw.builtinId || null,
  });
}

function sanitizeCustomDateEntry(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;

  const title = String(raw.title || raw.name || `Entry ${index + 1}`).trim();
  const start = localDateKey(raw.start || raw.date || raw.from);

  if (!start) return null;

  const end = raw.end || raw.to
    ? localDateKey(raw.end || raw.to)
    : null;

  return cleanUndefined({
    id: String(raw.id || `${start}-${slug(title)}-${index}`),
    title: title || 'Date',
    start,
    end,
    allDay: raw.allDay !== false,
    description: raw.description ? String(raw.description) : '',
    location: raw.location ? String(raw.location) : '',
  });
}

function sanitizeCustomDatesSource(raw) {
  const entries = Array.isArray(raw.entries)
    ? raw.entries.map(sanitizeCustomDateEntry).filter(Boolean)
    : [];

  return cleanUndefined({
    type: 'custom-dates',
    title: raw.title ? String(raw.title) : '',
    entries,
  });
}

export function sanitizeCalendarCategorySource(raw) {
  if (!raw || typeof raw !== 'object') return undefined;

  if (raw.type === 'holidays') {
    return sanitizeHolidaySource(raw);
  }

  if (raw.type === 'custom-dates') {
    return sanitizeCustomDatesSource(raw);
  }

  // Future extension point:
  // - school-holidays-de
  // - ics-url
  // - caldav
  // - custom-api
  return undefined;
}

// ------------------------------------------------------------
// Source descriptions
// ------------------------------------------------------------

export function calendarCategorySourceDescription(source) {
  if (!source?.type) return '';

  if (source.type === 'holidays') {
    const parts = [
      source.country || '',
      source.state || '',
      source.region || '',
    ].filter(Boolean);

    return `Dynamic holidays · ${parts.join('-') || 'unknown'}`;
  }

  if (source.type === 'custom-dates') {
    const n = Array.isArray(source.entries) ? source.entries.length : 0;
    return `Custom date source · ${n} entr${n === 1 ? 'y' : 'ies'}`;
  }

  return `Source · ${source.type}`;
}

// ------------------------------------------------------------
// Holiday provider
// ------------------------------------------------------------

function holidayProviderFor(source) {
  const key = [
    source.country || '',
    source.state || '',
    source.region || '',
    source.language || '',
  ].join(':');

  if (holidayProviderCache.has(key)) {
    return holidayProviderCache.get(key);
  }

  const hd = new Holidays(
    source.country || 'DE',
    source.state || undefined,
    source.region || undefined
  );

  if (source.language) {
    try {
      hd.setLanguages(source.language);
    } catch {
      try {
        hd.setLanguages([source.language]);
      } catch {}
    }
  }

  holidayProviderCache.set(key, hd);

  return hd;
}

function holidayRawEventsForCategory(cat, rangeStartMs, rangeEndMs, fromYear, toYear) {
  const source = cat.source;

  if (!source || source.type !== 'holidays') return [];

  const out = [];
  const hd = holidayProviderFor(source);

  const types = Array.isArray(source.types) && source.types.length
    ? source.types
    : ['public'];

  for (let year = fromYear; year <= toYear; year++) {
    let holidays = [];

    try {
      holidays = hd.getHolidays(year) || [];
    } catch {
      holidays = [];
    }

    for (const h of holidays) {
      if (h.type && !types.includes(h.type)) continue;

      const day = localDateKey(h.start || h.date);
      if (!day) continue;

      if (!eventIntersectsRange(day, null, rangeStartMs, rangeEndMs)) {
        continue;
      }

      const stableName = h.name || h.localName || 'Feiertag';

      out.push({
        id: `src:${cat.id}:${day}:${slug(stableName)}`,
        title: stableName,
        start: day,
        end: null,
        allDay: true,

        categoryId: cat.id,
        color: cat.color || undefined,

        location: '',
        description: h.note || '',
        status: 'confirmed',

        readonly: true,
        generated: true,

        source: {
          type: 'holidays',
          country: source.country,
          state: source.state || null,
          region: source.region || null,
          holidayType: h.type || '',
          rule: h.rule || '',
        },
      });
    }
  }

  return out;
}

function customDateRawEventsForCategory(cat, rangeStartMs, rangeEndMs) {
  const source = cat.source;

  if (!source || source.type !== 'custom-dates') return [];

  const entries = Array.isArray(source.entries)
    ? source.entries
    : [];

  const out = [];

  entries.forEach((entry, index) => {
    const start = localDateKey(entry.start);
    if (!start) return;

    // UX rule for custom date ranges:
    // User-entered `end` is inclusive.
    // FullCalendar all-day `end` is exclusive.
    const endExclusive = entry.end
      ? addDaysKey(localDateKey(entry.end), 1)
      : null;

    if (!eventIntersectsRange(start, endExclusive, rangeStartMs, rangeEndMs)) {
      return;
    }

    out.push({
      id: `src:${cat.id}:custom:${entry.id || index}`,
      title: entry.title || 'Date',
      start,
      end: endExclusive,
      allDay: true,

      categoryId: cat.id,
      color: cat.color || undefined,

      location: entry.location || '',
      description: entry.description || '',
      status: 'confirmed',

      readonly: true,
      generated: true,

      source: {
        type: 'custom-dates',
        sourceTitle: source.title || '',
      },
    });
  });

  return out;
}

// ------------------------------------------------------------
// Public generation API
// ------------------------------------------------------------

export function sourceEventsForRange(categories, rangeStart, rangeEnd) {
  const start = rangeStart instanceof Date
    ? rangeStart
    : new Date(rangeStart);

  const end = rangeEnd instanceof Date
    ? rangeEnd
    : new Date(rangeEnd);

  const rangeStartMs = start.getTime();
  const rangeEndMs = end.getTime();

  if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs)) {
    return [];
  }

  const fromYear = start.getFullYear() - 1;
  const toYear = end.getFullYear() + 1;

  const out = [];

  for (const cat of categoriesArray(categories)) {
    if (!cat || cat.visible === false) continue;
    if (!cat.source?.type) continue;

    if (cat.source.type === 'holidays') {
      out.push(...holidayRawEventsForCategory(
        cat,
        rangeStartMs,
        rangeEndMs,
        fromYear,
        toYear
      ));

      continue;
    }

    if (cat.source.type === 'custom-dates') {
      out.push(...customDateRawEventsForCategory(
        cat,
        rangeStartMs,
        rangeEndMs
      ));

      continue;
    }
  }

  return out;
}

// ------------------------------------------------------------
// Custom source JSON parser
// ------------------------------------------------------------

export function parseCustomDatesJson(text) {
  let json;

  try {
    json = JSON.parse(String(text || '').trim());
  } catch (err) {
    throw new Error('Invalid JSON');
  }

  const entries = Array.isArray(json)
    ? json
    : Array.isArray(json.entries)
      ? json.entries
      : Array.isArray(json.events)
        ? json.events
        : [];

  const clean = entries
    .map(sanitizeCustomDateEntry)
    .filter(Boolean);

  if (!clean.length) {
    throw new Error('No valid date entries found');
  }

  return clean;
}

export function exampleCustomDatesJson() {
  return JSON.stringify([
    {
      title: 'Winterferien Niedersachsen',
      start: '2026-02-02',
      end: '2026-02-03'
    },
    {
      title: 'Osterferien Niedersachsen',
      start: '2026-03-23',
      end: '2026-04-07'
    },
    {
      title: 'Sommerferien Niedersachsen',
      start: '2026-07-02',
      end: '2026-08-12'
    }
  ], null, 2);
}