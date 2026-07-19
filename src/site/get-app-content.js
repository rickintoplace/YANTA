// ============================================================
// YANTA — /get-app landing page
//
// A focused "get the mobile app" page. Store options lead (sideloading
// is increasingly restricted); a direct APK is offered only when a
// download URL is configured. Desktop visitors get a QR to continue on
// their phone. Rendered inside the shared site shell (see site-pages.js).
// ============================================================

import { renderBrandedQrSvg } from '../qr.js';
import { BRAND_LOGO_SVG } from '../brand-logo.js';
import {
  appStoreTargets,
  getAppUrl,
} from '../install/install-manager.js';
import { installEnvironment } from '../install/install-environment.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const PLAY_BADGE_SVG = `
<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
  <path fill="#EA4335" d="M3.6 2.2 13.4 12 3.6 21.8c-.3-.2-.5-.6-.5-1V3.2c0-.4.2-.8.5-1z" opacity="0"/>
  <path fill="#00D2FF" d="M3.9 2 14 12 3.9 22a1 1 0 0 1-.6-.9V2.9c0-.4.2-.7.6-.9z"/>
  <path fill="#00E676" d="M3.9 2c.2-.1.5-.1.8.05l12 6.9-2.7 2.7L3.9 2z"/>
  <path fill="#FF3D00" d="M17.9 8.95 21 10.7c.7.4.7 1.4 0 1.8L17.7 14l-3.7-2 3.9-3.05z"/>
  <path fill="#FFC107" d="M4.7 22c-.3.15-.6.15-.8.05l10.1-10 2.7 2.7L4.7 22z"/>
</svg>`;

/**
 * The page body HTML. Wire it up with wireGetAppPage() after mounting.
 */
export function getAppContent() {
  const env = installEnvironment();
  const { play, apk } = appStoreTargets();

  const onPhone = env.mobile;

  const heroLead = onPhone
    ? 'Install the YANTA app for reliable, exactly-timed reminders and instant chat notifications.'
    : 'YANTA’s mobile app delivers your reminders and chat messages as reliable system notifications. Scan the code to install it on your phone.';

  const storeButtons = `
    <div class="yanta-getapp-stores">
      <a class="yanta-getapp-store primary" href="${escapeHtml(play)}" target="_blank" rel="noopener">
        <span class="yanta-getapp-store-icon">${PLAY_BADGE_SVG}</span>
        <span class="yanta-getapp-store-text">
          <small>Get it on</small>
          <strong>Google Play</strong>
        </span>
      </a>
      ${
        apk
          ? `
        <a class="yanta-getapp-store" href="${escapeHtml(apk)}" rel="noopener" download>
          <span class="yanta-getapp-store-icon">${downloadIcon()}</span>
          <span class="yanta-getapp-store-text">
            <small>Advanced</small>
            <strong>Download APK</strong>
          </span>
        </a>`
          : ''
      }
    </div>
    ${
      apk
        ? `<p class="yanta-getapp-fineprint">Installing an APK directly requires allowing installs from your browser. The Play Store install is recommended.</p>`
        : ''
    }
  `;

  return `
    <section class="yanta-getapp">
      <div class="yanta-getapp-hero">
        <div class="yanta-getapp-mark">${BRAND_LOGO_SVG}</div>
        <h1>Get YANTA on your phone</h1>
        <p>${escapeHtml(heroLead)}</p>
      </div>

      <div class="yanta-getapp-grid">
        <div class="yanta-getapp-panel">
          <h2>Install the app</h2>
          ${storeButtons}
        </div>

        ${
          onPhone
            ? ''
            : `
          <div class="yanta-getapp-panel yanta-getapp-qr-panel">
            <h2>Scan to install</h2>
            <div class="yanta-getapp-qr" data-getapp-qr></div>
            <p class="yanta-getapp-qr-caption">Point your phone’s camera at the code.</p>
          </div>`
        }
      </div>

      <ul class="yanta-getapp-benefits">
        <li>${checkIcon()} Event reminders fire on time, even offline</li>
        <li>${checkIcon()} Chat messages arrive as system notifications</li>
        <li>${checkIcon()} Home-screen widgets and quick capture</li>
        <li>${checkIcon()} Same encrypted, local-first vault as the web app</li>
      </ul>

      <p class="yanta-getapp-back">
        Prefer the web? <a href="${escapeHtml(webAppOrigin())}">Open YANTA in your browser</a>.
      </p>
    </section>
  `;
}

function webAppOrigin() {
  return (import.meta.env.VITE_APP_ORIGIN || 'https://yanta.page').replace(/\/+$/, '');
}

function checkIcon() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
}

function downloadIcon() {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
}

/**
 * Injects page CSS and renders the QR for desktop visitors.
 */
export function wireGetAppPage() {
  injectGetAppCss();

  const host = document.querySelector('[data-getapp-qr]');
  if (host) {
    try {
      // Encode the page itself so a scan lands here on the phone, where
      // the store buttons take over. Works even before a store listing.
      host.append(renderBrandedQrSvg(getAppUrl(), { size: 208, logo: BRAND_LOGO_SVG }));
    } catch (err) {
      console.warn('[YANTA get-app] QR render failed', err);
    }
  }
}

function injectGetAppCss() {
  if (document.getElementById('yanta-getapp-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-getapp-css';
  style.textContent = `
