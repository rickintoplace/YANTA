// ============================================================
// YANTA — private folders: the dialogs
//
// Make a folder private (password + a recovery code shown once), unlock
// (password, or recovery code and a new password), change the password,
// replace the recovery code, turn it back into a normal folder, delete.
// The keys and the content live in private-folders.js.
// ============================================================

import { downloadBlob, el, escapeHtml, lucide, state, toast } from '../core.js';
import { t } from '../i18n/index.js';
import { yantaAlert, yantaConfirm, yantaDialog } from '../dialogs.js';
import { noteMarkdown } from '../yjs.js';

import { generateRecoveryCode } from './private-crypto.js';
import {
  changePrivateFolderPassword,
  deletePrivateFolder,
  isPrivateFolderUnlocked,
  lockPrivateFolder,
  makeFolderNormal,
  makeFolderPrivate,
  privateConversionBlocker,
  recoverPrivateFolder,
  replacePrivateFolderRecoveryCode,
  unlockPrivateFolder,
} from './private-folders.js';

const MIN_PASSWORD = 8;

function ensureCss() {
  if (document.getElementById('yanta-private-css')) return;
  const style = document.createElement('style');
  style.id = 'yanta-private-css';
  style.textContent = `
.yanta-private-form { display: grid; gap: 10px; margin-top: 12px; }
.yanta-private-code {
  display: flex; align-items: center; justify-content: center;
  padding: 12px; border: 1px dashed var(--accent); border-radius: 10px;
  background: var(--bg); color: var(--text);
  font-family: var(--font-mono, monospace); font-size: 17px; font-weight: 700; letter-spacing: .06em;
  user-select: all; word-break: break-all; text-align: center;
}
.yanta-private-code-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.yanta-private-check { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; color: var(--text); line-height: 1.45; cursor: pointer; }
.yanta-private-check input { margin-top: 2px; }
.yanta-private-hint { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-dim); }
.yanta-private-warn { margin: 0; padding: 8px 10px; border-radius: 9px; font-size: 12.5px; line-height: 1.5; color: var(--text); background: color-mix(in srgb, var(--red) 9%, transparent); border: 1px solid color-mix(in srgb, var(--red) 30%, var(--border)); }
.yanta-private-error { min-height: 16px; margin: 0; color: var(--red); font-size: 12px; }
.yanta-private-link { justify-self: start; padding: 0; border: 0; background: none; color: var(--text-dim); font: inherit; font-size: 12.5px; text-decoration: underline; cursor: pointer; }
`;
  document.head.append(style);
}

function input(placeholder, autocomplete = 'new-password') {
  return el('input', { type: 'password', class: 'yanta-dialog-input', placeholder, 'aria-label': placeholder, autocomplete });
}

function folderName(folderId) {
  return state.folders.get(folderId)?.name || t('private.unnamed');
}

function checkNewPassword(first, second, error) {
  if (first.value.length < MIN_PASSWORD) { error.textContent = t('private.tooShort'); first.focus(); return false; }
  if (first.value !== second.value) { error.textContent = t('private.mismatch'); second.focus(); return false; }
  return true;
}

// ---- recovery code: show, copy, print, save

function printRecoveryCode(code, name) {
  const win = window.open('', '_blank', 'width=720,height=640');
  if (!win) return false;

  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(t('private.print.title'))}</title>
