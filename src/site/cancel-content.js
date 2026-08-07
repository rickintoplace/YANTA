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
// ============================================================

import { apiFetch } from '../cloud/cloud-api.js';

import {
  escapeHtml,
  YANTA_LEGAL,
} from './legal-links.js';

import {
  ensureSiteFormCss,
  radioChoice,
  textField,
  wireSiteForm,
} from './site-form.js';

const CONTACT_EMAIL = YANTA_LEGAL.contactEmail;

/** The /cancel page body. Wire it up with wireCancelPage() after mounting. */
export function cancelContent() {
  ensureSiteFormCss();

  return `
    <article class="yanta-legal-doc">
      <h1>Cancel contract</h1>
      <p lang="de" class="yanta-form__hint" style="margin-bottom:20px">
        Verträge hier kündigen (§ 312k BGB)
      </p>

      <p>
        Cancel your YANTA Plus subscription here. You do not need to sign in.
        We confirm every cancellation by email, including the time we received
        it and the date your contract ends — keep that email, it is your proof.
      </p>

      <p>
        Cancelling ends the paid plan only. <strong>Nothing is deleted.</strong>
        You keep YANTA Plus until the end of the period you already paid for,
        and the account then continues on the Free plan. To remove the account
        itself, use <a href="/delete-account">Delete account</a>.
      </p>

      <form class="yanta-form" id="yanta-cancel-form" novalidate>
        <fieldset class="yanta-form__choices">
          <legend class="yanta-form__legend">Type of termination</legend>
          ${radioChoice({
            name: 'kind',
            value: 'ordinary',
            title: 'Ordinary termination',
            description: 'Ends at the end of your current billing period. This is the usual choice.',
            checked: true,
          })}
          ${radioChoice({
            name: 'kind',
            value: 'extraordinary',
            title: 'Extraordinary termination',
            description: 'For good cause, with immediate effect. Please state the reason below.',
          })}
        </fieldset>

        ${textField({
          id: 'yanta-cancel-email',
          label: 'Email address of your YANTA account',
          type: 'email',
          autocomplete: 'email',
          hint: 'We send the confirmation here. Use the address your subscription runs on.',
        })}

        ${textField({
          id: 'yanta-cancel-name',
          label: 'Name',
          optional: true,
          autocomplete: 'name',
        })}

        ${textField({
          id: 'yanta-cancel-contractRef',
          label: 'Contract or invoice reference',
          optional: true,
          hint: 'Helps us find the right contract if you have more than one.',
        })}

        <div class="yanta-form__field" id="yanta-cancel-reason-field" hidden>
          <label for="yanta-cancel-reason">Reason for the extraordinary termination</label>
          <textarea id="yanta-cancel-reason" name="reason"></textarea>
        </div>

        <p class="yanta-form__declaration">
          By submitting this form I declare that I terminate my YANTA Plus
          contract at the earliest possible date.
        </p>

        <div class="yanta-btn-row">
          <button type="submit" class="yanta-site-btn primary yanta-form__submit">
            Cancel now
          </button>
        </div>

        <p class="yanta-form__status" role="status" aria-live="polite"></p>
      </form>

      <h2>Other ways to cancel</h2>
      <p>
        A cancellation is valid in any clear form. You can also email
        <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>
        or write to ${escapeHtml(YANTA_LEGAL.providerName)},
        ${escapeHtml(YANTA_LEGAL.street)}, ${escapeHtml(YANTA_LEGAL.city)},
        ${escapeHtml(YANTA_LEGAL.country)}. Signed-in customers can also cancel
        under <strong>Settings → Sync → Manage billing</strong>.
      </p>
      <p>
        Cancelling is not the same as withdrawing. Within 14 days of your first
        purchase you may also have a statutory right of withdrawal — see
        <a href="/withdrawal">Right of withdrawal</a>.
      </p>
    </article>
  `;
}

export function wireCancelPage() {
  const form = document.getElementById('yanta-cancel-form');
  const reasonField = document.getElementById('yanta-cancel-reason-field');

  if (!form) return;

  form.addEventListener('change', () => {
    reasonField.hidden =
      form.querySelector('input[name="kind"]:checked')?.value !== 'extraordinary';
  });

  wireSiteForm({
    formId: 'yanta-cancel-form',
    busyLabel: 'Submitting your cancellation…',

    validate: (data) => (
      String(data.get('email') || '').includes('@')
        ? ''
        : {
            message: 'Please enter the email address of your YANTA account.',
            focus: 'yanta-cancel-email',
          }
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
        <h2>Cancellation received</h2>
        <p>
          Your reference is
          <span class="yanta-receipt__reference">${escapeHtml(res?.reference || '—')}</span>.
        </p>
        <p>
          We have sent the confirmation to the address you gave, with the exact
          time we received your declaration and the date your contract ends. If
          it has not arrived in a few minutes, check your spam folder and then
          contact
          <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>.
        </p>
      </div>
    `,

    errorMessage: (err) => (
      err?.status === 429
        ? `Too many attempts from this device. Please email ${CONTACT_EMAIL} instead — that is equally valid.`
        : `We could not record your cancellation. Please email ${CONTACT_EMAIL}: a cancellation by email is equally valid and takes effect when it reaches us.`
    ),
  });
}
