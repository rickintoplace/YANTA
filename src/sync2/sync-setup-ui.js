// ============================================================
// YANTA Sync2 — Cloud Sync setup UI
//
// UX goals:
// - No misleading "first/additional device" language.
// - New device flow: sign in to provider + enter Sync Key + pull immediately.
// - Copy buttons are directly next to fields.
// - Busy state prevents double-clicking while connecting.
// - Provider-neutral UI structure, Google Drive currently implemented.
// ============================================================

import {
  el,
  store,
  toast,
  lucide,
} from '../core.js';

import {
  createSync2GoogleDriveAppRuntime,
  getSync2SyncKey,
  setSync2SyncKey,
} from './app-engine.js';

import {
  vaultDevicesMap,
} from './vault-doc.js';

import {
  GoogleDriveObjectStore,
} from './google-drive-object-store.js';

import {
  createSync2PairingPayload,
  createSync2PairingUrl,
  importSync2PairingPayload,
  renderSync2QrSvg,
  scanQrWithCamera,
} from './pairing.js';

import {
  removePristineWelcomeVaultIfPresent,
} from '../notes.js';

import {
  syncKeyToBytes,
} from './crypto.js';

import {
  SYNC2_PROVIDERS,
} from './provider-registry.js';

let modal = null;
let statusEl = null;
let autoSyncStarted = false;
let pendingPairingText = '';
let busy = false;

function clientId() {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
}

function escapeHtmlLocal(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function isStandalonePwa() {
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true
  );
}

