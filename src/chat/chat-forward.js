// ============================================================
// YANTA Chat — Forward messages to another chat
//
// E2EE-Hinweis:
// Verschlüsselte Anhänge werden per Content-Copy weitergeleitet (der
// Attachment-Key steckt im Event-Content und reist im neuen verschlüsselten
// Event mit) — identisch zum Verhalten von Element.
// ============================================================
import {
  el,
  escapeHtml,
  lucide,
  toast,
} from '../core.js';

import {
  roomDisplayName,
  sendRoomMessage,
  visibleRooms,
} from './chat-send.js';

function ensureCss() {
  if (document.getElementById('yanta-chat-forward-css')) return;
  const style = document.createElement('style');
  style.id = 'yanta-chat-forward-css';
  style.textContent = `
.yanta-chat-forward-overlay {
  position: fixed;
  inset: 0;
  z-index: 1350;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(0,0,0,.48);
  backdrop-filter: blur(14px);
}
.yanta-chat-forward-card {
  width: min(480px, 96vw);
  max-height: min(640px, 92vh);
  display: grid;
  grid-template-rows: auto auto 1fr;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 22px;
  background: var(--bg-elev);
  box-shadow: 0 28px 90px rgba(0,0,0,.46);
}
.yanta-chat-forward-card header,
.yanta-chat-forward-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}
.yanta-chat-forward-card header strong { color: var(--text); }
.yanta-chat-forward-search input { min-width: 0; flex: 1; }
.yanta-chat-forward-list { overflow: auto; padding: 8px; }
.yanta-chat-forward-row {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.yanta-chat-forward-row:hover {
  border-color: color-mix(in srgb, var(--accent) 36%, var(--border));
  background: color-mix(in srgb, var(--accent) 9%, transparent);
}
.yanta-chat-forward-row small { color: var(--text-faint); }
.yanta-chat-forward-avatar {
  width: 34px;
  height: 34px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  color: var(--accent);
  font-size: 12px;
  font-weight: 900;
}
.yanta-chat-forward-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 750;
}
.yanta-chat-forward-empty {
  min-height: 160px;
  display: grid;
  place-items: center;
  color: var(--text-faint);
}
`;
  document.head.append(style);
}

function forwardableContent(event) {
  const content =
    event?.getClearContent?.() ||
    event?.getContent?.() ||
    event?.event?.content ||
    {};
  const base = content['m.new_content']
    ? { ...content['m.new_content'] }
    : { ...content };
  delete base['m.relates_to'];
  delete base['m.new_content'];
  return base.msgtype ? base : null;
}

/**
 * Opens the forward picker. Resolves true when messages were forwarded.
 */
export function openChatForwardPicker({
  client,
  sourceRoomId = '',
  events = [],
} = {}) {
  return new Promise((resolve) => {
    const contents = (events || [])
      .slice()
      .sort((a, b) => Number(a?.getTs?.() || 0) - Number(b?.getTs?.() || 0))
      .map(forwardableContent)
      .filter(Boolean);

    if (!client || !contents.length) {
      toast('Nothing to forward.', 'error');
      resolve(false);
      return;
    }

    ensureCss();

    const overlay = el('div', {
      class: 'yanta-chat-forward-overlay',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Forward messages',
    });

    let query = '';
    let sending = false;

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

    const render = () => {
      const rooms = visibleRooms(client)
        .filter((room) =>
          !query ||
          roomDisplayName(client, room).toLowerCase().includes(query))
        .sort((a, b) =>
          Number(b.getLastActiveTimestamp?.() || 0) -
          Number(a.getLastActiveTimestamp?.() || 0))
        .slice(0, 60);

      overlay.innerHTML = `
        <section class="yanta-chat-forward-card">
          <header>
            ${lucide('forward', 20)}
            <strong>Forward ${contents.length > 1 ? `${contents.length} messages` : 'message'}</strong>
            <span class="grow"></span>
            <button class="icon-btn" data-close title="Close" aria-label="Close">${lucide('x', 18)}</button>
          </header>
          <div class="yanta-chat-forward-search">
            ${lucide('search', 15)}
            <input class="text-input" data-search value="${escapeHtml(query)}" placeholder="Search chats…" autocomplete="off" spellcheck="false">
          </div>
          <div class="yanta-chat-forward-list">
            ${
              rooms.length
                ? rooms.map((room) => `
                    <button class="yanta-chat-forward-row" type="button" data-room-id="${escapeHtml(room.roomId)}">
                      <span class="yanta-chat-forward-avatar">${escapeHtml(roomDisplayName(client, room).slice(0, 2).toUpperCase())}</span>
                      <span class="yanta-chat-forward-name">${escapeHtml(roomDisplayName(client, room))}</span>
                      ${room.roomId === sourceRoomId ? '<small>This chat</small>' : '<small></small>'}
                    </button>
                  `).join('')
                : '<div class="yanta-chat-forward-empty">No chats found.</div>'
            }
          </div>
        </section>
      `;

      overlay.querySelector('[data-search]')?.addEventListener('input', (e) => {
        query = String(e.target.value || '').trim().toLowerCase();
        render();
        requestAnimationFrame(() => {
          const input = overlay.querySelector('[data-search]');
          input?.focus();
          input?.setSelectionRange(input.value.length, input.value.length);
        });
      });

      overlay.querySelectorAll('[data-room-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (sending) return;
          sending = true;
          btn.disabled = true;
          try {
            for (const content of contents) {
              await sendRoomMessage(client, btn.dataset.roomId, content);
            }
            toast(
              contents.length > 1
                ? `Forwarded ${contents.length} messages`
                : 'Message forwarded',
              'success'
            );
            close(true);
          } catch (err) {
            sending = false;
            btn.disabled = false;
            console.warn('[YANTA Chat] Forward failed', err);
            toast('Could not forward message.', 'error');
          }
        });
      });
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest?.('[data-close]')) {
        close(false);
      }
    });

    window.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    render();
    requestAnimationFrame(() => overlay.querySelector('[data-search]')?.focus());
  });
}