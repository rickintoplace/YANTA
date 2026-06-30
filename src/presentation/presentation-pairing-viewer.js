import {
  escapeHtml,
  escapeAttr,
  lucide,
  uid,
} from '../core.js';

import {
  renderBrandedQrSvg,
} from '../qr.js';

import {
  BRAND_LOGO_SVG,
} from '../brand-logo.js';

const SIGNALING_URL =
  import.meta.env.VITE_YANTA_SIGNALING_URL ||
  'wss://yanta-signaling-932960946294.europe-west1.run.app';

function base64UrlEncodeString(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  let bin = '';

  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }

  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomToken() {
  if (crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '') + uid();
  }

  return uid() + uid() + Date.now().toString(36);
}

function createDisplayPairingPayload() {
  return {
    v: 1,
    kind: 'yanta-presentation-display-pairing',
    topic: `present-pair-${randomToken()}-${Date.now()}`,
    token: randomToken() + randomToken(),
    origin: location.origin,
    createdAt: Date.now(),
  };
}

function pairingUrl(payload) {
  const encoded = base64UrlEncodeString(JSON.stringify(payload));

  return `${location.origin}/#present-pair=${encodeURIComponent(encoded)}`;
}

function injectCss() {
  if (document.getElementById('yanta-presentation-pairing-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-presentation-pairing-css';
  style.textContent = `
html.yanta-presentation-pair-page,
body.yanta-presentation-pair-page {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;

  background: #141414;
  color: #e8e6e3;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Helvetica,
    Arial,
    sans-serif;
}

.yanta-present-pair-shell {
  position: fixed;
  inset: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  padding: 24px;
  background:
    radial-gradient(circle at 50% 20%, rgba(110,168,254,.18), transparent 34%),
    #141414;
}

.yanta-present-pair-card {
  width: min(520px, 94vw);

  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 18px;

  padding: 24px;

  border: 1px solid #333;
  border-radius: 24px;

  background: rgba(28,28,28,.92);
  box-shadow:
    0 28px 90px rgba(0,0,0,.48),
    0 1px 0 rgba(255,255,255,.05) inset;

  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.yanta-present-pair-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.yanta-present-pair-brand .brand-mark {
  width: 34px;
  height: 34px;
  display: inline-flex;
}

.yanta-present-pair-brand strong {
  font-size: 15px;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.yanta-present-pair-hero {
  text-align: center;
}

.yanta-present-pair-hero h1 {
  margin: 6px 0 6px;
  font-size: clamp(24px, 5vw, 42px);
  line-height: 1.05;
  letter-spacing: -0.045em;
}

.yanta-present-pair-hero p {
  margin: 0;
  color: #aaa5a0;
  font-size: 14px;
  line-height: 1.55;
}

.yanta-present-pair-qr {
  display: flex;
  justify-content: center;

  padding: 18px;
  border-radius: 22px;
  background: white;
}

.yanta-present-pair-qr svg {
  display: block;
  max-width: 100%;
  height: auto;
}

.yanta-present-pair-status {
  min-height: 44px;

  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  padding: 10px 12px;
  border: 1px solid #333;
  border-radius: 14px;

  background: #202020;
  color: #aaa5a0;

  font-size: 13px;
  line-height: 1.4;
  text-align: center;
}

.yanta-present-pair-status.connected {
  color: #4ade80;
  border-color: rgba(74,222,128,.38);
  background: rgba(74,222,128,.08);
}

.yanta-present-pair-status.error {
  color: #f87171;
  border-color: rgba(248,113,113,.48);
  background: rgba(248,113,113,.08);
}

.yanta-present-pair-actions {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}

.yanta-present-pair-actions input {
  min-width: 0;
  height: 38px;

  padding: 0 10px;
  border: 1px solid #333;
  border-radius: 10px;

  background: #141414;
  color: #e8e6e3;

  font-family:
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Consolas,
    monospace;
  font-size: 11px;
}

.yanta-present-pair-btn {
  min-height: 38px;
  padding: 0 12px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;

  border: 1px solid #333;
  border-radius: 10px;

  background: #242424;
  color: #e8e6e3;

  font-size: 13px;
  font-weight: 800;

  cursor: pointer;
}

.yanta-present-pair-btn:hover {
  background: #2e2e2e;
}

.yanta-present-pair-small {
  color: #77716c;
  font-size: 12px;
  line-height: 1.45;
  text-align: center;
}

@media (max-width: 620px) {
  .yanta-present-pair-actions {
    grid-template-columns: 1fr;
  }
}
  `;

  document.head.append(style);
}

function setStatus(message, className = '') {
  const node = document.querySelector('[data-present-pair-status]');
  if (!node) return;

  node.className = `yanta-present-pair-status ${className}`.trim();
  node.innerHTML = message;
}

function connectDisplaySocket(payload) {
  const ws = new WebSocket(SIGNALING_URL);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({
      type: 'subscribe',
      topics: [payload.topic],
    }));

    setStatus(`${lucide('wifi', 15)} Waiting for your phone…`);
  });

  ws.addEventListener('message', (event) => {
    let msg = null;

    try {
      msg = JSON.parse(event.data);
    } catch {}

    const data = msg?.data;

    if (!data || data.token !== payload.token) return;

    if (data.kind === 'presentation-link' && data.url) {
      setStatus(`${lucide('check', 15)} Presentation received. Opening…`, 'connected');

      window.setTimeout(() => {
        location.assign(data.url);
      }, 450);
    }

    if (data.kind === 'pairing-error') {
      setStatus(
        `${lucide('triangle-alert', 15)} ${escapeHtml(data.message || 'Could not start presentation')}`,
        'error'
      );
    }
  });

  ws.addEventListener('close', () => {
    setStatus(`${lucide('wifi-off', 15)} Connection closed. Refresh this page to try again.`, 'error');
  });

  ws.addEventListener('error', () => {
    setStatus(`${lucide('wifi-off', 15)} Could not connect to pairing server.`, 'error');
  });

  return ws;
}

