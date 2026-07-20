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

export function formatList(items, opts = { style: 'long', type: 'conjunction' }) {
  return cached('list', opts, () => new Intl.ListFormat(getLocale(), opts)).format(items);
}

// Drop cached formatters — call when the active locale changes without a reload.
export function clearFormatCache() {
  cache.clear();
}
