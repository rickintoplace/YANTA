// ============================================================
// YANTA — locale-aware formatting helpers.
//
// Thin wrappers over Intl.*, keyed to the active locale from ./index.js, with
// cached formatter instances (constructing Intl.* is comparatively costly).
// Prefer these over hand-rolled date/number strings so numbers, dates, prices
// and lists read natively in every language.
// ============================================================

import { getLocale } from './index.js';

const cache = new Map();

function cached(kind, opts, make) {
  const key = kind + '|' + getLocale() + '|' + JSON.stringify(opts || {});
  let inst = cache.get(key);
  if (!inst) {
    inst = make();
    cache.set(key, inst);
  }
  return inst;
}

function asDate(value) {
  return value instanceof Date ? value : new Date(value);
}

export function formatNumber(n, opts) {
  return cached('num', opts, () => new Intl.NumberFormat(getLocale(), opts)).format(n);
}

export function formatDate(value, opts = { dateStyle: 'medium' }) {
  return cached('date', opts, () => new Intl.DateTimeFormat(getLocale(), opts)).format(asDate(value));
}

export function formatTime(value, opts = { timeStyle: 'short' }) {
  return cached('time', opts, () => new Intl.DateTimeFormat(getLocale(), opts)).format(asDate(value));
}

export function formatDateTime(value, opts = { dateStyle: 'medium', timeStyle: 'short' }) {
  return cached('datetime', opts, () => new Intl.DateTimeFormat(getLocale(), opts)).format(asDate(value));
}

export function formatRelativeTime(value, unit, opts = { numeric: 'auto' }) {
  return cached('rel', opts, () => new Intl.RelativeTimeFormat(getLocale(), opts)).format(value, unit);
}

// Largest unit whose threshold the distance stays below wins, so a
// timestamp reads the way people say it out loud ("3 days ago", not
// "72 hours ago").
const AGO_NOW_MS = 45_000;

const AGO_UNITS = [
  [3_600_000, 'minute', 60_000],
  [86_400_000, 'hour', 3_600_000],
  [604_800_000, 'day', 86_400_000],
  [2_629_800_000, 'week', 604_800_000],
  [31_557_600_000, 'month', 2_629_800_000],
];

/**
 * Human distance to a timestamp ("2 hours ago", "vor 2 Std." with
 * `style: 'narrow'`). Anything inside the last minute reads as "now".
 */
export function formatTimeAgo(value, opts = {}) {
  const options = { numeric: 'auto', ...opts };
  const diff = asDate(value).getTime() - Date.now();
  const distance = Math.abs(diff);

  if (distance < AGO_NOW_MS) {
    return formatRelativeTime(0, 'second', options);
  }

  for (const [limit, unit, ms] of AGO_UNITS) {
    if (distance < limit) return formatRelativeTime(Math.round(diff / ms), unit, options);
  }

  return formatRelativeTime(Math.round(diff / 31_557_600_000), 'year', options);
}

export function formatList(items, opts = { style: 'long', type: 'conjunction' }) {
  return cached('list', opts, () => new Intl.ListFormat(getLocale(), opts)).format(items);
}

// Drop cached formatters — call when the active locale changes without a reload.
export function clearFormatCache() {
  cache.clear();
}
