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
import { openSurface } from './ui/surface.js';

let peek = null;

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
  peek?.close();
  const cat = state.calendarCategories.get(ev.categoryId);

  peek = openSurface({
    kind: 'popover',
    title: ev.title || '',
    anchor,
    width: 320,
    className: 'ypk',
    historyId: 'calendar-peek',
    onClose: () => { peek = null; },
  });

  peek.body.innerHTML = `
    <p class="ypk-when">${escapeHtml(dateLine(ev))}</p>
    ${ev.location ? `<p class="ypk-line">${lucide('map-pin', 14)}<span>${escapeHtml(ev.location)}</span></p>` : ''}
    ${ev.description ? `<p class="ypk-desc">${linkify(ev.description.slice(0, 1200))}</p>` : ''}
    <p class="ypk-cal"><span class="ypk-dot" style="background:${escapeAttr(cat?.color || 'var(--accent)')}"></span>${escapeHtml(cat?.name || '')}${cat?.spaceId && !cat?.source ? ` · ${escapeHtml(t('peek.viewOnly'))}` : ''}</p>
    ${onCopy ? `<button type="button" class="ys-link ypk-copy" data-copy>${lucide('calendar-plus', 14)}<span>${escapeHtml(t('peek.copy'))}</span></button>` : ''}`;

  peek.body.addEventListener('click', (e) => {
    if (!e.target.closest('[data-copy]')) return;
    // The editor opens once the peek's history entry is gone.
    peek?.closeThen(() => onCopy?.(ev));
  });
}
