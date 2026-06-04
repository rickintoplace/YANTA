// ============================================================
// YANTA — Inline UI helpers.
// Replaces prompt()/confirm() with in-place controls.
// No modal, no browser dialog.
// ============================================================

import { escapeHtml, lucide } from './core.js';

function stop(e) {
  e.preventDefault();
  e.stopPropagation();
}

function stopBubble(e) {
  e.stopPropagation();
}

export function inlineTextEdit(anchor, {
  initial = '',
  placeholder = '',
  emptyFallback = 'Untitled',
  commitLabel = 'Save',
  cancelLabel = 'Cancel',
  select = true,
  displayValue,
  onCommit,
  onCancel,
} = {}) {
  if (!anchor) return null;

  if (anchor.dataset.inlineEditing === '1') {
    anchor.querySelector('input')?.focus();
    anchor.querySelector('input')?.select();
    return null;
  }

  anchor.dataset.inlineEditing = '1';

  const oldChildren = [...anchor.childNodes];
  const oldTitle = anchor.getAttribute('title') || '';

  const form = document.createElement('form');
  form.className = 'yanta-inline-edit';
  form.innerHTML = `
    <input class="yanta-inline-edit-input"
      value="${escapeHtml(initial)}"
      placeholder="${escapeHtml(placeholder)}"
      autocomplete="off"
      spellcheck="false" />
    <button type="submit" class="yanta-inline-edit-btn primary" title="${escapeHtml(commitLabel)}">
      ${lucide('check', 13)}
    </button>
    <button type="button" class="yanta-inline-edit-btn" data-cancel title="${escapeHtml(cancelLabel)}">
      ${lucide('x', 13)}
    </button>
    <span class="yanta-inline-edit-error" hidden></span>
  `;

  const input = form.querySelector('input');
  const cancelBtn = form.querySelector('[data-cancel]');
  const errorEl = form.querySelector('.yanta-inline-edit-error');

  const cleanupEditingFlag = () => {
    anchor.dataset.inlineEditing = '';
    delete anchor.dataset.inlineEditing;

    if (oldTitle) anchor.setAttribute('title', oldTitle);
    else anchor.removeAttribute('title');
  };

  const restore = () => {
    anchor.replaceChildren(...oldChildren);
    cleanupEditingFlag();
    onCancel?.();
  };

  const finish = (value) => {
    const shown = displayValue ? displayValue(value) : value;
    anchor.textContent = shown;
    cleanupEditingFlag();
  };

  // Wichtig:
  // NICHT capture:true verwenden.
  // Sonst erreichen Klicks auf X/Check nicht zuverlässig den Button-Handler.
  form.addEventListener('pointerdown', stopBubble);
  form.addEventListener('mousedown', stopBubble);
  form.addEventListener('click', stopBubble);

  form.addEventListener('submit', async (e) => {
    stop(e);

    const value = (input.value || '').trim() || emptyFallback;

    try {
      form.classList.add('is-saving');
      errorEl.hidden = true;

      const result = await onCommit?.(value);

      if (result === false) {
        form.classList.remove('is-saving');
        return;
      }

      finish(typeof result === 'string' ? result : value);
    } catch (err) {
      console.error(err);
      form.classList.remove('is-saving');
      errorEl.textContent = err?.message || 'Could not save';
      errorEl.hidden = false;
    }
  });

  cancelBtn.addEventListener('click', (e) => {
    stop(e);
    restore();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      stop(e);
      restore();
      return;
    }
  
    // Optional: Ctrl/Cmd+Enter speichert explizit.
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      stop(e);
      form.requestSubmit();
      return;
    }
  
    /*
      Wichtig:
      Keydowns aus dem Inline-Editor dürfen nicht bis zu Cards,
      Tree-Rows oder globalen Shortcuts bubbelen.
  
      Bei normalem Enter NICHT preventDefault() aufrufen,
      damit der native Form-Submit weiterhin speichern kann.
    */
    e.stopPropagation();
  });

  anchor.replaceChildren(form);
  anchor.setAttribute('title', '');

  requestAnimationFrame(() => {
    input.focus();
    if (select) input.select();
  });

  return {
    input,
    cancel: restore,
  };
}

export function inlineConfirm(anchor, {
  message = 'Are you sure?',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  placement = 'after',
  onConfirm,
  onCancel,
} = {}) {
  if (!anchor) return null;

  const parent = anchor.parentElement || anchor;
  parent.querySelectorAll(':scope > .yanta-inline-confirm').forEach((n) => n.remove());

  const wrap = document.createElement('span');
  wrap.className = 'yanta-inline-confirm' + (danger ? ' danger' : '');
  wrap.innerHTML = `
    <span class="yanta-inline-confirm-msg">${escapeHtml(message)}</span>
    <button type="button" class="yanta-inline-confirm-btn ${danger ? 'danger' : 'primary'}" data-confirm>
      ${escapeHtml(confirmLabel)}
    </button>
    <button type="button" class="yanta-inline-confirm-btn" data-cancel>
      ${escapeHtml(cancelLabel)}
    </button>
  `;

  const confirmBtn = wrap.querySelector('[data-confirm]');
  const cancelBtn = wrap.querySelector('[data-cancel]');
  const msgEl = wrap.querySelector('.yanta-inline-confirm-msg');

  // Auch hier: kein capture:true.
  // Buttons müssen erst ihre eigenen click-Handler bekommen.
  wrap.addEventListener('pointerdown', stopBubble);
  wrap.addEventListener('mousedown', stopBubble);
  wrap.addEventListener('click', stopBubble);

  cancelBtn.addEventListener('click', (e) => {
    stop(e);
    wrap.remove();
    onCancel?.();
  });

  confirmBtn.addEventListener('click', async (e) => {
    stop(e);

    try {
      wrap.classList.add('is-saving');
      await onConfirm?.();
      wrap.remove();
    } catch (err) {
      console.error(err);
      wrap.classList.remove('is-saving');
      msgEl.textContent = err?.message || 'Action failed';
    }
  });

  if (placement === 'inside') {
    anchor.append(wrap);
  } else {
    anchor.insertAdjacentElement('afterend', wrap);
  }

  requestAnimationFrame(() => {
    confirmBtn?.focus();
  });

  return wrap;
}