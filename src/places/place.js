// ============================================================
// YANTA — The place value object.
//
// A place is the *optional structured twin* of a free-text location string.
// The string always stays authoritative for humans, ICS `LOCATION` and any
// non-YANTA client; the place only adds coordinates on top. Nothing is ever
// derived away, so an ICS round-trip cannot lose what the user typed.
//
// Deliberately no map library: YANTA renders a place as a chip that hands
// off to the maps app the user already trusts. That keeps the bundle flat,
// keeps working offline, and keeps tile servers from seeing every note the
// user opens.
// ============================================================

const PLACE_VERSION = 1;

/** 5 decimals ≈ 1 m — plenty for an address, and keeps the vault payload small. */
const COORD_DECIMALS = 5;

function round(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const f = 10 ** COORD_DECIMALS;
  return Math.round(n * f) / f;
}

/**
 * Validates and trims an untrusted place object (vault, chat embed, import).
 * Returns null when it carries no usable coordinates.
 */
export function normalizePlace(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const latitude = round(raw.latitude);
  const longitude = round(raw.longitude);

  if (latitude == null || longitude == null) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  const str = (v, max) => String(v || '').trim().slice(0, max);

  return {
    v: PLACE_VERSION,
    latitude,
    longitude,
    label: str(raw.label, 200),
    address: str(raw.address, 400),
    countryCode: str(raw.countryCode, 2).toUpperCase(),
    osmType: str(raw.osmType, 16),
    osmId: str(raw.osmId, 32),
    source: str(raw.source, 64),
  };
}

/** Builds a place from a geocoder candidate (see ./geocode.js). */
export function placeFromCandidate(candidate) {
  return normalizePlace(candidate);
}

/** The single line a user should see for this place. */
export function placeText(place) {
  if (!place) return '';

  return place.address || place.label || formatCoords(place);
}

export function formatCoords(place) {
  if (!place) return '';

  return `${place.latitude}, ${place.longitude}`;
}

// -------- Handing off to a maps app ----------------------------

function platform() {
  const ua = navigator.userAgent || '';

  if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1)) return 'apple';
  if (/Macintosh/.test(ua)) return 'apple';
  if (/Android/.test(ua)) return 'android';

  return 'other';
}

const PROVIDERS = {
  apple: (p, q) => `https://maps.apple.com/?ll=${p.latitude},${p.longitude}&q=${q}`,
  google: (p) => `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`,
  osm: (p) =>
    `https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=17/${p.latitude}/${p.longitude}`,
  geo: (p, q) => `geo:${p.latitude},${p.longitude}?q=${p.latitude},${p.longitude}(${q})`,
};

/**
 * The "open in…" targets for a place, native handler first.
 *
 * Order matters more than completeness here: the first entry is what the
 * platform's own maps app answers, so the common case is one tap.
 */
export function mapTargets(place) {
  if (!place) return [];

  const q = encodeURIComponent(placeText(place) || formatCoords(place));

  const apple = { id: 'apple', label: 'Apple Maps', icon: 'map', url: PROVIDERS.apple(place, q) };
  const google = { id: 'google', label: 'Google Maps', icon: 'map', url: PROVIDERS.google(place) };
  const osm = { id: 'osm', label: 'OpenStreetMap', icon: 'globe', url: PROVIDERS.osm(place) };
  const geo = { id: 'geo', label: 'Maps app', icon: 'map-pin', url: PROVIDERS.geo(place, q) };

  switch (platform()) {
    case 'apple': return [apple, google, osm];
    case 'android': return [geo, google, osm];
    default: return [google, apple, osm];
  }
}

/**
 * URL of the platform's preferred maps target — the one to put behind a
 * plain `<a>` so middle-click, "copy link" and screen readers all behave.
 */
export function primaryMapUrl(place) {
  return mapTargets(place)[0]?.url || '';
}
