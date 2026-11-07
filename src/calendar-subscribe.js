// ============================================================
// YANTA — "Subscribe to a calendar"
//
// Three ways in, in the order people need them:
// 1. Public holidays and school holidays for a country and region.
//    Holidays come from date-holidays (offline, ~200 countries), school
//    holidays from OpenHolidays (open data, ~35 countries). One form,
//    two switches, one button — no wall of buttons per state.
// 2. Any calendar by link (.ics / webcal): match schedules, waste
//    collection, a public Google calendar. Checked before it is added,
//    so a wrong link fails here and not silently later.
// 3. Own dates as JSON, behind a disclosure: rarely needed.
//
// Everything subscribed is read-only and generated; see
// calendar-sources.js and calendar-feeds.js.
// ============================================================

import { state, escapeHtml, escapeAttr, lucide, toast } from './core.js';
import { t, getLocale } from './i18n/index.js';
import {
  fetchIcsFeed,
  normalizeFeedUrl,
  seedFeed,
  schoolHolidayCountries,
  schoolHolidayRegions,
} from './calendar-feeds.js';
import { parseCustomDatesJson, exampleCustomDatesJson } from './calendar-sources.js';

const PALETTE = { holidays: '#e8590c', school: '#37b24d', ics: '#1098ad', custom: '#ae3ec9' };

let Holidays = null;
let schoolCountries = null;
const regionCache = new Map();

function uiLang() {
  return String(getLocale() || 'en').slice(0, 2).toLowerCase();
}

async function loadHolidays() {
  if (!Holidays) Holidays = (await import('date-holidays')).default;
  return Holidays;
}

function sameSource(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'holidays') return a.country === b.country && (a.state || null) === (b.state || null) && (a.region || null) === (b.region || null);
  if (a.type === 'feed') {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'ics') return a.url === b.url;
    return a.country === b.country && (a.subdivision || null) === (b.subdivision || null);
  }
  return false;
}

export function subscribedCategory(source) {
  return [...state.calendarCategories.values()].find((c) => sameSource(c.source, source)) || null;
}

