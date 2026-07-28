// ============================================================
// YANTA — Native Dialogs
//
// Replaces browser confirm()/prompt()/alert() with branded,
// accessible, promise-based YANTA dialogs.
//
// Exports:
// - yantaConfirm({ title, message, confirmLabel, cancelLabel, danger, icon })
// - yantaPrompt({ title, message, label, initial, placeholder, required, multiline, inputType })
// - yantaChoice({ title, message, choices })
// - yantaAlert({ title, message, icon })
// - yantaFolderPicker({ title, allowNone, noneLabel, isDisabled })
//
// Return values:
// - yantaConfirm -> boolean
// - yantaPrompt -> string | null
// - yantaChoice -> choice.id | null
// - yantaFolderPicker -> folderId | null | undefined
//   null = "No folder", undefined = cancelled
// ============================================================

import {
  state,
  escapeHtml,
  escapeAttr,
  lucide,
} from './core.js';
import { t } from './i18n/index.js';

import {
  pushOverlayState,
  closeTopOverlay,
  registerOverlayRoute,
  overlayIdFromState,
} from './overlay-history.js';
  
let cssInjected = false;
let activeDialog = null;
let dialogOverlayRegistered = false;
  
function dialogIsOpen() {
  return !!activeDialog?.modal?.isConnected;
}