.yanta-getapp {
  max-width: 860px;
  margin: 0 auto;
  padding: 8px 4px 40px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.yanta-getapp-hero { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.yanta-getapp-mark { width: 56px; height: 56px; color: var(--accent, #2f6b4f); }
.yanta-getapp-mark svg { width: 100%; height: 100%; }
.yanta-getapp-hero h1 { margin: 0; font-size: clamp(26px, 5vw, 38px); line-height: 1.15; }
.yanta-getapp-hero p { margin: 0; max-width: 46ch; color: var(--text-dim, #667); font-size: 16px; line-height: 1.6; }

.yanta-getapp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 20px;
  align-items: stretch;
}

.yanta-getapp-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  border: 1px solid var(--border, #e4e2dc);
  border-radius: 18px;
  background: var(--bg-elev, #fff);
}

.yanta-getapp-panel h2 { margin: 0; font-size: 15px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-dim, #667); }

.yanta-getapp-stores { display: flex; flex-direction: column; gap: 12px; }

.yanta-getapp-store {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 18px;
  border-radius: 12px;
  border: 1px solid var(--border, #d8d6cf);
  background: var(--bg, #faf9f6);
  color: var(--text, #1a1a1a);
  text-decoration: none;
  transition: transform .12s ease, box-shadow .12s ease;
}

.yanta-getapp-store:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,.08); }
.yanta-getapp-store.primary { background: #111; border-color: #111; color: #fff; }
.yanta-getapp-store-icon { flex: 0 0 auto; display: inline-flex; }
.yanta-getapp-store-text { display: flex; flex-direction: column; line-height: 1.15; }
.yanta-getapp-store-text small { font-size: 11px; opacity: .75; }
.yanta-getapp-store-text strong { font-size: 17px; font-weight: 650; }

.yanta-getapp-fineprint { margin: 0; font-size: 12px; color: var(--text-dim, #889); line-height: 1.5; }

.yanta-getapp-qr-panel { align-items: center; text-align: center; }
.yanta-getapp-qr { padding: 12px; background: #fff; border-radius: 14px; line-height: 0; box-shadow: 0 2px 10px rgba(0,0,0,.06); }
.yanta-getapp-qr-caption { margin: 0; font-size: 13px; color: var(--text-dim, #667); }

.yanta-getapp-benefits {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px 20px;
}

.yanta-getapp-benefits li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14.5px;
  color: var(--text, #222);
}

.yanta-getapp-benefits svg { flex: 0 0 auto; color: var(--accent, #2f6b4f); }

.yanta-getapp-back { text-align: center; margin: 0; font-size: 14px; color: var(--text-dim, #667); }
.yanta-getapp-back a { color: var(--accent, #2f6b4f); font-weight: 600; }
`;

  document.head.append(style);
}
