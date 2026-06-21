import qrcode from 'qrcode-generator';

import {
  openDB,
  escapeHtml,
  escapeAttr,
  lucide,
  uid,
  downloadBlob,
  safeFilename,
} from '../core.js';

import {
  loadAppearance,
  watchSystemTheme,
  cycleAppearanceMode,
  resolveEffectiveMode,
  getAppearance,
  saveAppearance,
} from '../settings.js';

import {
  eventsToIcs,
} from '../calendar-ics.js';

import {
  yantaAlert,
} from '../dialogs.js';

const PENDING_YANTA_EVENT_KEY = 'yanta.publicShare.pendingCalendarEvent.v1';

let shareModal = null;
let outsideMenuBound = false;

let themeDropdownEl = null;
let themeDropdownTimeout = null;
let themeEventsBound = false;

function safeGetAppearanceMode() {
  try {
    const app = getAppearance();
    return app.mode || 'auto';
  } catch {
    return 'auto';
  }
}

async function safeSetAppearanceMode(mode) {
  try {
    await saveAppearance({ mode });
  } catch (err) {
    console.warn('[YANTA Public Share] could not save appearance via settings', err);
  }
  updatePublicShareThemeButtons(document);
}

function injectEnhancementCss() {
  if (document.getElementById('yanta-public-share-enhancements-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-public-share-enhancements-css';
  style.textContent = `
.yps-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(0,0,0,0.54);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.yps-modal-backdrop[hidden] {
  display: none !important;
}

.yps-modal-card {
  width: min(460px, 94vw);
  max-height: min(86vh, 720px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--bg-elev);
  color: var(--text);
  box-shadow: 0 28px 90px rgba(0,0,0,0.48);
}

.yps-modal-head {
  min-height: 52px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev-2);
}

.yps-modal-head h3 {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 15px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.yps-modal-body {
  padding: 15px;
  overflow: auto;
}

.yps-share-qr-box {
  display: flex;
  justify-content: center;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: white;
  margin-bottom: 12px;
}

.yps-share-link-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.yps-share-link-row input {
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text);
  background: var(--bg);
  font: 12px var(--font-mono);
}

.yps-btn.is-copied,
.yps-icon-btn.is-copied {
  color: white;
  background: var(--green);
  border-color: var(--green);
}

.yps-btn.is-copied svg,
.yps-icon-btn.is-copied svg {
  animation: yps-copy-check-pop 360ms cubic-bezier(.2,.8,.2,1);
}

@keyframes yps-copy-check-pop {
  0% {
    transform: scale(0.62) rotate(-18deg);
    opacity: 0;
  }
  55% {
    transform: scale(1.18) rotate(4deg);
    opacity: 1;
  }
  100% {
    transform: scale(1) rotate(0);
    opacity: 1;
  }
}

.yps-calendar-section {
  margin: 22px 0 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.yps-calendar-section-head {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 8px;
  color: var(--text);
}

.yps-calendar-section-head h2 {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.yps-calendar-section-head svg {
  flex: 0 0 auto;
  color: var(--accent);
}

.yps-event-card {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 15px;
  background: var(--bg-elev);
  overflow: visible;
}

.yps-event-card-head {
  padding: 13px 14px;
  display: flex;
  align-items: center;
  gap: 11px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev-2);
  border-top-left-radius: 15px;
  border-top-right-radius: 15px;
}

.yps-event-card-icon {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.yps-event-card-title {
  flex: 1;
  min-width: 0;
}

.yps-event-card-title strong {
  display: block;
  color: var(--text);
  font-size: 14px;
  line-height: 1.25;
}

.yps-event-card-title small {
  display: block;
  margin-top: 3px;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.35;
}

.yps-event-card-body {
  padding: 13px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.yps-event-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.45;
}

.yps-event-meta-row {
  display: flex;
  align-items: flex-start;
  gap: 7px;
}

.yps-event-meta-row svg {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--accent);
}

.yps-event-description {
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.yps-event-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  gap: 7px;
  align-items: center;
}

.yps-event-actions .yps-btn {
  min-width: 0;
  white-space: nowrap;
}

.yps-event-more-wrap {
  position: relative;
  display: inline-flex;
  justify-content: flex-end;
}

.yps-event-more-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 40;
  min-width: 190px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--bg-elev-3);
  color: var(--text);
  box-shadow: 0 16px 48px rgba(0,0,0,0.28);
}

.yps-event-more-menu[hidden] {
  display: none !important;
}

.yps-event-more-menu a {
  width: 100%;
  min-height: 35px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  text-align: left;
  text-decoration: none;
  font-size: 13px;
  cursor: pointer;
}

.yps-event-more-menu a:hover {
  background: var(--bg-elev-2);
}

.yps-theme-menu {
  position: fixed;
  z-index: 300;
  min-width: 150px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev-3);
  color: var(--text);
  box-shadow: 0 10px 30px rgba(0,0,0,0.3);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.yps-theme-menu[hidden] {
  display: none !important;
}

.yps-theme-menu-item {
  width: 100%;
  min-height: 36px;
  padding: 6px 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-family: var(--font);
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease;
}

.yps-theme-menu-item:hover {
  background: var(--bg-elev-2);
}

.yps-theme-menu-item.is-active {
  color: var(--accent);
  font-weight: 600;
}

.yps-theme-menu-item .radio-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 2px solid var(--text-faint);
  display: inline-block;
  flex-shrink: 0;
}

.yps-theme-menu-item.is-active .radio-dot {
  border-color: var(--accent);
  background: var(--accent);
}

@media (max-width: 680px) {
  .yps-share-link-row {
    grid-template-columns: 1fr;
  }

  .yps-event-actions {
    grid-template-columns: 1fr;
  }

  .yps-event-more-wrap {
    justify-content: stretch;
  }

  .yps-event-more-wrap > .yps-icon-btn {
    width: 100%;
  }

  .yps-event-more-menu {
    left: 0;
    right: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .yps-btn.is-copied svg,
  .yps-icon-btn.is-copied svg {
    animation: none !important;
  }
}
  `;

  document.head.append(style);
}

export async function setupPublicShareAppearance() {
  /*
    Reuse the normal YANTA appearance stack.
    No duplicated public-share theme state.
  */
  try {
    await openDB();
  } catch {}

  try {
    await loadAppearance();
    watchSystemTheme();
  } catch (err) {
    console.warn('[YANTA Public Share] appearance load failed', err);
  }

  updatePublicShareThemeButtons(document);
}

export function updatePublicShareThemeButtons(root = document) {
  const mode = resolveEffectiveMode();
  const configMode = safeGetAppearanceMode();

  document.documentElement.setAttribute('data-public-share-theme', mode);

  let icon = 'laptop';
  let label = 'System theme';
  if (configMode === 'light') {
    icon = 'sun';
    label = 'Light theme';
  } else if (configMode === 'dark') {
    icon = 'moon';
    label = 'Dark theme';
  }

  root.querySelectorAll('[data-yps-theme-toggle]').forEach((btn) => {
    const visibleLabel = btn.querySelector('[data-yps-theme-label]');

    btn.title = `Theme: ${label}`;
    btn.setAttribute('aria-label', `Theme: ${label}`);

    if (visibleLabel) {
      btn.innerHTML = `${lucide(icon, 15)} <span data-yps-theme-label>${label}</span>`;
    } else {
      btn.innerHTML = lucide(icon, 16);
    }
  });
}

export async function togglePublicShareAppearance() {
  await cycleAppearanceMode();
  updatePublicShareThemeButtons(document);
}

function ensureThemeDropdown() {
  injectEnhancementCss();
  if (themeDropdownEl) return themeDropdownEl;

  themeDropdownEl = document.createElement('div');
  themeDropdownEl.className = 'yps-theme-menu';
  themeDropdownEl.hidden = true;

  themeDropdownEl.addEventListener('mouseenter', () => {
    clearTimeout(themeDropdownTimeout);
  });

  themeDropdownEl.addEventListener('mouseleave', () => {
    hideThemeDropdownWithDelay();
  });

  document.body.appendChild(themeDropdownEl);
  return themeDropdownEl;
}

function hideThemeDropdownWithDelay() {
  clearTimeout(themeDropdownTimeout);
  themeDropdownTimeout = setTimeout(() => {
    if (themeDropdownEl) themeDropdownEl.hidden = true;
  }, 300);
}

function hideThemeDropdownImmediately() {
  clearTimeout(themeDropdownTimeout);
  if (themeDropdownEl) themeDropdownEl.hidden = true;
}

export function showThemeDropdown(buttonEl) {
  const menu = ensureThemeDropdown();
  clearTimeout(themeDropdownTimeout);

  const currentMode = safeGetAppearanceMode();

  const options = [
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
    { value: 'auto', label: 'System', icon: 'laptop' },
  ];

  menu.innerHTML = options.map((opt) => {
    const isActive = currentMode === opt.value;
    return `
      <button type="button" class="yps-theme-menu-item ${isActive ? 'is-active' : ''}" data-yps-theme-set="${opt.value}">
        <span class="radio-dot"></span>
        ${lucide(opt.icon, 14)}
        <span>${opt.label}</span>
      </button>
    `;
  }).join('');

  menu.querySelectorAll('[data-yps-theme-set]').forEach((item) => {
    item.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const newMode = item.dataset.ypsThemeSet;
      await safeSetAppearanceMode(newMode);
      hideThemeDropdownImmediately();
    });
  });

  const rect = buttonEl.getBoundingClientRect();
  menu.hidden = false;

  const menuWidth = 150;
  let left = rect.right - menuWidth;
  if (left < 10) left = rect.left;

  let top = rect.bottom + window.scrollY + 6;
  if (top + 120 > window.innerHeight + window.scrollY) {
    top = rect.top + window.scrollY - menu.offsetHeight - 6;
  }

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

export function toggleThemeDropdown(buttonEl) {
  const menu = ensureThemeDropdown();
  if (!menu.hidden && menu.triggerBtn === buttonEl) {
    hideThemeDropdownImmediately();
  } else {
    showThemeDropdown(buttonEl);
    menu.triggerBtn = buttonEl;
  }
}

function bindGlobalThemeEvents() {
  if (themeEventsBound) return;
  themeEventsBound = true;

  document.addEventListener('pointerdown', (e) => {
    if (!themeDropdownEl || themeDropdownEl.hidden) return;
    if (themeDropdownEl.contains(e.target)) return;
    if (e.target.closest?.('[data-yps-theme-toggle]')) return;
    hideThemeDropdownImmediately();
  }, true);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideThemeDropdownImmediately();
    }
  });
}

