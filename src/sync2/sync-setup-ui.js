// ============================================================
// YANTA Sync2 — Google Drive setup UI
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
    createSync2PairingPayload,
    importSync2PairingPayload,
    renderSync2QrSvg,
    scanQrWithCamera,
  } from './pairing.js';
  
  import {
    syncKeyToBytes,
  } from './crypto.js';
  
  import {
    removePristineWelcomeVaultIfPresent,
  } from '../notes.js';
  
  let modal = null;
  let statusEl = null;
  let autoSyncStarted = false;
  
  function clientId() {
    return import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  }
  
  function setStatus(msg = '', type = '') {
    if (!statusEl) return;
  
    statusEl.textContent = msg;
    statusEl.className = 'yanta-sync2-setup-status' + (type ? ` ${type}` : '');
  }
  
  function close() {
    if (modal) modal.hidden = true;
  }
  
  function ensureModal() {
    if (modal) return modal;
  
    injectCss();
  
    modal = el('div', {
      class: 'modal yanta-sync2-setup-modal',
      hidden: true,
    });
  
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
      if (e.target.closest?.('[data-sync2-close]')) close();
    });
  
    document.body.append(modal);
  
    return modal;
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
    prompt = 'consent',
  } = {}) {
    const id = clientId();
  
    if (!id) {
      throw new Error('Google Client ID missing. Set VITE_GOOGLE_CLIENT_ID.');
    }
  
    await store.settings.set('sync2.provider', 'google-drive');
  
    const runtime = await createSync2GoogleDriveAppRuntime({
      clientId: id,
      googlePrompt: prompt,
    });
  
    window.yantaSync2 = runtime;
  
    startAutoSyncIfNeeded(runtime.engine);
  
    return runtime;
  }
  
  async function setupFirstDevice() {
    try {
      setStatus('Connecting to Google Drive…');
  
      const runtime = await connectRuntime({
        prompt: 'consent',
      });
  
      setStatus('Uploading encrypted full snapshot…');
  
      await runtime.pushFullStateNow({
        includeSnapshots: true,
      });
  
      setStatus('Creating pairing QR…');
  
      const payload = await createSync2PairingPayload({
        provider: 'google-drive',
      });
  
      renderConnectedView({
        payload,
        syncKey: runtime.syncKey,
      });
  
      toast('Google Drive Sync enabled', 'success');
    } catch (err) {
      console.error(err);
      setStatus(err?.message || String(err), 'error');
      toast('Google Drive Sync setup failed', 'error');
    }
  }
  
  async function setupExistingDeviceFromPayload(payloadText) {
    try {
      setStatus('Reading Sync QR/key…');
  
      await importSync2PairingPayload(payloadText);
  
      setStatus('Removing untouched local Welcome vault if present…');
  
      await removePristineWelcomeVaultIfPresent({
        reason: 'google-drive-sync-connect',
      });
  
      setStatus('Connecting to Google Drive…');
  
      const runtime = await connectRuntime({
        prompt: 'consent',
      });
  
      setStatus('Downloading and decrypting vault…');
  
      await runtime.syncNow({
        verbose: false,
        pullSnapshots: true,
      });
  
      const payload = await createSync2PairingPayload({
        provider: 'google-drive',
      });
  
      renderConnectedView({
        payload,
        syncKey: runtime.syncKey,
      });
  
      toast('Google Drive Sync connected', 'success');
    } catch (err) {
      console.error(err);
      setStatus(err?.message || String(err), 'error');
      toast('Google Drive Sync connect failed', 'error');
    }
  }
  
  async function setupExistingDeviceFromRawKey(rawKey) {
    const key = String(rawKey || '').trim();
  
    if (!key) {
      throw new Error('Sync key missing');
    }
  
    syncKeyToBytes(key);
  
    await setSync2SyncKey(key);
  
    return setupExistingDeviceFromPayload(
      'yanta-sync2:' + btoa(JSON.stringify({
        kind: 'noop',
      }))
    );
  }
  
  function renderStartView() {
    const m = ensureModal();
  
    m.innerHTML = `
      <div class="modal-card yanta-sync2-setup-card">
        <header class="modal-head">
          <h3>Google Drive Sync</h3>
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
            <strong>Important:</strong> The Sync QR contains your encryption key.
            Anyone with this QR/key can decrypt your YANTA vault.
          </div>
  
          <section class="yanta-sync2-choice">
            <h4>First device</h4>
            <p>Create encrypted sync data in Google Drive and show a QR code for adding more devices.</p>
            <button class="btn primary" data-action="first">
              ${lucide('cloud-upload', 14)} Create Google Drive Sync
            </button>
          </section>
  
          <section class="yanta-sync2-choice">
            <h4>Additional device</h4>
            <p>Scan the QR from your first device, or paste the pairing text.</p>
  
            <div class="compress-actions" style="justify-content:flex-start;flex-wrap:wrap">
              <button class="btn" data-action="scan">
                ${lucide('qr-code', 14)} Scan QR
              </button>
              <button class="btn" data-action="paste">
                ${lucide('clipboard', 14)} Paste pairing text/key
              </button>
            </div>
          </section>
  
          <div class="yanta-sync2-setup-status" data-status></div>
        </div>
      </div>
    `;
  
    statusEl = m.querySelector('[data-status]');
  
    m.querySelector('[data-action="first"]')?.addEventListener('click', setupFirstDevice);
  
    m.querySelector('[data-action="scan"]')?.addEventListener('click', async () => {
      try {
        setStatus('Starting camera…');
        const text = await scanQrWithCamera();
        await setupExistingDeviceFromPayload(text);
      } catch (err) {
        console.error(err);
        setStatus(err?.message || String(err), 'error');
      }
    });
  
    m.querySelector('[data-action="paste"]')?.addEventListener('click', renderPasteView);
  
    m.hidden = false;
  }
  
  function renderPasteView() {
    const m = ensureModal();
  
    m.innerHTML = `
      <div class="modal-card yanta-sync2-setup-card">
        <header class="modal-head">
          <h3>Connect existing YANTA Sync</h3>
          <button class="icon-btn" data-sync2-close>&times;</button>
        </header>
  
        <div class="modal-body yanta-sync2-setup-body">
          <p style="color:var(--text-dim);font-size:13px;line-height:1.5">
            Paste the full QR pairing text from your first device.
          </p>
  
          <textarea class="text-input" data-pairing rows="7" placeholder="yanta-sync2:..."></textarea>
  
          <div class="compress-actions">
            <button class="btn" data-action="back">Back</button>
            <button class="btn primary" data-action="connect">
              ${lucide('link', 14)} Connect
            </button>
          </div>
  
          <div class="yanta-sync2-setup-status" data-status></div>
        </div>
      </div>
    `;
  
    statusEl = m.querySelector('[data-status]');
  
    m.querySelector('[data-action="back"]')?.addEventListener('click', renderStartView);
  
    m.querySelector('[data-action="connect"]')?.addEventListener('click', async () => {
      const text = m.querySelector('[data-pairing]')?.value || '';
      await setupExistingDeviceFromPayload(text);
    });
  }
  
  async function renderConnectedView({
    payload,
    syncKey,
  }) {
    const m = ensureModal();
  
    m.innerHTML = `
      <div class="modal-card yanta-sync2-setup-card">
        <header class="modal-head">
          <h3>Google Drive Sync is active</h3>
          <button class="icon-btn" data-sync2-close>&times;</button>
        </header>
  
        <div class="modal-body yanta-sync2-setup-body">
          <div class="yanta-sync2-setup-hero">
            <div class="yanta-sync2-setup-icon ok">${lucide('check', 28)}</div>
            <div>
              <strong>Encrypted sync enabled</strong>
              <p>Use this QR code to add your phone, laptop or another browser.</p>
            </div>
          </div>
  
          <div class="yanta-sync2-qr" data-qr></div>
  
          <div class="yanta-sync2-warning">
            <strong>Keep private:</strong> This QR code contains your Sync Key.
            Anyone with it can decrypt your YANTA vault.
          </div>
  
          <label style="font-size:12px;color:var(--text-dim)">
            Pairing text
            <textarea class="text-input" data-payload rows="4" readonly></textarea>
          </label>
  
          <label style="font-size:12px;color:var(--text-dim)">
            Sync key
            <input class="text-input" data-key readonly />
          </label>
  
          <div class="compress-actions">
            <button class="btn" data-action="sync-now">
              ${lucide('refresh-cw', 14)} Sync now
            </button>
            <button class="btn" data-action="copy-pairing">
              ${lucide('copy', 14)} Copy pairing
            </button>
            <button class="btn" data-action="copy-key">
              ${lucide('key', 14)} Copy key
            </button>
            <button class="btn primary" data-sync2-close>Done</button>
          </div>
  
          <div class="yanta-sync2-setup-status" data-status></div>
        </div>
      </div>
    `;
  
    statusEl = m.querySelector('[data-status]');
  
    m.querySelector('[data-qr]')?.append(renderSync2QrSvg(payload, 240));
    m.querySelector('[data-payload]').value = payload;
    m.querySelector('[data-key]').value = syncKey || await getSync2SyncKey();
  
    m.querySelector('[data-action="copy-pairing"]')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(payload);
      toast('Pairing text copied', 'success');
    });
  
    m.querySelector('[data-action="copy-key"]')?.addEventListener('click', async () => {
      const key = syncKey || await getSync2SyncKey();
      await navigator.clipboard.writeText(key);
      toast('Sync key copied', 'success');
    });
  
    m.querySelector('[data-action="sync-now"]')?.addEventListener('click', async () => {
      try {
        setStatus('Synchronizing…');
  
        await window.yantaSync2?.syncNow?.({
          verbose: false,
          pullSnapshots: true,
        });
  
        setStatus('Sync complete', 'success');
        toast('Sync complete', 'success');
      } catch (err) {
        console.error(err);
        setStatus(err?.message || String(err), 'error');
        toast('Sync failed', 'error');
      }
    });
  
    m.hidden = false;
  }
  
  export function openGoogleDriveSyncSetup() {
    renderStartView();
  }
  
  function injectCss() {
    if (document.getElementById('yanta-sync2-setup-css')) return;
  
    const style = document.createElement('style');
    style.id = 'yanta-sync2-setup-css';
    style.textContent = `
  .yanta-sync2-setup-card {
    width: min(560px, 94vw);
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
  
  .yanta-sync2-warning {
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--yellow) 45%, var(--border));
    border-radius: 10px;
  
    background: color-mix(in srgb, var(--yellow) 10%, transparent);
    color: var(--text-dim);
  
    font-size: 12px;
    line-height: 1.45;
  }
  
  .yanta-sync2-warning strong {
    color: var(--yellow);
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
    color: var(--text-faint);
    font-size: 12px;
  }
  
  .yanta-sync2-setup-status.error {
    color: var(--red);
  }
  
  .yanta-sync2-setup-status.success {
    color: var(--green);
  }
  `;
  
    document.head.append(style);
  }