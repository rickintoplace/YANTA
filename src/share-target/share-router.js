// ============================================================
// YANTA — Web Share Target router
//
// Opened at boot when the OS share sheet posted content to YANTA (see the
// service-worker /share-target handler and the boot consumer in main.js).
//
// One overlay, two zones:
//   - Chats (top):   multi-select broadcast to chat partners (needs Matrix).
//   - Targets (bottom): one-tap smart destinations, context-ranked by payload.
//
// Open vs. background is a deliberate per-target property:
//   - background → routes silently, toasts "Saved", overlay closes.
//   - open       → routes, then navigates into that surface (note/event/AI).
//
// Everything reuses existing primitives — this file only orchestrates.
// ============================================================
import {
  el,
  escapeHtml,
  lucide,
  toast,
} from '../core.js';

import { t } from '../i18n/index.js';

import { resolveMatrixClient } from '../chat/chat-actions.js';

import {
  roomDisplayName,
  sendFileToRoom,
  sendTextToRoom,
  visibleRooms,
} from '../chat/chat-send.js';

const raf = () => new Promise((r) => requestAnimationFrame(r));

// ---------------------------------------------------------------
// Payload shaping
// ---------------------------------------------------------------

function firstUrl(text) {
  const m = String(text || '').match(/https?:\/\/\S+/);
  return m ? m[0] : '';
}

function isFeedLike(url) {
  return /(youtube\.com|youtu\.be|\/feed\b|feeds?\.|\.rss\b|\.atom\b|\/rss\b)/i.test(url);
}

/** A clean text/markdown body from the shared fields, without duplication. */
function composeText(payload) {
  const title = String(payload?.title || '').trim();
  const text = String(payload?.text || '').trim();
  const url = String(payload?.url || '').trim();

  const parts = [];
  if (title && title !== text) parts.push(title);
  if (text) parts.push(text);
  if (url && !text.includes(url)) parts.push(url);

  return parts.join('\n').trim();
}

function shapePayload(payload) {
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const imageFile =
    files.find((f) => String(f?.type || '').startsWith('image/')) || null;

  const title = String(payload?.title || '').trim();
  const text = composeText(payload);
  const linkUrl = String(payload?.url || '').trim() || firstUrl(payload?.text);
  const hasSnippet = Boolean(title || (payload?.text || '').trim());

  const kind = imageFile ? 'image' : (linkUrl ? 'link' : 'text');

  return { title, text, linkUrl, imageFile, hasSnippet, kind };
}

/** Short label for the preview chip. */
function previewLabel(shaped) {
  if (shaped.kind === 'image') {
    return shaped.imageFile?.name || t('shareTarget.previewImage');
  }
  return shaped.linkUrl || shaped.text || '';
}

function previewIcon(shaped) {
  if (shaped.kind === 'image') return 'image';
  if (shaped.kind === 'link') return 'link';
  return 'file-text';
}

// Context-ranked target list. Background targets carry mode:'background'.
function buildTargets(shaped) {
  const targets = [];

  if (shaped.kind !== 'image' && shaped.text) {
    targets.push({ id: 'capture', icon: 'zap', mode: 'background' });
  }

  targets.push({ id: 'note', icon: 'file-text', mode: 'open' });

  if (shaped.text) {
    targets.push({ id: 'ai', icon: 'sparkles', mode: 'open' });
  }

  if (shaped.hasSnippet) {
    targets.push({ id: 'event', icon: 'calendar', mode: 'open' });
  }

  if (shaped.linkUrl && isFeedLike(shaped.linkUrl)) {
    targets.push({ id: 'rss', icon: 'rss', mode: 'background' });
  }

  return targets;
}

// ---------------------------------------------------------------
// Target actions — each reuses an existing primitive.
// ---------------------------------------------------------------

async function runTarget(id, shaped) {
  if (id === 'capture') {
    const { captureToJournal } = await import('../journal.js');
    await captureToJournal(shaped.text, { source: 'share-target' });
    return;
  }

  if (id === 'note') {
    const { runCreateAction } = await import('../create-actions.js');
    await runCreateAction('note', { source: 'share-target' });
    await raf();

    if (shaped.imageFile) {
      const { insertImageAsRef } = await import('../image.js');
      await insertImageAsRef(shaped.imageFile);
    } else if (shaped.text) {
      const { insertAtCursor } = await import('../editor.js');
      insertAtCursor(shaped.text + '\n');
    }
    return;
  }

  if (id === 'event') {
    const { openCalendar, openNewCalendarEvent } = await import('../calendar.js');
    openCalendar?.({ push: true });
    await raf();
    await raf();
    openNewCalendarEvent({ title: (shaped.title || shaped.text || '').slice(0, 140) });
    return;
  }

  if (id === 'ai') {
    window.dispatchEvent(new CustomEvent('yanta-open-ai-assistant', {
      detail: { attachment: shaped.text },
    }));
    return;
  }

  if (id === 'rss') {
    const { addRssFeedFromUniversalInput } = await import('../rss/rss-actions.js');
    await addRssFeedFromUniversalInput(shaped.linkUrl);
    return;
  }

  throw new Error(`Unknown share target: ${id}`);
}

