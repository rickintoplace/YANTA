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
  parseSync2PairingPayload,
} from './pairing.js';

import {
  syncKeyToBytes,
} from './crypto.js';

import {
  removePristineWelcomeVaultIfPresent,
} from '../notes.js';

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

.yanta-cloud-usage-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.yanta-cloud-usage-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.yanta-cloud-usage-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;

  font-size: 12px;
}

.yanta-cloud-usage-label {
  color: var(--text);
  font-weight: 700;
}

.yanta-cloud-usage-value {
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
}

.yanta-cloud-usage-bar {
  position: relative;
  height: 7px;

  overflow: hidden;
  border-radius: 999px;

  background: color-mix(in srgb, var(--text-faint) 16%, transparent);
}

.yanta-cloud-usage-bar > span {
  position: absolute;
  inset: 0 auto 0 0;

  width: var(--usage-pct, 0%);
  min-width: var(--usage-min, 0px);

  border-radius: inherit;

  background: linear-gradient(
    90deg,
    var(--accent),
    color-mix(in srgb, var(--accent) 65%, white)
  );
}

.yanta-cloud-usage-row.warn .yanta-cloud-usage-bar > span {
  background: var(--yellow);
}

.yanta-cloud-usage-row.danger .yanta-cloud-usage-bar > span {
  background: var(--red);
}

.yanta-cloud-usage-caption {
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.35;
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
  await renderCloudHome(me);
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
        await renderCloudHome(me);
    } catch (err) {
      setStatus(err?.message || 'Login failed', 'error');
    }
  });

  setTimeout(() => modal.querySelector('[data-code]')?.focus(), 0);
}