function fmtTime(ts) {
  if (!ts) return 'never';

  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'never';

  return d.toLocaleString([], {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function currentDeviceId() {
  return window.yantaSync2?.deviceId || '';
}

function collectSyncDevices() {
  try {
    return [...vaultDevicesMap().values()]
      .filter(Boolean)
      .sort((a, b) => Number(b.lastSeenAt || b.updated || 0) - Number(a.lastSeenAt || a.updated || 0));
  } catch {
    return [];
  }
}

function renderDevicesHtml() {
  const devices = collectSyncDevices();
  const current = currentDeviceId();

  if (!devices.length) {
    return `<div class="yanta-sync2-empty">No device activity recorded yet.</div>`;
  }

  return `
    <div class="yanta-sync2-device-list">
      ${devices.map((d) => `
        <div class="yanta-sync2-device ${d.id === current ? 'current' : ''}">
          <div class="yanta-sync2-device-head">
            <strong>${escapeHtmlLocal(d.name || d.id || 'Device')}</strong>
            ${d.id === current ? '<span>Current device</span>' : ''}
          </div>
          <div class="yanta-sync2-device-meta">
            <div>Last seen: ${escapeHtmlLocal(fmtTime(d.lastSeenAt))}</div>
            <div>Last sync: ${escapeHtmlLocal(fmtTime(d.lastSyncAt))}</div>
            <div>Last push: ${escapeHtmlLocal(fmtTime(d.lastPushAt))}</div>
            <div>Last pull: ${escapeHtmlLocal(fmtTime(d.lastPullAt))}</div>
            <div>Status: ${escapeHtmlLocal(d.syncStatus || 'unknown')}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function setStatus(msg = '', type = '') {
  if (!statusEl) return;

  statusEl.textContent = msg;
  statusEl.className = 'yanta-sync2-setup-status' + (type ? ` ${type}` : '');
}

function close() {
  if (modal) modal.hidden = true;
}

function copyFieldHtml({
  label,
  value,
  rows = 3,
  kind = 'textarea',
  copyLabel = 'Copy',
  placeholder = '',
  readonly = true,
} = {}) {
  const id = 'copy_' + Math.random().toString(36).slice(2);

  const field = kind === 'input'
    ? `<input id="${id}" class="text-input" value="${escapeHtmlLocal(value || '')}" ${readonly ? 'readonly' : ''} placeholder="${escapeHtmlLocal(placeholder)}" />`
    : `<textarea id="${id}" class="text-input" rows="${rows}" ${readonly ? 'readonly' : ''} placeholder="${escapeHtmlLocal(placeholder)}">${escapeHtmlLocal(value || '')}</textarea>`;

  return `
    <label class="yanta-sync2-copy-field">
      <span>${escapeHtmlLocal(label)}</span>
      <div class="yanta-sync2-copy-row">
        ${field}
        <button class="btn" type="button" data-copy-from="${id}">
          ${lucide('copy', 14)} ${escapeHtmlLocal(copyLabel)}
        </button>
      </div>
    </label>
  `;
}

function ensureModal() {
  if (modal) return modal;

  injectCss();

  modal = el('div', {
    class: 'modal yanta-sync2-setup-modal',
    hidden: true,
  });

  modal.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest?.('[data-copy-from]');

    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();

      const id = copyBtn.dataset.copyFrom;
      const field = modal.querySelector('#' + CSS.escape(id));

      if (!field) return;

      try {
        await navigator.clipboard.writeText(field.value || field.textContent || '');
        toast('Copied', 'success');
      } catch {
        toast('Copy failed', 'error');
      }

      return;
    }

    if (e.target === modal) close();
    if (e.target.closest?.('[data-sync2-close]')) close();
  });

  document.body.append(modal);

  return modal;
}

function setBusy(next, message = '') {
  busy = !!next;

  if (message) {
    setStatus(message);
  }

  if (!modal) return;

  modal.querySelectorAll('button, input, textarea, select').forEach((node) => {
    if (node.closest('[data-sync2-close]')) return;
    if (node.matches('[data-sync2-close]')) return;

    node.disabled = busy;
    node.classList.toggle('is-busy-disabled', busy);
  });
}

async function withBusy(message, fn) {
  if (busy) return null;

  setBusy(true, message);

  try {
    return await fn();
  } finally {
    setBusy(false);
  }
}

function startAutoSyncIfNeeded(engine) {
  if (!engine || autoSyncStarted) return;
  autoSyncStarted = true;

  let timer = 0;
  let running = false;

  const request = (reason = 'manual', delay = 1200) => {
    clearTimeout(timer);

    timer = window.setTimeout(async () => {
      if (running) return;
      if (navigator.onLine === false) return;

      running = true;

      try {
        await engine.syncNow({ verbose: false });
      } catch (err) {
        console.warn('[YANTA Sync2] auto sync failed:', reason, err);
      } finally {
        running = false;
      }
    }, delay);
  };

  request('startup', 1500);

  window.addEventListener('focus', () => request('focus', 300));
  window.addEventListener('online', () => request('online', 300));
  window.addEventListener('yanta-note-updated', () => request('note-updated'));
  window.addEventListener('yanta-calendar-updated', () => request('calendar-updated'));
  window.addEventListener('yanta-vault-hydrated', () => request('vault-hydrated', 2500));

  window.setInterval(() => {
    if (!document.hidden) request('interval', 0);
  }, 30_000);
}

async function connectRuntime({
  providerId = 'google-drive',
  prompt = 'consent',
} = {}) {
  const provider = SYNC2_PROVIDERS[providerId];

  if (!provider) {
    throw new Error(`Unknown sync provider: ${providerId}`);
  }

  if (providerId !== 'google-drive') {
    throw new Error(`${provider.label} setup UI is not implemented yet.`);
  }

  const id = clientId();

  if (!id) {
    throw new Error('Google Client ID missing. Set VITE_GOOGLE_CLIENT_ID.');
  }

  await store.settings.set('sync2.provider', providerId);

  try {
    window.yantaSync2?.engine?.stop?.();
  } catch {}

  const runtime = await createSync2GoogleDriveAppRuntime({
    clientId: id,
    googlePrompt: prompt,
  });

  window.yantaSync2 = runtime;

  startAutoSyncIfNeeded(runtime.engine);

  return runtime;
}

async function deleteAllGoogleDriveSyncObjects() {
  const id = clientId();

  if (!id) {
    throw new Error('Google Client ID missing. Set VITE_GOOGLE_CLIENT_ID.');
  }

  const remote = new GoogleDriveObjectStore({
    clientId: id,
    initialPrompt: 'consent',
  });

  await remote.init();

  const result = await remote.deleteAllYantaFiles({
    onProgress({ deleted, total }) {
      setStatus(`Deleting encrypted YANTA Sync data… ${deleted}/${total}`);
    },
  });

  return result.deleted;
}

function isWrongKeyError(err) {
  const msg = String(err?.message || err || '');

  return (
    err?.code === 'EWRONGKEY' ||
    err?.name === 'OperationError' ||
    msg.includes('Wrong Sync Key') ||
    msg.includes('OperationError') ||
    msg.toLowerCase().includes('decrypt')
  );
}

async function importKeyOrPairingText(text) {
  const raw = String(text || '').trim();

  if (!raw) {
    throw new Error('Enter a Sync Key or pairing link.');
  }

  try {
    return await importSync2PairingPayload(raw);
  } catch {}

  syncKeyToBytes(raw);

  await setSync2SyncKey(raw);
  await store.settings.set('sync2.provider', 'google-drive');

  return {
    v: 1,
    app: 'YANTA',
    kind: 'sync2-manual-key',
    provider: 'google-drive',
    syncKey: raw,
  };
}

async function setupCreateNewSyncVault() {
  try {
    setStatus('Connecting to Google Drive…');

    let runtime;

    try {
      runtime = await connectRuntime({
        providerId: 'google-drive',
        prompt: 'consent',
      });
    } catch (err) {
      if (!isWrongKeyError(err)) throw err;

      renderWrongKeyResetView();
      return;
    }

    setStatus('Uploading encrypted full snapshot…');

    await runtime.pushFullStateNow({
      includeSnapshots: true,
      verbose: false,
    });

    setStatus('Creating pairing QR…');

    const pairingUrl = await createSync2PairingUrl({
      provider: 'google-drive',
    });

    const rawPayload = await createSync2PairingPayload({
      provider: 'google-drive',
    });

    await renderConnectedView({
      pairingUrl,
      rawPayload,
      syncKey: runtime.syncKey,
    });

    toast('Google Drive Sync enabled', 'success');
  } catch (err) {
    console.error(err);
    setStatus(err?.message || String(err), 'error');
    toast('Google Drive Sync setup failed', 'error');
  }
}

async function connectExistingDeviceWithText(text) {
  try {
    setStatus('Reading Sync Key or pairing link…');

    await importKeyOrPairingText(text);

    setStatus('Removing untouched local Welcome vault if present…');

    await removePristineWelcomeVaultIfPresent({
      reason: 'cloud-sync-connect',
    });

    setStatus('Connecting to Google Drive…');

    const runtime = await connectRuntime({
      providerId: 'google-drive',
      prompt: 'consent',
    });

    setStatus('Pulling and decrypting vault…');

    await runtime.syncNow({
      verbose: false,
      pullSnapshots: true,
    });

    const pairingUrl = await createSync2PairingUrl({
      provider: 'google-drive',
    });

    const rawPayload = await createSync2PairingPayload({
      provider: 'google-drive',
    });

    await renderConnectedView({
      pairingUrl,
      rawPayload,
      syncKey: runtime.syncKey,
    });

    setStatus('Sync complete', 'success');
    toast('Device connected and pulled', 'success');
  } catch (err) {
    console.error(err);

    const msg = isWrongKeyError(err)
      ? (
          'Wrong Sync Key. This key or link does not match the encrypted data in this Google Drive account.\n\n' +
          'Check that you selected the same Google account as the device that created the sync vault.'
        )
      : err?.message || String(err);

    setStatus(msg, 'error');
    toast('Cloud Sync connect failed', 'error');
  }
}

function renderWrongKeyResetView() {
  const m = ensureModal();

  m.innerHTML = `
    <div class="modal-card yanta-sync2-setup-card">
      <header class="modal-head">
        <h3>Existing encrypted sync data found</h3>
        <button class="icon-btn" data-sync2-close>&times;</button>
      </header>

      <div class="modal-body yanta-sync2-setup-body">
        <div class="yanta-sync2-warning">
          <strong>Wrong Sync Key:</strong>
          Google Drive already contains encrypted YANTA Sync data that cannot be decrypted with this browser's local key.
        </div>

        <section class="yanta-sync2-choice">
          <h4>Connect this device instead</h4>
          <p>Use the Sync Key or pairing link from a device that already belongs to this sync vault.</p>
          <button class="btn" data-action="connect-existing">
            ${lucide('key', 14)} Enter Sync Key
          </button>
        </section>

        <section class="yanta-sync2-choice danger-zone">
          <h4>Delete old cloud sync data</h4>
          <p>Only use this for old test data or if you are sure this Google Drive sync vault is no longer needed.</p>
          <button class="btn danger" data-action="delete-create">
            ${lucide('trash', 14)} Delete cloud sync data and create new
          </button>
        </section>

        <div class="yanta-sync2-setup-status" data-status></div>
      </div>
    </div>
  `;

  statusEl = m.querySelector('[data-status]');

  m.querySelector('[data-action="connect-existing"]')?.addEventListener('click', renderConnectExistingView);

  m.querySelector('[data-action="delete-create"]')?.addEventListener('click', () => {
    withBusy('Deleting encrypted YANTA Sync data from Google Drive…', async () => {
      const deleted = await deleteAllGoogleDriveSyncObjects();

      setStatus(`Deleted ${deleted} object${deleted === 1 ? '' : 's'}. Creating new sync…`);

      await setupCreateNewSyncVault();
    }).catch((err) => {
      console.error(err);
      setStatus(err?.message || String(err), 'error');
      toast('Reset failed', 'error');
    });
  });
}

async function resetGoogleDriveSyncData() {
  try {
    setStatus('Connecting to Google Drive to delete sync data…');

    const count = await deleteAllGoogleDriveSyncObjects();

    await store.settings.set('sync2.provider', null);

    try {
      window.yantaSync2?.engine?.stop?.();
    } catch {}

    window.yantaSync2 = null;

    setStatus(`Deleted ${count} Google Drive sync object${count === 1 ? '' : 's'}.`, 'success');
    toast('Google Drive Sync data reset', 'success');
  } catch (err) {
    console.error(err);
    setStatus(err?.message || String(err), 'error');
    toast('Reset failed', 'error');
  }
}

function renderStartView() {
  const m = ensureModal();

  m.innerHTML = `
    <div class="modal-card yanta-sync2-setup-card">
      <header class="modal-head">
        <h3>Cloud Sync</h3>
        <button class="icon-btn" data-sync2-close>&times;</button>
      </header>

      <div class="modal-body yanta-sync2-setup-body">
        <div class="yanta-sync2-setup-hero">
          <div class="yanta-sync2-setup-icon">${lucide('cloud', 28)}</div>
          <div>
            <strong>Encrypted sync via Google Drive</strong>
            <p>YANTA stores only encrypted objects in your hidden Google Drive app data folder.</p>
          </div>
        </div>

        <div class="yanta-sync2-warning">
          <strong>Important:</strong> The Sync Key and pairing link can decrypt your YANTA vault.
          Keep them private.
        </div>

        <section class="yanta-sync2-choice">
          <h4>Create a new encrypted sync vault</h4>
          <p>Use this when this device should upload the current local vault as the starting point.</p>
          <button class="btn primary" data-action="create-new">
            ${lucide('cloud-upload', 14)} Create new sync vault
          </button>
        </section>

        <section class="yanta-sync2-choice">
          <h4>Connect this device to existing sync</h4>
          <p>Sign in to the same Google account, enter the Sync Key, and pull the encrypted vault immediately.</p>

          <div class="compress-actions" style="justify-content:flex-start;flex-wrap:wrap">
            <button class="btn primary" data-action="connect-existing">
              ${lucide('key', 14)} Enter Sync Key
            </button>
            <button class="btn" data-action="scan">
              ${lucide('qr-code', 14)} Scan QR
            </button>
          </div>
        </section>

        <section class="yanta-sync2-choice danger-zone">
          <h4>Reset cloud sync data</h4>
          <p>Connect to Google and delete encrypted YANTA Sync data from the hidden appDataFolder.</p>
          <button class="btn danger" data-action="reset">
            ${lucide('trash', 14)} Connect and delete Google Drive Sync data
          </button>
        </section>

        <div class="yanta-sync2-setup-status" data-status></div>
      </div>
    </div>
  `;

  statusEl = m.querySelector('[data-status]');

  m.querySelector('[data-action="create-new"]')?.addEventListener('click', () => {
    withBusy('Connecting to Google Drive…', setupCreateNewSyncVault);
  });

  m.querySelector('[data-action="connect-existing"]')?.addEventListener('click', renderConnectExistingView);

  m.querySelector('[data-action="scan"]')?.addEventListener('click', () => {
    withBusy('Starting camera…', async () => {
      const text = await scanQrWithCamera();
      pendingPairingText = text;
      renderConnectExistingView(text);
      setStatus('QR code read. Continue to pull.', 'success');
    }).catch((err) => {
      console.error(err);
      setStatus(err?.message || String(err), 'error');
    });
  });

  m.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
    withBusy('Connecting to Google Drive to delete sync data…', resetGoogleDriveSyncData);
  });

  m.hidden = false;
}

