// ============================================================
// YANTA Sync2 — YANTA Cloud setup UI
// ============================================================

import {
  el,
  store,
  toast,
  lucide,
  escapeHtml,
} from '../core.js';

import {
  cloudMe,
  cloudSendCode,
  cloudVerifyCode,
  cloudCreateVault,
  YANTA_CLOUD_BASE_URL,
} from '../cloud/cloud-api.js';

import {
  createSync2YantaCloudAppRuntime,
  getSync2SyncKey,
  setSync2SyncKey,
} from './app-engine.js';

import {
  createSync2PairingPayload,
  createSync2PairingUrl,
  renderSync2QrSvg,
  importSync2PairingPayload,
} from './pairing.js';

import {
  syncKeyToBytes,
} from './crypto.js';

let modal = null;
let statusEl = null;
let turnstileToken = '';
let turnstileWidgetId = null;

const TURNSTILE_SITE_KEY =
  import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

function setStatus(msg = '', type = '') {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = 'yanta-cloud-status' + (type ? ` ${type}` : '');
}

function close() {
  if (modal) modal.hidden = true;
}

function ensureCss() {
  if (document.getElementById('yanta-cloud-setup-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-cloud-setup-css';
  style.textContent = `
.yanta-cloud-card {
  width: min(640px, 94vw);
}

.yanta-cloud-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.yanta-cloud-hero {
  display: flex;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev-2);
}

.yanta-cloud-hero-icon {
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

.yanta-cloud-hero strong {
  color: var(--text);
  font-size: 15px;
}

.yanta-cloud-hero p {
  margin: 4px 0 0;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.45;
}

.yanta-cloud-warning {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--yellow) 45%, var(--border));
  background: color-mix(in srgb, var(--yellow) 10%, transparent);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.yanta-cloud-section {
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev);
}

.yanta-cloud-section h4 {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--text);
}

.yanta-cloud-section p {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.45;
}

.yanta-cloud-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.yanta-cloud-status {
  min-height: 18px;
  white-space: pre-wrap;
  color: var(--text-faint);
  font-size: 12px;
}

.yanta-cloud-status.error {
  color: var(--red);
}

.yanta-cloud-status.success {
  color: var(--green);
}

.yanta-cloud-recovery {
  font-family: var(--font-mono);
  font-size: 12px;
  resize: vertical;
}

.yanta-cloud-qr {
  display: flex;
  justify-content: center;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: white;
}
`;
  document.head.append(style);
}

function ensureModal() {
  if (modal) return modal;

  ensureCss();

  modal = el('div', {
    class: 'modal yanta-cloud-modal',
    hidden: true,
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
    if (e.target.closest?.('[data-yanta-cloud-close]')) close();
  });

  document.body.append(modal);

  return modal;
}

function renderShell(title, bodyHtml) {
  const m = ensureModal();

  m.innerHTML = `
    <div class="modal-card yanta-cloud-card">
      <header class="modal-head">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-btn" data-yanta-cloud-close>&times;</button>
      </header>
      <div class="modal-body yanta-cloud-body">
        ${bodyHtml}
        <div class="yanta-cloud-status" data-status></div>
      </div>
    </div>
  `;

  statusEl = m.querySelector('[data-status]');
  m.hidden = false;
}

function renderTurnstile(container) {
  turnstileToken = '';

  if (!TURNSTILE_SITE_KEY) {
    return;
  }

  const host = document.createElement('div');
  host.className = 'yanta-cloud-turnstile';
  container.append(host);

  const ensureScript = () => new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }

    const existing = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }

    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });

  ensureScript().then(() => {
    turnstileWidgetId = window.turnstile.render(host, {
      sitekey: TURNSTILE_SITE_KEY,
      callback(token) {
        turnstileToken = token;
      },
    });
  }).catch(() => {
    setStatus('Could not load Turnstile.', 'error');
  });
}

export async function openYantaCloudSetup() {
  try {
    const me = await cloudMe();

    if (me.authenticated) {
      renderCloudHome(me);
    } else {
      renderLogin();
    }
  } catch {
    renderLogin();
  }
}

