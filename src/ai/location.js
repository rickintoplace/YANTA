// ============================================================
// YANTA AI — Approximate user location helper
//
// UX policy:
// - No browser geolocation permission dialog.
// - User explicitly enters city / region / postal code.
// - Stored coordinates are rounded to ~city level before saving.
//
// The lookup itself is shared with the calendar's location field
// (src/places/geocode.js). Only the coarsening policy lives here: what the
// AI needs is "which city am I in", never a street address.
// ============================================================

import { searchPlaces } from '../places/geocode.js';

const APPROX_LOCATION_KEY = 'yanta.ai.approxLocation.v1';

function roundCoord(value, decimals = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const f = 10 ** decimals;
  return Math.round(n * f) / f;
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

/**
 * Search city / region / postal code.
 *
 * countryCode is optional but improves postal-code results significantly:
 * - 37073 + DE
 * - 10001 + US
 * - SW1A 1AA + GB
 *
 * The lookup itself lives in src/places/geocode.js — shared with the calendar
 * location field. What stays here is this module's own policy: a coarse label
 * for AI context, and the rounding applied before anything is stored.
 */
export async function searchApproxLocations(query, {
  countryCode = '',
  limit = 6,
} = {}) {
  const q = String(query || '').trim();

  if (!q) {
    throw new Error('Enter a city, region or postcode.');
  }

  const candidates = await searchPlaces(q, { countryCode, limit });

  if (!candidates.length) {
    throw new Error(`Location not found: ${q}`);
  }

  return candidates.map((c) => ({
    ...c,
    // AI context wants "Göttingen, Lower Saxony, Germany", not a house number.
    label: c.address || c.label,
  }));
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