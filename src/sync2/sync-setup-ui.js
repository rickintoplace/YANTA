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

import { openBoundOverlay } from '../overlay-history.js';
import { yantaPrompt } from '../dialogs.js';
import { t, getLocale } from '../i18n/index.js';

import {
  syncKeyToBytes,
} from './crypto.js';

import {
  printRecoveryKit,
  extractSyncKeyFromRecoveryInput,
} from './recovery-kit.js';

import {
  SYNC2_PROVIDERS,
} from './provider-registry.js';

let modal = null;
let releaseSetup = null;
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
  if (!ts) return t('sync.setup.never');

  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return t('sync.setup.never');

  return d.toLocaleString(getLocale(), {
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
    return `<div class="yanta-sync2-empty">${escapeHtmlLocal(t('sync.setup.noDevices'))}</div>`;
  }

  return `
    <div class="yanta-sync2-device-list">
      ${devices.map((d) => `
        <div class="yanta-sync2-device ${d.id === current ? 'current' : ''}">
          <div class="yanta-sync2-device-head">
            <strong>${escapeHtmlLocal(d.name || d.id || t('sync.setup.device'))}</strong>
            ${d.id === current ? `<span>${escapeHtmlLocal(t('sync.setup.currentDevice'))}</span>` : ''}
          </div>
          <div class="yanta-sync2-device-meta">
            <div>${escapeHtmlLocal(t('sync.setup.lastSeen', { time: fmtTime(d.lastSeenAt) }))}</div>
            <div>${escapeHtmlLocal(t('sync.setup.lastSync', { time: fmtTime(d.lastSyncAt) }))}</div>
            <div>${escapeHtmlLocal(t('sync.setup.lastPush', { time: fmtTime(d.lastPushAt) }))}</div>
            <div>${escapeHtmlLocal(t('sync.setup.lastPull', { time: fmtTime(d.lastPullAt) }))}</div>
            <div>${escapeHtmlLocal(t('sync.setup.status', { status: d.syncStatus || t('sync.setup.statusUnknown') }))}</div>
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

/** Device-back closes the setup instead of the app. */
function bindBackToSetup() {
  releaseSetup = openBoundOverlay('sync-setup', {
    close,
    isOpen: () => !!modal?.isConnected && !modal.hidden,
  });
}

function close() {
  if (modal) modal.hidden = true;

  const release = releaseSetup;
  releaseSetup = null;
  release?.();
}

function copyFieldHtml({
  label,
  value,
  rows = 3,
  kind = 'textarea',
  copyLabel = t('common.copy'),
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
        toast(t('sync.setup.copied'), 'success');
      } catch {
        toast(t('sync.setup.copyFailed'), 'error');
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
      setStatus(t('sync.setup.deletingProgress', { deleted, total }));
    },
  });

  return result.deleted;
}

/*
  Only the engine's key check decides this. Matching on messages turned
  network and download failures into "wrong key" — and that view offers
  deleting the cloud vault.
*/
function isWrongKeyError(err) {
  return err?.code === 'EWRONGKEY';
}

/*
  Deleting the remote vault is irreversible and destroys every other
  device's copy of anything not synced locally. Make the user type it.
*/
async function confirmRemoteVaultDeletion() {
  const word = 'DELETE';

  const typed = await yantaPrompt({
    title: t('sync.setup.deleteTitle'),
    message: t('sync.setup.deleteMessage', { word }),
    placeholder: word,
    confirmLabel: t('tree.trash.deletePermanently'),
    danger: true,
    required: true,
    select: false,
    validate: (value) =>
      String(value || '').trim() === word ? true : t('sync.setup.deleteTypeToConfirm', { word }),
  });

  return String(typed || '').trim() === word;
}

async function importKeyOrPairingText(text) {
  const raw = String(text || '').trim();

  if (!raw) {
    throw new Error('Enter a Sync Key or pairing link.');
  }

  try {
    return await importSync2PairingPayload(raw);
  } catch {}

  // Tolerates the printed Recovery Kit form (grouped with spaces)
  // and a pasted recovery JSON file, not just the bare key.
  const key = extractSyncKeyFromRecoveryInput(raw);

  syncKeyToBytes(key);

  await setSync2SyncKey(key);
  await store.settings.set('sync2.provider', 'google-drive');

  return {
    v: 1,
    app: 'YANTA',
    kind: 'sync2-manual-key',
    provider: 'google-drive',
    syncKey: key,
  };
}