export function mountPresentationPairingViewer() {
  document.documentElement.classList.add('yanta-presentation-pair-page');
  document.body.classList.add('yanta-presentation-pair-page');

  injectCss();

  const payload = createDisplayPairingPayload();
  const url = pairingUrl(payload);

  document.body.innerHTML = `
    <main class="yanta-present-pair-shell">
      <section class="yanta-present-pair-card">
        <div class="yanta-present-pair-brand">
          <span class="brand-mark">${BRAND_LOGO_SVG}</span>
          <strong>YANTA Present</strong>
        </div>

        <div class="yanta-present-pair-hero">
          <h1>Pair this display</h1>
          <p>
            Scan this QR code with your phone to send a YANTA presentation
            to this device.
          </p>
        </div>

        <div class="yanta-present-pair-qr" data-present-pair-qr></div>

        <div class="yanta-present-pair-status" data-present-pair-status>
          ${lucide('loader-circle', 15)}
          Preparing pairing…
        </div>

        <div class="yanta-present-pair-actions">
          <input readonly value="${escapeAttr(url)}" data-present-pair-url />
          <button class="yanta-present-pair-btn" type="button" data-present-pair-copy>
            ${lucide('copy', 14)}
            Copy
          </button>
        </div>

        <div class="yanta-present-pair-small">
          No YANTA login is required on this device. The presentation will open only after your phone approves it.
        </div>
      </section>
    </main>
  `;

  document.querySelector('[data-present-pair-qr]')?.append(renderBrandedQrSvg(url, {
    size: 260,
    logo: BRAND_LOGO_SVG,
  }));

  document.querySelector('[data-present-pair-copy]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      setStatus(`${lucide('check', 15)} Pairing link copied.`, 'connected');
    } catch {
      setStatus(`${lucide('triangle-alert', 15)} Copy failed.`, 'error');
    }
  });

  connectDisplaySocket(payload);
}