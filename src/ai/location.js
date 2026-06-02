// ============================================================
// YANTA AI — Approximate user location helper
//
// UX policy:
// - No browser geolocation permission dialog.
// - User explicitly enters city / region / postal code.
// - Lightweight international lookup via Open-Meteo + Nominatim fallback.
// - Stored coordinates are rounded before saving.
// ============================================================

const APPROX_LOCATION_KEY = 'yanta.ai.approxLocation.v1';

function roundCoord(value, decimals = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function cleanCountryCode(value = '') {
  const s = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : '';
}

function isPostalLike(query = '') {
  const q = String(query || '').trim();

  // International-ish postal code heuristic:
  // - contains at least one digit
  // - no commas / long place names
  // - allows spaces and hyphens, e.g. "37073", "10001", "SW1A 1AA"
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
  const latitude = Number(raw.latitude ?? raw.lat);
  const longitude = Number(raw.longitude ?? raw.lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    label: String(raw.label || '').trim() || `${latitude}, ${longitude}`,
    timezone: raw.timezone || '',
    countryCode: raw.countryCode || '',
    source: raw.source || 'geocoding',
  };
}

function dedupeCandidates(list = []) {
  const out = [];
  const seen = new Set();

  for (const raw of list) {
    const c = normalizeCandidate(raw);
    if (!c) continue;

    const key = [
      roundCoord(c.latitude, 2),
      roundCoord(c.longitude, 2),
      c.label.toLowerCase(),
    ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);

    out.push(c);
  }

  return out;
}

function saveApproxLocation(loc) {
  localStorage.setItem(APPROX_LOCATION_KEY, JSON.stringify(loc));

  window.dispatchEvent(new CustomEvent('yanta-ai-location-changed', {
    detail: loc,
  }));

  return loc;
}

export function getApproxUserLocation() {
  try {
    const raw = localStorage.getItem(APPROX_LOCATION_KEY);
    if (!raw) return null;

    const loc = JSON.parse(raw);

    if (
      typeof loc !== 'object' ||
      !Number.isFinite(Number(loc.latitude)) ||
      !Number.isFinite(Number(loc.longitude))
    ) {
      return null;
    }

    return loc;
  } catch {
    return null;
  }
}

export function clearApproxUserLocation() {
  try {
    localStorage.removeItem(APPROX_LOCATION_KEY);
  } catch {}

  window.dispatchEvent(new CustomEvent('yanta-ai-location-changed', {
    detail: null,
  }));
}

/**
 * Kept only for compatibility with older imports.
 * The app intentionally no longer opens browser geolocation dialogs.
 */
export function geolocationErrorMessage() {
  return 'Browser location is intentionally disabled. Enter a city, region or postcode instead.';
}

/**
 * Kept only for compatibility with older imports.
 * Do not call this from UI.
 */
export async function requestApproxUserLocation() {
  throw new Error(
    'Browser location is intentionally disabled. Enter a city, region or postcode instead.'
  );
}

async function searchOpenMeteo(query, {
  countryCode = '',
  limit = 5,
} = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', q);
  url.searchParams.set('count', String(Math.max(1, Math.min(10, Number(limit || 5)))));
  url.searchParams.set('language', 'de');
  url.searchParams.set('format', 'json');

  const cc = cleanCountryCode(countryCode);
  if (cc) {
    url.searchParams.set('countryCode', cc);
  }

  const res = await fetch(url.href, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Open-Meteo geocoding failed: HTTP ${res.status}`);
  }

  const json = await res.json();

  return (json?.results || []).map((hit) => ({
    latitude: hit.latitude,
    longitude: hit.longitude,
    label: compactLabel([
      hit.name,
      hit.admin2,
      hit.admin1,
      hit.country,
    ]),
    timezone: hit.timezone || '',
    countryCode: hit.country_code || hit.countryCode || '',
    source: 'open-meteo-geocoding',
  }));
}

async function searchNominatim(query, {
  countryCode = '',
  limit = 5,
} = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const cc = cleanCountryCode(countryCode);

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', String(Math.max(1, Math.min(10, Number(limit || 5)))));

  if (cc) {
    url.searchParams.set('countrycodes', cc.toLowerCase());
  }

  if (cc && isPostalLike(q)) {
    url.searchParams.set('postalcode', q);
  } else {
    url.searchParams.set('q', q);
  }

  const res = await fetch(url.href, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': navigator.language || 'de',
    },
  });

  if (!res.ok) {
    throw new Error(`Nominatim geocoding failed: HTTP ${res.status}`);
  }

  const json = await res.json();

  return (Array.isArray(json) ? json : []).map((hit) => {
    const a = hit.address || {};

    return {
      latitude: Number(hit.lat),
      longitude: Number(hit.lon),
      label: compactLabel([
        a.city || a.town || a.village || a.municipality || a.county,
        a.postcode,
        a.state,
        a.country,
      ]) || hit.display_name,
      timezone: '',
      countryCode: (a.country_code || '').toUpperCase(),
      source: 'nominatim-openstreetmap',
    };
  });
}

/**
 * Search city / region / postal code.
 *
 * countryCode is optional but improves postal-code results significantly:
 * - 37073 + DE
 * - 10001 + US
 * - SW1A 1AA + GB
 */
export async function searchApproxLocations(query, {
  countryCode = '',
  limit = 6,
} = {}) {
  const q = String(query || '').trim();

  if (!q) {
    throw new Error('Enter a city, region or postcode.');
  }

  const max = Math.max(1, Math.min(10, Number(limit || 6)));

  const results = await Promise.allSettled([
    searchOpenMeteo(q, { countryCode, limit: max }),
    searchNominatim(q, { countryCode, limit: max }),
  ]);

  const candidates = dedupeCandidates(
    results.flatMap((r) => r.status === 'fulfilled' ? r.value : [])
  ).slice(0, max);

  if (!candidates.length) {
    throw new Error(`Location not found: ${q}`);
  }

  return candidates;
}

export function setApproxUserLocationFromCandidate(candidate) {
  const c = normalizeCandidate(candidate);

  if (!c) {
    throw new Error('Invalid location candidate.');
  }

  const latitude = roundCoord(c.latitude, 1);
  const longitude = roundCoord(c.longitude, 1);

  if (latitude == null || longitude == null) {
    throw new Error('Invalid coordinates.');
  }

  return saveApproxLocation({
    latitude,
    longitude,
    label: c.label || 'approximate location',
    accuracyMeters: null,
    roundedToDecimals: 1,
    timezone: c.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    source: c.source || 'manual-location-search',
    countryCode: c.countryCode || '',
    updatedAt: new Date().toISOString(),
  });
}

export async function setApproxUserLocationFromPlace(query, options = {}) {
  const [candidate] = await searchApproxLocations(query, {
    countryCode: options.countryCode || '',
    limit: 1,
  });

  return setApproxUserLocationFromCandidate(candidate);
}