function renderLogin() {
  renderShell('YANTA Cloud Login', `
    <div class="yanta-cloud-hero">
      <div class="yanta-cloud-hero-icon">${lucide('cloud', 28)}</div>
      <div>
        <strong>Sign in to YANTA Cloud</strong>
        <p>Use your email address. YANTA Cloud stores only encrypted sync objects.</p>
      </div>
    </div>

    <section class="yanta-cloud-section">
      <h4>Email</h4>
      <div class="yanta-cloud-grid">
        <input class="text-input" data-email placeholder="you@example.com" autocomplete="email" />
        <div data-turnstile></div>
        <button class="btn primary" data-send-code>${lucide('mail', 14)} Send code</button>
      </div>
    </section>
  `);

  renderTurnstile(modal.querySelector('[data-turnstile]'));

  modal.querySelector('[data-send-code]')?.addEventListener('click', async () => {
    const email = modal.querySelector('[data-email]')?.value?.trim();

    if (!email) {
      setStatus('Enter your email address.', 'error');
      return;
    }

    try {
      setStatus('Sending code…');

      await cloudSendCode(email, turnstileToken);

      renderCode(email);
    } catch (err) {
      setStatus(err?.message || 'Could not send code', 'error');
    }
  });
}

function renderCode(email) {
  renderShell('Enter login code', `
    <div class="yanta-cloud-hero">
      <div class="yanta-cloud-hero-icon">${lucide('key-round', 28)}</div>
      <div>
        <strong>We sent a 6-digit code</strong>
        <p>Enter the code from your email. You can also open the magic link from the email.</p>
      </div>
    </div>

    <section class="yanta-cloud-section">
      <h4>Code</h4>
      <input class="text-input" data-code placeholder="XXXXXX" inputmode="numeric" maxlength="6" />
      <div class="compress-actions" style="margin-top:10px">
        <button class="btn" data-back>Back</button>
        <span class="grow"></span>
        <button class="btn primary" data-verify>${lucide('check', 14)} Continue</button>
      </div>
    </section>
  `);

  modal.querySelector('[data-back]')?.addEventListener('click', renderLogin);

  modal.querySelector('[data-code]')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      modal.querySelector('[data-verify]')?.click();
    }
  });

  modal.querySelector('[data-verify]')?.addEventListener('click', async () => {
    const code = modal.querySelector('[data-code]')?.value?.trim();

    if (!code) {
      setStatus('Enter the code.', 'error');
      return;
    }

    try {
      setStatus('Verifying…');

      await cloudVerifyCode(email, code);

      const me = await cloudMe();
      renderCloudHome(me);
    } catch (err) {
      setStatus(err?.message || 'Login failed', 'error');
    }
  });

  setTimeout(() => modal.querySelector('[data-code]')?.focus(), 0);
}

function usageLine(me) {
  const usage = me.usage || {};
  const limits = me.limits || {};

  const mb = (n) => `${(Number(n || 0) / 1024 / 1024).toFixed(1)} MB`;

  return [
    `Plan: ${me.user?.plan || 'free'}`,
    `Storage: ${mb(usage.storage_bytes)} / ${mb(limits.storageBytes)}`,
    `Objects: ${usage.object_count || 0} / ${limits.objects || 0}`,
    `Download this month: ${mb(usage.download_bytes_month)} / ${mb(limits.downloadBytesMonth)}`,
  ].join('\n');
}

function renderCloudHome(me) {
  const vaults = me.vaults || [];

  renderShell('YANTA Cloud', `
    <div class="yanta-cloud-hero">
      <div class="yanta-cloud-hero-icon">${lucide('cloud-check', 28)}</div>
      <div>
        <strong>Signed in as ${escapeHtml(me.user?.email || '')}</strong>
        <p>Encrypted cloud sync is available for this account.</p>
      </div>
    </div>

    <div class="yanta-cloud-warning">
      <strong>Important:</strong> Your email gives access to your YANTA Cloud account.
      Your Recovery Key decrypts your notes. YANTA cannot recover encrypted notes without it.
    </div>

    <section class="yanta-cloud-section">
      <h4>Usage</h4>
      <pre style="white-space:pre-wrap;margin:0;color:var(--text-dim);font-size:12px">${escapeHtml(usageLine(me))}</pre>
    </section>

    <section class="yanta-cloud-section">
      <h4>Cloud vault</h4>
      <p>${vaults.length ? 'Choose an existing vault or create a new one.' : 'No cloud vault exists yet. Create one to start syncing.'}</p>

      <div class="yanta-cloud-grid">
        ${vaults.map((v) => `
          <button class="btn" data-vault-id="${escapeHtml(v.id)}">
            ${lucide('database', 14)}
            ${escapeHtml(v.name || v.id)}
          </button>
        `).join('')}

        <button class="btn primary" data-create-vault>
          ${lucide('plus', 14)}
          Create new cloud vault
        </button>
      </div>
    </section>
  `);

  modal.querySelector('[data-create-vault]')?.addEventListener('click', async () => {
    try {
      setStatus('Creating cloud vault…');

      const res = await cloudCreateVault({
        name: 'My YANTA Vault',
      });

      renderRecoveryStep(res.vault.id, {
        mode: 'new',
      });
    } catch (err) {
      setStatus(err?.message || 'Could not create vault', 'error');
    }
  });

  modal.querySelectorAll('[data-vault-id]')?.forEach((btn) => {
    btn.addEventListener('click', () => {
      renderExistingVaultStep(btn.dataset.vaultId);
    });
  });
}

