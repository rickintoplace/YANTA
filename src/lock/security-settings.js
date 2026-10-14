// ============================================================
// YANTA — Settings › Security
//
// App lock for this device (password, passkeys, auto-lock, lock now),
// which also encrypts what YANTA stores here (at-rest.js), and "sign out
// and remove everything from this device". Honest about the limits:
// feeds and system notifications stay plain.
// ============================================================

import { el, toast } from '../core.js';
import { getLocale, t } from '../i18n/index.js';

import {
  disableLock,
  getLockConfig,
  isUnlocked,
  removePasskeyWrap,
  setLockPassword,
  setLockTimers,
  unlockWithPassword,
} from './lock-keys.js';

const IDLE_CHOICES = [0, 1, 5, 10, 30, 60];
const HIDDEN_CHOICES = [-1, 0, 1, 5, 15];

function group(title, ...children) {
  return el('div', { class: 'yanta-settings-group' },
    el('div', { class: 'yanta-settings-group-title' }, title),
    ...children
  );
}

function hint(text) {
  return el('p', { class: 'yanta-settings-hint' }, text);
}

function minutesLabel(n, { hidden = false } = {}) {
  if (n === -1) return t('lock.settings.never');
  if (n === 0) return hidden ? t('lock.settings.immediately') : t('lock.settings.never');
  return t('lock.settings.minutes', { count: n });
}

/** A small inline form asking for a new password twice. */
function passwordForm({ submitLabel, onSubmit, requireCurrent = false }) {
  const current = requireCurrent ? el('input', { type: 'password', class: 'text-input', placeholder: t('lock.settings.currentPassword'), autocomplete: 'current-password' }) : null;
  const first = el('input', { type: 'password', class: 'text-input', placeholder: t('lock.newPassword'), autocomplete: 'new-password' });
  const second = el('input', { type: 'password', class: 'text-input', placeholder: t('lock.repeatPassword'), autocomplete: 'new-password' });
  const error = el('p', { class: 'yanta-settings-hint', style: { color: 'var(--red)' }, role: 'alert' });
  const submit = el('button', { type: 'submit', class: 'btn primary' }, submitLabel);

  const form = el('form', { class: 'yanta-security-form' }, ...(current ? [current] : []), first, second, error, submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    if (first.value.length < 6) { error.textContent = t('lock.tooShort'); return; }
    if (first.value !== second.value) { error.textContent = t('lock.mismatch'); return; }

    submit.disabled = true;
    try {
      if (current && !(await unlockWithPassword(current.value))) {
        error.textContent = t('lock.wrong');
        return;
      }
      await onSubmit(first.value);
    } finally {
      submit.disabled = false;
    }
  });

  return form;
}

async function recoveryKeyForWrap() {
  try {
    const { getSync2SyncKey } = await import('../sync2/app-engine.js');
    return await getSync2SyncKey();
  } catch {
    return null;
  }
}

function passkeyLabel(passkey) {
  const where = passkey.attachment === 'platform' ? t('lock.passkeys.platform') : passkey.attachment === 'cross-platform' ? t('lock.passkeys.roaming') : t('lock.passkeys.generic');
  const when = new Date(passkey.createdAt || Date.now()).toLocaleDateString(getLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
  return t('lock.passkeys.label', { where, date: when });
}

/**
 * Passkeys that unlock instead of the password. Adding one asks for the
 * password first: an unlocked, unattended device must not let someone
 * register their own way in.
 */
async function passkeyGroup(config, rerender) {
  const { passkeyUnlockSupported } = await import('./passkey-unlock.js');
  const passkeys = config.passkeys || [];

  const list = el('div', { class: 'yanta-security-passkeys' },
    ...passkeys.map((passkey) => {
      const remove = el('button', { type: 'button', class: 'btn' }, t('lock.passkeys.remove'));
      remove.addEventListener('click', async () => {
        await removePasskeyWrap(passkey.id);
        toast(t('lock.passkeys.removed'), 'success');
        rerender();
      });
      return el('div', { class: 'yanta-security-row' }, el('span', { class: 'yanta-security-passkey-name' }, passkeyLabel(passkey)), remove);
    })
  );

  if (!(await passkeyUnlockSupported())) {
    return group(t('lock.passkeys.title'), hint(t('lock.passkeys.unsupported')), list);
  }

  const add = el('button', { type: 'button', class: 'btn' }, t('lock.passkeys.add'));

  add.addEventListener('click', () => {
    const input = el('input', { type: 'password', class: 'text-input', placeholder: t('lock.settings.currentPassword'), autocomplete: 'current-password' });
    const error = el('p', { class: 'yanta-settings-hint', style: { color: 'var(--red)' }, role: 'alert' });
    const submit = el('button', { type: 'submit', class: 'btn primary' }, t('lock.passkeys.create'));
    const form = el('form', { class: 'yanta-security-form' }, hint(t('lock.passkeys.confirmHint')), input, error, submit);
    let verified = false;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      submit.disabled = true;

      try {
        if (!verified) {
          if (!(await unlockWithPassword(input.value))) {
            error.textContent = t('lock.wrong');
            return;
          }
          verified = true;
          input.remove();
        }

        const { addPasskey } = await import('./passkey-unlock.js');
        await addPasskey({ userName: t('lock.passkeys.userName') });
        toast(t('lock.passkeys.added'), 'success');
        rerender();
      } catch (err) {
        if (err?.code === 'ENOPRF') error.textContent = t('lock.passkeys.noPrf');
        else if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') error.textContent = t('lock.passkeys.cancelled');
        else error.textContent = t('lock.passkeys.failed');
        // The browser may want a fresh click for the passkey dialog: the button says so.
        if (verified) submit.textContent = t('lock.passkeys.retry');
      } finally {
        submit.disabled = false;
      }
    });

    add.replaceWith(form);
    input.focus();
  });

  return group(t('lock.passkeys.title'), hint(t('lock.passkeys.hint')), list, el('div', { class: 'yanta-security-row' }, add));
}