function renderConnectExistingView(initialText = pendingPairingText) {
  const standalone = isStandalonePwa();
  const m = ensureModal();

  m.innerHTML = `
    <div class="modal-card yanta-sync2-setup-card">
      <header class="modal-head">
        <h3>Connect this device</h3>
        <button class="icon-btn" data-sync2-close>&times;</button>
      </header>

      <div class="modal-body yanta-sync2-setup-body">
        <div class="yanta-sync2-setup-hero">
          <div class="yanta-sync2-setup-icon">${lucide('key', 28)}</div>
          <div>
            <strong>Use an existing encrypted sync vault</strong>
            <p>Enter the Sync Key or pairing link, sign in to the same Google account, and pull immediately.</p>
          </div>
        </div>

        ${
          standalone
            ? ''
            : `
              <div class="yanta-sync2-browser-warning">
                <strong>You are in a browser tab.</strong>
                If you installed YANTA as a PWA but this opened in the wrong browser,
                open the installed app and paste the key or scan the QR there.
              </div>
            `
        }

        <label class="yanta-sync2-copy-field">
          <span>Sync Key or pairing link</span>
          <textarea class="text-input" data-pairing rows="7" placeholder="Paste Sync Key, https://.../#sync2=..., or yanta-sync:...">${escapeHtmlLocal(initialText || '')}</textarea>
        </label>

        <div class="compress-actions">
          <button class="btn" data-action="back">Back</button>
          <button class="btn" data-action="paste-clipboard">
            ${lucide('clipboard', 14)} Paste from clipboard
          </button>
          <button class="btn primary" data-action="connect-pull">
            ${lucide('cloud-download', 14)} Connect & Pull
          </button>
        </div>

        <div class="yanta-sync2-setup-status" data-status></div>
      </div>
    </div>
  `;

  statusEl = m.querySelector('[data-status]');

  m.querySelector('[data-action="back"]')?.addEventListener('click', renderStartView);

  m.querySelector('[data-action="paste-clipboard"]')?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const input = m.querySelector('[data-pairing]');
      if (input) input.value = text || '';
      toast('Pasted from clipboard', 'success');
    } catch {
      toast('Clipboard paste failed', 'error');
    }
  });

  m.querySelector('[data-action="connect-pull"]')?.addEventListener('click', () => {
    withBusy('Connecting to Google Drive…', async () => {
      const text = m.querySelector('[data-pairing]')?.value || '';
      await connectExistingDeviceWithText(text);
    });
  });
}