export function bindThemeToggleEvents(root = document) {
  bindGlobalThemeEvents();

  root.querySelectorAll('[data-yps-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleThemeDropdown(btn);
    });

    btn.addEventListener('mouseenter', () => {
      showThemeDropdown(btn);
      if (themeDropdownEl) {
        themeDropdownEl.triggerBtn = btn;
      }
    });

    btn.addEventListener('mouseleave', () => {
      hideThemeDropdownWithDelay();
    });
  });
}

function renderQrSvg(text, size = 224) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const n = qr.getModuleCount();
  const ns = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', n);
  bg.setAttribute('height', n);
  bg.setAttribute('fill', 'white');
  svg.append(bg);

  let path = '';

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.isDark(y, x)) {
        path += `M${x} ${y}h1v1h-1z`;
      }
    }
  }

  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'black');
  svg.append(p);

  return svg;
}

function ensureShareFallbackModal() {
  injectEnhancementCss();

  if (shareModal) return shareModal;

  shareModal = document.createElement('div');
  shareModal.className = 'yps-modal-backdrop';
  shareModal.hidden = true;

  shareModal.addEventListener('click', (e) => {
    if (e.target === shareModal) closeShareFallbackModal();
    if (e.target.closest?.('[data-yps-share-fallback-close]')) {
      closeShareFallbackModal();
    }
  });

  document.body.append(shareModal);

  return shareModal;
}