function renderExistingVaultStep(vaultId) {
  renderShell('Connect existing cloud vault', `
    <div class="yanta-cloud-hero">
      <div class="yanta-cloud-hero-icon">${lucide('key', 28)}</div>
      <div>
        <strong>Recovery Key required</strong>
        <p>Enter your Recovery Key or paste a YANTA pairing payload from another device.</p>
      </div>
    </div>

    <section class="yanta-cloud-section">
      <h4>Recovery Key or pairing payload</h4>
      <textarea class="text-input" data-recovery rows="6" placeholder="Paste Recovery Key or yanta-sync2:..."></textarea>
      <div class="compress-actions" style="margin-top:10px">
        <button class="btn" data-back>Back</button>
        <span class="grow"></span>
        <button class="btn primary" data-connect>${lucide('cloud-download', 14)} Connect & Pull</button>
      </div>
    </section>
  `);

  modal.querySelector('[data-back]')?.addEventListener('click', async () => {
    renderCloudHome(await cloudMe());
  });

  modal.querySelector('[data-connect]')?.addEventListener('click', async () => {
    const raw = modal.querySelector('[data-recovery]')?.value?.trim();

    if (!raw) {
      setStatus('Paste your Recovery Key or pairing payload.', 'error');
      return;
    }

    try {
      setStatus('Importing key…');

      if (raw.startsWith('yanta-sync2:') || raw.includes('#sync2=')) {
        await importSync2PairingPayload(raw);
      } else {
        syncKeyToBytes(raw);
        await setSync2SyncKey(raw);
      }

      await store.settings.set('sync2.provider', 'yanta-cloud');
      await store.settings.set('sync2.yantaCloud.vaultId', vaultId);
      await store.settings.set('sync2.yantaCloud.baseUrl', YANTA_CLOUD_BASE_URL);

      setStatus('Connecting and pulling encrypted vault…');

      const runtime = await createSync2YantaCloudAppRuntime({
        baseUrl: YANTA_CLOUD_BASE_URL,
        vaultId,
      });

      window.yantaSync2 = runtime;

      await runtime.syncNow({
        verbose: false,
        pullSnapshots: true,
      });

      toast('YANTA Cloud connected', 'success');
      renderConnected(vaultId, runtime.syncKey);
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'Could not connect vault', 'error');
    }
  });
}

