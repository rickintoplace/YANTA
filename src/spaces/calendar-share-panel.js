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
import { openSurface } from '../ui/surface.js';
import { calendarBridges } from './calendar-registry.js';
import { calendarFeedFor, markCalendarFeedSeen, groupCalendarFeed, calendarChangeLine } from './calendar-feed.js';
import { spaceParticipants } from './space-people.js';


let panel = null;

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

  // The feed stores the English fallbacks 'Someone' / 'Untitled event'.
  const changes = groupCalendarFeed([...feed.entries].reverse()).slice(0, 5);
  const changesHtml = changes.length
    ? `<ul class="ycs-changes">${changes.map((e) => `
        <li class="${e.ts > feed.lastSeenAt ? 'is-new' : ''}">
          <button type="button" data-event="${escapeAttr(e.action !== 'removed' ? e.eventId || '' : '')}">
            <span>${escapeHtml(calendarChangeLine(e,
              names.get(e.actor) || (e.actor !== 'Someone' && e.actor) || t('calendarShare.someone'),
              (e.title !== 'Untitled event' && e.title) || t('calendarShare.untitledEvent')))}</span>
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
      .map((b) => {
        const ui = discardUi.get(b.spaceId) || { state: 'idle' };
        const action = ui.state === 'busy'
          ? `<p class="ycs-status is-busy" aria-live="polite">${lucide('loader-circle', 14)}<span>${escapeHtml(t('calendarShare.discarding'))}</span></p>`
          : `${ui.state === 'error' ? `<p class="ycs-status is-bad" aria-live="polite">${lucide('circle-alert', 14)}<span>${escapeHtml(ui.message)}</span></p>` : ''}
             <button type="button" class="ycs-link" data-discard>${lucide('trash-2', 14)}<span>${escapeHtml(ui.state === 'error' ? t('calendarShare.tryAgain') : t('calendarShare.discard'))}</span></button>`;
        return `
        <section class="ycs-calendar" data-broken="${escapeAttr(b.spaceId)}">
          <div class="ycs-calendar-head">
            <span class="ycs-dot is-broken" aria-hidden="true"></span>
            <h3>${escapeHtml(b.label && b.label !== 'a calendar' ? b.label : t('calendarShare.untitled'))}</h3>
            <span class="ycs-role">${escapeHtml(t('calendarShare.sharedOn', { date: new Date(b.createdAt || Date.now()).toLocaleDateString(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) }))}</span>
          </div>
          <p class="ycs-status is-bad">${lucide('circle-alert', 14)}<span>${escapeHtml(t('calendarShare.broken'))}</span></p>
          ${action}
        </section>`;
      }).join('');
  } catch {
    return '';
  }
}

/** idle | busy | error — per broken share, while the panel is open. */
const discardUi = new Map();

/*
  The panel re-renders on every sync and presence change. Replacing the
  buttons between pointerdown and pointerup swallows the click (it then
  lands on their parent) — so nothing is replaced while a pointer is
  down in the panel, and nothing at all when the markup did not change.
*/
let pointerDown = false;
let renderPending = false;
let lastHtml = '';

async function render() {
  if (!panel) return;
  if (pointerDown) {
    renderPending = true;
    return;
  }
  const body = panel.body;
  const sections = await Promise.all(calendarBridges().map(sectionHtml));
  const html = sections.join('') + await brokenHtml();
  if (!panel) return;
  if (pointerDown) {
    renderPending = true;
    return;
  }
  if (html === lastHtml && body.childElementCount) return;
  lastHtml = html;

  body.innerHTML = html || `
    <div class="ycs-empty">
      <p>${escapeHtml(t('calendarShare.emptyTitle'))}</p>
      <p class="ycs-quiet">${escapeHtml(t('calendarShare.emptyHint'))}</p>
    </div>`;
}

function close() {
  panel?.close();
}

/** What has to stop when the surface goes, however it was closed. */
function closed() {
  panel = null;
  window.removeEventListener('yanta-calendar-feed-updated', render);
  window.removeEventListener('yanta-space-changed', render);
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

async function discard(spaceId) {
  if (discardUi.get(spaceId)?.state === 'busy') return;
  discardUi.set(spaceId, { state: 'busy' });
  await render();

  const health = await import('./space-health.js');
  const result = await health.discardBrokenShare(spaceId);

  if (result.ok) {
    discardUi.delete(spaceId);
    toast(t('calendarShare.discarded'), 'success');
  } else {
    discardUi.set(spaceId, {
      state: 'error',
      message: result.offline ? t('calendarShare.offline') : t('calendarShare.failed', { reason: result.message || String(result.status || '') }),
    });
  }
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

  syncUi.clear();
  discardUi.clear();
  lastHtml = '';
  pointerDown = false;
  renderPending = false;

  panel = openSurface({
    kind: 'popover',
    title: t('calendarShare.title'),
    anchor,
    width: 380,
    className: 'ycs',
    historyId: 'calendar-share-panel',
    onClose: closed,
  });
  const root = panel.body;

  root.addEventListener('pointerdown', () => { pointerDown = true; });
  const release = () => {
    if (!pointerDown) return;
    pointerDown = false;
    // After the click has been dispatched.
    if (renderPending) setTimeout(() => { renderPending = false; render(); }, 0);
  };
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);

  root.addEventListener('click', async (e) => {
    const space = e.target.closest('[data-space]')?.dataset.space;
    if (e.target.closest('[data-sync]') && space) return syncSpace(space);
    if (e.target.closest('[data-copy-link]') && space) return copyLink(space);

    const broken = e.target.closest('[data-broken]')?.dataset.broken;
    if (broken && e.target.closest('[data-discard]')) return discard(broken);

    const eventId = e.target.closest('[data-event]')?.dataset.event;
    if (eventId && state.calendarEvents.has(eventId)) {
      close();
      const { openCalendarEvent } = await import('../calendar.js');
      openCalendarEvent(eventId);
    }
  });

  window.addEventListener('yanta-calendar-feed-updated', render);
  window.addEventListener('yanta-space-changed', render);

  await render();
}
