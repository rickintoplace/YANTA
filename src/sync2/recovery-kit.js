// ============================================================
// YANTA Sync2 — Printable Recovery Kit
//
// A single-page, print-friendly document (à la 1Password Emergency
// Kit) containing the Recovery Key, a pairing QR code and plain-
// language restore instructions. Zero-knowledge means YANTA cannot
// restore a vault without this key — so the kit is the user's only
// guaranteed way back in.
// ============================================================

import {
  createSync2PairingUrl,
  renderSync2QrSvg,
} from './pairing.js';

import { BRAND_LOGO_SVG } from '../brand-logo.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

/*
  Groups of 4 make the key realistic to type by hand from paper.
  Restore flows strip whitespace before parsing, so the grouped
  form is directly usable.
*/
function formatKeyForPrint(syncKey) {
  return String(syncKey || '').match(/.{1,4}/g)?.join(' ') || '';
}

/**
 * Normalize hand-entered recovery input into a bare sync key.
 *
 * Accepts the key as printed in the Recovery Kit (grouped with spaces),
 * a plain base64url key, or the downloaded recovery JSON file pasted
 * verbatim. Pairing links/payloads are NOT handled here — callers try
 * those first.
 */
export function extractSyncKeyFromRecoveryInput(raw) {
  const text = String(raw || '').trim();

  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(text);

      if (json?.syncKey) {
        return String(json.syncKey).trim();
      }
    } catch {}
  }

  return text.replace(/\s+/g, '');
}

function providerLabel(provider) {
  return provider === 'yanta-cloud'
    ? 'YANTA Cloud'
    : 'Google Drive (own storage)';
}

function restoreStepsHtml(provider) {
  const origin = escapeHtml(location.origin);

  const commonFirst = `Open <strong>${origin}</strong> on the new device.`;

  if (provider === 'yanta-cloud') {
    return `
      <ol>
        <li>${commonFirst}</li>
        <li>Go to <strong>Settings → YANTA Cloud Sync</strong> and choose <strong>Connect existing vault</strong>.</li>
        <li>Sign in with the account email shown on this page.</li>
        <li>Scan the QR code below — or type the Recovery Key (spaces don't matter).</li>
        <li>Your encrypted vault is pulled and decrypted on the device.</li>
      </ol>
    `;
  }

  return `
    <ol>
      <li>${commonFirst}</li>
      <li>Go to <strong>Settings → Advanced: Google Drive Sync</strong> and choose <strong>Enter Sync Key</strong>.</li>
      <li>Sign in to the same Google account that holds the encrypted sync data.</li>
      <li>Scan the QR code below — or type the Recovery Key (spaces don't matter).</li>
      <li>Your encrypted vault is pulled and decrypted on the device.</li>
    </ol>
  `;
}