// ---------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------

function ensureCss() {
  if (document.getElementById('yanta-share-router-css')) return;
  const style = document.createElement('style');
  style.id = 'yanta-share-router-css';
  style.textContent = `
.yanta-share-overlay {
  position: fixed;
  inset: 0;
  z-index: 1360;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(0,0,0,.48);
  backdrop-filter: blur(14px);
}
.yanta-share-card {
  width: min(480px, 96vw);
  max-height: min(720px, 94vh);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 22px;
  background: var(--bg-elev);
  box-shadow: 0 28px 90px rgba(0,0,0,.46);
}
.yanta-share-card header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 13px 15px;
  border-bottom: 1px solid var(--border);
}
.yanta-share-card header strong { color: var(--text); font-size: 15px; }
.yanta-share-card header .grow { flex: 1; }
.yanta-share-preview {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 12px 15px 4px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: color-mix(in srgb, var(--accent) 6%, transparent);
  color: var(--text-faint);
}
.yanta-share-preview svg { color: var(--accent); flex: 0 0 auto; }
.yanta-share-preview span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text);
}
.yanta-share-chats { display: grid; grid-template-rows: auto 1fr; min-height: 0; }
.yanta-share-chats-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 15px 6px;
}
.yanta-share-chats-head .label {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.yanta-share-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 15px 6px;
  padding: 7px 11px;
  border: 1px solid var(--border);
  border-radius: 11px;
}
.yanta-share-search input { min-width: 0; flex: 1; border: 0; background: transparent; color: var(--text); }
.yanta-share-search input:focus { outline: none; }
.yanta-share-list { overflow: auto; padding: 2px 8px 8px; }
.yanta-share-row {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 9px 12px;
  border: 1px solid transparent;
  border-radius: 13px;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.yanta-share-row:hover {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.yanta-share-row.is-selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
}
.yanta-share-avatar {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  color: var(--accent);
  font-size: 12px;
  font-weight: 900;
}
.yanta-share-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}
.yanta-share-check { color: var(--accent); display: inline-grid; place-items: center; }
.yanta-share-empty {
  padding: 20px 12px;
  text-align: center;
  color: var(--text-faint);
  font-size: 13px;
}
.yanta-share-send {
  margin: 4px 15px 0;
  padding: 10px 14px;
  border: 0;
  border-radius: 12px;
  background: var(--accent);
  color: #fff;
  font-weight: 800;
  cursor: pointer;
}
.yanta-share-send[disabled] { opacity: .45; cursor: default; }
.yanta-share-targets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  padding: 12px 15px 16px;
  border-top: 1px solid var(--border);
}
.yanta-share-target {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 12px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--bg);
  color: var(--text);
  font-weight: 700;
  cursor: pointer;
  text-align: left;
}
.yanta-share-target:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.yanta-share-target svg { color: var(--accent); flex: 0 0 auto; }
`;
  document.head.append(style);
}

/**
 * Open the share router for a shared payload. Resolves when it closes.
 * @param {{title?:string,text?:string,url?:string,files?:File[]}} payload
 */