async function setupCreateNewSyncVault() {
  try {
    setStatus(t('sync.setup.connectingDrive'));

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

    setStatus(t('sync.setup.uploadingSnapshot'));

    await runtime.pushFullStateNow({
      includeSnapshots: true,
      verbose: false,
    });

    setStatus(t('sync.setup.creatingQr'));

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

    toast(t('sync.setup.driveEnabled'), 'success');
  } catch (err) {
    console.error(err);
    setStatus(err?.message || String(err), 'error');
    toast(t('sync.setup.driveSetupFailed'), 'error');
  }
}

async function connectExistingDeviceWithText(text) {
  try {
    setStatus(t('sync.setup.readingKey'));

    await importKeyOrPairingText(text);

    setStatus(t('sync.setup.removingWelcome'));

    await removePristineWelcomeVaultIfPresent({
      reason: 'cloud-sync-connect',
    });

    setStatus(t('sync.setup.connectingDrive'));

    const runtime = await connectRuntime({
      providerId: 'google-drive',
      prompt: 'consent',
    });

    setStatus(t('sync.setup.pulling'));

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

    setStatus(t('settings.sync.syncCompleteToast'), 'success');
    toast(t('sync.setup.devicePulled'), 'success');
  } catch (err) {
    console.error(err);

    const msg = isWrongKeyError(err)
      ? (
          t('sync.setup.wrongKey')
        )
      : err?.message || String(err);

    setStatus(msg, 'error');
    toast(t('sync.setup.connectFailed'), 'error');
  }
}

function renderWrongKeyResetView() {
  const m = ensureModal();

  m.innerHTML = `
    <div class="modal-card yanta-sync2-setup-card">
      <header class="modal-head">
        <h3>${escapeHtmlLocal(t('sync.setup.existingTitle'))}</h3>
        <button class="icon-btn" data-sync2-close>&times;</button>
      </header>

      <div class="modal-body yanta-sync2-setup-body">
        <div class="yanta-sync2-warning">
          <strong>${escapeHtmlLocal(t('sync.setup.wrongKeyLabel'))}</strong>
          ${escapeHtmlLocal(t('sync.setup.wrongKeyBody'))}
        </div>

        <section class="yanta-sync2-choice">
          <h4>${escapeHtmlLocal(t('sync.setup.connectInsteadTitle'))}</h4>
          <p>${escapeHtmlLocal(t('sync.setup.connectInsteadBody'))}</p>
          <button class="btn" data-action="connect-existing">
            ${lucide('key', 14)} ${escapeHtmlLocal(t('sync.setup.enterKey'))}
          </button>
        </section>

        <section class="yanta-sync2-choice danger-zone">
          <h4>${escapeHtmlLocal(t('sync.setup.deleteOldTitle'))}</h4>
          <p>${escapeHtmlLocal(t('sync.setup.deleteOldBody'))}</p>
          <button class="btn danger" data-action="delete-create">
            ${lucide('trash', 14)} ${escapeHtmlLocal(t('sync.setup.deleteAndCreate'))}
          </button>
        </section>

        <div class="yanta-sync2-setup-status" data-status></div>
      </div>
    </div>
  `;

  statusEl = m.querySelector('[data-status]');

  m.querySelector('[data-action="connect-existing"]')?.addEventListener('click', renderConnectExistingView);

  m.querySelector('[data-action="delete-create"]')?.addEventListener('click', async () => {
    if (!await confirmRemoteVaultDeletion()) return;

    withBusy(t('sync.setup.deletingFromDrive'), async () => {
      const deleted = await deleteAllGoogleDriveSyncObjects();

      setStatus(t('sync.setup.deletedCreating', { count: deleted }));

      await setupCreateNewSyncVault();
    }).catch((err) => {
      console.error(err);
      setStatus(err?.message || String(err), 'error');
      toast(t('sync.setup.resetFailed'), 'error');
    });
  });
}

async function resetGoogleDriveSyncData() {
  try {
    setStatus(t('sync.setup.connectingToDelete'));

    const count = await deleteAllGoogleDriveSyncObjects();

    await store.settings.set('sync2.provider', null);

    try {
      window.yantaSync2?.engine?.stop?.();
    } catch {}

    window.yantaSync2 = null;

    setStatus(t('sync.setup.deletedObjects', { count }), 'success');
    toast(t('sync.setup.driveReset'), 'success');
  } catch (err) {
    console.error(err);
    setStatus(err?.message || String(err), 'error');
    toast(t('sync.setup.resetFailed'), 'error');
  }
}