function closeShareFallbackModal() {
  if (shareModal) shareModal.hidden = true;
}

function setButtonCopied(btn, {
  copiedLabel = 'Copied',
  duration = 1300,
} = {}) {
  if (!btn) return;

  const originalHtml = btn.dataset.ypsOriginalHtml || btn.innerHTML;
  btn.dataset.ypsOriginalHtml = originalHtml;

  const rect = btn.getBoundingClientRect();
  const previousMinWidth = btn.style.minWidth;

  if (rect.width > 0) {
    btn.style.minWidth = `${Math.ceil(rect.width)}px`;
  }

  btn.classList.add('is-copied');
  btn.disabled = true;
  btn.innerHTML = `${lucide('check', 14)} <span>${escapeHtml(copiedLabel)}</span>`;

  clearTimeout(btn._ypsCopiedTimer);

  btn._ypsCopiedTimer = window.setTimeout(() => {
    btn.classList.remove('is-copied');
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    btn.style.minWidth = previousMinWidth;
  }, duration);
}

async function copyTextWithButtonFeedback(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    setButtonCopied(btn);
    return true;
  } catch (err) {
    console.warn('[YANTA Public Share] copy failed', err);

    await yantaAlert({
      title: 'Copy failed',
      message: text,
      icon: 'copy',
      confirmLabel: 'Close',
    });

    return false;
  }
}

