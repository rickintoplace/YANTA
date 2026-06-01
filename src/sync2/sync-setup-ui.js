// ============================================================
// YANTA Sync2 — Google Drive setup UI
//
// Best-practice QR + PWA UX:
// - First device shows QR as https://.../#sync2=...
// - If opened in wrong browser, user gets copy/instructions.
// - In-app scanner remains the most reliable PWA flow.
// - Google OAuth starts only after explicit user click.
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
  } from './app-engine.js';
  
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
  
  let modal = null;
  let statusEl = null;
  let autoSyncStarted = false;
  let pendingPairingText = '';
  
  function clientId() {
    return import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  }
  
  function isStandalonePwa() {
    return (
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.navigator.standalone === true
    );
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
  
  async function setupFirstDevice() {
    try {
      setStatus('Connecting to Google Drive…');
  
      let runtime;
  
      try {
        runtime = await connectRuntime({
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
      });
  
      setStatus('Creating pairing QR…');
  
      const pairingUrl = await createSync2PairingUrl({
        provider: 'google-drive',
      });
  
      const rawPayload = await createSync2PairingPayload({
        provider: 'google-drive',
      });
  
      renderConnectedView({
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
            <h4>If this is an additional device</h4>
            <p>Go back and scan/paste the Sync QR from your first device.</p>
            <button class="btn" data-action="back">${lucide('arrow-left', 14)} Back</button>
          </section>
  
          <section class="yanta-sync2-choice danger-zone">
            <h4>If this is old test data</h4>
            <p>Delete the encrypted YANTA Sync objects from Google Drive and create a new cloud sync vault from this device.</p>
            <button class="btn danger" data-action="delete-create">
              ${lucide('trash', 14)} Delete cloud sync data and create new
            </button>
          </section>
  
          <div class="yanta-sync2-setup-status" data-status></div>
        </div>
      </div>
    `;
  
    statusEl = m.querySelector('[data-status]');
  
    m.querySelector('[data-action="back"]')?.addEventListener('click', renderStartView);
  
    m.querySelector('[data-action="delete-create"]')?.addEventListener('click', async () => {
      try {
        setStatus('Deleting encrypted YANTA Sync data from Google Drive…');
  
        const deleted = await deleteAllGoogleDriveSyncObjects();
  
        setStatus(`Deleted ${deleted} object${deleted === 1 ? '' : 's'}. Creating new sync…`);
  
        await setupFirstDevice();
      } catch (err) {
        console.error(err);
        setStatus(err?.message || String(err), 'error');
        toast('Reset failed', 'error');
      }
    });
  }
  
  async function prepareExistingDeviceFromPayload(pairingText) {
    try {
      setStatus('Reading Sync QR/link…');
  
      pendingPairingText = pairingText;
  
      await importSync2PairingPayload(pairingText);
  
      setStatus('Sync key imported. Continue with Google Drive.', 'success');
  
      renderContinueGoogleView(pairingText);
    } catch (err) {
      console.error(err);
      setStatus(err?.message || String(err), 'error');
      toast('Could not read Sync QR/link', 'error');
    }
  }
  
  async function connectExistingDeviceNow() {
    try {
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
  
      const pairingUrl = await createSync2PairingUrl({
        provider: 'google-drive',
      });
  
      const rawPayload = await createSync2PairingPayload({
        provider: 'google-drive',
      });
  
      renderConnectedView({
        pairingUrl,
        rawPayload,
        syncKey: runtime.syncKey,
      });
  
      toast('Google Drive Sync connected', 'success');
    } catch (err) {
      console.error(err);
  
      const msg = isWrongKeyError(err)
      ? (
          'Wrong Sync Key. This QR/link does not match the encrypted data in this Google Drive account.\n\n' +
          'Check that you selected the same Google account as on the first device. '
        )
      : err?.message || String(err);
  
      setStatus(msg, 'error');
      toast('Google Drive Sync connect failed', 'error');
    }
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
            <strong>Important:</strong> The Sync QR/link contains your encryption key.
            Anyone with it can decrypt your YANTA vault.
          </div>
  
          <section class="yanta-sync2-choice">
            <h4>First device</h4>
            <p>Create encrypted sync data in Google Drive and show a QR/link for adding more devices.</p>
            <button class="btn primary" data-action="first">
              ${lucide('cloud-upload', 14)} Create Google Drive Sync
            </button>
          </section>
  
          <section class="yanta-sync2-choice">
            <h4>Additional device</h4>
            <p>Best PWA flow: open the installed YANTA app, then scan this QR from inside YANTA.</p>
  
            <div class="compress-actions" style="justify-content:flex-start;flex-wrap:wrap">
              <button class="btn" data-action="scan">
                ${lucide('qr-code', 14)} Scan QR
              </button>
              <button class="btn" data-action="paste">
                ${lucide('clipboard', 14)} Paste pairing link/text
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
  
    m.querySelector('[data-action="first"]')?.addEventListener('click', setupFirstDevice);
  
    m.querySelector('[data-action="scan"]')?.addEventListener('click', async () => {
      try {
        setStatus('Starting camera…');
        const text = await scanQrWithCamera();
        await prepareExistingDeviceFromPayload(text);
      } catch (err) {
        console.error(err);
        setStatus(err?.message || String(err), 'error');
      }
    });
  
    m.querySelector('[data-action="paste"]')?.addEventListener('click', renderPasteView);
    m.querySelector('[data-action="reset"]')?.addEventListener('click', resetGoogleDriveSyncData);
  
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
            Paste the Sync QR link or raw pairing text from your first device.
          </p>
  
          <textarea class="text-input" data-pairing rows="7" placeholder="https://yanta.page/#sync2=... or yanta-sync2:..."></textarea>
  
          <div class="compress-actions">
            <button class="btn" data-action="back">Back</button>
            <button class="btn primary" data-action="import">
              ${lucide('key', 14)} Import key
            </button>
          </div>
  
          <div class="yanta-sync2-setup-status" data-status></div>
        </div>
      </div>
    `;
  
    statusEl = m.querySelector('[data-status]');
  
    m.querySelector('[data-action="back"]')?.addEventListener('click', renderStartView);
  
    m.querySelector('[data-action="import"]')?.addEventListener('click', async () => {
      const text = m.querySelector('[data-pairing]')?.value || '';
      await prepareExistingDeviceFromPayload(text);
    });
  }
  
  function renderContinueGoogleView(pairingText = pendingPairingText) {
    const standalone = isStandalonePwa();
    const m = ensureModal();
  
    m.innerHTML = `
      <div class="modal-card yanta-sync2-setup-card">
        <header class="modal-head">
          <h3>Sync key imported</h3>
          <button class="icon-btn" data-sync2-close>&times;</button>
        </header>
  
        <div class="modal-body yanta-sync2-setup-body">
          <div class="yanta-sync2-setup-hero">
            <div class="yanta-sync2-setup-icon ok">${lucide('key', 28)}</div>
            <div>
              <strong>Sync key ready</strong>
              <p>Now connect to the same Google Drive account that contains your encrypted YANTA Sync data.</p>
            </div>
          </div>
  
          ${
            standalone
              ? ''
              : `
                <div class="yanta-sync2-browser-warning">
                  <strong>You are in a browser tab.</strong>
                  If you installed YANTA as a PWA but this opened in the wrong browser,
                  open the installed YANTA app and use Sync → Scan QR or paste this pairing link there.
                </div>
              `
          }
  
          <label style="font-size:12px;color:var(--text-dim)">
            Pairing link/text
            <textarea class="text-input" data-pairing readonly rows="4"></textarea>
          </label>
  
          <div class="compress-actions">
            <button class="btn" data-action="back">Back</button>
            <button class="btn" data-action="copy">
              ${lucide('copy', 14)} Copy pairing
            </button>
            <button class="btn primary" data-action="google">
              ${lucide('cloud', 14)} Continue with Google Drive
            </button>
          </div>
  
          <div class="yanta-sync2-setup-status" data-status></div>
        </div>
      </div>
    `;
  
    statusEl = m.querySelector('[data-status]');
  
    const pairingEl = m.querySelector('[data-pairing]');
    if (pairingEl) pairingEl.value = pairingText || '';
  
    m.querySelector('[data-action="back"]')?.addEventListener('click', renderStartView);
  
    m.querySelector('[data-action="copy"]')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(pairingText || '');
      toast('Pairing link copied', 'success');
    });
  
    m.querySelector('[data-action="google"]')?.addEventListener('click', connectExistingDeviceNow);
  }
  
  async function renderConnectedView({
    pairingUrl,
    rawPayload,
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
              <p>Scan this QR with another device. If it opens in the wrong browser, open the installed YANTA app and scan from inside the app.</p>
            </div>
          </div>
  
          <div class="yanta-sync2-qr" data-qr></div>
  
          <div class="yanta-sync2-warning">
            <strong>Keep private:</strong> This QR/link contains your Sync Key.
            Anyone with it can decrypt your YANTA vault.
          </div>
  
          <label style="font-size:12px;color:var(--text-dim)">
            Pairing link
            <textarea class="text-input" data-url rows="4" readonly></textarea>
          </label>
  
          <label style="font-size:12px;color:var(--text-dim)">
            Raw pairing text
            <textarea class="text-input" data-raw rows="4" readonly></textarea>
          </label>
  
          <label style="font-size:12px;color:var(--text-dim)">
            Sync key
            <input class="text-input" data-key readonly />
          </label>
  
          <div class="compress-actions">
            <button class="btn" data-action="sync-now">
              ${lucide('refresh-cw', 14)} Sync now
            </button>
            <button class="btn" data-action="copy-url">
              ${lucide('copy', 14)} Copy link
            </button>
            <button class="btn" data-action="copy-raw">
              ${lucide('copy', 14)} Copy raw
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
  
    m.querySelector('[data-qr]')?.append(renderSync2QrSvg(pairingUrl, 240));
    m.querySelector('[data-url]').value = pairingUrl || '';
    m.querySelector('[data-raw]').value = rawPayload || '';
    m.querySelector('[data-key]').value = syncKey || await getSync2SyncKey();
  
    m.querySelector('[data-action="copy-url"]')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(pairingUrl || '');
      toast('Pairing link copied', 'success');
    });
  
    m.querySelector('[data-action="copy-raw"]')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(rawPayload || '');
      toast('Raw pairing text copied', 'success');
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
  
  export async function openGoogleDriveSyncSetupWithPayload(pairingText) {
    ensureModal();
    modal.hidden = false;
    await prepareExistingDeviceFromPayload(pairingText);
  }
  
  function injectCss() {
    if (document.getElementById('yanta-sync2-setup-css')) return;
  
    const style = document.createElement('style');
    style.id = 'yanta-sync2-setup-css';
    style.textContent = `
  .yanta-sync2-setup-card {
    width: min(590px, 94vw);
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