function renderStartView() {
  const m = ensureModal();

  m.innerHTML = `
    <div class="modal-card yanta-sync2-setup-card">
      <header class="modal-head">
        <h3>${escapeHtmlLocal(t('sync.setup.startTitle'))}</h3>
        <button class="icon-btn" data-sync2-close>&times;</button>
      </header>

      <div class="modal-body yanta-sync2-setup-body">
        <div class="yanta-sync2-setup-hero">
          <div class="yanta-sync2-setup-icon">${lucide('cloud', 28)}</div>
          <div>
            <strong>${escapeHtmlLocal(t('sync.setup.startHeroTitle'))}</strong>
            <p>
              ${escapeHtmlLocal(t('sync.setup.startHeroBody'))}
            </p>
          </div>
        </div>

        <div class="yanta-sync2-warning">
          <strong>${escapeHtmlLocal(t('sync.setup.importantLabel'))}</strong> ${escapeHtmlLocal(t('sync.setup.importantBody'))}
        </div>

        <section class="yanta-sync2-choice">
          <h4>${escapeHtmlLocal(t('sync.setup.createTitle'))}</h4>
          <p>${escapeHtmlLocal(t('sync.setup.createBody'))}</p>
          <button class="btn primary" data-action="create-new">
            ${lucide('cloud-upload', 14)} ${escapeHtmlLocal(t('sync.setup.createButton'))}
          </button>
        </section>

        <section class="yanta-sync2-choice">
          <h4>${escapeHtmlLocal(t('sync.setup.connectTitle'))}</h4>
          <p>${escapeHtmlLocal(t('sync.setup.connectBody'))}</p>

          <div class="compress-actions" style="justify-content:flex-start;flex-wrap:wrap">
            <button class="btn primary" data-action="connect-existing">
              ${lucide('key', 14)} ${escapeHtmlLocal(t('sync.setup.enterKey'))}
            </button>
            <button class="btn" data-action="scan">
              ${lucide('qr-code', 14)} ${escapeHtmlLocal(t('sync.setup.scanQr'))}
            </button>
          </div>
        </section>

        <section class="yanta-sync2-choice danger-zone">
          <h4>${escapeHtmlLocal(t('sync.setup.resetTitle'))}</h4>
          <p>${escapeHtmlLocal(t('sync.setup.resetBody'))}</p>
          <button class="btn danger" data-action="reset">
            ${lucide('trash', 14)} ${escapeHtmlLocal(t('sync.setup.resetButton'))}
          </button>
        </section>

        <div class="yanta-sync2-setup-status" data-status></div>
      </div>
    </div>
  `;

  statusEl = m.querySelector('[data-status]');

  m.querySelector('[data-action="create-new"]')?.addEventListener('click', () => {
    withBusy(t('sync.setup.connectingDrive'), setupCreateNewSyncVault);
  });

  m.querySelector('[data-action="connect-existing"]')?.addEventListener('click', renderConnectExistingView);

  m.querySelector('[data-action="scan"]')?.addEventListener('click', () => {
    withBusy(t('sync.setup.startingCamera'), async () => {
      const text = await scanQrWithCamera();
      pendingPairingText = text;
      renderConnectExistingView(text);
      setStatus(t('sync.setup.qrRead'), 'success');
    }).catch((err) => {
      console.error(err);
      setStatus(err?.message || String(err), 'error');
    });
  });

  m.querySelector('[data-action="reset"]')?.addEventListener('click', async () => {
    if (!await confirmRemoteVaultDeletion()) return;

    withBusy(t('sync.setup.connectingToDelete'), resetGoogleDriveSyncData);
  });

  m.hidden = false;
  bindBackToSetup();
}