export async function openShareFallbackModal({
  url = location.href,
  title = 'YANTA Public Share',
} = {}) {
  const modal = ensureShareFallbackModal();

  modal.innerHTML = `
    <div class="yps-modal-card">
      <header class="yps-modal-head">
        <h3>${escapeHtml(title || 'Share')}</h3>
        <button class="yps-icon-btn" type="button" data-yps-share-fallback-close title="Close">
          ${lucide('x', 16)}
        </button>
      </header>

      <div class="yps-modal-body">
        <div class="yps-share-qr-box" data-yps-share-qr></div>

        <div class="yps-share-link-row">
          <input readonly value="${escapeAttr(url)}" data-yps-share-link />
          <button class="yps-btn primary" type="button" data-yps-copy-share-link>
            ${lucide('copy', 14)}
            <span>Copy link</span>
          </button>
        </div>
      </div>
    </div>
  `;

  modal.querySelector('[data-yps-share-qr]')?.append(renderQrSvg(url, 224));

  modal.querySelector('[data-yps-copy-share-link]')?.addEventListener('click', async (e) => {
    await copyTextWithButtonFeedback(url, e.currentTarget);
  });

  modal.hidden = false;
}

export async function sharePublicPage({
  url = location.href,
  title = 'YANTA Public Share',
  text = title,
} = {}) {
  if (navigator.share) {
    try {
      await navigator.share({
        title,
        text,
        url,
      });

      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.warn('[YANTA Public Share] native share failed, showing fallback', err);
    }
  }

  await openShareFallbackModal({
    url,
  });
}