function fmtBytesCompact(n) {
  const value = Number(n || 0);

  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;

  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function pctClass(pct) {
  if (pct >= 98) return 'danger';
  if (pct >= 85) return 'warn';
  return '';
}

function usageBarHtml({
  label,
  used,
  limit,
  formatter = fmtBytesCompact,
  caption = '',
}) {
  const u = Number(used || 0);
  const l = Number(limit || 0);
  const pct = l > 0 ? Math.max(0, Math.min(100, Math.round((u / l) * 100))) : 0;

  return `
    <div class="yanta-cloud-usage-row ${pctClass(pct)}">
      <div class="yanta-cloud-usage-head">
        <span class="yanta-cloud-usage-label">${escapeHtml(label)}</span>
        <span class="yanta-cloud-usage-value">
          ${escapeHtml(formatter(u))} / ${escapeHtml(formatter(l))}
        </span>
      </div>

      <div class="yanta-cloud-usage-bar" style="--usage-pct:${pct}%;--usage-min:${u > 0 ? '4px' : '0px'}">
        <span></span>
      </div>

      ${
        caption
          ? `<div class="yanta-cloud-usage-caption">${escapeHtml(caption)}</div>`
          : ''
      }
    </div>
  `;
}

function usageBarsHtml(me) {
  const usage = me.usage || {};
  const limits = me.limits || {};
  const plan = me.user?.plan || 'free';

  const countFmt = (n) => String(Number(n || 0).toLocaleString());

  return `
    <div class="yanta-cloud-usage-list">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:2px">
        <strong style="color:var(--text)">Plan</strong>
        <span style="color:var(--accent);font-weight:800;text-transform:capitalize">${escapeHtml(plan)}</span>
      </div>

      ${usageBarHtml({
        label: 'Storage',
        used: usage.storage_bytes,
        limit: limits.storageBytes,
        caption: 'Encrypted vault objects stored in YANTA Cloud.',
      })}

      ${usageBarHtml({
        label: 'Objects',
        used: usage.object_count,
        limit: limits.objects,
        formatter: countFmt,
        caption: 'Encrypted snapshots, updates and assets.',
      })}

      ${usageBarHtml({
        label: 'Download this month',
        used: usage.download_bytes_month,
        limit: limits.downloadBytesMonth,
      })}

      ${usageBarHtml({
        label: 'Upload today',
        used: usage.upload_bytes_day,
        limit: limits.uploadBytesDay,
      })}

      ${usageBarHtml({
        label: 'Writes today',
        used: usage.writes_today,
        limit: limits.writesDay,
        formatter: countFmt,
      })}
    </div>
  `;
}

async function configuredYantaCloudVaultId() {
  try {
    return await store.settings.get('sync2.yantaCloud.vaultId', '');
  } catch {
    return '';
  }
}

async function configuredYantaCloudBaseUrl() {
  try {
    return await store.settings.get('sync2.yantaCloud.baseUrl', YANTA_CLOUD_BASE_URL);
  } catch {
    return YANTA_CLOUD_BASE_URL;
  }
}

async function isLocalYantaCloudVault(vaultId) {
  const provider = await store.settings.get('sync2.provider', '').catch(() => '');
  const configuredVaultId = await configuredYantaCloudVaultId();

  return provider === 'yanta-cloud' && configuredVaultId === vaultId;
}

async function openConnectAnotherDeviceForVault(vaultId) {
  if (!vaultId) {
    setStatus('No cloud vault selected.', 'error');
    return;
  }

  const local = await isLocalYantaCloudVault(vaultId);

  if (!local) {
    setStatus(
      'This desktop is not locally connected to that vault yet. Connect this device first, then create a pairing QR.',
      'error'
    );
    return;
  }

  const syncKey = await getSync2SyncKey();

  renderConnected(vaultId, syncKey);
}

async function connectThisDeviceToVault(vaultId) {
  if (!vaultId) {
    setStatus('No cloud vault selected.', 'error');
    return;
  }

  renderExistingVaultStep(vaultId);
}

async function renderCloudHome(me) {
  const vaults = me.vaults || [];
  const configuredVaultId = await configuredYantaCloudVaultId();

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
        ${usageBarsHtml(me)}
    </section>

    <section class="yanta-cloud-section">
      <h4>Cloud vaults</h4>
      <p>${
        vaults.length
          ? 'Manage your cloud vaults and connect more devices.'
          : 'No cloud vault exists yet. Create one to start syncing.'
      }</p>

      <div class="yanta-cloud-grid">
        ${
          vaults.map((v) => {
            const active = v.id === configuredVaultId;

            return `
              <div class="yanta-cloud-vault-card" data-vault-card="${escapeHtml(v.id)}"
                style="
                  padding:12px;
                  border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};
                  border-radius:12px;
                  background:${active ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-elev))' : 'var(--bg-elev-2)'};
                  display:flex;
                  flex-direction:column;
                  gap:9px;
                ">
                <div style="display:flex;align-items:center;gap:8px;min-width:0">
                  <span style="display:inline-flex;color:${active ? 'var(--accent)' : 'var(--text-dim)'}">
                    ${lucide(active ? 'cloud-check' : 'database', 16)}
                  </span>
                  <strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    ${escapeHtml(v.name || v.id)}
                  </strong>
                  ${
                    active
                      ? `<span style="font-size:11px;color:var(--accent);font-weight:800">Active</span>`
                      : ''
                  }
                </div>

                <div style="font-size:11px;color:var(--text-faint);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  ${escapeHtml(v.id)}
                </div>

                <div class="compress-actions" style="justify-content:flex-start;flex-wrap:wrap">
                  ${
                    active
                      ? `
                        <button class="btn primary" data-vault-action="connect-device" data-vault-id="${escapeHtml(v.id)}">
                          ${lucide('qr-code', 14)}
                          Connect another device
                        </button>

                        <button class="btn" data-vault-action="sync-now" data-vault-id="${escapeHtml(v.id)}">
                          ${lucide('refresh-cw', 14)}
                          Sync now
                        </button>
                      `
                      : `
                        <button class="btn primary" data-vault-action="connect-this-device" data-vault-id="${escapeHtml(v.id)}">
                          ${lucide('key', 14)}
                          Connect this device
                        </button>
                      `
                  }
                </div>
              </div>
            `;
          }).join('')
        }

        <button class="btn primary" data-create-vault>
          ${lucide('plus', 14)}
          Create new cloud vault
        </button>
      </div>
    </section>
  `);

  statusEl = modal.querySelector('[data-status]');

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

  modal.querySelectorAll('[data-vault-action="connect-this-device"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      connectThisDeviceToVault(btn.dataset.vaultId);
    });
  });

  modal.querySelectorAll('[data-vault-action="connect-device"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openConnectAnotherDeviceForVault(btn.dataset.vaultId);
    });
  });

  modal.querySelectorAll('[data-vault-action="sync-now"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        setStatus('Synchronizing…');

        await window.yantaSync2?.syncNow?.({
          verbose: false,
          pullSnapshots: false,
        });

        setStatus('Sync complete', 'success');
        toast('Sync complete', 'success');
      } catch (err) {
        setStatus(err?.message || 'Sync failed', 'error');
      }
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
    await renderCloudHome(await cloudMe());
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
  const baseUrl = await configuredYantaCloudBaseUrl();

  const pairingUrl = await createSync2PairingUrl({
    provider: 'yanta-cloud',
    cloud: {
      vaultId,
      baseUrl,
    },
  });

  const rawPayload = await createSync2PairingPayload({
    provider: 'yanta-cloud',
    cloud: {
      vaultId,
      baseUrl,
    },
  });

  renderShell('Connect another device', `
    <div class="yanta-cloud-hero">
      <div class="yanta-cloud-hero-icon">${lucide('qr-code', 28)}</div>
      <div>
        <strong>Scan this QR code with your phone</strong>
        <p>The phone will sign in to YANTA Cloud, import the Recovery Key and pull the encrypted vault.</p>
      </div>
    </div>

    <div class="yanta-cloud-warning">
      <strong>Keep private:</strong> This QR/link contains your Recovery Key.
      Anyone with it can decrypt your YANTA vault.
    </div>

    <div class="yanta-cloud-qr" data-qr></div>

    <section class="yanta-cloud-section">
      <h4>Pairing link</h4>
      <textarea class="text-input" data-pairing-link rows="4" readonly>${escapeHtml(pairingUrl)}</textarea>

      <h4 style="margin-top:14px">Raw pairing text</h4>
      <textarea class="text-input" data-pairing rows="4" readonly>${escapeHtml(rawPayload)}</textarea>

      <div class="compress-actions" style="margin-top:10px;flex-wrap:wrap">
        <button class="btn" data-copy-link>${lucide('copy', 14)} Copy pairing link</button>
        <button class="btn" data-copy-pairing>${lucide('copy', 14)} Copy raw text</button>
        <button class="btn" data-sync-now>${lucide('refresh-cw', 14)} Sync now</button>
        <span class="grow"></span>
        <button class="btn" data-back-cloud-home>Back</button>
        <button class="btn primary" data-yanta-cloud-close>Done</button>
      </div>
    </section>
  `);

  statusEl = modal.querySelector('[data-status]');

  modal.querySelector('[data-qr]')?.append(renderSync2QrSvg(pairingUrl, 240));

  modal.querySelector('[data-copy-link]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pairingUrl);
      toast('Pairing link copied', 'success');
    } catch {
      toast('Copy failed', 'error');
    }
  });

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
        pullSnapshots: false,
      });

      setStatus('Sync complete', 'success');
      toast('Sync complete', 'success');
    } catch (err) {
      setStatus(err?.message || 'Sync failed', 'error');
    }
  });

  modal.querySelector('[data-back-cloud-home]')?.addEventListener('click', async () => {
    await renderCloudHome(await cloudMe());
  });
}

export async function openYantaCloudSetupWithPayload(pairingText) {
  ensureModal();
  modal.hidden = false;

  let payload = null;

  try {
    payload = parseSync2PairingPayload(pairingText);
  } catch (err) {
    renderLogin();
    setStatus(err?.message || 'Invalid pairing payload', 'error');
    return;
  }

  if (payload.provider !== 'yanta-cloud') {
    renderLogin();
    setStatus('This pairing code is not for YANTA Cloud.', 'error');
    return;
  }

  const me = await cloudMe().catch(() => null);

  if (!me?.authenticated) {
    renderLoginForPendingPairing(pairingText);
    return;
  }

  await connectYantaCloudFromPairing(pairingText);
}

function renderLoginForPendingPairing(pairingText) {
  renderShell('Sign in to connect device', `
    <div class="yanta-cloud-hero">
      <div class="yanta-cloud-hero-icon">${lucide('smartphone', 28)}</div>
      <div>
        <strong>Pair this device with YANTA Cloud</strong>
        <p>First sign in with your email. Then YANTA will use the scanned QR code to connect this device.</p>
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

      renderCodeForPendingPairing(email, pairingText);
    } catch (err) {
      setStatus(err?.message || 'Could not send code', 'error');
    }
  });
}

