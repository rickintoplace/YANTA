// ============================================================
// YANTA — pre-contractual withdrawal step (§ 356 Abs. 4/5 BGB)
//
// YANTA Plus activates the moment the payment goes through, which is
// "beginning performance during the withdrawal period". That is only lawful
// if the consumer expressly requested it and acknowledged what it means, so
// the checkbox is a condition of proceeding rather than a nicety.
//
// It deliberately does not claim the right disappears on payment: for a
// running subscription the service is not completely performed at signup,
// so a withdrawal stays possible and is settled pro rata (§ 357 Abs. 8 BGB).
// The withdrawal notice spells that out; this dialog links to it.
//
// Self-contained on purpose — it runs both inside the app shell and on the
// standalone /pricing page, which has no dialog system of its own.
// ============================================================

import { t } from '../i18n/index.js';

const DIALOG_ID = 'yanta-withdrawal-consent';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function ensureCss() {
  if (document.getElementById(`${DIALOG_ID}-css`)) return;

  const style = document.createElement('style');
  style.id = `${DIALOG_ID}-css`;
  style.textContent = `
#${DIALOG_ID}::backdrop {
  background: rgba(0, 0, 0, 0.44);
}

#${DIALOG_ID} {
  width: min(520px, calc(100vw - 32px));
  /* The app stylesheet styles bare <dialog>; restore native modal centring. */
  margin: auto;
  padding: 0;
  inset: 0;
  position: fixed;
  max-height: calc(100dvh - 32px);
  border: 1px solid var(--border, #d8c7a5);
  border-radius: 18px;
  background: var(--bg-elev, #f7efd8);
  color: var(--text, #29251d);
  font-family: var(--font, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  overflow: auto;
}

/* Same reasoning as the legal pages: the UA blue fails on the dark theme. */
#${DIALOG_ID} a {
  color: var(--text, #29251d);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.yanta-consent__body {
  padding: 24px 24px 20px;
}

.yanta-consent__body h2 {
  margin: 0 0 10px;
  font-size: 20px;
}

.yanta-consent__body p {
  margin: 0 0 12px;
  color: var(--text-dim, #625a49);
  font-size: 14px;
  line-height: 1.6;
}

.yanta-consent__check {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-top: 16px;
  padding: 13px 15px;
  border: 1px solid var(--border, #d8c7a5);
  border-radius: 12px;
  background: var(--bg, #fff8ef);
  cursor: pointer;
}

.yanta-consent__check input {
  margin-top: 2px;
  flex: none;
  accent-color: var(--accent, #8FA31E);
}

.yanta-consent__check span {
  color: var(--text, #29251d);
  font-size: 13.5px;
  line-height: 1.55;
}

.yanta-consent__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 0 24px 22px;
}

.yanta-consent__btn {
  min-height: 40px;
  padding: 9px 16px;
  border: 1px solid var(--border, #d8c7a5);
  border-radius: 10px;
  background: var(--bg-elev-2, #efe3c7);
  color: var(--text, #29251d);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.yanta-consent__btn.primary {
  border-color: var(--accent, #8FA31E);
  background: var(--accent, #8FA31E);
  color: #fff;
}

.yanta-consent__btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.yanta-consent__btn:focus-visible,
.yanta-consent__check:focus-within {
  outline: 2px solid var(--accent, #8FA31E);
  outline-offset: 2px;
}
`;
  document.head.append(style);
}

/**
 * Ask for the express request and acknowledgement.
 *
 * Resolves `true` once the box is ticked and the buyer continues, and
 * `false` if they back out — callers must treat `false` as "do not open
 * checkout".
 */
export function requestWithdrawalConsent() {
  ensureCss();

  document.getElementById(DIALOG_ID)?.remove();

  const dialog = document.createElement('dialog');
  dialog.id = DIALOG_ID;
  dialog.setAttribute('aria-labelledby', `${DIALOG_ID}-title`);

  /*
    keepRight carries a {link} token so translators can place the link where
    their sentence needs it instead of having the markup dictate word order.
  */
  const withdrawalLink =
    `<a href="/withdrawal" target="_blank" rel="noopener">${escapeHtml(t('site.consent.linkLabel'))}</a>`;

  dialog.innerHTML = `
    <form method="dialog" class="yanta-consent__body">
      <h2 id="${DIALOG_ID}-title">${escapeHtml(t('site.consent.title'))}</h2>

      <p>${escapeHtml(t('site.consent.lead'))}</p>

      <p>${t('site.consent.keepRight', { link: withdrawalLink })}</p>

      <label class="yanta-consent__check">
        <input type="checkbox" id="${DIALOG_ID}-box">
        <span>${escapeHtml(t('site.consent.checkbox'))}</span>
      </label>
    </form>

    <div class="yanta-consent__actions">
      <button type="button" class="yanta-consent__btn" data-consent="cancel">
        ${escapeHtml(t('site.consent.cancel'))}
      </button>
      <button type="button" class="yanta-consent__btn primary" data-consent="ok" disabled>
        ${escapeHtml(t('site.consent.continue'))}
      </button>
    </div>
  `;

  document.body.append(dialog);

  const box = dialog.querySelector(`#${DIALOG_ID}-box`);
  const okBtn = dialog.querySelector('[data-consent="ok"]');
  const cancelBtn = dialog.querySelector('[data-consent="cancel"]');

  box.addEventListener('change', () => {
    okBtn.disabled = !box.checked;
  });

  return new Promise((resolve) => {
    let settled = false;

    const close = (granted) => {
      if (settled) return;
      settled = true;

      dialog.close();
      dialog.remove();
      resolve(granted);
    };

    okBtn.addEventListener('click', () => close(box.checked));
    cancelBtn.addEventListener('click', () => close(false));

    // Escape and backdrop dismissal must count as "no".
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(false);
    });

    dialog.showModal();
    box.focus();
  });
}
