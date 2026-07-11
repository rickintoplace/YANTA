// ============================================================
// YANTA Chat — Telegram-style message selection
//
// - Drag neben einer Nachricht (Maus) selektiert Bereiche.
// - Drag innerhalb einer Bubble bleibt normale Textauswahl.
// - Im Selection-Modus toggelt Tap/Klick auf oder neben einer Nachricht.
// - Bottom-Bar: Reply · Copy · Forward · More (Info, Delete).
// ============================================================
import {
  el,
  lucide,
  toast,
} from '../core.js';
import {
  yantaConfirm,
} from '../dialogs.js';
import {
  showMenu,
} from '../tree.js';
import {
  openChatForwardPicker,
} from './chat-forward.js';
import {
  messagePreview,
} from './chat-message-render.js';

function ensureSelectionCss() {
  if (document.getElementById('yanta-chat-selection-css')) return;
  const style = document.createElement('style');
  style.id = 'yanta-chat-selection-css';
  style.textContent = `
.yanta-chat-event.is-selected .yanta-chat-bubble {
  outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 16%, transparent);
}
.yanta-chat-surface.is-selecting .yanta-chat-event {
  cursor: pointer;
}
.yanta-chat-surface.is-selecting .yanta-chat-composer-wrap > :not(.yanta-chat-selection-bar) {
  display: none !important;
}
.yanta-chat-selection-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
}
.yanta-chat-selection-bar[hidden] {
  display: none !important;
}
.yanta-chat-selection-count {
  color: var(--text);
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
}
.yanta-chat-noselect,
.yanta-chat-noselect * {
  user-select: none !important;
}
`;
  document.head.append(style);
}

/**
 * Creates the selection controller for one Chat root.
 */