async function renderConnectedView({
  pairingUrl,
  rawPayload,
  syncKey,
}) {
  const m = ensureModal();
  const key = syncKey || await getSync2SyncKey();

  m.innerHTML = `
    <div class="modal-card yanta-sync2-setup-card">
      <header class="modal-head">
        <h3>Cloud Sync is active</h3>
        <button class="icon-btn" data-sync2-close>&times;</button>
      </header>

      <div class="modal-body yanta-sync2-setup-body">
        <div class="yanta-sync2-setup-hero">
          <div class="yanta-sync2-setup-icon ok">${lucide('check', 28)}</div>
          <div>
            <strong>Encrypted sync enabled</strong>
            <p>Use the pairing link, QR code, or Sync Key to connect another device.</p>
          </div>
        </div>

        <div class="yanta-sync2-qr" data-qr></div>

        <div class="yanta-sync2-warning">
          <strong>Keep private:</strong> This QR/link contains your Sync Key.
          Anyone with it can decrypt your YANTA vault.
        </div>

        <section class="yanta-sync2-choice">
          <h4>Devices</h4>
          ${renderDevicesHtml()}
        </section>

        ${copyFieldHtml({
          label: 'Pairing link',
          value: pairingUrl || '',
          rows: 4,
        })}

        ${copyFieldHtml({
          label: 'Raw pairing text',
          value: rawPayload || '',
          rows: 4,
        })}

        ${copyFieldHtml({
          label: 'Sync Key',
          value: key,
          kind: 'input',
        })}

        <div class="compress-actions">
          <button class="btn" data-action="sync-now">
            ${lucide('refresh-cw', 14)} Sync now
          </button>
          <button class="btn" data-action="new-device">
            ${lucide('smartphone', 14)} Connect another device
          </button>
          <button class="btn primary" data-sync2-close>Done</button>
        </div>

        <div class="yanta-sync2-setup-status" data-status></div>
      </div>
    </div>
  `;

  statusEl = m.querySelector('[data-status]');

  m.querySelector('[data-qr]')?.append(renderSync2QrSvg(pairingUrl, 240));

  m.querySelector('[data-action="sync-now"]')?.addEventListener('click', () => {
    withBusy('Synchronizing…', async () => {
      if (typeof window.yantaSync2Now === 'function') {
        await window.yantaSync2Now({
          interactive: true,
          catchUp: true,
        });
      } else {
        await window.yantaSync2?.syncNow?.({
          verbose: false,
          pullSnapshots: true,
        });
      }

      setStatus('Sync complete', 'success');
      toast('Sync complete', 'success');
    }).catch((err) => {
      console.error(err);
      setStatus(err?.message || String(err), 'error');
      toast('Sync failed', 'error');
    });
  });

  m.querySelector('[data-action="new-device"]')?.addEventListener('click', () => {
    renderConnectExistingView(rawPayload || pairingUrl || key);
  });

  m.hidden = false;
}

