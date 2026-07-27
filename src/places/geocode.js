// ============================================================
// YANTA — Geocoding transport.
//
// One place-lookup pipeline for the whole app, deliberately provider-plural:
//
//   Open-Meteo   generous limits, excellent for cities/regions — asked first.
//   Nominatim    street-level detail Open-Meteo does not have. Its usage
//                policy caps clients at 1 request/second, so calls here are
//                serialized through a gate and every result is cached.
//
// Callers own their precision policy: src/ai/location.js deliberately rounds
// to ~city level before storing anything, while a calendar event keeps the
// exact address it was given. This module just fetches and normalizes.
//
// Privacy: the query is a place *name the user typed*, never a device
// position — YANTA does not open the browser geolocation dialog anywhere.
// ============================================================

const OPEN_METEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

/** Nominatim's published limit is 1 req/s; stay a little under it. */
const NOMINATIM_MIN_INTERVAL_MS = 1100;

const CACHE_MAX = 80;

/** @type {Map<string, object[]>} insertion-ordered, so the oldest key is first. */
const cache = new Map();

let nominatimGate = Promise.resolve();

function cleanCountryCode(value = '') {
  const s = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : '';
}

/**
 * International-ish postal code heuristic: has a digit, no place-name commas.
 * Nominatim resolves "37073" far better as `postalcode` than as free text —
 * but only when it also knows the country.
 */
export function isPostalLike(query = '') {
  const q = String(query || '').trim();

  return (
    q.length >= 3 &&
    q.length <= 12 &&
    /\d/.test(q) &&
    /^[\p{L}\p{N}\s-]+$/u.test(q)
  );
}

function compactLabel(parts = []) {
  return parts
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .filter((x, i, arr) => arr.indexOf(x) === i)
    .join(', ');
}

function normalizeCandidate(raw = {}) {
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude,
    longitude,
    label: String(raw.label || '').trim() || `${latitude}, ${longitude}`,
    address: String(raw.address || '').trim(),
    timezone: raw.timezone || '',
    countryCode: raw.countryCode || '',
    osmType: raw.osmType || '',
    osmId: raw.osmId ? String(raw.osmId) : '',
    source: raw.source || 'geocoding',
  };
}

/**
 * Collapses duplicates on *either* signal:
 *
 *   - same ~11 m coordinate grid (two providers naming the same door), and
 *   - same rendered address text.
 *
 * The second rule is what keeps the list honest: Nominatim happily returns
 * the node, the way and the relation for one building, each a few metres
 * apart, which would otherwise show up as five identical-looking rows.
 */
function dedupe(list = []) {
  const out = [];
  const seenCoords = new Set();
  const seenText = new Set();

  for (const raw of list) {
    const c = normalizeCandidate(raw);
    if (!c) continue;

    const coordKey = `${c.latitude.toFixed(4)}|${c.longitude.toFixed(4)}`;
    const textKey = (c.address || c.label).toLowerCase();

    if (seenCoords.has(coordKey) || seenText.has(textKey)) continue;

    seenCoords.add(coordKey);
    seenText.add(textKey);
    out.push(c);
  }

  return out;
}

/**
 * Round-robins the providers instead of concatenating them.
 *
 * Concatenation lets whichever provider answers first fill every visible
 * slot — "Berlin" returns six Berlins from Open-Meteo and buries every
 * street address Nominatim found. Interleaving guarantees both readings of
 * the query stay reachable without scrolling.
 */
function interleave(first = [], second = []) {
  const out = [];

  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    if (first[i]) out.push(first[i]);
    if (second[i]) out.push(second[i]);
  }

  return out;
}

/**
 * A house number (or an explicit comma) means the user is after a specific
 * address, which is Nominatim's strength; a bare name is usually a place,
 * which Open-Meteo ranks better.
 */
function looksLikeAddress(query) {
  return /\d/.test(query) || query.includes(',');
}

// -------- Providers --------------------------------------------

