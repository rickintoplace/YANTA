// ============================================================
// YANTA — i18n runtime.
//
// A deliberately tiny message layer (no i18next & co.) that fits YANTA's
// vanilla-JS, boot-budget-conscious architecture:
//
//   - t(key, params)      synchronous lookup — usable inside any render code
//   - catalogs lazy-load  only the active locale (+ EN fallback) ship as chunks
//   - Intl.*              powers plurals & formatting (see ./format.js)
//
// Because YANTA builds DOM from template literals (no reactive framework),
// there is no live re-render on switch: setLocale() persists the choice and
// the caller reloads — the same soft-reload UX Apple/Google apps use for a
// language change, which happens rarely. Static markup carrying [data-i18n]
// attributes is filled by applyStaticI18n() at boot.
// ============================================================

// Ordered list — also drives the Settings language picker.
export const LOCALES = [
  { code: 'en', label: 'English',  native: 'English' },
  { code: 'de', label: 'German',   native: 'Deutsch' },
  { code: 'es', label: 'Spanish',  native: 'Español' },
  { code: 'fr', label: 'French',   native: 'Français' },
  { code: 'ja', label: 'Japanese', native: '日本語' },
];

export const SUPPORTED = LOCALES.map((l) => l.code);
export const DEFAULT_LOCALE = 'en';

// Device-local (mirrors the appearance boot cache): a language choice is
// per-device by nature, and localStorage lets index.html read it before any
// bundle parses. Keep this key in sync with the inline boot snippet.
export const STORAGE_KEY = 'yanta.lang';

// Lazy chunk loaders — Vite code-splits each locale into its own file.
const LOADERS = {
  en: () => import('./locales/en.js'),
  de: () => import('./locales/de.js'),
  es: () => import('./locales/es.js'),
  fr: () => import('./locales/fr.js'),
  ja: () => import('./locales/ja.js'),
};

let activeCode = DEFAULT_LOCALE;
let active = {};        // active locale catalog
let fallback = {};      // EN catalog, used for keys missing in `active`
let pluralRules = new Intl.PluralRules(DEFAULT_LOCALE);

const listeners = new Set();

// ---------------------------------------------------------------
// Locale resolution
// ---------------------------------------------------------------

function readStoredLocale() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED.includes(v) ? v : null;
  } catch {
    return null;
  }
}

// Match the user's browser-preference chain against what we support,
// base-language first (de-AT → de, es-419 → es).
function matchBrowserLocale(prefs = navigator.languages || [navigator.language || '']) {
  for (const pref of prefs) {
    const base = String(pref || '').toLowerCase().split('-')[0];
    if (SUPPORTED.includes(base)) return base;
  }
  return DEFAULT_LOCALE;
}

// Effective locale: explicit user choice wins, else browser preference.
export function resolveLocale() {
  return readStoredLocale() || matchBrowserLocale();
}

export function getLocale() {
  return activeCode;
}

// True when the active locale came from an explicit stored choice rather than
// browser detection — lets the picker show a "Match system" affordance.
export function hasExplicitLocale() {
  return readStoredLocale() != null;
}

// ---------------------------------------------------------------
// Boot
// ---------------------------------------------------------------

async function loadCatalog(code) {
  const mod = await (LOADERS[code] || LOADERS[DEFAULT_LOCALE])();
  return mod.default || {};
}

// Load the active locale (and EN as fallback if different) and apply it.
// Awaited during boot before the first render so t() is never a cache miss.
export async function initI18n(code = resolveLocale()) {
  activeCode = SUPPORTED.includes(code) ? code : DEFAULT_LOCALE;

  const [act, fb] = await Promise.all([
    loadCatalog(activeCode),
    activeCode === DEFAULT_LOCALE ? null : loadCatalog(DEFAULT_LOCALE),
  ]);

  active = act;
  fallback = fb || act;
  pluralRules = new Intl.PluralRules(activeCode);

  document.documentElement.lang = activeCode;
  applyStaticI18n();
  emitChange();

  return activeCode;
}

// Persist a new choice. Returns true if it actually changed. Callers that need
// already-rendered views to update should reload afterwards (see Settings).
export function setLocale(code) {
  if (!SUPPORTED.includes(code) || code === activeCode) return false;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {}
  return true;
}

// Drop the explicit choice and fall back to browser detection.
export function clearLocale() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

// ---------------------------------------------------------------
// Lookup + interpolation
// ---------------------------------------------------------------

function lookup(catalog, key) {
  let node = catalog;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (match, name) => {
    if (!(name in params)) return match;
    const v = params[name];
    // Numbers are locale-formatted for free (grouping, native digits).
    return typeof v === 'number'
      ? new Intl.NumberFormat(activeCode).format(v)
      : String(v ?? '');
  });
}

/**
 * Translate `key`, interpolating `{token}` params.
 *
 * Plurals: give the catalog value an object of CLDR categories and pass a
 * `count`, e.g.  notes.count: { one: '{count} note', other: '{count} notes' }
 * → t('notes.count', { count: 3 }).
 *
 * Resolution order: active locale → EN fallback → the key itself (so a missing
 * string is visible, never a blank).
 */
export function t(key, params) {
  let value = lookup(active, key);
  if (value === undefined) value = lookup(fallback, key);
  if (value === undefined) return key;

  if (value && typeof value === 'object') {
    const count = params?.count;
    const category = typeof count === 'number' ? pluralRules.select(count) : 'other';
    value = value[category] ?? value.other ?? value.one ?? key;
  }

  return typeof value === 'string' ? interpolate(value, params) : key;
}

// ---------------------------------------------------------------
// Static markup ([data-i18n*] in index.html and injected shells)
// ---------------------------------------------------------------

const STATIC_ATTRS = [
  ['data-i18n', 'textContent'],
  ['data-i18n-placeholder', 'placeholder'],
  ['data-i18n-title', 'title'],
  ['data-i18n-aria-label', 'aria-label'],
];

// Fill every [data-i18n*] element under `root` from the catalog. Safe to call
// repeatedly (idempotent) — runs at boot and after a live locale change.
export function applyStaticI18n(root = document) {
  for (const [attr, target] of STATIC_ATTRS) {
    for (const node of root.querySelectorAll(`[${attr}]`)) {
      const value = t(node.getAttribute(attr));
      if (target === 'textContent') node.textContent = value;
      else node.setAttribute(target, value);
    }
  }
}

// ---------------------------------------------------------------
// Change notification (for any live-updating surface that opts in)
// ---------------------------------------------------------------

export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emitChange() {
  for (const fn of listeners) {
    try {
      fn(activeCode);
    } catch (err) {
      console.warn('[YANTA i18n] locale-change listener failed', err);
    }
  }
}