/** Guest mode for a computer that is not the user's (lock-keys.js). */
function guestGroup(config, rerender) {
  if (config.guest) {
    const end = el('button', { type: 'button', class: 'btn danger' }, t('lock.guest.end'));
    end.addEventListener('click', async () => {
      const { confirmAndWipeThisDevice } = await import('./wipe-device.js');
      await confirmAndWipeThisDevice();
    });
    return group(t('lock.guest.title'), el('p', { class: 'yanta-security-status' }, t('lock.guest.onHint')), end);
  }

  const start = el('button', { type: 'button', class: 'btn' }, t('lock.guest.start'));
  start.addEventListener('click', async () => {
    const { yantaConfirm } = await import('../dialogs.js');
    const synced = !!window.yantaSync2?.engine;
    const ok = await yantaConfirm({
      title: t('lock.guest.confirmTitle'),
      message: synced ? t('lock.guest.confirmSynced') : t('lock.guest.confirmLocal'),
      confirmLabel: t('lock.guest.confirm'),
      danger: !synced,
    });
    if (!ok) return;

    const { startGuestMode } = await import('./lock-keys.js');
    await startGuestMode();
    const { shareKeyWithOpenTabs } = await import('./app-lock.js');
    shareKeyWithOpenTabs();
    toast(t('lock.guest.started'), 'success');
    rerender();
    sealStoredData(rerender);
  });

  return group(t('lock.guest.title'), hint(t('lock.guest.offHint')), start);
}

// ---- Two-factor sign-in for the YANTA Cloud account (worker: user_mfa)

function backupCodesBlock(codes, onDone) {
  const list = el('pre', { class: 'yanta-security-codes' }, codes.join('\n'));
  const copy = el('button', { type: 'button', class: 'btn' }, t('mfa.settings.copy'));
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast(t('mfa.settings.copied'), 'success');
    } catch {}
  });
  const save = el('button', { type: 'button', class: 'btn' }, t('mfa.settings.download'));
  save.addEventListener('click', async () => {
    const { downloadBlob } = await import('../core.js');
    downloadBlob(new Blob([`YANTA — ${t('mfa.settings.backupTitle')}\n\n${codes.join('\n')}\n`], { type: 'text/plain' }), 'yanta-backup-codes.txt');
  });
  const done = el('button', { type: 'button', class: 'btn primary' }, t('mfa.settings.done'));
  done.addEventListener('click', onDone);

  return el('div', { class: 'yanta-security-form' },
    el('strong', {}, t('mfa.settings.backupTitle')),
    hint(t('mfa.settings.backupHint')),
    list,
    el('div', { class: 'yanta-security-row' }, copy, save, done)
  );
}

async function askMfaCode() {
  const { yantaPrompt } = await import('../dialogs.js');
  return yantaPrompt({
    title: t('mfa.stepUp.title'),
    message: t('mfa.settings.codePrompt'),
    label: t('mfa.login.code'),
    placeholder: '123456',
    required: true,
  });
}

