// ============================================================
// YANTA — /withdraw, the § 356a BGB withdrawal function
//
// Since 19 June 2026, a contract concluded online has to be withdrawable
// online too: a button labelled "Vertrag widerrufen" that stays available
// (the footer and sidebar link), leading to a step where the consumer gives
// their name, identifies the contract and says where the confirmation of
// receipt goes, and then a second button, "Widerruf bestätigen", that sends
// it. No login — the purchase does not need one either (the account is
// created by email at checkout).
//
// Like the cancellation page, the form carries nothing but the form; the
// receipt offers the declaration with its time of receipt as a file and
// for printing. A person processes every withdrawal (see the Worker's
// handleWithdrawalRequest), so the confirmation says it was received, not
// that it took effect — as the statute's explanatory notes ask.
// ============================================================

import { apiFetch } from '../cloud/cloud-api.js';
import { getLocale } from '../i18n/index.js';

import { legalFormStrings } from './legal-documents.js';

import {
  escapeHtml,
  YANTA_LEGAL,
} from './legal-links.js';

import {
  declarationReceiptHtml,
  ensureSiteFormCss,
  fill,
  formatReceiptTime,
  textField,
  wireDeclarationReceipt,
  wireSiteForm,
} from './site-form.js';

const CONTACT_EMAIL = YANTA_LEGAL.contactEmail;

let s = null;

/** The /withdraw page body. Wire it up with wireWithdrawPage() after mounting. */
export async function withdrawContent() {
  ensureSiteFormCss();

  ({ strings: s } = await legalFormStrings('withdraw'));

  return `
    <article class="yanta-legal-doc">
      <h1>${escapeHtml(s.heading)}</h1>

      <form class="yanta-form" id="yanta-withdraw-form" novalidate>
        ${textField({
          id: 'yanta-withdraw-name',
          label: s.nameLabel,
          autocomplete: 'name',
          required: true,
        })}

        ${textField({
          id: 'yanta-withdraw-email',
          label: s.emailLabel,
          type: 'email',
          autocomplete: 'email',
          hint: escapeHtml(s.emailHint),
          required: true,
        })}

        ${textField({
          id: 'yanta-withdraw-contractRef',
          label: s.refLabel,
          optional: true,
          hint: escapeHtml(s.refHint),
        })}

        <p class="yanta-form__declaration">${escapeHtml(s.declaration)}</p>

        <div class="yanta-btn-row">
          <button type="submit" class="yanta-site-btn primary yanta-form__submit">
            ${escapeHtml(s.submit)}
          </button>
        </div>

        <p class="yanta-form__status" role="status" aria-live="polite"></p>
      </form>
    </article>
  `;
}

export function wireWithdrawPage() {
  if (!s) return;

  const mailLink = `<a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>`;

  wireSiteForm({
    formId: 'yanta-withdraw-form',
    busyLabel: s.busy,

    validate: (data) => {
      if (!String(data.get('name') || '').trim()) {
        return { message: s.needName, focus: 'yanta-withdraw-name' };
      }

      if (!String(data.get('email') || '').includes('@')) {
        return { message: s.needEmail, focus: 'yanta-withdraw-email' };
      }

      return '';
    },

    submit: (data) => apiFetch('/api/withdrawal', {
      method: 'POST',
      body: {
        name: data.get('name'),
        email: data.get('email'),
        contractRef: data.get('contractRef') || '',
        lang: getLocale(),
      },
    }),

    receipt: (res) => declarationReceiptHtml({
      heading: s.receiptHeading,
      intro: escapeHtml(s.receiptIntro),
      receivedLabel: s.receivedLabel,
      receivedAt: res?.receivedAt || Date.now(),
      refLabel: s.referenceLabel,
      reference: res?.reference,
      declarationLabel: s.declarationLabel,
      declaration: res?.declaration || '',
      saveLabel: s.save,
      printLabel: s.print,
      after: `<p>${fill(escapeHtml(s.receiptBody), { mail: mailLink })}</p>`,
    }),

    afterReceipt: (res) => wireDeclarationReceipt({
      filename: `${s.fileName}-${res?.reference || 'receipt'}.txt`,
      lines: [
        s.receiptHeading,
        '',
        `${s.receivedLabel}: ${formatReceiptTime(res?.receivedAt || Date.now())}`,
        `${s.referenceLabel}: ${res?.reference || '—'}`,
        '',
        `${s.declarationLabel}:`,
        res?.declaration || '',
      ],
    }),

    errorMessage: (err) => (
      err?.status === 429
        ? fill(s.errRate, { mail: CONTACT_EMAIL })
        : fill(s.errGeneric, { mail: CONTACT_EMAIL })
    ),
  });
}
