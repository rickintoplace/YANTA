// ============================================================
// YANTA — "Shared calendars": who, what changed, is it in sync
//
// One panel for the three questions a shared calendar raises:
//   - who is it shared with (and who edited last),
//   - what did the others change,
//   - did my own entries actually reach everyone?
// The last one is answered honestly — unsent changes, the last error,
// when this device last heard from the server — with a "Sync now" that
// sends a full copy of everything this device has. A share that
// silently drops edits is the worst thing it can do.
// ============================================================

import { state, escapeHtml, lucide, toast } from '../core.js';
import { calendarBridges } from './calendar-registry.js';
import { calendarFeedFor, markCalendarFeedSeen } from './calendar-feed.js';
import { spaceParticipants } from './space-people.js';
import { peekOwnIdentity } from './space-identity.js';

const ROLE_LABEL = { owner: 'Owner', write: 'Can edit', read: 'Can view' };

function ago(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function syncLine(session) {
  const engine = session?.engine;
  if (!engine) return { tone: 'warn', text: 'Not connected on this device.' };

  if (engine.hasUnsent?.()) {
    const err = engine.lastUploadError;
    const status = Number(err?.status || 0);
    return {
      tone: 'bad',
      text: status === 401 || status === 403
        ? 'Your changes were refused: this device has no edit access any more. Ask for a new edit link.'
        : `Your latest changes are not sent yet${err ? ` (${escapeHtml(err.message || 'error')})` : ''}.`,
    };
  }

  if (engine.lastPullError) {
    return { tone: 'warn', text: `Cannot reach the server right now (${escapeHtml(engine.lastPullError.message || 'offline')}).` };
  }

  return { tone: 'ok', text: `Up to date · last checked ${ago(engine.lastPullAt || session.lastPullAt)}.` };
}

function sectionHtml(bridge, feed) {
  const session = state.spaces.get(bridge.spaceId);
  const cat = state.calendarCategories.get(bridge.categoryId);
  const name = cat?.name || session?.record?.title || 'Shared calendar';
  const me = peekOwnIdentity();
  const people = spaceParticipants(bridge.spaceId);
  const sync = syncLine(session);
  const count = bridge.events().length;

  const peopleHtml = people.length
    ? people.map((p) => `
        <li>
          <span class="avatar">${escapeHtml((p.name || '?').slice(0, 2).toUpperCase())}</span>
          <span class="who">${escapeHtml(p.name)}${p.id === me ? ' (you)' : ''}</span>
          <small>${escapeHtml(ROLE_LABEL[p.role] || '')}${p.lastActive ? ` · active ${escapeHtml(ago(p.lastActive))}` : ''}</small>
        </li>`).join('')
    : '<li class="muted">Only people invited by name are listed. Anyone with the link can open it.</li>';

  const names = new Map(people.map((p) => [p.id, p.name]));
  const changes = [...feed.entries].reverse().slice(0, 8);
  const changesHtml = changes.length
    ? changes.map((e) => `
        <li class="${e.ts > feed.lastSeenAt ? 'is-new' : ''}">
          <strong>${escapeHtml(names.get(e.actor) || e.actor || 'Someone')}</strong>
          ${e.action === 'added' ? 'added' : e.action === 'removed' ? 'removed' : 'changed'}
          “${escapeHtml(e.title || 'Untitled event')}”
          <small>${escapeHtml(ago(e.ts))}</small>
        </li>`).join('')
    : '<li class="muted">No changes by others yet.</li>';

  return `
    <section class="yanta-cal-share-section" data-space="${escapeHtml(bridge.spaceId)}">
      <header>
        ${lucide('users', 15)}
        <strong>${escapeHtml(name)}</strong>
        <span class="role">${escapeHtml(ROLE_LABEL[bridge.role] || '')}</span>
      </header>
      <div class="sync ${sync.tone}">
        ${lucide(sync.tone === 'ok' ? 'check-circle-2' : 'alert-triangle', 14)}
        <span>${sync.text} ${count} event${count === 1 ? '' : 's'} in the shared calendar.</span>
        <button type="button" class="btn compact" data-sync-now>${lucide('refresh-cw', 13)} Sync now</button>
      </div>
      <h4>People</h4>
      <ul class="people">${peopleHtml}</ul>
      <h4>Recent changes by others</h4>
      <ul class="changes">${changesHtml}</ul>
    </section>`;
}

const CSS = `
.yanta-cal-share-panel { display: grid; gap: 14px; max-height: 70vh; overflow: auto; }
.yanta-cal-share-section { border: 1px solid var(--border); border-radius: 13px; padding: 12px; display: grid; gap: 8px; }
.yanta-cal-share-section header { display: flex; align-items: center; gap: 8px; }
.yanta-cal-share-section header svg { color: var(--accent); }
.yanta-cal-share-section .role { margin-left: auto; font-size: 12px; color: var(--text-faint); }
.yanta-cal-share-section h4 { margin: 4px 0 0; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-faint); }
.yanta-cal-share-section ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 13px; }
.yanta-cal-share-section .people li { display: flex; align-items: center; gap: 8px; }
.yanta-cal-share-section .avatar { width: 26px; height: 26px; border-radius: 999px; display: inline-grid; place-items: center; font-size: 11px; font-weight: 800; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
.yanta-cal-share-section .people small { margin-left: auto; color: var(--text-faint); }
.yanta-cal-share-section .changes li.is-new strong::before { content: '● '; color: var(--accent); }
.yanta-cal-share-section .changes small, .yanta-cal-share-section .muted { color: var(--text-faint); }
.yanta-cal-share-section .sync { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 10px; border-radius: 10px; font-size: 13px; }
.yanta-cal-share-section .sync span { flex: 1; min-width: 180px; }
.yanta-cal-share-section .sync.ok { background: color-mix(in srgb, var(--green, #22c55e) 9%, transparent); }
.yanta-cal-share-section .sync.warn { background: color-mix(in srgb, var(--yellow, #eab308) 12%, transparent); }
.yanta-cal-share-section .sync.bad { background: color-mix(in srgb, var(--red, #ef4444) 12%, transparent); }
`;

/** Opens the panel; marks the change feeds seen. */
export async function openCalendarSharePanel() {
  const { yantaDialog } = await import('../dialogs.js');
  const bridges = calendarBridges();

  const render = async (host) => {
    const sections = [];
    for (const bridge of bridges) sections.push(sectionHtml(bridge, await calendarFeedFor(bridge.spaceId)));
    // Shares the server knows but this device cannot open.
    let broken = [];
    try {
      const health = await import('./space-health.js');
      broken = health.brokenShares().filter((b) => b.sourceType === 'calendar');
    } catch {}

    const brokenHtml = broken.map((b) => `
      <section class="yanta-cal-share-section">
        <header>${lucide('alert-triangle', 15)}<strong>${escapeHtml(b.name || b.title || 'A shared calendar')}</strong></header>
        <div class="sync bad"><span>This calendar is shared, but this device cannot open the share (its keys are missing here). Entries made here do not reach anyone. Share it again from the calendar list (⋯ → Share) and send the new link.</span></div>
      </section>`).join('');

    host.innerHTML = sections.join('') + brokenHtml ||
      `<p class="muted">No calendar on this device is shared yet. Share one from the calendar list (⋯ → Share) and send the link — everyone with an edit link can add entries.</p>`;
  };

  await yantaDialog({
    title: 'Shared calendars',
    icon: 'users',
    closeOnBackdrop: true,
    build: async ({ body, actions, done, button }) => {
      const style = document.createElement('style');
      style.textContent = CSS;
      const host = document.createElement('div');
      host.className = 'yanta-cal-share-panel';
      body.append(style, host);
      await render(host);

      host.addEventListener('click', async (e) => {
        const btn = e.target.closest?.('[data-sync-now]');
        if (!btn) return;
        const spaceId = btn.closest('[data-space]')?.dataset.space;
        const engine = state.spaces.get(spaceId)?.engine;
        if (!engine) return;
        btn.disabled = true;
        try {
          await engine.syncNow();
          toast('Shared calendar synced', 'success');
        } catch (err) {
          toast(`Sync failed: ${err?.message || err}`, 'error');
        }
        await render(host);
      });

      const close = button({ label: 'Close', kind: 'primary' });
      close.addEventListener('click', () => done(null));
      actions.append(close);
    },
  });

  for (const bridge of bridges) await markCalendarFeedSeen(bridge.spaceId).catch(() => {});
  window.dispatchEvent(new CustomEvent('yanta-calendar-feed-changed'));
}