async function mfaGroup(rerender) {
  const api = await import('../cloud/cloud-api.js');
  const me = await api.cloudMe().catch(() => null);

  if (!me?.authenticated) {
    return group(t('mfa.settings.title'), hint(t('mfa.settings.offHint')), hint(t('mfa.settings.notSignedIn')));
  }

  const status = await api.cloudMfaStatus().catch(() => null);
  const body = el('div');

  if (status?.enabled) {
    const renew = el('button', { type: 'button', class: 'btn' }, t('mfa.settings.renew'));
    renew.addEventListener('click', async () => {
      const code = await askMfaCode();
      if (!code) return;
      try {
        const result = await api.cloudMfaRenewBackupCodes(code);
        body.replaceChildren(backupCodesBlock(result.backupCodes || [], rerender));
      } catch {
        toast(t('mfa.settings.invalid'), 'error');
      }
    });

    const off = el('button', { type: 'button', class: 'btn danger' }, t('mfa.settings.turnOff'));
    off.addEventListener('click', async () => {
      const code = await askMfaCode();
      if (!code) return;
      try {
        await api.cloudMfaDisable(code);
        toast(t('mfa.settings.turnedOff'), 'success');
        rerender();
      } catch {
        toast(t('mfa.settings.invalid'), 'error');
      }
    });

    body.append(
      el('p', { class: 'yanta-security-status' }, t('mfa.settings.onHint', { count: status.backupRemaining })),
      el('div', { class: 'yanta-security-row' }, renew, off)
    );
    return group(t('mfa.settings.title'), body);
  }

  const setup = el('button', { type: 'button', class: 'btn' }, t('mfa.settings.turnOn'));
  setup.addEventListener('click', async () => {
    setup.disabled = true;
    let secret;
    try {
      secret = await api.cloudMfaSetup();
    } catch (err) {
      toast(err?.message || String(err), 'error');
      setup.disabled = false;
      return;
    }

    const { renderBrandedQrSvg } = await import('../qr.js');
    const qr = el('div', { class: 'yanta-security-qr' });
    qr.append(renderBrandedQrSvg(secret.uri, { size: 180 }));

    const code = el('input', { type: 'text', class: 'text-input', placeholder: t('mfa.settings.confirmCode'), inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6' });
    const error = el('p', { class: 'yanta-settings-hint', style: { color: 'var(--red)' }, role: 'alert' });
    const confirm = el('button', { type: 'submit', class: 'btn primary' }, t('mfa.settings.confirm'));
    const form = el('form', { class: 'yanta-security-form' },
      hint(t('mfa.settings.scan')),
      qr,
      el('code', { class: 'yanta-security-secret' }, secret.secret.match(/.{1,4}/g).join(' ')),
      code,
      error,
      confirm
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      confirm.disabled = true;
      try {
        const result = await api.cloudMfaEnable(code.value.trim());
        toast(t('mfa.settings.turnedOn'), 'success');
        body.replaceChildren(backupCodesBlock(result.backupCodes || [], rerender));
      } catch {
        error.textContent = t('mfa.settings.invalid');
        confirm.disabled = false;
      }
    });

    body.replaceChildren(form);
    code.focus();
  });

  body.append(hint(t('mfa.settings.offHint')), el('div', { class: 'yanta-security-row' }, setup));
  return group(t('mfa.settings.title'), body);
}

/** Seals what was stored before the lock; the status line follows. */
async function sealStoredData(rerender) {
  try {
    const { migrateAtRest } = await import('./at-rest-migrate.js');
    await migrateAtRest();
  } catch (err) {
    console.warn('[YANTA] Sealing stored data paused', err);
    toast(t('lock.settings.sealFailed'), 'error');
  }
  rerender();
}

export function securitySettingsElement({ rerender }) {
  const root = el('div', { class: 'yanta-security-settings' });

  if (!document.getElementById('yanta-security-css')) {
    const style = document.createElement('style');
    style.id = 'yanta-security-css';
    style.textContent = `
.yanta-security-form { display: grid; gap: 8px; max-width: 360px; margin-top: 8px; }
.yanta-security-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.yanta-security-row label { min-width: 180px; color: var(--text); font-size: 13px; }
.yanta-security-passkey-name { flex: 1; min-width: 160px; color: var(--text); font-size: 13px; }
.yanta-security-status { margin: 6px 0 0; font-size: 12.5px; color: var(--accent, var(--text)); }
.yanta-security-qr { display: inline-block; padding: 10px; background: #fff; border-radius: 12px; width: max-content; }
.yanta-security-secret { font-family: var(--font-mono, monospace); font-size: 13px; letter-spacing: .05em; user-select: all; word-break: break-all; }
.yanta-security-codes { margin: 0; padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; background: var(--bg); font-family: var(--font-mono, monospace); font-size: 14px; line-height: 1.7; user-select: all; }
.yanta-security-note { margin: 12px 0 18px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-elev-2); color: var(--text-dim); font-size: 12.5px; line-height: 1.5; }
`;
    document.head.append(style);
  }

  (async () => {
    const config = await getLockConfig();

    if (config.guest) root.append(guestGroup(config));

    // ---- App lock
    if (!config.enabled) {
      root.append(group(t('lock.settings.lockTitle'),
        hint(t('lock.settings.lockOffHint')),
        passwordForm({
          submitLabel: t('lock.settings.turnOn'),
          onSubmit: async (password) => {
            await setLockPassword(password, { syncKey: await recoveryKeyForWrap() });
            const { shareKeyWithOpenTabs } = await import('./app-lock.js');
            shareKeyWithOpenTabs();
            toast(t('lock.settings.turnedOn'), 'success');
            rerender();
            sealStoredData(rerender);
          },
        })
      ));
    } else {
      const lockNowBtn = el('button', { type: 'button', class: 'btn' }, t('lock.lockNow'));
      lockNowBtn.addEventListener('click', async () => {
        const { lockNow } = await import('./app-lock.js');
        lockNow();
      });

      const idle = el('select', { class: 'text-input' },
        ...IDLE_CHOICES.map((n) => el('option', { value: String(n), selected: Number(config.idleMinutes) === n }, minutesLabel(n))));
      idle.addEventListener('change', () => setLockTimers({ idleMinutes: Number(idle.value) }));

      const hidden = el('select', { class: 'text-input' },
        ...HIDDEN_CHOICES.map((n) => el('option', { value: String(n), selected: Number(config.hiddenMinutes) === n }, minutesLabel(n, { hidden: true }))));
      hidden.addEventListener('change', () => setLockTimers({ hiddenMinutes: Number(hidden.value) }));

      // Turning the lock off asks for the password: an unlocked, unattended
      // device must not be one click away from staying unlocked.
      const turnOff = el('button', { type: 'button', class: 'btn danger' }, t('lock.settings.turnOff'));
      turnOff.addEventListener('click', () => {
        const input = el('input', { type: 'password', class: 'text-input', placeholder: t('lock.settings.currentPassword'), autocomplete: 'current-password' });
        const error = el('p', { class: 'yanta-settings-hint', style: { color: 'var(--red)' }, role: 'alert' });
        const confirm = el('button', { type: 'submit', class: 'btn danger' }, t('lock.settings.turnOff'));
        const form = el('form', { class: 'yanta-security-form' }, input, error, confirm);

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!(await unlockWithPassword(input.value)) || !isUnlocked()) {
            error.textContent = t('lock.wrong');
            return;
          }
          await disableLock();
          toast(t('lock.settings.turnedOff'), 'success');
          rerender();
        });

        turnOff.replaceWith(form);
        input.focus();
      });

      root.append(group(t('lock.settings.lockTitle'),
        hint(t('lock.settings.lockOnHint')),
        el('p', { class: 'yanta-security-status' }, config.atRest?.migratedAt ? t('lock.settings.sealedStatus') : t('lock.settings.sealingStatus')),
        el('div', { class: 'yanta-security-row' }, lockNowBtn, el('span', { class: 'yanta-settings-hint' }, 'Ctrl+Shift+L')),
        el('div', { class: 'yanta-security-row' }, el('label', {}, t('lock.settings.idle')), idle),
        el('div', { class: 'yanta-security-row' }, el('label', {}, t('lock.settings.hidden')), hidden),
        config.recovery ? null : hint(t('lock.settings.noRecovery')),
        el('div', { class: 'yanta-security-row' }, turnOff)
      ));

      root.append(await passkeyGroup(config, rerender));

      root.append(group(t('lock.settings.changeTitle'),
        passwordForm({
          requireCurrent: true,
          submitLabel: t('lock.settings.change'),
          onSubmit: async (password) => {
            await setLockPassword(password, { syncKey: await recoveryKeyForWrap() });
            toast(t('lock.settings.changed'), 'success');
            rerender();
          },
        })
      ));
    }

    if (!config.enabled && !config.guest) root.append(guestGroup(config, rerender));

    root.append(el('p', { class: 'yanta-security-note' }, t('lock.settings.honest')));

    // ---- Remove from this device
    const wipe = el('button', { type: 'button', class: 'btn danger' }, t('lock.wipeTitle'));
    wipe.addEventListener('click', async () => {
      const { confirmAndWipeThisDevice } = await import('./wipe-device.js');
      await confirmAndWipeThisDevice();
    });

    root.append(group(t('lock.settings.deviceTitle'), hint(t('lock.settings.deviceHint')), wipe));

    // ---- Other devices: managed where YANTA Cloud lists them.
    const manage = el('button', { type: 'button', class: 'btn' }, t('lock.settings.manageDevices'));
    manage.addEventListener('click', async () => {
      const { openYantaCloudSetup } = await import('../sync2/yanta-cloud-setup-ui.js');
      openYantaCloudSetup({ focus: 'devices' });
    });

    root.append(group(t('lock.settings.otherDevicesTitle'), hint(t('lock.settings.otherDevicesHint')), manage));

    // ---- YANTA Cloud account: two-factor sign-in
    root.append(await mfaGroup(rerender));
  })();

  return root;
}
