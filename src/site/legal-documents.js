// ============================================================
// YANTA — legal document loader
//
// Picks the reader's locale bundle and lazily imports it, so a visitor only
// downloads the language they read. English is the source of record.
//
// Not every document exists in every language: the consumer-facing ones that
// carry real risk with German customers are translated, the rest are not.
// Where a translation is missing we serve the English text with a notice in
// the reader's own language rather than a machine-shaped approximation of a
// liability clause.
// ============================================================

import { getLocale, t } from '../i18n/index.js';
import { escapeHtml } from './legal-links.js';

const LOADERS = {
  en: () => import('./legal/en.js'),
  de: () => import('./legal/de.js'),
};

/**
 * Strings for the form pages (/cancel, /report, /delete-account) in the
 * active locale, falling back to English per missing group.
 *
 * Returns `{ strings, localised }` — `localised` false means the caller
 * should show the English-only notice above its content.
 */
export async function legalFormStrings(group) {
  const locale = getLocale();
  const translated = !!LOADERS[locale];

  const mod = await (LOADERS[locale] || LOADERS.en)();
  const strings = mod.forms?.[group];

  if (strings) {
    return { strings, localised: translated };
  }

  const english = await LOADERS.en();

  return { strings: english.forms[group], localised: false };
}

export function englishOnlyNotice() {
  return `
    <div class="yanta-note-box yanta-legal-lang-note" lang="${escapeHtml(getLocale())}">
      <p>${escapeHtml(t('site.legal.englishOnly'))}</p>
    </div>
  `;
}

/**
 * Render a legal document in the active locale.
 *
 * Resolves to markup. Missing translations fall back to English, prefixed
 * with a notice; an unknown `kind` falls back to the imprint, which is the
 * one document that must always resolve.
 */
export async function legalDocument(kind) {
  const locale = getLocale();
  const translated = !!LOADERS[locale];

  const mod = await (LOADERS[locale] || LOADERS.en)();
  const documents = mod.default || {};

  let render = documents[kind];
  let localised = translated;

  /*
    A locale bundle may translate only some documents. Anything it omits comes
    from English, and then the notice applies even though the locale itself is
    "translated".
  */
  if (!render && translated) {
    const english = await LOADERS.en();
    render = (english.default || {})[kind];
    localised = false;
  }

  if (!render) {
    render = documents.imprint || (await LOADERS.en()).default.imprint;
  }

  return `${localised ? '' : englishOnlyNotice()}${render()}`;
}