export function openShareRouter(payload) {
  return new Promise((resolve) => {
    const shaped = shapePayload(payload);

    // Nothing usable was shared — do not open an empty router.
    if (!shaped.text && !shaped.imageFile && !shaped.linkUrl) {
      resolve(false);
      return;
    }

    ensureCss();

    const overlay = el('div', {
      class: 'yanta-share-overlay',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t('shareTarget.title'),
    });

    let client = null;
    let query = '';
    let sending = false;
    const selected = new Set();

    const close = (result) => {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    };

    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close(false);
    };

    // A background target routes silently; an open target navigates away.
    const applyTarget = async (target) => {
      try {
        await runTarget(target.id, shaped);
        if (target.mode === 'background') {
          toast(t(`shareTarget.saved.${target.id}`), 'success');
        }
        close(true);
      } catch (err) {
        console.error('[YANTA Share] target failed', target.id, err);
        toast(t('shareTarget.failed'), 'error');
      }
    };

    const sendToSelected = async () => {
      if (!client || sending || !selected.size) return;
      sending = true;
      renderSendBtn();
      try {
        for (const roomId of selected) {
          if (shaped.text) await sendTextToRoom(client, roomId, shaped.text);
          if (shaped.imageFile) await sendFileToRoom(client, roomId, shaped.imageFile);
        }
        toast(t('shareTarget.sentToChats', { count: selected.size }), 'success');
        close(true);
      } catch (err) {
        sending = false;
        renderSendBtn();
        console.warn('[YANTA Share] chat send failed', err);
        toast(t('shareTarget.failed'), 'error');
      }
    };

    const renderSendBtn = () => {
      const btn = overlay.querySelector('[data-send]');
      if (!btn) return;
      btn.disabled = sending || !selected.size;
      btn.textContent = selected.size
        ? t('shareTarget.sendToChats', { count: selected.size })
        : t('shareTarget.selectChats');
    };

    const renderRows = () => {
      const list = overlay.querySelector('[data-list]');
      if (!list) return;

      const rooms = visibleRooms(client)
        .filter((room) =>
          !query || roomDisplayName(client, room).toLowerCase().includes(query))
        .sort((a, b) =>
          Number(b.getLastActiveTimestamp?.() || 0) -
          Number(a.getLastActiveTimestamp?.() || 0))
        .slice(0, 60);

      list.innerHTML = rooms.length
        ? rooms.map((room) => {
            const name = roomDisplayName(client, room);
            const on = selected.has(room.roomId);
            return `
              <button class="yanta-share-row${on ? ' is-selected' : ''}" type="button" data-room-id="${escapeHtml(room.roomId)}" aria-pressed="${on}">
                <span class="yanta-share-avatar">${escapeHtml(name.slice(0, 2).toUpperCase())}</span>
                <span class="yanta-share-name">${escapeHtml(name)}</span>
                <span class="yanta-share-check">${on ? lucide('check-circle-2', 18) : lucide('circle', 18)}</span>
              </button>`;
          }).join('')
        : `<div class="yanta-share-empty">${escapeHtml(t('shareTarget.noChats'))}</div>`;

      list.querySelectorAll('[data-room-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.roomId;
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          renderRows();
          renderSendBtn();
        });
      });
    };

    const chatsMarkup = () => `
      <section class="yanta-share-chats">
        <div class="yanta-share-chats-head">
          <span class="label">${escapeHtml(t('shareTarget.sendToChatsLabel'))}</span>
        </div>
        <div>
          <div class="yanta-share-search">
            ${lucide('search', 15)}
            <input data-search value="${escapeHtml(query)}" placeholder="${escapeHtml(t('shareTarget.searchChats'))}" autocomplete="off" spellcheck="false">
          </div>
          <button class="yanta-share-send" data-send type="button"></button>
          <div class="yanta-share-list" data-list></div>
        </div>
      </section>`;

    const render = () => {
      const targets = buildTargets(shaped);

      overlay.innerHTML = `
        <section class="yanta-share-card">
          <header>
            ${lucide('share-2', 19)}
            <strong>${escapeHtml(t('shareTarget.title'))}</strong>
            <span class="grow"></span>
            <button class="icon-btn" data-close type="button" title="${escapeHtml(t('common.close'))}" aria-label="${escapeHtml(t('common.close'))}">${lucide('x', 18)}</button>
          </header>

          <div class="yanta-share-preview">
            ${lucide(previewIcon(shaped), 16)}
            <span>${escapeHtml(previewLabel(shaped))}</span>
          </div>

          ${client ? chatsMarkup() : '<div></div>'}

          <div class="yanta-share-targets">
            ${targets.map((target) => `
              <button class="yanta-share-target" type="button" data-target="${escapeHtml(target.id)}">
                ${lucide(target.icon, 17)}
                <span>${escapeHtml(t(`shareTarget.target.${target.id}`))}</span>
              </button>`).join('')}
          </div>
        </section>`;

      overlay.querySelector('[data-search]')?.addEventListener('input', (e) => {
        query = String(e.target.value || '').trim().toLowerCase();
        renderRows();
        requestAnimationFrame(() => {
          const input = overlay.querySelector('[data-search]');
          input?.focus();
          input?.setSelectionRange(input.value.length, input.value.length);
        });
      });

      overlay.querySelector('[data-send]')?.addEventListener('click', sendToSelected);

      overlay.querySelectorAll('[data-target]').forEach((btn) => {
        const target = targets.find((tg) => tg.id === btn.dataset.target);
        btn.addEventListener('click', () => applyTarget(target));
      });

      renderRows();
      renderSendBtn();
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest?.('[data-close]')) {
        close(false);
      }
    });

    window.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    render();

    // Resolve the Matrix client lazily; re-render to reveal the chats zone
    // once it's ready (a share must not wait on chat to be usable).
    resolveMatrixClient()
      .then((c) => {
        if (!c || !overlay.isConnected) return;
        client = c;
        render();
        requestAnimationFrame(() => overlay.querySelector('[data-search]')?.focus());
      })
      .catch(() => {});
  });
}
