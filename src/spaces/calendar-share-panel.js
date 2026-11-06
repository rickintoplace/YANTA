// ============================================================
// YANTA — shared calendars at a glance
//
// Anchored to the people button in the calendar toolbar: a popover on
// wide screens, a sheet from the bottom on phones. Per shared calendar
// it answers three questions in reading order — is it working, who is
// in it, what did they change — and offers the two actions that matter:
// sync now, and (for the owner) send the link again.
//
// "Is it working" is stated honestly; a share that silently drops
// entries is the worst thing it can do. "Sync now" reports in place,
// on the line it acts on, never by a toast behind the panel.
// ============================================================

import { state, escapeHtml, escapeAttr, lucide, toast } from '../core.js';
import { t, getLocale } from '../i18n/index.js';
import { openBoundOverlay } from '../overlay-history.js';
import { calendarBridges } from './calendar-registry.js';
import { calendarFeedFor, markCalendarFeedSeen } from './calendar-feed.js';
import { spaceParticipants } from './space-people.js';

const PHONE = '(max-width: 640px)';

let panel = null;
let releaseOverlay = null;

function relative(ts) {
  if (!ts) return '';
  const diff = (ts - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

function initials(name) {
  const parts = String(name || '?').trim().split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

// Hue per person, stable across renders.
function hueFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** idle | busy | done | error — per space, while the panel is open. */
const syncUi = new Map();

function statusHtml(bridge, session, count) {
  const engine = session?.engine;
  const ui = syncUi.get(bridge.spaceId) || { state: 'idle' };
  const action = (label) => `<button type="button" class="ycs-link" data-sync>${escapeHtml(label)}</button>`;
  const line = (tone, icon, text, extra = '') =>
    `<p class="ycs-status is-${tone}" aria-live="polite">${lucide(icon, 14)}<span>${escapeHtml(text)}</span>${extra}</p>`;

  if (ui.state === 'busy') return line('busy', 'loader-circle', t('calendarShare.syncing'));
  if (ui.state === 'error') return line('bad', 'circle-alert', ui.message, action(t('calendarShare.tryAgain')));
  if (!engine) return line('warn', 'circle-alert', t('calendarShare.notConnected'));

  if (engine.hasUnsent?.()) {
    const status = Number(engine.lastUploadError?.status || 0);
    return line('bad', 'circle-alert', status === 401 || status === 403 ? t('calendarShare.refused') : t('calendarShare.unsent'), action(t('calendarShare.sendNow')));
  }

  if (engine.lastPullError) return line('warn', 'wifi-off', t('calendarShare.offline'), action(t('calendarShare.tryAgain')));

  const when = engine.lastPullAt || session.lastPullAt;
  const text = ui.state === 'done'
    ? t('calendarShare.syncedNow', { count })
    : t('calendarShare.upToDate', { count, when: when ? relative(when) : '—' });

  return line('ok', 'check', text, action(t('calendarShare.syncNow')));
}

async function sectionHtml(bridge) {
  const session = state.spaces.get(bridge.spaceId);
  const cat = state.calendarCategories.get(bridge.categoryId);
  const name = cat?.name || session?.record?.title || t('calendarShare.untitled');
  const color = cat?.color || 'var(--accent)';
  const [people, feed] = await Promise.all([spaceParticipants(bridge.spaceId), calendarFeedFor(bridge.spaceId)]);
  const names = new Map(people.flatMap((p) => p.ids.map((id) => [id, p.name])));
  const count = bridge.events().length;
  const role = (r) => t(`calendarShare.role.${r}`);

  const peopleHtml = people.map((p) => `
    <li class="ycs-person">
      <span class="ycs-avatar" style="--h:${hueFor(p.id)}" aria-hidden="true">${escapeHtml(initials(p.name))}</span>
      <span class="ycs-person-name">${escapeHtml(p.isMe ? t('calendarShare.you', { name: p.name }) : p.name)}</span>
      <span class="ycs-person-meta">${escapeHtml(role(p.role))}${!p.isMe && p.lastActive ? ` · ${escapeHtml(relative(p.lastActive))}` : ''}</span>
    </li>`).join('');

  const changes = [...feed.entries].reverse().slice(0, 5);
  const changesHtml = changes.length
    ? `<ul class="ycs-changes">${changes.map((e) => `
        <li class="${e.ts > feed.lastSeenAt ? 'is-new' : ''}">
          <button type="button" data-event="${escapeAttr(e.action !== 'removed' ? e.eventId || '' : '')}">
            <span>${escapeHtml(t(`calendarShare.change.${e.action === 'added' ? 'added' : e.action === 'removed' ? 'removed' : 'changed'}`, {
              who: names.get(e.actor) || e.actor || t('calendarShare.someone'),
              title: e.title || t('calendarShare.untitledEvent'),
            }))}</span>
            <time>${escapeHtml(relative(e.ts))}</time>
          </button>
        </li>`).join('')}</ul>`
    : `<p class="ycs-quiet">${escapeHtml(t('calendarShare.noChanges'))}</p>`;

  const ownerAction = bridge.isOwner
    ? `<button type="button" class="ycs-link" data-copy-link>${lucide('link', 14)}<span>${escapeHtml(t('calendarShare.copyLink'))}</span></button>`
    : '';

  return `
    <section class="ycs-calendar" data-space="${escapeAttr(bridge.spaceId)}">
      <div class="ycs-calendar-head">
        <span class="ycs-dot" style="background:${escapeAttr(color)}" aria-hidden="true"></span>
        <h3>${escapeHtml(name)}</h3>
        <span class="ycs-role">${escapeHtml(role(bridge.role))}</span>
      </div>
      ${statusHtml(bridge, session, count)}
      <ul class="ycs-people" aria-label="${escapeAttr(t('calendarShare.people'))}">${peopleHtml}</ul>
      ${ownerAction}
      <h4>${escapeHtml(t('calendarShare.recent'))}</h4>
      ${changesHtml}
    </section>`;
}

async function brokenHtml() {
  try {
    const health = await import('./space-health.js');
    return health.brokenShares()
      .filter((b) => b.sourceType === 'calendar')
      .map((b) => `
        <section class="ycs-calendar">
          <div class="ycs-calendar-head"><span class="ycs-dot is-broken" aria-hidden="true"></span><h3>${escapeHtml(b.name || t('calendarShare.untitled'))}</h3></div>
          <p class="ycs-status is-bad">${lucide('circle-alert', 14)}<span>${escapeHtml(t('calendarShare.broken'))}</span></p>
        </section>`).join('');
  } catch {
    return '';
  }
}

async function render() {
  if (!panel) return;
  const body = panel.querySelector('.ycs-body');
  const sections = await Promise.all(calendarBridges().map(sectionHtml));
  const html = sections.join('') + await brokenHtml();
  if (!panel) return;

  body.innerHTML = html || `
    <div class="ycs-empty">
      <p>${escapeHtml(t('calendarShare.emptyTitle'))}</p>
      <p class="ycs-quiet">${escapeHtml(t('calendarShare.emptyHint'))}</p>
    </div>`;
}

function onKey(e) {
  if (e.key === 'Escape' && e.isTrusted) {
    e.preventDefault();
    e.stopPropagation();
    close();
  }
}

function close({ fromHistory = false } = {}) {
  if (!panel) return;
  const el = panel;
  panel = null;
  el.classList.add('is-leaving');
  setTimeout(() => el.remove(), 160);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('yanta-calendar-feed-updated', render);
  window.removeEventListener('yanta-space-changed', render);
  const release = releaseOverlay;
  releaseOverlay = null;
  if (!fromHistory) release?.();
  Promise.all(calendarBridges().map((b) => markCalendarFeedSeen(b.spaceId).catch(() => {})))
    .then(() => window.dispatchEvent(new CustomEvent('yanta-calendar-feed-updated', { detail: {} })));
}

async function syncSpace(spaceId) {
  const engine = state.spaces.get(spaceId)?.engine;
  if (!engine) return;

  syncUi.set(spaceId, { state: 'busy' });
  await render();

  const started = Date.now();
  try {
    await engine.syncNow();
    syncUi.set(spaceId, { state: 'done' });
  } catch (err) {
    const status = Number(err?.status || 0);
    syncUi.set(spaceId, {
      state: 'error',
      message: status === 401 || status === 403 ? t('calendarShare.refused') : t('calendarShare.failed', { reason: err?.message || String(err) }),
    });
  }

  // Long enough to be seen: a sync that "does nothing" is a sync nobody trusts.
  await new Promise((r) => setTimeout(r, Math.max(0, 450 - (Date.now() - started))));
  window.dispatchEvent(new CustomEvent('yanta-calendar-space-applied', { detail: { spaceId } }));
  await render();
}

async function copyLink(spaceId) {
  const { spaceLinksFor } = await import('./space-session.js');
  const session = state.spaces.get(spaceId);
  const link = session && spaceLinksFor(session).write;
  if (!link) return;

  try {
    await navigator.clipboard.writeText(link);
    toast(t('calendarShare.linkCopied'), 'success');
  } catch {
    window.prompt(t('calendarShare.copyLink'), link);
  }
}

/** Opens (or closes) the panel at the toolbar button. */
export async function openCalendarSharePanel(anchor) {
  if (panel) {
    close();
    return;
  }

  ensureCss();
  syncUi.clear();

  const phone = window.matchMedia(PHONE).matches;
  panel = document.createElement('div');
  panel.className = `ycs ${phone ? 'is-sheet' : 'is-popover'}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('calendarShare.title'));
  panel.innerHTML = `
    ${phone ? '<div class="ycs-scrim" data-close></div>' : ''}
    <div class="ycs-surface">
      ${phone ? '<div class="ycs-grip" aria-hidden="true"></div>' : ''}
      <header class="ycs-head">
        <h2>${escapeHtml(t('calendarShare.title'))}</h2>
        <button type="button" class="icon-btn" data-close aria-label="${escapeAttr(t('common.close'))}">${lucide('x', 16)}</button>
      </header>
      <div class="ycs-body"></div>
    </div>`;
  document.body.append(panel);

  if (!phone && anchor) {
    const r = anchor.getBoundingClientRect();
    const surface = panel.querySelector('.ycs-surface');
    surface.style.top = `${Math.round(r.bottom + 8)}px`;
    surface.style.left = `${Math.round(Math.max(12, Math.min(r.left, window.innerWidth - 392)))}px`;
  }

  panel.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return close();

    const space = e.target.closest('[data-space]')?.dataset.space;
    if (e.target.closest('[data-sync]') && space) return syncSpace(space);
    if (e.target.closest('[data-copy-link]') && space) return copyLink(space);

    const eventId = e.target.closest('[data-event]')?.dataset.event;
    if (eventId && state.calendarEvents.has(eventId)) {
      close();
      const { openCalendarEvent } = await import('../calendar.js');
      openCalendarEvent(eventId);
    }
  });

  if (!phone) {
    setTimeout(() => {
      document.addEventListener('pointerdown', function outside(e) {
        if (!panel) return document.removeEventListener('pointerdown', outside, true);
        if (panel.contains(e.target) || anchor?.contains(e.target)) return;
        document.removeEventListener('pointerdown', outside, true);
        close();
      }, true);
    }, 0);
  }

  document.addEventListener('keydown', onKey, true);
  window.addEventListener('yanta-calendar-feed-updated', render);
  window.addEventListener('yanta-space-changed', render);
  releaseOverlay = openBoundOverlay('calendar-share-panel', { close, isOpen: () => !!panel });

  await render();
}

function ensureCss() {
  if (document.getElementById('ycs-css')) return;
  const style = document.createElement('style');
  style.id = 'ycs-css';
  style.textContent = `
.ycs { position: fixed; inset: 0; z-index: 1300; pointer-events: none; }
.ycs-surface {
  pointer-events: auto;
  position: absolute;
  display: flex; flex-direction: column;
  background: var(--bg-elev);
  color: var(--text);
  box-shadow: 0 18px 48px -12px rgba(0,0,0,.32), 0 2px 6px rgba(0,0,0,.06);
}
.ycs.is-popover .ycs-surface {
  width: 380px; max-height: min(620px, calc(100vh - 96px));
  border-radius: 14px;
  animation: ycs-pop .18s cubic-bezier(.16,1,.3,1);
  transform-origin: top left;
}
.ycs.is-sheet { pointer-events: auto; }
.ycs-scrim { position: absolute; inset: 0; background: rgba(0,0,0,.32); animation: ycs-fade .18s ease-out; }
.ycs.is-sheet .ycs-surface {
  left: 0; right: 0; bottom: 0; max-height: 86vh;
  border-radius: 16px 16px 0 0;
  padding-bottom: env(safe-area-inset-bottom);
  animation: ycs-rise .26s cubic-bezier(.16,1,.3,1);
}
.ycs-grip { width: 36px; height: 4px; border-radius: 2px; background: var(--border-strong, var(--border)); margin: 8px auto 0; }
.ycs.is-leaving .ycs-surface, .ycs.is-leaving .ycs-scrim { opacity: 0; transition: opacity .14s ease-in; }
@keyframes ycs-pop { from { opacity: 0; transform: translateY(-4px) scale(.985); } }
@keyframes ycs-rise { from { transform: translateY(28px); opacity: .5; } }
@keyframes ycs-fade { from { opacity: 0; } }

.ycs-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 12px 4px 20px; }
.ycs-head h2 { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.01em; }
.ycs-body { overflow: auto; overscroll-behavior: contain; padding: 0 20px 18px; }

.ycs-calendar { padding: 14px 0 18px; }
.ycs-calendar + .ycs-calendar { border-top: 1px solid var(--border); }
.ycs-calendar-head { display: flex; align-items: center; gap: 10px; }
.ycs-calendar-head h3 { margin: 0; flex: 1; min-width: 0; font-size: 17px; font-weight: 650; letter-spacing: -0.015em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ycs-dot { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.ycs-dot.is-broken { background: var(--red, #d64545); }
.ycs-role { font-size: 12px; color: var(--text-dim); }

.ycs-status { display: flex; align-items: center; gap: 8px; margin: 6px 0 0; font-size: 13px; line-height: 1.45; color: var(--text-dim); }
.ycs-status > svg { flex: none; }
.ycs-status span { flex: 1; min-width: 0; }
.ycs-status.is-ok > svg { color: var(--green, #2f9e5b); }
.ycs-status.is-warn { color: color-mix(in srgb, var(--yellow, #b7791f) 70%, var(--text)); }
.ycs-status.is-bad { color: color-mix(in srgb, var(--red, #d64545) 78%, var(--text)); }
.ycs-status.is-busy > svg { animation: ycs-spin 0.9s linear infinite; color: var(--accent); }
@keyframes ycs-spin { to { transform: rotate(360deg); } }

.ycs-link {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  padding: 4px 2px; border: 0; background: none;
  color: var(--accent); font: inherit; font-weight: 600; font-size: 13px;
  cursor: pointer; border-radius: 6px;
}
.ycs-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.ycs-link:focus-visible, .ycs-changes button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ycs-calendar > .ycs-link { margin-top: 12px; }

.ycs-people { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 10px; }
.ycs-person { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: 10px; font-size: 14px; }
.ycs-avatar {
  width: 28px; height: 28px; border-radius: 50%;
  display: grid; place-items: center;
  font-size: 11px; font-weight: 700; letter-spacing: .02em;
  background: hsl(var(--h) 42% 88%); color: hsl(var(--h) 48% 26%);
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .ycs-avatar { background: hsl(var(--h) 28% 26%); color: hsl(var(--h) 60% 86%); } }
:root[data-theme="dark"] .ycs-avatar { background: hsl(var(--h) 28% 26%); color: hsl(var(--h) 60% 86%); }
.ycs-person-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ycs-person-meta { font-size: 12px; color: var(--text-dim); white-space: nowrap; }

.ycs-calendar h4 { margin: 20px 0 4px; font-size: 13px; font-weight: 650; color: var(--text); }
.ycs-changes { list-style: none; margin: 0; padding: 0; }
.ycs-changes button {
  width: 100%; display: flex; align-items: baseline; gap: 12px;
  padding: 6px 0; border: 0; background: none; color: var(--text);
  text-align: left; font: inherit; font-size: 13px; line-height: 1.4; cursor: pointer; border-radius: 6px;
}
.ycs-changes button span { flex: 1; min-width: 0; }
.ycs-changes time { font-size: 12px; color: var(--text-dim); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ycs-changes li.is-new span { font-weight: 600; }
.ycs-changes button:hover span { text-decoration: underline; text-underline-offset: 3px; }
.ycs-quiet { margin: 0; font-size: 13px; color: var(--text-dim); }
.ycs-empty { padding: 16px 0 6px; display: grid; gap: 6px; font-size: 14px; }
.ycs-empty p { margin: 0; max-width: 34ch; }
@media (prefers-reduced-motion: reduce) { .ycs * { animation: none !important; } }
`;
  document.head.append(style);
}