function recoveryKitHtml({
  provider,
  vaultId,
  syncKey,
  accountEmail,
  qrSvgHtml,
}) {
  const createdAt = new Date().toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>YANTA Recovery Kit</title>
<style>
  :root {
    color-scheme: light;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    padding: 40px 44px;

    color: #1f1e1c;
    background: #ffffff;

    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 13.5px;
    line-height: 1.6;
  }

  header {
    display: flex;
    align-items: center;
    gap: 14px;

    padding-bottom: 18px;
    margin-bottom: 24px;
    border-bottom: 2px solid #1f1e1c;
  }

  header svg {
    width: 40px;
    height: 40px;
  }

  header h1 {
    margin: 0;
    font-size: 24px;
    letter-spacing: -0.02em;
  }

  header p {
    margin: 2px 0 0;
    color: #5a5854;
    font-size: 12.5px;
  }

  .spacer {
    flex: 1;
  }

  .created {
    color: #5a5854;
    font-size: 11.5px;
    text-align: right;
  }

  .warning {
    padding: 12px 16px;
    margin-bottom: 22px;

    border: 1.5px solid #1f1e1c;
    border-radius: 10px;

    font-size: 13px;
  }

  .warning strong {
    display: block;
    margin-bottom: 2px;
  }

  h2 {
    margin: 26px 0 8px;
    font-size: 15px;
    letter-spacing: -0.01em;
  }

  .facts {
    width: 100%;
    border-collapse: collapse;
  }

  .facts td {
    padding: 5px 0;
    border-bottom: 1px solid #e2e0dc;
    vertical-align: top;
  }

  .facts td:first-child {
    width: 160px;
    color: #5a5854;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .key {
    padding: 16px 18px;

    border: 1.5px dashed #1f1e1c;
    border-radius: 10px;

    font-family: ui-monospace, SFMono-Regular, "Cascadia Code", Menlo, Consolas, monospace;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: 0.06em;
    word-break: break-all;
    word-spacing: 0.35em;
  }

  .restore {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 24px;
    align-items: start;
  }

  .restore ol {
    margin: 0;
    padding-left: 20px;
  }

  .restore li {
    margin-bottom: 5px;
  }

  .qr {
    padding: 10px;
    border: 1px solid #e2e0dc;
    border-radius: 12px;
  }

  .qr svg {
    display: block;
    width: 180px;
    height: 180px;
  }

  footer {
    margin-top: 30px;
    padding-top: 12px;
    border-top: 1px solid #e2e0dc;

    color: #8a8884;
    font-size: 11px;
  }

  @media print {
    body {
      padding: 24px 28px;
    }
  }

  @page {
    size: A4;
    margin: 12mm;
  }
</style>
</head>
<body>
  <header>
    ${BRAND_LOGO_SVG}
    <div>
      <h1>YANTA Recovery Kit</h1>
      <p>Your encrypted vault's master key — keep this page safe and offline.</p>
    </div>
    <span class="spacer"></span>
    <div class="created">
      Created<br>${escapeHtml(createdAt)}
    </div>
  </header>

  <div class="warning">
    <strong>Anyone with this page can read your notes.</strong>
    YANTA is zero-knowledge: your notes are encrypted with this key before they leave your device,
    and YANTA cannot reset or recover it. Store this page like a passport — a safe, a locked drawer,
    or a sealed envelope. Do not photograph it into a cloud photo library.
  </div>

  <h2>Vault details</h2>
  <table class="facts">
    <tr>
      <td>Storage</td>
      <td>${escapeHtml(providerLabel(provider))}</td>
    </tr>
    ${
      accountEmail
        ? `<tr><td>Account email</td><td>${escapeHtml(accountEmail)}</td></tr>`
        : ''
    }
    ${
      vaultId
        ? `<tr><td>Vault ID</td><td>${escapeHtml(vaultId)}</td></tr>`
        : ''
    }
    <tr>
      <td>App</td>
      <td>${escapeHtml(location.origin)}</td>
    </tr>
  </table>

  <h2>Recovery Key</h2>
  <div class="key">${escapeHtml(formatKeyForPrint(syncKey))}</div>

  <h2>How to restore your vault</h2>
  <div class="restore">
    ${restoreStepsHtml(provider)}
    <div class="qr">${qrSvgHtml}</div>
  </div>

  <footer>
    The QR code contains the Recovery Key as a pairing link — scanning it is equivalent to typing the key.
    If you stop using YANTA, destroy this page.
  </footer>
</body>
</html>`;
}

/**
 * Open the OS print dialog with a one-page Recovery Kit.
 *
 * Must be called from a user gesture (button click) so the print
 * window is not popup-blocked.
 */
export async function printRecoveryKit({
  provider = 'yanta-cloud',
  vaultId = '',
  syncKey,
  accountEmail = '',
} = {}) {
  if (!syncKey) {
    throw new Error('Recovery Key is not available on this device.');
  }

  const pairingUrl = await createSync2PairingUrl({
    provider,
    cloud: provider === 'yanta-cloud'
      ? { vaultId }
      : null,
  });

  const qrSvg = renderSync2QrSvg(pairingUrl, 180);

  const html = recoveryKitHtml({
    provider,
    vaultId,
    syncKey,
    accountEmail,
    qrSvgHtml: qrSvg?.outerHTML || '',
  });

  const win = window.open('', '_blank', 'width=900,height=1000');

  if (!win) {
    throw new Error('Popup blocked. Allow popups for this site to print the Recovery Kit.');
  }

  win.document.open();
  win.document.write(html);
  win.document.close();

  /*
    Warum: Safari/Firefox drucken sonst eine halb gerenderte Seite — erst
    nach load ist das QR-SVG sicher gelayoutet. Manche Browser feuern load
    nach document.close() aber nicht mehr, daher zusätzlich ein Timeout.
  */
  let printed = false;

  const doPrint = () => {
    if (printed) return;
    printed = true;

    win.focus();
    win.print();
  };

  win.addEventListener('load', doPrint);
  win.setTimeout(doPrint, 600);
}
