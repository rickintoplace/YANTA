// ============================================================
// YANTA Sync2 — Auth-required notice
//
// BYO providers (Google Drive) cannot refresh tokens silently in
// every browser. When background sync hits EAUTH_REQUIRED it must
// not fail silently: the user believes they are synced. This card
// surfaces the state once per session with a one-click reconnect.
// ============================================================

import {
  lucide,
  toast,
} from '../core.js';

let shownThisSession = false;
let root = null;

function injectCss() {
  if (document.getElementById('yanta-sync-auth-notice-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-sync-auth-notice-css';
  style.textContent = `
.yanta-sync-auth-notice {
  position: fixed;
  right: max(18px, env(safe-area-inset-right));
  bottom: max(18px, env(safe-area-inset-bottom));
  z-index: 240;

  width: min(420px, calc(100vw - 28px));

  display: flex;
  flex-direction: column;
  gap: 10px;

  padding: 14px;

  border: 1px solid color-mix(in srgb, var(--yellow, #fbbf24) 45%, var(--border));
  border-radius: 16px;

  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--yellow, #fbbf24) 8%, var(--bg-elev)),
      var(--bg-elev)
    );

  color: var(--text);

  box-shadow:
    0 24px 80px rgba(0,0,0,0.42),
    0 1px 0 rgba(255,255,255,0.04) inset;

  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.yanta-sync-auth-notice[hidden] {
  display: none !important;
}

.yanta-sync-auth-notice-head {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}

.yanta-sync-auth-notice-icon {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;

  color: var(--yellow, #fbbf24);
  background: color-mix(in srgb, var(--yellow, #fbbf24) 14%, transparent);
}

.yanta-sync-auth-notice-main {
  flex: 1;
  min-width: 0;
}

.yanta-sync-auth-notice-main strong {
  display: block;
  color: var(--text);
  font-size: 14px;
  line-height: 1.25;
}

.yanta-sync-auth-notice-main p {
  margin: 4px 0 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.yanta-sync-auth-notice-close {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border: 0;
  border-radius: 999px;

  background: transparent;
  color: var(--text-faint);

  cursor: pointer;
}

.yanta-sync-auth-notice-close:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}

.yanta-sync-auth-notice-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
}
`;

  document.head.append(style);
}

function hide() {
  if (root) root.hidden = true;
}

/**
 * Show the "sync signed out" card. Once per session, so a failing
 * background sync loop cannot nag.
 */
export function notifySyncAuthRequired({
  provider = 'google-drive',
} = {}) {
  if (shownThisSession) return;
  shownThisSession = true;

  injectCss();

  if (!root) {
    root = document.createElement('div');
    root.className = 'yanta-sync-auth-notice';
    document.body.append(root);
  }

  root.innerHTML = `
    <div class="yanta-sync-auth-notice-head">
      <span class="yanta-sync-auth-notice-icon">
        ${lucide('cloud-alert', 18)}
      </span>

      <span class="yanta-sync-auth-notice-main">
        <strong>Sync is paused — sign-in needed</strong>
        <p>
          Google Drive signed this device out, so your changes are currently
          only stored locally. Reconnect to resume encrypted sync.
        </p>
      </span>

      <button class="yanta-sync-auth-notice-close" data-dismiss title="Dismiss">
        ${lucide('x', 15)}
      </button>
    </div>

    <div class="yanta-sync-auth-notice-actions">
      <button class="btn primary" data-reconnect>
        ${lucide('refresh-cw', 14)}
        Reconnect Google Drive
      </button>
    </div>
  `;

  root.hidden = false;

  root.querySelector('[data-dismiss]')?.addEventListener('click', hide);

  root.querySelector('[data-reconnect]')?.addEventListener('click', async () => {
    hide();

    try {
      if (provider === 'google-drive') {
        const { openGoogleDriveSyncSetup } = await import('./sync-setup-ui.js');
        openGoogleDriveSyncSetup();
      } else {
        const { openYantaCloudSetup } = await import('./yanta-cloud-setup-ui.js');
        await openYantaCloudSetup();
      }
    } catch (err) {
      console.error('[YANTA Sync2] could not open reconnect setup', err);
      toast('Could not open sync setup', 'error');
    }
  });
}