export function openGoogleDriveSyncSetup() {
  renderStartView();
}

export async function openGoogleDriveSyncSetupWithPayload(pairingText) {
  ensureModal();
  modal.hidden = false;

  pendingPairingText = pairingText || '';
  renderConnectExistingView(pairingText || '');
}

function injectCss() {
  if (document.getElementById('yanta-sync2-setup-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-sync2-setup-css';
  style.textContent = `
.yanta-sync2-setup-card {
  width: min(640px, 94vw);
}

.yanta-sync2-setup-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.yanta-sync2-setup-hero {
  display: flex;
  align-items: flex-start;
  gap: 12px;

  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;

  background: var(--bg-elev-2);
}

.yanta-sync2-setup-hero strong {
  color: var(--text);
  font-size: 15px;
}

.yanta-sync2-setup-hero p {
  margin: 4px 0 0;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.45;
}

.yanta-sync2-setup-icon {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 14px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
}

.yanta-sync2-setup-icon.ok {
  color: var(--green);
  background: color-mix(in srgb, var(--green) 13%, transparent);
}

.yanta-sync2-choice {
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev);
}

.yanta-sync2-choice h4 {
  margin: 0 0 4px;
  color: var(--text);
  font-size: 14px;
}

.yanta-sync2-choice p {
  margin: 0 0 12px;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.45;
}

.yanta-sync2-choice.danger-zone {
  border-color: color-mix(in srgb, var(--red) 32%, var(--border));
}

.yanta-sync2-warning,
.yanta-sync2-browser-warning {
  padding: 10px 12px;
  border-radius: 10px;

  color: var(--text-dim);

  font-size: 12px;
  line-height: 1.45;
}

.yanta-sync2-warning {
  border: 1px solid color-mix(in srgb, var(--yellow) 45%, var(--border));
  background: color-mix(in srgb, var(--yellow) 10%, transparent);
}

.yanta-sync2-warning strong {
  color: var(--yellow);
}

.yanta-sync2-browser-warning {
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 9%, transparent);
}

.yanta-sync2-browser-warning strong {
  color: var(--accent);
}

.yanta-sync2-qr {
  display: flex;
  justify-content: center;

  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 14px;

  background: white;
}

.yanta-sync2-setup-status {
  min-height: 18px;
  white-space: pre-wrap;

  color: var(--text-faint);
  font-size: 12px;
}

.yanta-sync2-setup-status.error {
  color: var(--red);
}

.yanta-sync2-setup-status.success {
  color: var(--green);
}

.yanta-sync2-device-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yanta-sync2-device {
  padding: 10px 11px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev-2);
}

.yanta-sync2-device.current {
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
  background: color-mix(in srgb, var(--accent) 9%, var(--bg-elev-2));
}

.yanta-sync2-device-head {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
  margin-bottom: 6px;
}

.yanta-sync2-device-head strong {
  color: var(--text);
  font-size: 13px;
}

.yanta-sync2-device-head span {
  color: var(--accent);
  font-size: 11px;
  font-weight: 800;
}

.yanta-sync2-device-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px 10px;
  color: var(--text-dim);
  font-size: 11px;
}

.yanta-sync2-empty {
  color: var(--text-faint);
  font-size: 12px;
  font-style: italic;
}

.yanta-sync2-copy-field {
  display: flex;
  flex-direction: column;
  gap: 5px;

  font-size: 12px;
  color: var(--text-dim);
}

.yanta-sync2-copy-field > span {
  font-weight: 600;
}

.yanta-sync2-copy-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: stretch;
}

.yanta-sync2-copy-row .text-input {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
}

.yanta-sync2-copy-row .btn {
  white-space: nowrap;
}

.yanta-sync2-setup-modal .is-busy-disabled {
  opacity: 0.62;
}

@media (max-width: 680px) {
  .yanta-sync2-copy-row {
    grid-template-columns: 1fr;
  }

  .yanta-sync2-device-meta {
    grid-template-columns: 1fr;
  }
}
`;

  document.head.append(style);
}