function registerDialogOverlayRoute() {
  if (dialogOverlayRegistered) return;

  dialogOverlayRegistered = true;

  registerOverlayRoute('yanta-dialog', {
    // Generic promise dialogs cannot be meaningfully restored on Forward,
    // because their original Promise resolver no longer exists.
    // So open is intentionally a no-op.
    open: () => {},

    close: () => {
      activeDialog?.complete?.(null, {
        fromHistory: true,
      });
    },

    isOpen: dialogIsOpen,

    surface: () => {
      const modal = activeDialog?.modal;
      if (!modal?.isConnected) return null;

      return {
        element: modal.querySelector('.yanta-dialog-card') || modal,
        backdrop: modal,
        mode: 'shrink',
      };
    },
  });
}

  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
  
    const style = document.createElement('style');
    style.id = 'yanta-dialogs-css';
    style.textContent = `
  .yanta-dialog-modal {
    position: fixed;
    inset: 0;
    z-index: 1520;
  
    display: flex;
    align-items: center;
    justify-content: center;
  
    padding:
      max(16px, env(safe-area-inset-top))
      max(16px, env(safe-area-inset-right))
      max(16px, env(safe-area-inset-bottom))
      max(16px, env(safe-area-inset-left));
  
    background: rgba(0,0,0,0.52);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  
    animation: yanta-dialog-fade 120ms ease;
  }
  
  .yanta-dialog-modal[hidden] {
    display: none !important;
  }
  
  .yanta-dialog-card {
    width: min(520px, 100%);
    max-height: min(78vh, 720px);
  
    display: flex;
    flex-direction: column;
    overflow: hidden;
  
    color: var(--text);
    background: var(--bg-elev);
  
    border: 1px solid var(--border);
    border-radius: 16px;
  
    box-shadow:
      0 28px 90px rgba(0,0,0,0.48),
      0 1px 0 rgba(255,255,255,0.04) inset;
  
    animation: yanta-dialog-pop 150ms cubic-bezier(.2,.8,.2,1);
  }
  
  .yanta-dialog-card.danger {
    border-color: color-mix(in srgb, var(--red) 45%, var(--border));
  }
  
  .yanta-dialog-head {
    flex: 0 0 auto;
  
    min-height: 54px;
    padding: 13px 14px;
  
    display: flex;
    align-items: center;
    gap: 11px;
  
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev-2);
  }
  
  .yanta-dialog-icon {
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
  
    display: inline-flex;
    align-items: center;
    justify-content: center;
  
    border-radius: 999px;
  
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  
  .yanta-dialog-card.danger .yanta-dialog-icon {
    color: var(--red);
    background: color-mix(in srgb, var(--red) 14%, transparent);
  }
  
  .yanta-dialog-title-wrap {
    flex: 1;
    min-width: 0;
  }
  
  .yanta-dialog-title {
    margin: 0;
  
    color: var(--text);
    font-size: 15px;
    font-weight: 850;
    line-height: 1.25;
  
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  
  .yanta-dialog-kicker {
    margin-top: 2px;
  
    color: var(--text-faint);
    font-size: 11px;
    line-height: 1.25;
  }
  
  .yanta-dialog-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  
    padding: 15px;
  }
  
  .yanta-dialog-message {
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1.55;
    white-space: normal;
  }
  
  .yanta-dialog-message strong {
    color: var(--text);
  }
  
  .yanta-dialog-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  
  .yanta-dialog-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  
    color: var(--text-dim);
    font-size: 12px;
  }
  
  .yanta-dialog-field-label {
    color: var(--text);
    font-weight: 720;
  }
  
  .yanta-dialog-input {
    width: 100%;
    margin: 0;
  
    color: var(--text);
    background: var(--bg);
  
    border: 1px solid var(--border);
    border-radius: 9px;
  
    padding: 9px 10px;
  
    font: inherit;
    font-size: 13px;
    line-height: 1.35;
  
    outline: none;
  }
  
  textarea.yanta-dialog-input {
    min-height: 110px;
    resize: vertical;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.45;
  }
  
  .yanta-dialog-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
  }
  
  .yanta-dialog-error {
    min-height: 16px;
  
    color: var(--red);
    font-size: 12px;
    line-height: 1.35;
  }
  
  .yanta-dialog-error[hidden] {
    display: none !important;
  }
  
  .yanta-dialog-actions {
    flex: 0 0 auto;
  
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  
    padding: 12px 14px;
  
    border-top: 1px solid var(--border);
    background: var(--bg-elev-2);
  }
  
  .yanta-dialog-actions .grow {
    flex: 1;
  }
  
  .yanta-dialog-btn {
    min-height: 34px;
  
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
  
    padding: 7px 12px;
  
    border-radius: 9px;
    border: 1px solid var(--border);
  
    color: var(--text);
    background: var(--bg-elev);
  
    font-size: 13px;
    font-weight: 720;
  
    cursor: pointer;
  }
  
  .yanta-dialog-btn:hover:not(:disabled) {
    background: var(--bg-elev-3);
    border-color: var(--border-strong);
  }
  
  .yanta-dialog-btn.primary {
    color: white;
    background: var(--accent);
    border-color: var(--accent);
  }
  
  .yanta-dialog-btn.primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  
  .yanta-dialog-btn.danger {
    color: white;
    background: var(--red);
    border-color: var(--red);
  }
  
  .yanta-dialog-btn.danger:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  
  .yanta-dialog-btn.ghost {
    background: transparent;
    border-color: transparent;
    color: var(--text-dim);
  }
  
  .yanta-dialog-btn.ghost:hover:not(:disabled) {
    color: var(--text);
    background: var(--bg-elev-3);
  }
  
  .yanta-dialog-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  
  .yanta-choice-list,
  .yanta-folder-picker-list {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  
  .yanta-choice-option,
  .yanta-folder-picker-option {
    width: 100%;
  
    display: flex;
    align-items: center;
    gap: 9px;
  
    min-height: 42px;
    padding: 9px 10px;
  
    color: var(--text);
    background: var(--bg-elev-2);
  
    border: 1px solid var(--border);
    border-radius: 10px;
  
    text-align: left;
    cursor: pointer;
  }
  
  .yanta-choice-option:hover:not(:disabled),
  .yanta-folder-picker-option:hover:not(:disabled),
  .yanta-choice-option.active,
  .yanta-folder-picker-option.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 9%, var(--bg-elev-2));
  }
  
  .yanta-choice-option.primary {
    border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
  }
  
  .yanta-choice-option.danger {
    border-color: color-mix(in srgb, var(--red) 38%, var(--border));
    color: var(--red);
  }
  
  .yanta-choice-option:disabled,
  .yanta-folder-picker-option:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  
  .yanta-choice-option-icon,
  .yanta-folder-picker-icon {
    width: 24px;
    height: 24px;
    flex: 0 0 24px;
  
    display: inline-flex;
    align-items: center;
    justify-content: center;
  
    color: var(--accent);
  }
  
  .yanta-choice-option.danger .yanta-choice-option-icon {
    color: var(--red);
  }
  
  .yanta-choice-option-main,
  .yanta-folder-picker-main {
    flex: 1;
    min-width: 0;
  
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  
  .yanta-choice-option-main strong,
  .yanta-folder-picker-main strong {
    color: var(--text);
    font-size: 13px;
    line-height: 1.25;
  }
  
  .yanta-choice-option.danger .yanta-choice-option-main strong {
    color: var(--red);
  }
  
  .yanta-choice-option-main small,
  .yanta-folder-picker-main small {
    color: var(--text-faint);
    font-size: 11px;
    line-height: 1.25;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  
  .yanta-folder-picker-search-row {
    display: flex;
    align-items: center;
    gap: 8px;
  
    margin-bottom: 10px;
    padding: 0 1px;
  }
  
  .yanta-folder-picker-search-row svg {
    color: var(--text-faint);
    flex: 0 0 auto;
  }
  
  .yanta-folder-picker-search-row input {
    flex: 1;
    min-width: 0;
  }
  
  .yanta-folder-picker-empty {
    padding: 16px;
    text-align: center;
  
    color: var(--text-faint);
    font-size: 12px;
    font-style: italic;
  
    border: 1px dashed var(--border);
    border-radius: 10px;
  }
  
  @keyframes yanta-dialog-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  @keyframes yanta-dialog-pop {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.985);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  
  @media (max-width: 640px) {
    .yanta-dialog-modal {
      align-items: flex-end;
      padding: 8px;
    }
  
    .yanta-dialog-card {
      width: 100%;
      max-height: min(88dvh, 760px);
      border-radius: 18px;
    }
  
    .yanta-dialog-title {
      white-space: normal;
    }
  
    .yanta-dialog-actions {
      flex-wrap: wrap;
    }
  
    .yanta-dialog-actions .yanta-dialog-btn {
      flex: 1 1 auto;
    }
  }
  
  @media (prefers-reduced-motion: reduce) {
    .yanta-dialog-modal,
    .yanta-dialog-card {
      animation: none !important;
    }
  }
    `;
  
    document.head.append(style);
  }
  
  function focusablesIn(node) {
    return [...node.querySelectorAll(
      [
        'button:not([disabled])',
        'input:not([disabled])',
        'textarea:not([disabled])',
        'select:not([disabled])',
        'a[href]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(',')
    )].filter((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden';
    });
  }
  
  function messageHtml(message = '') {
    return escapeHtml(String(message || '')).replace(/\n/g, '<br>');
  }
  
function closeActiveDialog() {
  if (!activeDialog) return;

  activeDialog.complete?.(null, {
    fromHistory: true,
  });
}
  
function makeModal({
  title = 'YANTA',
  message = '',
  icon = 'info',
  danger = false,
  kicker = '',
  closeOnBackdrop = true,
} = {}) {
  injectCss();
  registerDialogOverlayRoute();

  // If another YANTA dialog is currently open, cancel it directly.
  // Do not history.back() here; we are replacing the active dialog.
  closeActiveDialog();

  const modal = document.createElement('div');
  modal.className = 'yanta-dialog-modal';

  const card = document.createElement('div');
  card.className = 'yanta-dialog-card' + (danger ? ' danger' : '');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', title || t('dialog.ariaFallback'));

  card.innerHTML = `
    <header class="yanta-dialog-head">
      <span class="yanta-dialog-icon">${lucide(danger ? 'triangle-alert' : icon, 18)}</span>

      <div class="yanta-dialog-title-wrap">
        <h3 class="yanta-dialog-title">${escapeHtml(title)}</h3>
        ${kicker ? `<div class="yanta-dialog-kicker">${escapeHtml(kicker)}</div>` : ''}
      </div>

      <button type="button" class="icon-btn" data-dialog-x title="${escapeAttr(t('common.close'))}">${lucide('x', 16)}</button>
    </header>

    <main class="yanta-dialog-body">
      ${message ? `<div class="yanta-dialog-message">${messageHtml(message)}</div>` : ''}
    </main>

    <footer class="yanta-dialog-actions"></footer>
  `;

  modal.append(card);
  document.body.append(modal);

  const body = card.querySelector('.yanta-dialog-body');
  const actions = card.querySelector('.yanta-dialog-actions');

  let finishHandler = () => {};
  let closing = false;
  let pendingHistoryClose = false;
  let pendingHistoryValue = null;

  const cleanup = () => {
    window.removeEventListener('keydown', onKey, true);

    if (activeDialog?.modal === modal) {
      activeDialog = null;
    }

    try {
      modal.remove();
    } catch {}
  };

  const complete = (value = null, {
    fromHistory = false,
  } = {}) => {
    if (closing) return;

    /*
      User-initiated close:
      If this dialog owns the current overlay state, let browser history
      drive the actual close. Store the intended result so the Promise
      resolves correctly when popstate closes the dialog.
    */
    if (
      !fromHistory &&
      modal.isConnected &&
      overlayIdFromState() === 'yanta-dialog'
    ) {
      pendingHistoryClose = true;
      pendingHistoryValue = value;

      closeTopOverlay(() => {
        complete(value, {
          fromHistory: true,
        });
      });

      return;
    }

    closing = true;

    const finalValue = pendingHistoryClose
      ? pendingHistoryValue
      : value;

    cleanup();
    finishHandler?.(finalValue);
  };

  activeDialog = {
    modal,
    complete,
  };

  /*
    Push a dialog overlay state.
    If another dialog state is already current, replace it instead of
    stacking duplicate generic dialog states.
  */
  pushOverlayState('yanta-dialog', {}, {
    replace: overlayIdFromState() === 'yanta-dialog',
  });

  function onKey(e) {
    if (!modal.isConnected) {
      window.removeEventListener('keydown', onKey, true);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();

      complete(null);
      return;
    }

    if (e.key === 'Tab') {
      const items = focusablesIn(card);
      if (!items.length) return;

      const first = items[0];
      const last = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  window.addEventListener('keydown', onKey, true);

  modal.addEventListener('mousedown', (e) => {
    if (!closeOnBackdrop) return;

    if (e.target === modal) {
      e.preventDefault();
      complete(null);
    }
  });

  card.querySelector('[data-dialog-x]')?.addEventListener('click', () => {
    complete(null);
  });

  return {
    modal,
    card,
    body,
    actions,

    setFinish(fn) {
      finishHandler = fn || (() => {});
    },

    close: complete,

    // Raw cleanup for emergency use only.
    cleanup,
  };
}
  
  function button({
    label,
    icon = '',
    kind = '',
    type = 'button',
    dataset = {},
  } = {}) {
    const btn = document.createElement('button');
    btn.type = type;
    btn.className = [
      'yanta-dialog-btn',
      kind,
    ].filter(Boolean).join(' ');
  
    for (const [k, v] of Object.entries(dataset || {})) {
      btn.dataset[k] = v;
    }
  
    btn.innerHTML = `${icon ? lucide(icon, 14) : ''}<span>${escapeHtml(label)}</span>`;
    return btn;
  }
  
  export function yantaConfirm({
    title = t('dialog.confirmTitle'),
    message = '',
    confirmLabel = t('dialog.confirmAction'),
    cancelLabel = t('common.cancel'),
    danger = false,
    icon = danger ? 'triangle-alert' : 'help-circle',
    kicker = '',
  } = {}) {
    return new Promise((resolve) => {
      const dlg = makeModal({
        title,
        message,
        icon,
        danger,
        kicker,
      });
  
      const cancel = button({
        label: cancelLabel,
        kind: 'ghost',
        icon: 'x',
      });
  
      const confirm = button({
        label: confirmLabel,
        kind: danger ? 'danger' : 'primary',
        icon: danger ? 'trash' : 'check',
      });
  
      dlg.actions.append(cancel, confirm);
  
      dlg.setFinish((value) => {
        resolve(value === true);
      });

      cancel.addEventListener('click', () => {
        dlg.close(false);
      }, { once: true });

      confirm.addEventListener('click', () => {
        dlg.close(true);
      }, { once: true });
  
      requestAnimationFrame(() => {
        confirm.focus();
      });
    });
  }
  
  export function yantaAlert({
    title = t('dialog.noticeTitle'),
    message = '',
    icon = 'info',
    confirmLabel = t('common.ok'),
  } = {}) {
    return new Promise((resolve) => {
      const dlg = makeModal({
        title,
        message,
        icon,
        danger: false,
      });
  
      const ok = button({
        label: confirmLabel,
        kind: 'primary',
        icon: 'check',
      });
  
      dlg.actions.append(ok);
  
      dlg.setFinish(() => resolve());

      ok.addEventListener('click', () => {
        dlg.close(true);
      }, { once: true });
  
      requestAnimationFrame(() => ok.focus());
    });
  }
  
  export function yantaPrompt({
    title = t('dialog.inputTitle'),
    message = '',
    label = '',
    initial = '',
    placeholder = '',
    required = false,
    multiline = false,
    inputType = 'text',
    confirmLabel = t('common.save'),
    cancelLabel = t('common.cancel'),
    danger = false,
    icon = danger ? 'triangle-alert' : 'pencil',
    validate = null,
    select = true,
  } = {}) {
    return new Promise((resolve) => {
      const dlg = makeModal({
        title,
        message,
        icon,
        danger,
        closeOnBackdrop: false,
      });
  
      dlg.body.innerHTML = `
        <form class="yanta-dialog-form" data-prompt-form>
          ${
            label
              ? `<label class="yanta-dialog-field">
                  <span class="yanta-dialog-field-label">${escapeHtml(label)}</span>
                  ${
                    multiline
                      ? `<textarea class="yanta-dialog-input" data-prompt-input placeholder="${escapeAttr(placeholder)}" spellcheck="false">${escapeHtml(initial)}</textarea>`
                      : `<input class="yanta-dialog-input" data-prompt-input type="${escapeAttr(inputType)}" value="${escapeAttr(initial)}" placeholder="${escapeAttr(placeholder)}" autocomplete="off" spellcheck="false" />`
                  }
                </label>`
              : multiline
                ? `<textarea class="yanta-dialog-input" data-prompt-input placeholder="${escapeAttr(placeholder)}" spellcheck="false">${escapeHtml(initial)}</textarea>`
                : `<input class="yanta-dialog-input" data-prompt-input type="${escapeAttr(inputType)}" value="${escapeAttr(initial)}" placeholder="${escapeAttr(placeholder)}" autocomplete="off" spellcheck="false" />`
          }
  
          <div class="yanta-dialog-error" data-prompt-error hidden></div>
        </form>
      `;
  
      const form = dlg.body.querySelector('[data-prompt-form]');
      const input = dlg.body.querySelector('[data-prompt-input]');
      const error = dlg.body.querySelector('[data-prompt-error]');
  
      const cancel = button({
        label: cancelLabel,
        kind: 'ghost',
        icon: 'x',
      });
  
      const submit = button({
        label: confirmLabel,
        kind: danger ? 'danger' : 'primary',
        icon: danger ? 'triangle-alert' : 'check',
        type: 'submit',
      });
  
      dlg.actions.append(cancel, submit);
  
      const fail = (msg) => {
        error.textContent = msg || t('dialog.invalid');
        error.hidden = false;
        input.focus();
      };
  
      const commit = async () => {
        const value = String(input.value || '').trim();
  
        if (required && !value) {
          fail(t('dialog.required'));
          return;
        }
  
        if (validate) {
          const result = await validate(value);
  
          if (result === false) {
            fail(t('dialog.invalid'));
            return;
          }
  
          if (typeof result === 'string') {
            fail(result);
            return;
          }
        }
  
        dlg.close(value);
      };
  
      dlg.setFinish((value) => {
        resolve(typeof value === 'string' ? value : null);
      });

      cancel.addEventListener('click', () => {
        dlg.close(null);
      }, { once: true });
  
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        commit();
      });
  
      submit.addEventListener('click', (e) => {
        e.preventDefault();
        commit();
      });
  
      if (multiline) {
        input.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        });
      }
  
      requestAnimationFrame(() => {
        input.focus();
        if (select && input.select) input.select();
      });
    });
  }
  
  export function yantaChoice({
    title = 'Choose',
    message = '',
    icon = 'list-checks',
    danger = false,
    choices = [],
    cancelLabel = 'Cancel',
  } = {}) {
    return new Promise((resolve) => {
      const dlg = makeModal({
        title,
        message,
        icon,
        danger,
      });
  
      const list = document.createElement('div');
      list.className = 'yanta-choice-list';
  
      for (const choice of choices) {
        const btn = document.createElement('button');
        btn.type = 'button';
  
        btn.className = [
          'yanta-choice-option',
          choice.primary ? 'primary' : '',
          choice.danger ? 'danger' : '',
        ].filter(Boolean).join(' ');
  
        if (choice.disabled) btn.disabled = true;
  
        btn.innerHTML = `
          <span class="yanta-choice-option-icon">
            ${lucide(choice.icon || (choice.danger ? 'triangle-alert' : 'circle'), 16)}
          </span>
  
          <span class="yanta-choice-option-main">
            <strong>${escapeHtml(choice.label || choice.id)}</strong>
            ${choice.hint ? `<small>${escapeHtml(choice.hint)}</small>` : ''}
          </span>
        `;
  
        btn.addEventListener('click', () => {
          if (choice.disabled) return;
          dlg.close(choice.id);
        });
  
        list.append(btn);
      }
  
      dlg.body.append(list);
  
      const cancel = button({
        label: cancelLabel,
        kind: 'ghost',
        icon: 'x',
      });
  
      dlg.actions.append(cancel);
  
      dlg.setFinish((value) => {
        resolve(value || null);
      });

      cancel.addEventListener('click', () => {
        dlg.close(null);
      }, { once: true });
  
      requestAnimationFrame(() => {
        list.querySelector('button:not([disabled])')?.focus();
      });
    });
  }
  
  function folderPath(folderId) {
    if (!folderId) return '';
  
    const parts = [];
    const seen = new Set();
    let f = state.folders.get(folderId);
  
    while (f && !seen.has(f.id)) {
      seen.add(f.id);
      parts.unshift(f.name || 'Folder');
      f = f.parentId ? state.folders.get(f.parentId) : null;
    }
  
    return parts.join(' / ');
  }
  
  function sortedFolders() {
    return [...state.folders.values()]
      .sort((a, b) =>
        folderPath(a.id).localeCompare(folderPath(b.id)) ||
        String(a.name || '').localeCompare(String(b.name || ''))
      );
  }
  
  export function yantaFolderPicker({
    title = 'Choose folder',
    message = '',
    allowNone = true,
    noneLabel = 'No folder / Home',
    currentFolderId = '',
    isDisabled = null,
    disabledHint = 'Not available',
  } = {}) {
    return new Promise((resolve) => {
      const dlg = makeModal({
        title,
        message,
        icon: 'folder-input',
      });
  
      let query = '';
  
      const render = () => {
        const q = query.trim().toLowerCase();
        const folders = sortedFolders()
          .filter((f) => {
            if (!q) return true;
  
            const hay = [
              f.name || '',
              f.id,
              folderPath(f.id),
            ].join(' ').toLowerCase();
  
            return hay.includes(q);
          });
  
        dlg.body.innerHTML = `
          <div class="yanta-folder-picker-search-row">
            ${lucide('search', 15)}
            <input class="yanta-dialog-input" data-folder-search value="${escapeAttr(query)}" placeholder="Search folders…" autocomplete="off" spellcheck="false" />
          </div>
  
          <div class="yanta-folder-picker-list">
            ${
              allowNone
                ? `
                  <button type="button" class="yanta-folder-picker-option ${!currentFolderId ? 'active' : ''}" data-folder-id="">
                    <span class="yanta-folder-picker-icon">${lucide('home', 16)}</span>
                    <span class="yanta-folder-picker-main">
                      <strong>${escapeHtml(noneLabel)}</strong>
                      <small>Place item at the top level</small>
                    </span>
                  </button>
                `
                : ''
            }
  
            ${
              folders.length
                ? folders.map((f) => {
                    const disabled = !!isDisabled?.(f);
                    const path = folderPath(f.id);
  
                    return `
                      <button type="button"
                        class="yanta-folder-picker-option ${String(f.id) === String(currentFolderId) ? 'active' : ''}"
                        data-folder-id="${escapeAttr(f.id)}"
                        ${disabled ? 'disabled' : ''}>
                        <span class="yanta-folder-picker-icon">${lucide(f.icon || 'folder', 16)}</span>
                        <span class="yanta-folder-picker-main">
                          <strong>${escapeHtml(f.name || 'Folder')}</strong>
                          <small>${escapeHtml(disabled ? disabledHint : path || 'Top level')}</small>
                        </span>
                      </button>
                    `;
                  }).join('')
                : `<div class="yanta-folder-picker-empty">No folders found.</div>`
            }
          </div>
        `;
  
        const input = dlg.body.querySelector('[data-folder-search]');
  
        input?.addEventListener('input', () => {
          query = input.value || '';
          render();
        });
  
        input?.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            dlg.close(undefined);
          }
  
          if (e.key === 'Enter') {
            const first = dlg.body.querySelector('.yanta-folder-picker-option:not([disabled])');
            if (first) {
              e.preventDefault();
              first.click();
            }
          }
        });
  
        dlg.body.querySelectorAll('[data-folder-id]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (btn.disabled) return;
  
            const value = btn.dataset.folderId || null;
  
            dlg.close(value);
          });
        });
  
        requestAnimationFrame(() => {
          input?.focus();
          input?.setSelectionRange(query.length, query.length);
        });
      };
  
      const cancel = button({
        label: 'Cancel',
        kind: 'ghost',
        icon: 'x',
      });
  
      dlg.actions.append(cancel);
  
      dlg.setFinish((value) => {
        resolve(value);
      });

      cancel.addEventListener('click', () => {
        dlg.close(undefined);
      }, { once: true });
  
      render();
    });
  }