function guessCountry() {
  const existing = [...state.calendarCategories.values()].find((c) => c.source?.type === 'holidays');
  if (existing) return { country: existing.source.country, state: existing.source.state || '' };
  const fromLocale = /[-_]([A-Z]{2})$/i.exec(navigator.language || '')?.[1];
  const fallback = { de: 'DE', fr: 'FR', es: 'ES', ja: 'JP', en: 'US' }[uiLang()] || 'DE';
  return { country: (fromLocale || fallback).toUpperCase(), state: '' };
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The OpenHolidays region that is the date-holidays state. */
function matchSchoolRegion(regions, country, stateCode, stateName) {
  if (!stateCode) return null;
  const iso = `${country}-${stateCode}`.toUpperCase();
  return regions.find((r) => r.isoCode.toUpperCase() === iso || r.code.toUpperCase() === iso) ||
    regions.find((r) => norm(r.name) === norm(stateName)) ||
    regions.find((r) => norm(stateName).includes(norm(r.name)) || norm(r.name).includes(norm(stateName))) ||
    null;
}

// ---------------- render ---------------------------------------------

function html() {
  return `
    <div class="modal-card ysub" role="dialog" aria-labelledby="ysub-title">
      <header class="modal-head ysub-head">
        <h3 id="ysub-title">${escapeHtml(t('subscribe.title'))}</h3>
        <button class="icon-btn" data-cal-source-close aria-label="${escapeAttr(t('common.close'))}">${lucide('x', 18)}</button>
      </header>
      <div class="modal-body ysub-body">
        <section class="ysub-section" aria-labelledby="ysub-h1">
          <h4 id="ysub-h1">${escapeHtml(t('subscribe.regionTitle'))}</h4>
          <div class="ysub-row">
            <label class="ysub-field"><span>${escapeHtml(t('subscribe.country'))}</span><select data-country></select></label>
            <label class="ysub-field"><span>${escapeHtml(t('subscribe.region'))}</span><select data-state></select></label>
          </div>
          <label class="ysub-check"><input type="checkbox" data-want-holidays checked><span>${escapeHtml(t('subscribe.publicHolidays'))}</span><small data-holidays-note></small></label>
          <label class="ysub-check"><input type="checkbox" data-want-school><span>${escapeHtml(t('subscribe.schoolHolidays'))}</span><small data-school-note></small></label>
          <label class="ysub-field ysub-school-region" hidden><span>${escapeHtml(t('subscribe.schoolRegion'))}</span><select data-school-region></select></label>
          <div class="ysub-actions">
            <button type="button" class="btn primary" data-subscribe-region>${escapeHtml(t('subscribe.subscribe'))}</button>
            <p class="ysub-status" data-region-status aria-live="polite"></p>
          </div>
        </section>

        <section class="ysub-section" aria-labelledby="ysub-h2">
          <h4 id="ysub-h2">${escapeHtml(t('subscribe.linkTitle'))}</h4>
          <p class="ysub-hint">${escapeHtml(t('subscribe.linkHint'))}</p>
          <form class="ysub-link" data-link-form>
            <input type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://… / webcal://…" data-link aria-label="${escapeAttr(t('subscribe.linkLabel'))}">
            <button type="submit" class="btn primary">${escapeHtml(t('subscribe.subscribe'))}</button>
          </form>
          <p class="ysub-status" data-link-status aria-live="polite"></p>
        </section>

        <details class="ysub-section ysub-more">
          <summary>${escapeHtml(t('subscribe.customTitle'))}</summary>
          <p class="ysub-hint">${escapeHtml(t('subscribe.customHint'))}</p>
          <label class="ysub-field"><span>${escapeHtml(t('subscribe.customName'))}</span><input class="text-input" data-custom-name></label>
          <label class="ysub-field"><span>JSON</span><textarea class="text-input" data-custom-json rows="8" spellcheck="false">${escapeHtml(exampleCustomDatesJson())}</textarea></label>
          <div class="ysub-actions"><button type="button" class="btn" data-add-custom>${escapeHtml(t('subscribe.customAdd'))}</button></div>
        </details>
      </div>
    </div>`;
}

function status(el, tone, text) {
  if (!el) return;
  el.className = `ysub-status ${tone ? `is-${tone}` : ''}`;
  el.innerHTML = text ? `${lucide(tone === 'ok' ? 'check' : tone === 'bad' ? 'circle-alert' : tone === 'busy' ? 'loader-circle' : 'info', 14)}<span>${escapeHtml(text)}</span>` : '';
}

/**
 * Fills the modal and wires it. `api` comes from calendar.js:
 *   { putCalendarCategory, onAdded(cat) }
 */
export async function renderSubscribeDialog(modal, api) {
  ensureCss();
  modal.innerHTML = html();

  const $ = (sel) => modal.querySelector(sel);
  const countrySel = $('[data-country]');
  const stateSel = $('[data-state]');
  const wantHolidays = $('[data-want-holidays]');
  const wantSchool = $('[data-want-school]');
  const schoolRow = $('.ysub-school-region');
  const schoolSel = $('[data-school-region]');
  const regionStatus = $('[data-region-status]');
  const lang = uiLang();
  const ohLang = lang.toUpperCase();

  let regions = [];
  let schoolRegion = null;

  const H = await loadHolidays();
  const hd = new H();
  const countries = Object.entries(hd.getCountries(lang) || {}).sort((a, b) => a[1].localeCompare(b[1], getLocale()));
  const guess = guessCountry();
  countrySel.innerHTML = countries.map(([code, name]) => `<option value="${code}" ${code === guess.country ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');

  const stateName = () => stateSel.selectedOptions[0]?.textContent || '';
  const regionLabel = () => stateSel.value ? stateName() : countrySel.selectedOptions[0]?.textContent || '';

  const holidaySource = () => ({ type: 'holidays', country: countrySel.value, state: stateSel.value || null, region: null });
  const schoolSource = () => ({ type: 'feed', kind: 'school', country: countrySel.value, subdivision: (schoolRegion?.code) || null, lang: ohLang });

  function refreshButtons() {
    const hasH = !!subscribedCategory(holidaySource());
    const schoolOk = !wantSchool.disabled;
    const hasS = schoolOk && !!subscribedCategory(schoolSource());
    $('[data-holidays-note]').textContent = hasH ? t('subscribe.already') : '';
    $('[data-school-note]').textContent = !schoolOk ? t('subscribe.schoolUnavailable') : hasS ? t('subscribe.already') : '';
    const wants = (wantHolidays.checked && !hasH) || (wantSchool.checked && schoolOk && !hasS && (!!schoolRegion || !regions.length));
    $('[data-subscribe-region]').disabled = !wants;
  }

  function fillStates() {
    const states = Object.entries(hd.getStates(countrySel.value, lang) || {}).sort((a, b) => a[1].localeCompare(b[1], getLocale()));
    stateSel.innerHTML = `<option value="">${escapeHtml(t('subscribe.wholeCountry'))}</option>` +
      states.map(([code, name]) => `<option value="${escapeAttr(code)}" ${code === guess.state && countrySel.value === guess.country ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
    stateSel.closest('.ysub-field').hidden = !states.length;
  }

  async function fillSchool() {
    const country = countrySel.value;
    try {
      schoolCountries ||= await schoolHolidayCountries(ohLang);
    } catch {
      schoolCountries = null;
    }
    const supported = !!schoolCountries?.includes(country);
    wantSchool.disabled = !supported;
    if (!supported) {
      wantSchool.checked = false;
      schoolRow.hidden = true;
      regions = [];
      schoolRegion = null;
      refreshButtons();
      return;
    }
    if (!regionCache.has(country)) {
      try { regionCache.set(country, await schoolHolidayRegions(country, ohLang)); } catch { regionCache.set(country, []); }
    }
    if (countrySel.value !== country) return;
    regions = regionCache.get(country) || [];
    syncSchoolRegion();
  }

  function syncSchoolRegion() {
    const matched = matchSchoolRegion(regions, countrySel.value, stateSel.value, stateName());
    // Only ask when the region above does not say it.
    schoolRow.hidden = !wantSchool.checked || !regions.length || !!matched;
    if (matched) {
      schoolRegion = matched;
    } else if (regions.length) {
      schoolSel.innerHTML = `<option value="">${escapeHtml(t('subscribe.chooseRegion'))}</option>` +
        regions.map((r) => `<option value="${escapeAttr(r.code)}">${escapeHtml(r.name)}</option>`).join('');
      schoolRegion = null;
    } else {
      schoolRegion = null;
    }
    refreshButtons();
  }

  countrySel.addEventListener('change', () => { fillStates(); status(regionStatus, '', ''); fillSchool(); refreshButtons(); });
  stateSel.addEventListener('change', () => { status(regionStatus, '', ''); syncSchoolRegion(); });
  wantHolidays.addEventListener('change', refreshButtons);
  wantSchool.addEventListener('change', syncSchoolRegion);
  schoolSel.addEventListener('change', () => { schoolRegion = regions.find((r) => r.code === schoolSel.value) || null; refreshButtons(); });

  fillStates();
  refreshButtons();
  fillSchool();

  $('[data-subscribe-region]').addEventListener('click', () => {
    const added = [];
    const region = regionLabel();

    if (wantHolidays.checked && !subscribedCategory(holidaySource())) {
      const cat = api.putCalendarCategory({
        name: t('subscribe.holidaysName', { region }),
        color: PALETTE.holidays,
        visible: true,
        readonly: true,
        source: { ...holidaySource(), language: lang, types: ['public'] },
      });
      if (cat) added.push(cat);
    }

    if (wantSchool.checked && !wantSchool.disabled && !subscribedCategory(schoolSource())) {
      const schoolName = schoolRegion?.name || region;
      const cat = api.putCalendarCategory({
        name: t('subscribe.schoolName', { region: schoolName }),
        color: PALETTE.school,
        visible: true,
        readonly: true,
        source: schoolSource(),
      });
      if (cat) added.push(cat);
    }

    if (added.length) {
      status(regionStatus, 'ok', t('subscribe.added', { names: added.map((c) => c.name).join(', ') }));
      api.onAdded?.(added);
    }
    refreshButtons();
  });

  // ---- by link
  const linkInput = $('[data-link]');
  const linkStatus = $('[data-link-status]');
  let linkBusy = false;
  $('[data-link-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (linkBusy) return;
    const url = normalizeFeedUrl(linkInput.value);
    if (!url) {
      status(linkStatus, 'bad', t('subscribe.linkInvalid'));
      return;
    }
    const existing = subscribedCategory({ type: 'feed', kind: 'ics', url });
    if (existing) {
      status(linkStatus, 'ok', t('subscribe.linkAlready', { name: existing.name }));
      return;
    }

    linkBusy = true;
    status(linkStatus, 'busy', t('subscribe.linkChecking'));
    try {
      const feed = await fetchIcsFeed(url);
      const host = new URL(url).hostname.replace(/^www\./, '');
      const cat = api.putCalendarCategory({
        name: feed.name || host,
        color: PALETTE.ics,
        visible: true,
        readonly: true,
        source: { type: 'feed', kind: 'ics', url },
      });
      if (cat) {
        // The check was the first fetch: it becomes the cache.
        seedFeed(cat, feed);
        status(linkStatus, 'ok', t('subscribe.linkAdded', { name: cat.name, count: feed.events.length }));
        linkInput.value = '';
        api.onAdded?.([cat]);
      }
    } catch (err) {
      const msg = err?.code === 'signed-out' ? t('subscribe.signIn')
        : err?.code === 'offline' ? t('subscribe.offline')
          : err?.code === 'not_a_calendar' ? t('subscribe.notCalendar')
            : t('subscribe.linkFailed', { reason: err?.message || '' });
      status(linkStatus, 'bad', msg);
    } finally {
      linkBusy = false;
    }
  });

  // ---- own JSON
  $('[data-add-custom]').addEventListener('click', () => {
    const name = $('[data-custom-name]').value.trim() || t('subscribe.customTitle');
    let entries;
    try {
      entries = parseCustomDatesJson($('[data-custom-json]').value || '');
    } catch (err) {
      toast(err?.message || 'Invalid JSON', 'error');
      return;
    }
    const cat = api.putCalendarCategory({
      name,
      color: PALETTE.custom,
      visible: true,
      readonly: true,
      source: { type: 'custom-dates', title: name, entries },
    });
    if (cat) {
      toast(t('subscribe.added', { names: name }), 'success');
      api.onAdded?.([cat]);
    }
  });
}

function ensureCss() {
  if (document.getElementById('ysub-css')) return;
  const style = document.createElement('style');
  style.id = 'ysub-css';
  style.textContent = `
.ysub.modal-card { width: min(540px, 94vw); max-height: min(780px, 92vh); display: flex; flex-direction: column; }
.ysub-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ysub-head h3 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -0.01em; }
.ysub-body { overflow: auto; padding: 4px 22px 22px; }
.ysub-section { padding: 18px 0 20px; }
.ysub-section + .ysub-section { border-top: 1px solid var(--border); }
.ysub-section h4 { margin: 0 0 12px; font-size: 14px; font-weight: 650; }
.ysub-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 520px) { .ysub-row { grid-template-columns: 1fr; } }
.ysub-field { display: grid; gap: 5px; font-size: 12px; color: var(--text-dim); margin-bottom: 12px; }
.ysub-field[hidden] { display: none; }
.ysub-field select, .ysub-field input, .ysub-field textarea, .ysub-link input {
  font: inherit; font-size: 14px; color: var(--text); background: var(--bg);
  border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; min-width: 0; width: 100%; box-sizing: border-box;
}
.ysub-field textarea { font-family: var(--mono, ui-monospace, monospace); font-size: 12px; }
.ysub-check { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; padding: 6px 0; font-size: 14px; cursor: pointer; }
.ysub-check input { width: 16px; height: 16px; accent-color: var(--accent); align-self: center; }
.ysub-check small { flex-basis: 100%; padding-left: 26px; font-size: 12px; color: var(--text-dim); }
.ysub-check small:empty { display: none; }
.ysub-check:has(input:disabled) { color: var(--text-dim); cursor: default; }
.ysub-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; margin-top: 14px; }
.ysub-hint { margin: -4px 0 12px; font-size: 13px; line-height: 1.45; color: var(--text-dim); max-width: 60ch; }
.ysub-link { display: flex; gap: 8px; }
.ysub-link input { flex: 1; }
.ysub-status { display: flex; align-items: center; gap: 7px; margin: 10px 0 0; font-size: 13px; line-height: 1.45; color: var(--text-dim); }
.ysub-actions .ysub-status { margin: 0; }
.ysub-status:empty { display: none; }
.ysub-status svg { flex: none; }
.ysub-status.is-ok svg { color: var(--green, #2f9e5b); }
.ysub-status.is-bad { color: color-mix(in srgb, var(--red, #d64545) 78%, var(--text)); }
.ysub-status.is-busy svg { animation: ysub-spin .9s linear infinite; color: var(--accent); }
@keyframes ysub-spin { to { transform: rotate(360deg); } }
.ysub-more summary { cursor: pointer; font-size: 14px; font-weight: 600; list-style-position: outside; }
.ysub-more[open] summary { margin-bottom: 14px; }
@media (prefers-reduced-motion: reduce) { .ysub-status.is-busy svg { animation: none; } }
`;
  document.head.append(style);
}
