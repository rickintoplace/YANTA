// ============================================================
// YANTA Pulse — sidebar badge
//
// Unread Inbox count on the YANTA AI button. Pulse results are the AI
// working on its own, so they belong on the AI surface — Chat stays
// reserved for messages from actual people.
//
// The badge is a count, never a notification: it waits, it does not
// interrupt, and it clears as soon as the Inbox has been looked at.
// ============================================================

import { countUnreadInbox } from './pulse-store.js';

const CSS_ID = 'yanta-pulse-badge-css';
const BADGE_CLASS = 'yanta-pulse-sidebar-badge';

let installed = false;

function injectCss() {
  if (document.getElementById(CSS_ID)) return;

  const style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = `
/* Own anchor rather than relying on the chat badge's stylesheet. */
[data-sidebar-foot-action="ai"] {
  position: relative;
}

.${BADGE_CLASS} {
  position: absolute;
  top: -2px;
  right: -1px;

  min-width: 14px;
  height: 14px;
  padding: 0 4px;

  display: inline-grid;
  place-items: center;

  border-radius: 999px;
  background: var(--accent, #6ea8fe);
  box-shadow: 0 0 0 2px var(--bg-elev);

  color: #fff;
  font-size: 10px;
  font-weight: 850;
  line-height: 1;

  pointer-events: none;
}
`;

  document.head.append(style);
}

function aiButtons() {
  return [...document.querySelectorAll('[data-sidebar-foot-action="ai"]')];
}

export function renderPulseBadge(count = 0) {
  injectCss();

  const n = Math.max(0, Number(count) || 0);

  for (const button of aiButtons()) {
    let badge = button.querySelector(`:scope > .${BADGE_CLASS}`);

    if (!n) {
      badge?.remove();
      button.removeAttribute('data-pulse-unread');
      continue;
    }

    if (!badge) {
      badge = document.createElement('span');
      badge.className = BADGE_CLASS;
      button.append(badge);
    }

    badge.textContent = n > 9 ? '9+' : String(n);
    button.dataset.pulseUnread = String(n);
  }
}

export async function refreshPulseBadge() {
  const count = await countUnreadInbox().catch(() => 0);

  renderPulseBadge(count);

  return count;
}

export function setupPulseBadge() {
  if (installed) return;
  installed = true;

  window.addEventListener('yanta-pulse-inbox-changed', (event) => {
    renderPulseBadge(event.detail?.unread || 0);
  });

  // Footer actions re-render on resize; restore the badge afterwards.
  window.addEventListener('yanta-sidebar-resized', () => {
    refreshPulseBadge().catch(() => {});
  });

  refreshPulseBadge().catch(() => {});
}