export function createChatSelection({
  root,
  getClient,
  getRoomId,
  getEvents,
  onReply,
  onReload,
} = {}) {
  ensureSelectionCss();

  const selected = new Set();
  let active = false;
  let bar = null;
  let drag = null;
  let suppressClicksUntil = 0;

  const client = () => getClient?.() || null;
  const events = () => getEvents?.() || [];

  function eventById(id) {
    return events().find((ev) => (ev?.getId?.() || '') === id) || null;
  }

  function selectedEvents() {
    return [...selected]
      .map(eventById)
      .filter(Boolean)
      .sort((a, b) => Number(a.getTs?.() || 0) - Number(b.getTs?.() || 0));
  }

  function isOwn(ev) {
    const own = client()?.getUserId?.() || '';
    return !!own && ev?.getSender?.() === own;
  }

  function rowsList() {
    return [...root.querySelectorAll('.yanta-chat-event[data-event-id]')];
  }

  function rowAtPoint(x, y) {
    const hit = document.elementFromPoint(x, y);
    const direct = hit?.closest?.('.yanta-chat-event[data-event-id]');
    if (direct && root.contains(direct)) return direct;
    // "Neben der Nachricht" tippen: Zeile über die Y-Koordinate treffen.
    for (const row of rowsList()) {
      const r = row.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return row;
    }
    return null;
  }

  function ensureBar() {
    if (bar?.isConnected) return bar;
    const host = root.querySelector('.yanta-chat-composer-wrap');
    if (!host) return null;
    bar = el('div', {
      class: 'yanta-chat-selection-bar',
      hidden: true,
    });
    bar.innerHTML = `
      <button class="icon-btn" type="button" data-sel-exit title="Cancel selection" aria-label="Cancel selection">${lucide('x', 17)}</button>
      <strong class="yanta-chat-selection-count" data-sel-count>0 selected</strong>
      <span class="grow"></span>
      <button class="btn compact" type="button" data-sel-reply>${lucide('reply', 14)} Reply</button>
      <button class="btn compact" type="button" data-sel-copy>${lucide('copy', 14)} Copy</button>
      <button class="btn compact primary" type="button" data-sel-forward>${lucide('forward', 14)} Forward</button>
      <button class="icon-btn" type="button" data-sel-more title="More" aria-label="More">${lucide('ellipsis-vertical', 17)}</button>
    `;
    bar.querySelector('[data-sel-exit]').addEventListener('click', () => exit());
    bar.querySelector('[data-sel-reply]').addEventListener('click', replySelected);
    bar.querySelector('[data-sel-copy]').addEventListener('click', copySelected);
    bar.querySelector('[data-sel-forward]').addEventListener('click', forwardSelected);
    bar.querySelector('[data-sel-more]').addEventListener('click', (e) => {
      openMoreMenu(e.currentTarget);
    });
    host.append(bar);
    return bar;
  }

  function syncUi() {
    ensureBar();
    root.classList.toggle('is-selecting', active);
    if (bar) {
      bar.hidden = !active;
      const count = bar.querySelector('[data-sel-count]');
      if (count) count.textContent = `${selected.size} selected`;
      const reply = bar.querySelector('[data-sel-reply]');
      if (reply) reply.disabled = selected.size !== 1;
      const none = selected.size === 0;
      for (const btn of bar.querySelectorAll('[data-sel-copy],[data-sel-forward],[data-sel-more]')) {
        btn.disabled = none;
      }
    }
    for (const row of rowsList()) {
      row.classList.toggle('is-selected', selected.has(row.dataset.eventId || ''));
    }
  }

  function enter() {
    if (active) return;
    active = true;
    try {
      window.getSelection()?.removeAllRanges();
    } catch {}
    syncUi();
  }

  function exit() {
    active = false;
    selected.clear();
    drag = null;
    document.body.classList.remove('yanta-chat-noselect');
    syncUi();
  }

  function toggle(id) {
    const clean = String(id || '');
    if (!clean) return;
    if (selected.has(clean)) selected.delete(clean);
    else selected.add(clean);
    if (active && selected.size === 0) {
      exit();
      return;
    }
    syncUi();
  }

  function enterWith(id) {
    enter();
    if (id) selected.add(String(id));
    // Nach Long-Press/Drag folgt ein synthetischer Click — nicht togglen.
    suppressClicksUntil = Date.now() + 450;
    syncUi();
  }

  function replaceSelection(next) {
    selected.clear();
    for (const id of next) {
      if (id) selected.add(id);
    }
    syncUi();
  }

  async function replySelected() {
    const evs = selectedEvents();
    if (evs.length !== 1) return;
    const target = evs[0];
    exit();
    onReply?.(target);
  }

  async function copySelected() {
    const texts = selectedEvents()
      .map((ev) => String((ev.getClearContent?.() || ev.getContent?.() || {}).body || '').trim())
      .filter(Boolean);
    if (!texts.length) {
      toast('No text to copy.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(texts.join('\n\n'));
      toast('Copied', 'success');
      exit();
    } catch (err) {
      console.warn('[YANTA Chat] Selection copy failed', err);
      toast('Could not copy.', 'error');
    }
  }

  async function forwardSelected() {
    const evs = selectedEvents();
    if (!evs.length) return;
    const done = await openChatForwardPicker({
      client: client(),
      sourceRoomId: getRoomId?.() || '',
      events: evs,
    });
    if (done) exit();
  }

  async function deleteSelected() {
    const evs = selectedEvents();
    if (!evs.length) return;
    const own = evs.filter(isOwn);
    if (!own.length) {
      toast('Only your own messages can be deleted for everyone.', 'error');
      return;
    }
    const ok = await yantaConfirm({
      title: own.length === 1 ? 'Delete message?' : `Delete ${own.length} messages?`,
      message: own.length === evs.length
        ? 'This redacts the selected messages for everyone in the room.'
        : `Only your own ${own.length} of ${evs.length} selected messages can be deleted for everyone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return;
    const c = client();
    const roomId = getRoomId?.() || '';
    for (const ev of own) {
      try {
        await c.redactEvent(roomId, ev.getId?.());
      } catch (err) {
        console.warn('[YANTA Chat] Could not delete message', err);
        toast('Could not delete a message.', 'error');
      }
    }
    toast(own.length === 1 ? 'Message deleted' : `${own.length} messages deleted`, 'success');
    exit();
    await onReload?.();
  }

  async function infoSelected() {
    const evs = selectedEvents();
    if (evs.length !== 1) return;
    const ev = evs[0];
    await yantaConfirm({
      title: 'Message info',
      message: [
        `Event: ${ev.getId?.() || ''}`,
        `Sender: ${ev.getSender?.() || ''}`,
        `Time: ${new Date(ev.getTs?.() || Date.now()).toLocaleString()}`,
        '',
        messagePreview(ev) || 'No preview',
      ].join('\n'),
      confirmLabel: 'OK',
      cancelLabel: '',
      icon: 'info',
    });
  }

  function openMoreMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const evs = selectedEvents();
    const items = [];
    if (evs.length === 1) {
      items.push({
        label: 'Info',
        icon: 'info',
        action: infoSelected,
      });
    }
    if (evs.some(isOwn)) {
      items.push({
        label: 'Delete',
        icon: 'trash',
        danger: true,
        action: deleteSelected,
      });
    }
    if (!items.length) return;
    const menu = showMenu(r.right, r.top - 8, items, {
      align: 'end',
    });
    menu?.style?.setProperty('z-index', '10090', 'important');
  }

  // --- Drag-to-select (Maus) + Tap-Toggle im Selection-Modus ---------------

  root.addEventListener('pointerdown', (e) => {
    if (root.hidden) return;
    if (e.button != null && e.button !== 0) return;
    const timeline = root.querySelector('[data-chat-timeline]');
    if (!timeline || !timeline.contains(e.target)) return;
    if (!active) {
      /*
        Ohne aktiven Selection-Modus startet Drag-Select nur mit Maus und nur
        NEBEN der Bubble — Drag innerhalb der Bubble bleibt Textauswahl,
        Touch-Drag bleibt Scrollen (Telegram-Verhalten).
      */
      if (e.pointerType !== 'mouse') return;
      if (e.target.closest?.('.yanta-chat-bubble')) return;
      if (e.target.closest?.('button, a, input, textarea, select')) return;
    }
    drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      anchorRow: rowAtPoint(e.clientX, e.clientY),
      baseline: new Set(selected),
      started: false,
    };
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.anchorRow) {
      drag.anchorRow = rowAtPoint(e.clientX, e.clientY);
    }
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 8) return;
      if (!drag.anchorRow) {
        drag = null;
        return;
      }
      drag.started = true;
      document.body.classList.add('yanta-chat-noselect');
      try {
        window.getSelection()?.removeAllRanges();
      } catch {}
      if (!active) enter();
    }
    e.preventDefault();
    const current = rowAtPoint(e.clientX, e.clientY);
    if (!current) return;
    const rows = rowsList();
    const a = rows.indexOf(drag.anchorRow);
    const b = rows.indexOf(current);
    if (a < 0 || b < 0) return;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const next = new Set(drag.baseline);
    for (let i = lo; i <= hi; i++) {
      next.add(rows[i].dataset.eventId || '');
    }
    next.delete('');
    replaceSelection(next);
  }, true);

  const endDrag = (e) => {
    if (!drag || (e.pointerId != null && e.pointerId !== drag.pointerId)) return;
    if (drag.started) {
      suppressClicksUntil = Date.now() + 400;
    }
    drag = null;
    document.body.classList.remove('yanta-chat-noselect');
  };
  document.addEventListener('pointerup', endDrag, true);
  document.addEventListener('pointercancel', endDrag, true);

  root.addEventListener('click', (e) => {
    if (!active) return;
    if (Date.now() < suppressClicksUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const timeline = root.querySelector('[data-chat-timeline]');
    if (!timeline || !timeline.contains(e.target)) return;
    const row = rowAtPoint(e.clientX, e.clientY);
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    toggle(row.dataset.eventId || '');
  }, true);

  // Selektion nach Timeline-Re-Renders wiederherstellen.
  const restoreSoon = () => requestAnimationFrame(syncUi);
  window.addEventListener('yanta-chat-room-updated', restoreSoon);
  window.addEventListener('yanta-chat-timeline-rendered', restoreSoon);
  // Room-Wechsel/Chat-Schließen beendet den Selection-Modus.
  window.addEventListener('yanta-chat-opened', () => exit());
  window.addEventListener('yanta-chat-closed', () => exit());

  return {
    enter,
    exit,
    toggle,
    enterWith,
    isActive: () => active,
    count: () => selected.size,
    restore: syncUi,
  };
}