function renderConnectExistingView(initialText = pendingPairingText) {
  const standalone = isStandalonePwa();
  const m = ensureModal();

  m.innerHTML = `
    <div class="modal-card yanta-sync2-setup-card">
      <header class="modal-head">
        <h3>${escapeHtmlLocal(t('sync.setup.connectDeviceTitle'))}</h3>
        <button class="icon-btn" data-sync2-close>&times;</button>
      </header>

      <div class="modal-body yanta-sync2-setup-body">
        <div class="yanta-sync2-setup-hero">
          <div class="yanta-sync2-setup-icon">${lucide('key', 28)}</div>
          <div>
            <strong>${escapeHtmlLocal(t('sync.setup.useExistingTitle'))}</strong>
            <p>${escapeHtmlLocal(t('sync.setup.useExistingBody'))}</p>
          </div>
        </div>

        ${
          standalone
            ? ''
            : `
              <div class="yanta-sync2-browser-warning">
                <strong>${escapeHtmlLocal(t('sync.setup.browserTabLabel'))}</strong>
                ${escapeHtmlLocal(t('sync.setup.browserTabBody'))}
              </div>
            `
        }

        <label class="yanta-sync2-copy-field">
          <span>${escapeHtmlLocal(t('sync.setup.keyOrLink'))}</span>
          <textarea class="text-input" data-pairing rows="7" placeholder="${escapeHtmlLocal(t('sync.setup.keyPlaceholder'))}">${escapeHtmlLocal(initialText || '')}</textarea>
        </label>

        <div class="compress-actions">
          <button class="btn" data-action="back">${escapeHtmlLocal(t('common.back'))}</button>
          <button class="btn" data-action="paste-clipboard">
            ${lucide('clipboard', 14)} ${escapeHtmlLocal(t('sync.setup.pasteClipboard'))}
          </button>
          <button class="btn primary" data-action="connect-pull">
            ${lucide('cloud-download', 14)} ${escapeHtmlLocal(t('sync.setup.connectPull'))}
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
      toast(t('sync.setup.pasted'), 'success');
    } catch {
      toast(t('sync.setup.pasteFailed'), 'error');
    }
  });

  m.querySelector('[data-action="connect-pull"]')?.addEventListener('click', () => {
    withBusy(t('sync.setup.connectingDrive'), async () => {
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
        <h3>${escapeHtmlLocal(t('sync.setup.activeTitle'))}</h3>
        <button class="icon-btn" data-sync2-close>&times;</button>
      </header>

      <div class="modal-body yanta-sync2-setup-body">
        <div class="yanta-sync2-setup-hero">
          <div class="yanta-sync2-setup-icon ok">${lucide('check', 28)}</div>
          <div>
            <strong>${escapeHtmlLocal(t('sync.setup.enabledTitle'))}</strong>
            <p>${escapeHtmlLocal(t('sync.setup.enabledBody'))}</p>
          </div>
        </div>

        <div class="yanta-sync2-qr" data-qr></div>

        <div class="yanta-sync2-warning">
          <strong>${escapeHtmlLocal(t('sync.setup.keepPrivateLabel'))}</strong> ${escapeHtmlLocal(t('sync.setup.keepPrivateBody'))}
        </div>

        <section class="yanta-sync2-choice">
          <h4>${escapeHtmlLocal(t('sync.setup.devices'))}</h4>
          ${renderDevicesHtml()}
        </section>

        ${copyFieldHtml({
          label: t('sync.setup.pairingLink'),
          value: pairingUrl || '',
          rows: 4,
        })}

        ${copyFieldHtml({
          label: t('sync.setup.rawPairing'),
          value: rawPayload || '',
          rows: 4,
        })}

        ${copyFieldHtml({
          label: t('settings.sync.syncKeyTitle'),
          value: key,
          kind: 'input',
        })}

        <div class="compress-actions">
          <button class="btn" data-action="sync-now">
            ${lucide('refresh-cw', 14)} ${escapeHtmlLocal(t('settings.sync.syncNow'))}
          </button>
          <button class="btn" data-action="new-device">
            ${lucide('smartphone', 14)} ${escapeHtmlLocal(t('sync.setup.connectAnother'))}
          </button>
          <button class="btn" data-action="print-kit">
            ${lucide('printer', 14)} ${escapeHtmlLocal(t('sync.setup.printKit'))}
          </button>
          <button class="btn primary" data-sync2-close>${escapeHtmlLocal(t('common.done'))}</button>
        </div>

        <div class="yanta-sync2-setup-status" data-status></div>
      </div>
    </div>
  `;

  statusEl = m.querySelector('[data-status]');

  m.querySelector('[data-qr]')?.append(renderSync2QrSvg(pairingUrl, 240));

  m.querySelector('[data-action="sync-now"]')?.addEventListener('click', () => {
    withBusy(t('settings.sync.synchronizing'), async () => {
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

      setStatus(t('settings.sync.syncCompleteToast'), 'success');
      toast(t('settings.sync.syncCompleteToast'), 'success');
    }).catch((err) => {
      console.error(err);
      setStatus(err?.message || String(err), 'error');
      toast(t('settings.sync.syncFailedToast'), 'error');
    });
  });

  m.querySelector('[data-action="new-device"]')?.addEventListener('click', () => {
    renderConnectExistingView(rawPayload || pairingUrl || key);
  });

  m.querySelector('[data-action="print-kit"]')?.addEventListener('click', async () => {
    try {
      await printRecoveryKit({
        provider: 'google-drive',
        syncKey: key,
      });
    } catch (err) {
      console.error(err);
      setStatus(err?.message || t('sync.setup.kitFailed'), 'error');
    }
  });

  m.hidden = false;
  bindBackToSetup();
}

export function openGoogleDriveSyncSetup() {
  renderStartView();
}

export async function openGoogleDriveSyncSetupWithPayload(pairingText) {
  ensureModal();
  modal.hidden = false;
  bindBackToSetup();

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