<style>
  body { font: 15px/1.55 system-ui, sans-serif; color: #111; margin: 48px; }
  h1 { font-size: 20px; margin: 0 0 18px; }
  .code { margin: 28px 0; padding: 18px; border: 2px dashed #333; border-radius: 12px; font: 700 24px/1.4 ui-monospace, monospace; letter-spacing: .08em; text-align: center; }
  small { color: #555; }
</style></head><body>
  <h1>${escapeHtml(t('private.print.title'))}</h1>
  <p>${escapeHtml(t('private.print.body', { name }))}</p>
  <div class="code">${escapeHtml(code)}</div>
  <small>${escapeHtml(t('private.print.created', { date: new Date().toLocaleDateString() }))}</small>
</body></html>`);
  win.document.close();

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    win.focus();
    win.print();
  };
  win.addEventListener('load', doPrint);
  win.setTimeout(doPrint, 500);
  return true;
}

function recoveryCodeBlock(code, name, button) {
  const box = el('div', { class: 'yanta-private-code' }, code);

  const copy = button({ label: t('private.make.copy'), icon: 'copy' });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast(t('private.make.copied'), 'success');
    } catch {}
  });

  const print = button({ label: t('private.make.print'), icon: 'printer' });
  print.addEventListener('click', () => printRecoveryCode(code, name));

  const save = button({ label: t('private.make.download'), icon: 'download' });
  save.addEventListener('click', () => {
    const text = `${t('private.print.title')}\n\n${t('private.print.body', { name })}\n\n${code}\n`;
    downloadBlob(new Blob([text], { type: 'text/plain' }), 'yanta-private-folder-recovery-code.txt');
  });

  return el('div', { class: 'yanta-private-form' },
    el('strong', {}, t('private.make.codeTitle')),
    el('p', { class: 'yanta-private-warn' }, t('private.make.codeHint')),
    box,
    el('div', { class: 'yanta-private-code-actions' }, copy, print, save)
  );
}

function hasImages(folderId) {
  const inside = (id) => {
    const seen = new Set();
    let f = id;
    while (f && !seen.has(f)) {
      if (f === folderId) return true;
      seen.add(f);
      f = state.folders.get(f)?.parentId;
    }
    return false;
  };

  for (const note of state.notes.values()) {
    if (!inside(note.folderId)) continue;
    try {
      if (/yanta-img:\/\//.test(noteMarkdown(note.id))) return true;
    } catch {}
  }
  return false;
}

// ---- make private

export async function openMakePrivateDialog(folderId) {
  ensureCss();

  const blocker = privateConversionBlocker(folderId);
  if (blocker) {
    await yantaAlert({ title: t('private.menu.makePrivate'), message: blocker, icon: 'lock' });
    return false;
  }

  const name = folderName(folderId);
  const code = generateRecoveryCode();

  return yantaDialog({
    title: t('private.make.title', { name }),
    icon: 'lock',
    build: ({ body, actions, done, button }) => {
      const first = input(t('private.make.password'));
      const second = input(t('private.make.repeat'));
      const saved = el('input', { type: 'checkbox' });
      const error = el('p', { class: 'yanta-private-error', role: 'alert' });

      body.append(
        el('p', { class: 'yanta-private-hint' }, t('private.make.intro')),
        el('div', { class: 'yanta-private-form' }, first, second),
        recoveryCodeBlock(code, name, button),
        el('label', { class: 'yanta-private-check' }, saved, el('span', {}, t('private.make.saved'))),
        ...(hasImages(folderId) ? [el('p', { class: 'yanta-private-hint' }, t('private.make.imagesNote'))] : []),
        el('p', { class: 'yanta-private-hint' }, t('private.make.historyNote')),
        error
      );

      const cancel = button({ label: t('common.cancel'), kind: 'ghost' });
      cancel.addEventListener('click', () => done(null));

      const confirm = button({ label: t('private.make.confirm'), icon: 'lock', kind: 'primary' });
      confirm.disabled = true;
      saved.addEventListener('change', () => { confirm.disabled = !saved.checked; });

      confirm.addEventListener('click', async () => {
        error.textContent = '';
        if (!checkNewPassword(first, second, error)) return;

        confirm.disabled = true;
        cancel.disabled = true;
        confirm.querySelector('span').textContent = t('private.make.working');

        try {
          await makeFolderPrivate(folderId, { password: first.value, recoveryCode: code });
          toast(t('private.make.done', { name }), 'success');
          done(true);
        } catch (err) {
          console.error('[YANTA] Making the folder private failed', err);
          error.textContent = err?.message || String(err);
          confirm.disabled = false;
          cancel.disabled = false;
          confirm.querySelector('span').textContent = t('private.make.confirm');
        }
      });

      actions.append(cancel, el('span', { class: 'grow' }), confirm);
      requestAnimationFrame(() => first.focus());
    },
  });
}

// ---- unlock

export async function openUnlockPrivateDialog(privateFolderId) {
  ensureCss();
  if (isPrivateFolderUnlocked(privateFolderId)) return true;

  return yantaDialog({
    title: t('private.unlock.title'),
    icon: 'lock',
    build: ({ body, actions, done, button }) => {
      const renderPassword = () => {
        const pw = input(t('private.unlock.password'), 'current-password');
        const error = el('p', { class: 'yanta-private-error', role: 'alert' });
        const forgot = el('button', { type: 'button', class: 'yanta-private-link' }, t('private.unlock.forgot'));
        const form = el('form', { class: 'yanta-private-form' }, pw, error, forgot);

        const submit = button({ label: t('private.unlock.submit'), icon: 'lock-open', kind: 'primary', type: 'submit' });
        submit.setAttribute('form', 'yanta-private-unlock-form');
        form.id = 'yanta-private-unlock-form';

        const cancel = button({ label: t('common.cancel'), kind: 'ghost' });
        cancel.addEventListener('click', () => done(null));

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          error.textContent = '';
          submit.disabled = true;
          const result = await unlockPrivateFolder(privateFolderId, pw.value).catch(() => 'wrong');
          submit.disabled = false;

          if (result === 'ok') { done(true); return; }
          error.textContent = result === 'missing' ? t('private.unlock.missing') : t('private.unlock.wrong');
          pw.select();
        });

        forgot.addEventListener('click', renderRecovery);

        body.replaceChildren(form);
        actions.replaceChildren(cancel, el('span', { class: 'grow' }), submit);
        requestAnimationFrame(() => pw.focus());
      };

      const renderRecovery = () => {
        const code = el('input', { type: 'text', class: 'yanta-dialog-input', placeholder: 'XXXX-XXXX-…', 'aria-label': t('private.unlock.code'), autocomplete: 'off', spellcheck: 'false' });
        const first = input(t('private.unlock.newPassword'));
        const second = input(t('private.make.repeat'));
        const error = el('p', { class: 'yanta-private-error', role: 'alert' });
        const form = el('form', { class: 'yanta-private-form', id: 'yanta-private-recover-form' },
          el('strong', {}, t('private.unlock.recoveryTitle')),
          el('p', { class: 'yanta-private-hint' }, t('private.unlock.recoveryHint')),
          code, first, second, error
        );

        const submit = button({ label: t('private.unlock.saveAndUnlock'), icon: 'lock-open', kind: 'primary', type: 'submit' });
        submit.setAttribute('form', 'yanta-private-recover-form');
        const back = button({ label: t('private.unlock.back'), kind: 'ghost' });
        back.addEventListener('click', renderPassword);

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          error.textContent = '';
          if (!checkNewPassword(first, second, error)) return;

          submit.disabled = true;
          const result = await recoverPrivateFolder(privateFolderId, code.value, first.value).catch(() => 'wrong');
          submit.disabled = false;

          if (result === 'ok') {
            toast(t('private.change.done'), 'success');
            done(true);
            return;
          }
          error.textContent = result === 'missing' ? t('private.unlock.missing') : t('private.unlock.codeWrong');
        });

        body.replaceChildren(form);
        actions.replaceChildren(back, el('span', { class: 'grow' }), submit);
        requestAnimationFrame(() => code.focus());
      };

      renderPassword();
    },
  });
}

// ---- unlocked: password, recovery code, normal, delete

export async function openChangePrivatePasswordDialog(privateFolderId) {
  ensureCss();

  return yantaDialog({
    title: t('private.change.title'),
    icon: 'key-round',
    build: ({ body, actions, done, button }) => {
      const first = input(t('private.unlock.newPassword'));
      const second = input(t('private.make.repeat'));
      const error = el('p', { class: 'yanta-private-error', role: 'alert' });
      body.append(el('div', { class: 'yanta-private-form' }, first, second, error));

      const cancel = button({ label: t('common.cancel'), kind: 'ghost' });
      cancel.addEventListener('click', () => done(null));
      const confirm = button({ label: t('private.change.submit'), kind: 'primary' });
      confirm.addEventListener('click', async () => {
        error.textContent = '';
        if (!checkNewPassword(first, second, error)) return;
        confirm.disabled = true;
        try {
          await changePrivateFolderPassword(privateFolderId, first.value);
          toast(t('private.change.done'), 'success');
          done(true);
        } catch (err) {
          error.textContent = err?.message || String(err);
          confirm.disabled = false;
        }
      });

      actions.append(cancel, el('span', { class: 'grow' }), confirm);
      requestAnimationFrame(() => first.focus());
    },
  });
}

export async function openNewRecoveryCodeDialog(privateFolderId) {
  ensureCss();
  const name = folderName(privateFolderId);
  const code = generateRecoveryCode();

  return yantaDialog({
    title: t('private.recovery.title'),
    icon: 'key-round',
    build: ({ body, actions, done, button }) => {
      const saved = el('input', { type: 'checkbox' });
      body.append(
        el('p', { class: 'yanta-private-hint' }, t('private.recovery.intro')),
        recoveryCodeBlock(code, name, button),
        el('label', { class: 'yanta-private-check' }, saved, el('span', {}, t('private.make.saved')))
      );

      const cancel = button({ label: t('common.cancel'), kind: 'ghost' });
      cancel.addEventListener('click', () => done(null));
      const confirm = button({ label: t('private.recovery.confirm'), kind: 'primary' });
      confirm.disabled = true;
      saved.addEventListener('change', () => { confirm.disabled = !saved.checked; });
      confirm.addEventListener('click', async () => {
        confirm.disabled = true;
        await replacePrivateFolderRecoveryCode(privateFolderId, code);
        toast(t('private.recovery.done'), 'success');
        done(true);
      });

      actions.append(cancel, el('span', { class: 'grow' }), confirm);
    },
  });
}

export async function confirmMakeFolderNormal(privateFolderId) {
  const name = folderName(privateFolderId);
  const ok = await yantaConfirm({
    title: t('private.normal.title', { name }),
    message: t('private.normal.message'),
    confirmLabel: t('private.normal.confirm'),
    icon: 'lock-open',
  });
  if (!ok) return false;

  await makeFolderNormal(privateFolderId);
  toast(t('private.normal.done', { name }), 'success');
  return true;
}

export async function confirmDeletePrivateFolder(privateFolderId) {
  const name = folderName(privateFolderId);
  const ok = await yantaConfirm({
    title: t('private.delete.title', { name }),
    message: t('private.delete.message'),
    confirmLabel: t('private.delete.confirm'),
    danger: true,
  });
  if (!ok) return false;

  await deletePrivateFolder(privateFolderId);
  toast(t('private.delete.done'), 'success');
  return true;
}

// ---- menus (tree and dashboard share them)

/** Menu entries for a private folder's root, locked or not. */
export function privateRootMenuItems(folder, { inside = false, openFolder = null } = {}) {
  const id = folder.privateFolderId;

  if (!isPrivateFolderUnlocked(id)) {
    return [{
      label: t('private.menu.unlock'),
      icon: 'lock-open',
      action: () => openUnlockPrivateDialog(id),
    }];
  }

  return [
    ...(inside || !openFolder ? [] : [{ label: t('tree.menu.open'), icon: 'folder-open', action: () => openFolder(id) }, 'hr']),
    { label: t('private.menu.lock'), icon: 'lock', action: () => lockPrivateFolder(id) },
    { label: t('private.menu.changePassword'), icon: 'key-round', action: () => openChangePrivatePasswordDialog(id) },
    { label: t('private.menu.newRecoveryCode'), icon: 'rotate-ccw-key', action: () => openNewRecoveryCodeDialog(id) },
    'hr',
    { label: t('private.menu.makeNormal'), icon: 'lock-open', action: () => confirmMakeFolderNormal(id) },
    { label: t('private.menu.delete'), icon: 'trash', danger: true, action: () => confirmDeletePrivateFolder(id) },
  ];
}

/** "Make private…" for an ordinary folder. */
export function makePrivateMenuItem(folder) {
  return {
    label: t('private.menu.makePrivate'),
    icon: 'lock',
    action: () => openMakePrivateDialog(folder.id),
  };
}

export function privateFolderIcon(folder) {
  const span = el('span', { class: 'private-folder-dot', title: folder.privateLocked ? t('private.badgeLocked') : t('private.badgeUnlocked') });
  span.innerHTML = lucide(folder.privateLocked ? 'lock' : 'lock-open', 11);
  return span;
}