function renderCodeForPendingPairing(email, pairingText) {
  renderShell('Enter login code', `
    <div class="yanta-cloud-hero">
      <div class="yanta-cloud-hero-icon">${lucide('key-round', 28)}</div>
      <div>
        <strong>We sent a 6-digit code</strong>
        <p>Enter the code from your email. After login, pairing continues automatically.</p>
      </div>
    </div>

    <section class="yanta-cloud-section">
      <h4>Code</h4>
      <input class="text-input" data-code placeholder="123456" inputmode="numeric" maxlength="6" />
      <div class="compress-actions" style="margin-top:10px">
        <button class="btn" data-back>Back</button>
        <span class="grow"></span>
        <button class="btn primary" data-verify>${lucide('check', 14)} Continue</button>
      </div>
    </section>
  `);

  modal.querySelector('[data-back]')?.addEventListener('click', () => {
    renderLoginForPendingPairing(pairingText);
  });

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

      await connectYantaCloudFromPairing(pairingText);
    } catch (err) {
      setStatus(err?.message || 'Login failed', 'error');
    }
  });

  setTimeout(() => modal.querySelector('[data-code]')?.focus(), 0);
}

async function connectYantaCloudFromPairing(pairingText) {
  try {
    setStatus('Reading pairing code…');

    const payload = await importSync2PairingPayload(pairingText);

    if (payload.provider !== 'yanta-cloud') {
      throw new Error('Pairing payload is not for YANTA Cloud.');
    }

    const vaultId = payload.cloud?.vaultId;

    if (!vaultId) {
      throw new Error('Cloud vault id missing.');
    }

    const baseUrl = payload.cloud?.baseUrl || YANTA_CLOUD_BASE_URL;

    await store.settings.set('sync2.provider', 'yanta-cloud');
    await store.settings.set('sync2.yantaCloud.vaultId', vaultId);
    await store.settings.set('sync2.yantaCloud.baseUrl', baseUrl);

    setStatus('Removing untouched local Welcome vault if present…');

    await removePristineWelcomeVaultIfPresent({
        reason: 'yanta-cloud-pairing',
    });

    setStatus('Connecting to YANTA Cloud…');

    const runtime = await createSync2YantaCloudAppRuntime({
      baseUrl,
      vaultId,
    });

    window.yantaSync2 = runtime;

    setStatus('Pulling encrypted vault…');

    await runtime.syncNow({
      verbose: false,
      pullSnapshots: true,
    });

    toast('Device connected to YANTA Cloud', 'success');

    renderConnected(vaultId, runtime.syncKey);
  } catch (err) {
    console.error(err);
    setStatus(err?.message || 'Could not connect this device', 'error');
    toast('Cloud pairing failed', 'error');
  }
}