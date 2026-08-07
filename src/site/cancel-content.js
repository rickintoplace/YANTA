// ============================================================
// YANTA — /cancel, the § 312k BGB cancellation page
//
// German law requires a permanently available, directly reachable
// cancellation route for contracts concluded on a website, and it must not
// sit behind a login. The footer's "Cancel contract" link is the
// Kündigungsschaltfläche; this page is the Bestätigungsseite and its submit
// button the Bestätigungsschaltfläche.
//
// The form asks for exactly what § 312k Abs. 2 lists — type of termination,
// identification, the declaration itself, and where the confirmation goes —
// and nothing beyond it. No account, no captcha: both would be hurdles the
// provision does not allow.
//
// Wording comes from the locale bundle (src/site/legal/<locale>.js); the
// field structure lives here so it cannot drift out of sync with the wiring.
// ============================================================

import { apiFetch } from '../cloud/cloud-api.js';

import {
  englishOnlyNotice,
  legalFormStrings,
} from './legal-documents.js';

import {
  escapeHtml,
  YANTA_LEGAL,
} from './legal-links.js';

import {
  ensureSiteFormCss,
  fill,
  radioChoice,
  textField,
  wireSiteForm,
} from './site-form.js';

const CONTACT_EMAIL = YANTA_LEGAL.contactEmail;

let s = null;

/** The /cancel page body. Wire it up with wireCancelPage() after mounting. */
export async function cancelContent() {
  ensureSiteFormCss();

  const { strings, localised } = await legalFormStrings('cancel');
  s = strings;

  const address = [
    YANTA_LEGAL.providerName,
    YANTA_LEGAL.street,
    YANTA_LEGAL.city,
    YANTA_LEGAL.country,
  ].map(escapeHtml).join(', ');

  return `
    <article class="yanta-legal-doc">
      ${localised ? '' : englishOnlyNotice()}

      <h1>${escapeHtml(s.heading)}</h1>
      <p lang="de" class="yanta-form__hint" style="margin-bottom:20px">
        ${escapeHtml(s.statute)}
      </p>

      <p>${escapeHtml(s.intro)}</p>
      <p>${s.keepsData}</p>

      <form class="yanta-form" id="yanta-cancel-form" novalidate>
        <fieldset class="yanta-form__choices">
          <legend class="yanta-form__legend">${escapeHtml(s.typeLegend)}</legend>
          ${radioChoice({
            name: 'kind',
            value: 'ordinary',
            title: s.ordinary,
            description: s.ordinaryHint,
            checked: true,
          })}
          ${radioChoice({
            name: 'kind',
            value: 'extraordinary',
            title: s.extraordinary,
            description: s.extraordinaryHint,
          })}
        </fieldset>

        ${textField({
          id: 'yanta-cancel-email',
          label: s.emailLabel,
          type: 'email',
          autocomplete: 'email',
          hint: s.emailHint,
        })}

        ${textField({
          id: 'yanta-cancel-name',
          label: s.nameLabel,
          optional: true,
          autocomplete: 'name',
        })}

        ${textField({
          id: 'yanta-cancel-contractRef',
          label: s.refLabel,
          optional: true,
          hint: s.refHint,
        })}

        <div class="yanta-form__field" id="yanta-cancel-reason-field" hidden>
          <label for="yanta-cancel-reason">${escapeHtml(s.reasonLabel)}</label>
          <textarea id="yanta-cancel-reason" name="reason"></textarea>
        </div>

        <p class="yanta-form__declaration">${escapeHtml(s.declaration)}</p>

        <div class="yanta-btn-row">
          <button type="submit" class="yanta-site-btn primary yanta-form__submit">
            ${escapeHtml(s.submit)}
          </button>
        </div>

        <p class="yanta-form__status" role="status" aria-live="polite"></p>
      </form>

      <h2>${escapeHtml(s.otherHeading)}</h2>
      <p>${fill(s.otherBody, {
        mail: `<a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>`,
        address,
      })}</p>
      <p>${s.notWithdrawal}</p>
    </article>
  `;
}

export function wireCancelPage() {
  const form = document.getElementById('yanta-cancel-form');
  const reasonField = document.getElementById('yanta-cancel-reason-field');

  if (!form || !s) return;

  form.addEventListener('change', () => {
    reasonField.hidden =
      form.querySelector('input[name="kind"]:checked')?.value !== 'extraordinary';
  });

  const mailLink = `<a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>`;

  wireSiteForm({
    formId: 'yanta-cancel-form',
    busyLabel: s.busy,

    validate: (data) => (
      String(data.get('email') || '').includes('@')
        ? ''
        : { message: s.needEmail, focus: 'yanta-cancel-email' }
    ),

    submit: (data) => apiFetch('/api/cancellation', {
      method: 'POST',
      body: {
        email: data.get('email'),
        name: data.get('name') || '',
        contractRef: data.get('contractRef') || '',
        kind: data.get('kind') || 'ordinary',
        reason: data.get('reason') || '',
      },
    }),

    receipt: (res) => `
      <div class="yanta-receipt">
        <h2>${escapeHtml(s.receiptHeading)}</h2>
        <p>${fill(s.receiptRef, {
          ref: `<span class="yanta-receipt__reference">${escapeHtml(res?.reference || '—')}</span>`,
        })}</p>
        <p>${fill(s.receiptBody, { mail: mailLink })}</p>
      </div>
    `,

    errorMessage: (err) => (
      err?.status === 429
        ? fill(s.errRate, { mail: CONTACT_EMAIL })
        : fill(s.errGeneric, { mail: CONTACT_EMAIL })
    ),
  });
}