async function searchOpenMeteo(query, { countryCode, limit, signal }) {
  const url = new URL(OPEN_METEO_URL);
  url.searchParams.set('name', query);
  url.searchParams.set('count', String(limit));
  url.searchParams.set('language', navigator.language?.slice(0, 2) || 'en');
  url.searchParams.set('format', 'json');

  if (countryCode) url.searchParams.set('countryCode', countryCode);

  const res = await fetch(url.href, { headers: { Accept: 'application/json' }, signal });

  if (!res.ok) throw new Error(`Open-Meteo geocoding failed: HTTP ${res.status}`);

  const json = await res.json();

  return (json?.results || []).map((hit) => ({
    latitude: hit.latitude,
    longitude: hit.longitude,
    label: hit.name || '',
    address: compactLabel([hit.name, hit.admin2, hit.admin1, hit.country]),
    timezone: hit.timezone || '',
    countryCode: hit.country_code || hit.countryCode || '',
    source: 'open-meteo-geocoding',
  }));
}

/** Serializes callers so bursts of keystrokes cannot exceed Nominatim's limit. */
function throughNominatimGate(fn) {
  const run = nominatimGate.then(fn, fn);

  nominatimGate = run
    .catch(() => {})
    .then(() => new Promise((r) => setTimeout(r, NOMINATIM_MIN_INTERVAL_MS)));

  return run;
}

async function searchNominatim(query, { countryCode, limit, signal }) {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', String(limit));

  if (countryCode) url.searchParams.set('countrycodes', countryCode.toLowerCase());

  if (countryCode && isPostalLike(query)) url.searchParams.set('postalcode', query);
  else url.searchParams.set('q', query);

  return throughNominatimGate(async () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const res = await fetch(url.href, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': navigator.language || 'en',
      },
      signal,
    });

    if (!res.ok) throw new Error(`Nominatim geocoding failed: HTTP ${res.status}`);

    const json = await res.json();

    return (Array.isArray(json) ? json : []).map((hit) => {
      const a = hit.address || {};

      const place = a.amenity || a.shop || a.building || a.tourism || a.office || '';
      const street = compactLabel([a.road, a.house_number].filter(Boolean).reverse());
      const city = a.city || a.town || a.village || a.municipality || a.county || '';

      return {
        latitude: Number(hit.lat),
        longitude: Number(hit.lon),
        label: place || street || city || hit.display_name || '',
        address: compactLabel([street, a.postcode, city, a.state, a.country]) || hit.display_name,
        countryCode: (a.country_code || '').toUpperCase(),
        osmType: hit.osm_type || '',
        osmId: hit.osm_id || '',
        source: 'nominatim-openstreetmap',
      };
    });
  });
}

// -------- Public API -------------------------------------------

/**
 * Looks up a place by name, address or postal code.
 *
 * `countryCode` is optional but changes postal-code results dramatically
 * ("37073" + DE, "10001" + US, "SW1A 1AA" + GB).
 *
 * Both providers are asked in parallel and one failing never fails the call —
 * a flaky Nominatim still leaves the user with Open-Meteo's city hits.
 * Returns `[]` rather than throwing when nothing matches.
 */
export async function searchPlaces(query, {
  countryCode = '',
  limit = 6,
  signal,
} = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const cc = cleanCountryCode(countryCode);
  const max = Math.max(1, Math.min(10, Number(limit) || 6));
  const cacheKey = `${cc}|${max}|${q.toLowerCase()}`;

  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const [meteo, osm] = await Promise.allSettled([
    searchOpenMeteo(q, { countryCode: cc, limit: max, signal }),
    searchNominatim(q, { countryCode: cc, limit: max, signal }),
  ]);

  if (signal?.aborted) return [];

  const value = (settled) => (settled.status === 'fulfilled' ? settled.value : []);

  const results = dedupe(
    looksLikeAddress(q)
      ? interleave(value(osm), value(meteo))
      : interleave(value(meteo), value(osm))
  ).slice(0, max);

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, results);

  return results;
}