function toDate(value) {
  if (!value) return null;

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(y, m - 1, d, 0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function localDateKey(value) {
  const d = toDate(value);
  if (!d) return '';

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysKey(dateKey, days) {
  const d = toDate(dateKey);
  if (!d) return dateKey;

  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

function formatEventDateTime(value, allDay = false) {
  const d = toDate(value);
  if (!d) return '';

  if (allDay) {
    return d.toLocaleDateString([], {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  return d.toLocaleString([], {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatEventRange(ev = {}) {
  if (!ev.start) return '';

  const start = formatEventDateTime(ev.start, !!ev.allDay);

  if (!ev.end) return start;

  const sameDay = localDateKey(ev.start) === localDateKey(ev.end);

  if (!ev.allDay && sameDay) {
    const end = toDate(ev.end);
    return `${start} – ${end.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }

  return `${start} – ${formatEventDateTime(ev.end, !!ev.allDay)}`;
}

function externalDateUtc(value) {
  const d = toDate(value);
  if (!d) return '';

  return d.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function externalDateAllDay(value) {
  return localDateKey(value).replace(/-/g, '');
}

function providerDates(ev = {}) {
  if (ev.allDay) {
    const start = externalDateAllDay(ev.start);
    const end = externalDateAllDay(ev.end || addDaysKey(localDateKey(ev.start), 1));

    return {
      google: `${start}/${end}`,
      yahooStart: start,
      yahooEnd: end,
      outlookStart: localDateKey(ev.start),
      outlookEnd: localDateKey(ev.end || addDaysKey(localDateKey(ev.start), 1)),
    };
  }

  const start = externalDateUtc(ev.start);
  const end = externalDateUtc(
    ev.end ||
      new Date((toDate(ev.start)?.getTime() || Date.now()) + 60 * 60 * 1000)
  );

  return {
    google: `${start}/${end}`,
    yahooStart: start,
    yahooEnd: end,
    outlookStart: toDate(ev.start)?.toISOString() || '',
    outlookEnd: toDate(ev.end)?.toISOString() || new Date((toDate(ev.start)?.getTime() || Date.now()) + 60 * 60 * 1000).toISOString(),
  };
}

function eventUrlParams(ev = {}) {
  const title = ev.title || 'Untitled event';
  const details = ev.description || '';
  const location = ev.location || '';

  return {
    title,
    details,
    location,
    dates: providerDates(ev),
  };
}

function googleCalendarUrl(ev) {
  const p = eventUrlParams(ev);
  const url = new URL('https://calendar.google.com/calendar/render');

  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', p.title);
  url.searchParams.set('dates', p.dates.google);
  if (p.details) url.searchParams.set('details', p.details);
  if (p.location) url.searchParams.set('location', p.location);

  return url.href;
}

function outlookCalendarUrl(ev, host = 'https://outlook.live.com') {
  const p = eventUrlParams(ev);
  const url = new URL(`${host}/calendar/0/deeplink/compose`);

  url.searchParams.set('path', '/calendar/action/compose');
  url.searchParams.set('rru', 'addevent');
  url.searchParams.set('subject', p.title);
  url.searchParams.set('startdt', p.dates.outlookStart);
  url.searchParams.set('enddt', p.dates.outlookEnd);
  if (p.details) url.searchParams.set('body', p.details);
  if (p.location) url.searchParams.set('location', p.location);

  return url.href;
}

function yahooCalendarUrl(ev) {
  const p = eventUrlParams(ev);
  const url = new URL('https://calendar.yahoo.com/');

  url.searchParams.set('v', '60');
  url.searchParams.set('title', p.title);
  url.searchParams.set('st', p.dates.yahooStart);
  url.searchParams.set('et', p.dates.yahooEnd);
  if (p.details) url.searchParams.set('desc', p.details);
  if (p.location) url.searchParams.set('in_loc', p.location);

  return url.href;
}

function normalizePublicEvent(raw = {}) {
  return {
    id: String(raw.id || raw.externalUid || uid()),
    title: String(raw.title || raw.summary || 'Untitled event'),
    start: raw.start || '',
    end: raw.end || null,
    allDay: !!raw.allDay,
    location: raw.location || '',
    description: raw.description || '',
    status: raw.status || 'confirmed',
    categoryId: raw.categoryId || undefined,
    color: raw.color || undefined,
    icon: raw.icon || undefined,
    recurrence: raw.recurrence || null,
    reminders: Array.isArray(raw.reminders) ? raw.reminders : [],
    externalUid: raw.externalUid || raw.id || '',
    source: raw.source || null,
    markdownDerived: raw.markdownDerived === true,
    linkedToSharedNote: raw.linkedToSharedNote === true,
    mentionedInSharedNote: raw.mentionedInSharedNote === true,
  };
}

export function publicShareCalendarEvents(payload = {}) {
  const list =
    Array.isArray(payload.calendar?.events)
      ? payload.calendar.events
      : Array.isArray(payload.events)
        ? payload.events
        : [];

  const seen = new Set();
  const out = [];

  for (const raw of list) {
    const ev = normalizePublicEvent(raw);
    const key = ev.id || `${ev.title}|${ev.start}|${ev.end || ''}`;

    if (!ev.start || seen.has(key)) continue;

    seen.add(key);
    out.push(ev);
  }

  return out;
}

function eventIcsBlob(ev) {
  const ics = eventsToIcs([ev], {
    calendarName: 'YANTA Shared Event',
  });

  return new Blob([ics], {
    type: 'text/calendar;charset=utf-8',
  });
}

function downloadEventIcs(ev) {
  downloadBlob(
    eventIcsBlob(ev),
    safeFilename(`${ev.title || 'event'}.ics`)
  );
}

function publicEventForYantaCalendar(raw = {}) {
  const ev = normalizePublicEvent(raw);

  return {
    id: 'evt_' + uid(),
    title: ev.title || 'Untitled event',
    start: ev.start,
    end: ev.end || null,
    allDay: !!ev.allDay,
    categoryId: ev.categoryId || 'cal_default',
    color: ev.color || undefined,
    icon: ev.icon || undefined,
    location: ev.location || '',
    description: ev.description || '',
    status: ev.status || 'confirmed',
    recurrence: ev.recurrence || null,
    reminders: Array.isArray(ev.reminders) ? ev.reminders : [],
    externalUid: ev.externalUid || ev.id || '',
    noteId: null,
    relatedNoteIds: [],
    tags: [],
    created: Date.now(),
    updated: Date.now(),
  };
}

async function addEventToYantaCalendar(raw) {
  const ev = publicEventForYantaCalendar(raw);

  await openDB();

  const calendar = await import('../calendar.js');

  calendar.hydrateCalendarStateFromVault?.({
    silent: true,
  });

  const saved = calendar.putCalendarEvent?.(ev);

  await yantaAlert({
    title: saved ? 'Added to YANTA Calendar' : 'Could not add event',
    message: saved
      ? `"${ev.title}" was saved to your local YANTA Calendar.`
      : 'The event could not be saved.',
    icon: saved ? 'calendar-check' : 'triangle-alert',
    confirmLabel: 'Done',
  });

  return saved;
}

function editAndAddEventToYantaCalendar(raw) {
  const ev = publicEventForYantaCalendar(raw);

  try {
    sessionStorage.setItem(PENDING_YANTA_EVENT_KEY, JSON.stringify(ev));
  } catch {}

  location.assign(`${location.origin}/#calendar`);
}

export function pendingPublicShareCalendarEventKey() {
  return PENDING_YANTA_EVENT_KEY;
}

export function renderPublicShareCalendarSectionHtml(payload = {}) {
  const events = publicShareCalendarEvents(payload);

  if (!events.length) return '';

  return `
    <section class="yps-calendar-section" data-yps-calendar-section>
      <header class="yps-calendar-section-head">
        ${lucide('calendar-days', 18)}
        <h2>Calendar event${events.length === 1 ? '' : 's'}</h2>
      </header>

      ${events.map((ev, index) => {
        const when = formatEventRange(ev);
        const kind =
          ev.linkedToSharedNote
            ? 'Linked to this note'
            : ev.markdownDerived
              ? 'Mentioned as calendar link'
              : ev.mentionedInSharedNote
                ? 'Mentioned in this note'
                : 'Shared with this note';

        return `
          <article class="yps-event-card" data-yps-event-index="${index}">
            <header class="yps-event-card-head">
              <span class="yps-event-card-icon">
                ${lucide(ev.icon || 'calendar-clock', 17)}
              </span>

              <span class="yps-event-card-title">
                <strong>${escapeHtml(ev.title || 'Untitled event')}</strong>
                <small>${escapeHtml(kind)}</small>
              </span>
            </header>

            <div class="yps-event-card-body">
              <div class="yps-event-meta">
                ${when ? `
                  <div class="yps-event-meta-row">
                    ${lucide('clock', 14)}
                    <span>${escapeHtml(when)}</span>
                  </div>
                ` : ''}

                ${ev.location ? `
                  <div class="yps-event-meta-row">
                    ${lucide('map-pin', 14)}
                    <span>${escapeHtml(ev.location)}</span>
                  </div>
                ` : ''}
              </div>

              ${ev.description ? `
                <div class="yps-event-description">${escapeHtml(ev.description)}</div>
              ` : ''}

              <div class="yps-event-actions">
                <button class="yps-btn primary" type="button" data-yps-event-action="add-yanta">
                  ${lucide('calendar-plus', 14)}
                  <span>Add to YANTA Calendar</span>
                </button>

                <button class="yps-btn" type="button" data-yps-event-action="edit-yanta">
                  ${lucide('pencil', 14)}
                  <span>Edit and add</span>
                </button>

                <button class="yps-btn" type="button" data-yps-event-action="download-ics">
                  ${lucide('download', 14)}
                  <span>Download .ics</span>
                </button>

                <span class="yps-event-more-wrap">
                  <button class="yps-icon-btn" type="button" data-yps-event-more title="More calendar options" aria-label="More calendar options">
                    ${lucide('ellipsis', 17)}
                  </button>

                  <span class="yps-event-more-menu" data-yps-event-more-menu hidden>
                    <a href="${escapeAttr(googleCalendarUrl(ev))}" target="_blank" rel="noopener noreferrer">
                      ${lucide('calendar-plus', 13)}
                      <span>Google Calendar</span>
                    </a>

                    <a href="${escapeAttr(outlookCalendarUrl(ev, 'https://outlook.live.com'))}" target="_blank" rel="noopener noreferrer">
                      ${lucide('calendar-plus', 13)}
                      <span>Outlook</span>
                    </a>

                    <a href="${escapeAttr(outlookCalendarUrl(ev, 'https://outlook.office.com'))}" target="_blank" rel="noopener noreferrer">
                      ${lucide('calendar-plus', 13)}
                      <span>Office 365</span>
                    </a>

                    <a href="${escapeAttr(yahooCalendarUrl(ev))}" target="_blank" rel="noopener noreferrer">
                      ${lucide('calendar-plus', 13)}
                      <span>Yahoo</span>
                    </a>
                  </span>
                </span>
              </div>
            </div>
          </article>
        `;
      }).join('')}
    </section>
  `;
}

function closeAllEventMoreMenus(root = document, except = null) {
  root.querySelectorAll('[data-yps-event-more-menu]').forEach((menu) => {
    if (menu !== except) menu.hidden = true;
  });
}

export function bindPublicShareCalendarActions(root = document, payload = {}) {
  injectEnhancementCss();

  const events = publicShareCalendarEvents(payload);

  root.querySelectorAll('[data-yps-event-index]').forEach((card) => {
    const index = Number(card.dataset.ypsEventIndex || -1);
    const ev = events[index];

    if (!ev) return;

    const moreBtn = card.querySelector('[data-yps-event-more]');
    const moreMenu = card.querySelector('[data-yps-event-more-menu]');

    moreBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const nextHidden = !moreMenu.hidden;
      closeAllEventMoreMenus(document, moreMenu);
      moreMenu.hidden = nextHidden;
    });

    card.querySelectorAll('[data-yps-event-action]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const action = btn.dataset.ypsEventAction;

        if (action === 'download-ics') {
          downloadEventIcs(ev);
          return;
        }

        if (action === 'add-yanta') {
          await addEventToYantaCalendar(ev);
          return;
        }

        if (action === 'edit-yanta') {
          editAndAddEventToYantaCalendar(ev);
        }
      });
    });
  });

  if (!outsideMenuBound) {
    outsideMenuBound = true;

    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest?.('[data-yps-event-more], [data-yps-event-more-menu]')) {
        return;
      }

      closeAllEventMoreMenus(document);
    }, true);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeAllEventMoreMenus(document);
      }
    });
  }
}