async function renderRecoveryStep(vaultId, { mode = 'new' } = {}) {
  const syncKey = await getSync2SyncKey();

  renderShell('Save your Recovery Key', `
    <div class="yanta-cloud-warning">
      <strong>Save this Recovery Key.</strong><br>
      YANTA cannot recover encrypted notes without it.
    </div>

    <section class="yanta-cloud-section">
      <h4>Recovery Key</h4>
      <textarea class="text-input yanta-cloud-recovery" data-key rows="5" readonly>${escapeHtml(syncKey)}</textarea>

      <div class="compress-actions" style="margin-top:10px;flex-wrap:wrap">
        <button class="btn" data-copy>${lucide('copy', 14)} Copy</button>
        <button class="btn" data-download>${lucide('download', 14)} Download recovery file</button>
      </div>

      <label class="yanta-cloud-warning" style="display:flex;gap:8px;align-items:flex-start;margin-top:12px">
        <input type="checkbox" data-confirm />
        <span>I understand that YANTA cannot recover encrypted notes without this Recovery Key.</span>
      </label>

      <div class="compress-actions" style="margin-top:10px">
        <span class="grow"></span>
        <button class="btn primary" data-enable>${lucide('cloud-upload', 14)} Enable Cloud Sync</button>
      </div>
    </section>
  `);

  modal.querySelector('[data-copy]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(syncKey);
      toast('Recovery Key copied', 'success');
    } catch {
      toast('Copy failed', 'error');
    }
  });

  modal.querySelector('[data-download]')?.addEventListener('click', () => {
    const payload = {
      app: 'YANTA',
      type: 'yanta-recovery-key',
      version: 1,
      provider: 'yanta-cloud',
      vaultId,
      created: new Date().toISOString(),
      syncKey,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `yanta-recovery-${vaultId}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  modal.querySelector('[data-enable]')?.addEventListener('click', async () => {
    if (!modal.querySelector('[data-confirm]')?.checked) {
      setStatus('Confirm that you saved the Recovery Key.', 'error');
      return;
    }

    try {
      setStatus('Connecting to YANTA Cloud…');

      await store.settings.set('sync2.provider', 'yanta-cloud');
      await store.settings.set('sync2.yantaCloud.vaultId', vaultId);
      await store.settings.set('sync2.yantaCloud.baseUrl', YANTA_CLOUD_BASE_URL);

      const runtime = await createSync2YantaCloudAppRuntime({
        baseUrl: YANTA_CLOUD_BASE_URL,
        vaultId,
      });

      window.yantaSync2 = runtime;

    setStatus('Uploading encrypted snapshot…');

    await runtime.pushFullStateNow({
    includeSnapshots: true,
    verbose: false,
    });

    /*
    Neuer Cloud-Vault:
    Wir haben gerade den vollständigen verschlüsselten Zustand hochgeladen.
    Ein direkter Full Pull würde pro Note Snapshot-Listen erzeugen und ist
    für Onboarding unnötig langsam/teuer.

    uploadOutbox lädt nur kleine Vault/Device-Metadaten nach, die beim
    engine.start() in die Outbox gekommen sind.
    */
    setStatus('Finalizing cloud sync…');

    await runtime.engine?.uploadOutbox?.();

    toast('YANTA Cloud Sync enabled', 'success');

    renderConnected(vaultId, syncKey);
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'Could not enable sync', 'error');
    }
  });
}

async function renderConnected(vaultId, syncKey) {
  const pairingUrl = await createSync2PairingUrl({
    provider: 'yanta-cloud',
  });

  const rawPayload = await createSync2PairingPayload({
    provider: 'yanta-cloud',
  });

  renderShell('YANTA Cloud Sync is active', `
    <div class="yanta-cloud-hero">
      <div class="yanta-cloud-hero-icon">${lucide('check', 28)}</div>
      <div>
        <strong>Encrypted cloud sync enabled</strong>
        <p>Use the QR code or pairing text to connect another device.</p>
      </div>
    </div>

    <div class="yanta-cloud-qr" data-qr></div>

    <div class="yanta-cloud-warning">
      <strong>Keep private:</strong> This QR/link contains your Recovery Key.
      Anyone with it can decrypt your YANTA vault.
    </div>

    <section class="yanta-cloud-section">
      <h4>Pairing payload</h4>
      <textarea class="text-input" data-pairing rows="4" readonly>${escapeHtml(rawPayload)}</textarea>

      <div class="compress-actions" style="margin-top:10px;flex-wrap:wrap">
        <button class="btn" data-copy-pairing>${lucide('copy', 14)} Copy pairing text</button>
        <button class="btn" data-sync-now>${lucide('refresh-cw', 14)} Sync now</button>
        <span class="grow"></span>
        <button class="btn primary" data-yanta-cloud-close>Done</button>
      </div>
    </section>
  `);

  modal.querySelector('[data-qr]')?.append(renderSync2QrSvg(pairingUrl, 240));

  modal.querySelector('[data-copy-pairing]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(rawPayload);
      toast('Pairing text copied', 'success');
    } catch {
      toast('Copy failed', 'error');
    }
  });

  modal.querySelector('[data-sync-now]')?.addEventListener('click', async () => {
    try {
      setStatus('Synchronizing…');

      await window.yantaSync2?.syncNow?.({
        verbose: false,
        pullSnapshots: true,
      });

      setStatus('Sync complete', 'success');
      toast('Sync complete', 'success');
    } catch (err) {
      setStatus(err?.message || 'Sync failed', 'error');
    }
  });
}