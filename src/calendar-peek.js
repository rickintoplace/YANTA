// ============================================================
// YANTA — a look at a subscribed entry
//
// Holidays and subscribed calendars are read-only, so the editor is the
// wrong place for them; a toast with the title was too little (a match
// in a schedule has a place, a description, a link). This shows what
// there is, and offers the one thing that makes sense: a copy in an own
// calendar, to change or get reminded of.
// ============================================================

import { state, escapeHtml, escapeAttr, lucide } from './core.js';
import { t, getLocale } from './i18n/index.js';
import { openBoundOverlay } from './overlay-history.js';

const PHONE = '(max-width: 640px)';
let peek = null;
let release = null;

function close() {
  if (!peek) return;
  const el = peek;
  peek = null;
  document.removeEventListener('keydown', onKey, true);
  release?.();
  release = null;
  el.classList.add('is-leaving');
  setTimeout(() => el.remove(), 140);
}

function onKey(e) {
  if (e.key === 'Escape' && e.isTrusted && peek) {
    e.stopPropagation();
    close();
  }
}

function dateLine(ev) {
  const locale = getLocale();
  const day = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  if (ev.allDay) {
    const start = new Date(`${String(ev.start).slice(0, 10)}T00:00:00`);
    // Generated all-day ends are exclusive.
    const endEx = ev.end ? new Date(`${String(ev.end).slice(0, 10)}T00:00:00`) : null;
    const last = endEx ? new Date(endEx.getTime() - 86400000) : null;
    if (!last || last <= start) return start.toLocaleDateString(locale, day);
    const short = { weekday: 'short', day: 'numeric', month: 'short' };
    const sameYear = start.getFullYear() === last.getFullYear();
    return `${start.toLocaleDateString(locale, sameYear ? short : { ...short, year: 'numeric' })} – ${last.toLocaleDateString(locale, { ...short, year: 'numeric' })}`;
  }
  const s = new Date(ev.start);
  const e = ev.end ? new Date(ev.end) : null;
  const time = { hour: '2-digit', minute: '2-digit' };
  return `${s.toLocaleDateString(locale, day)}, ${s.toLocaleTimeString(locale, time)}${e ? `–${e.toLocaleTimeString(locale, time)}` : ''}`;
}

function linkify(text) {
  return escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

/**
 * @param ev      the generated event (raw source event)
 * @param anchor  the element tapped, for the popover position
 * @param onCopy  (ev) => void — copies into an own calendar
 */
export function openCalendarPeek(ev, anchor, { onCopy } = {}) {
  close();
  ensureCss();
  const cat = state.calendarCategories.get(ev.categoryId);
  const phone = window.matchMedia(PHONE).matches;

  peek = document.createElement('div');
  peek.className = `ypk ${phone ? 'is-sheet' : 'is-popover'}`;
  peek.setAttribute('role', 'dialog');
  peek.setAttribute('aria-label', ev.title || '');
  peek.innerHTML = `
    ${phone ? '<div class="ypk-scrim" data-close></div>' : ''}
    <div class="ypk-surface">
      <div class="ypk-head">
        <h3>${escapeHtml(ev.title || '')}</h3>
        <button type="button" class="icon-btn" data-close aria-label="${escapeAttr(t('common.close'))}">${lucide('x', 16)}</button>
      </div>
      <p class="ypk-when">${escapeHtml(dateLine(ev))}</p>
      ${ev.location ? `<p class="ypk-line">${lucide('map-pin', 14)}<span>${escapeHtml(ev.location)}</span></p>` : ''}
      ${ev.description ? `<p class="ypk-desc">${linkify(ev.description.slice(0, 1200))}</p>` : ''}
      <p class="ypk-cal"><span class="ypk-dot" style="background:${escapeAttr(cat?.color || 'var(--accent)')}"></span>${escapeHtml(cat?.name || '')}</p>
      ${onCopy ? `<button type="button" class="ypk-link" data-copy>${lucide('calendar-plus', 14)}<span>${escapeHtml(t('peek.copy'))}</span></button>` : ''}
    </div>`;
  document.body.append(peek);

  if (!phone && anchor) {
    const r = anchor.getBoundingClientRect();
    const surface = peek.querySelector('.ypk-surface');
    const w = 320;
    const left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
    const below = r.bottom + 8;
    surface.style.left = `${Math.round(left)}px`;
    if (below + 260 > window.innerHeight) surface.style.bottom = `${Math.round(window.innerHeight - r.top + 8)}px`;
    else surface.style.top = `${Math.round(below)}px`;
    setTimeout(() => {
      document.addEventListener('pointerdown', function outside(e) {
        if (!peek) return document.removeEventListener('pointerdown', outside, true);
        if (peek.contains(e.target)) return;
        document.removeEventListener('pointerdown', outside, true);
        close();
      }, true);
    }, 0);
  }

  peek.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return close();
    if (e.target.closest('[data-copy]')) {
      close();
      onCopy?.(ev);
    }
  });
  document.addEventListener('keydown', onKey, true);
  release = openBoundOverlay('calendar-peek', { close, isOpen: () => !!peek });
}

function ensureCss() {
  if (document.getElementById('ypk-css')) return;
  const style = document.createElement('style');
  style.id = 'ypk-css';
  style.textContent = `
.ypk { position: fixed; inset: 0; z-index: 1300; pointer-events: none; }
.ypk.is-sheet { pointer-events: auto; }
.ypk-scrim { position: absolute; inset: 0; background: rgba(0,0,0,.32); }
.ypk-surface {
  pointer-events: auto; position: absolute; box-sizing: border-box;
  background: var(--bg-elev); color: var(--text);
  box-shadow: 0 18px 48px -12px rgba(0,0,0,.32), 0 2px 6px rgba(0,0,0,.06);
  padding: 14px 16px 16px 18px;
}
.ypk.is-popover .ypk-surface { width: 320px; border-radius: 14px; animation: ypk-pop .16s cubic-bezier(.16,1,.3,1); }
.ypk.is-sheet .ypk-surface { left: 0; right: 0; bottom: 0; border-radius: 16px 16px 0 0; padding-bottom: calc(18px + env(safe-area-inset-bottom)); animation: ypk-rise .24s cubic-bezier(.16,1,.3,1); }
.ypk.is-leaving .ypk-surface, .ypk.is-leaving .ypk-scrim { opacity: 0; transition: opacity .12s ease-in; }
@keyframes ypk-pop { from { opacity: 0; transform: translateY(-4px); } }
@keyframes ypk-rise { from { transform: translateY(24px); opacity: .5; } }
.ypk-head { display: flex; align-items: flex-start; gap: 8px; }
.ypk-head h3 { flex: 1; margin: 2px 0 0; font-size: 17px; font-weight: 650; line-height: 1.3; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.ypk-when { margin: 6px 0 0; font-size: 14px; }
.ypk-line { display: flex; align-items: center; gap: 7px; margin: 8px 0 0; font-size: 13px; color: var(--text-dim); }
.ypk-desc { margin: 10px 0 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 30vh; overflow: auto; color: var(--text-dim); }
.ypk-desc a { color: var(--accent); }
.ypk-cal { display: flex; align-items: center; gap: 7px; margin: 12px 0 0; font-size: 12px; color: var(--text-dim); }
.ypk-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.ypk-link { display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; padding: 4px 2px; border: 0; background: none; color: var(--accent); font: inherit; font-weight: 600; font-size: 13px; cursor: pointer; border-radius: 6px; }
.ypk-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.ypk-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .ypk * { animation: none !important; } }
`;
  document.head.append(style);
}
