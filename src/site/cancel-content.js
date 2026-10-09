// ============================================================
// YANTA — /cancel, the § 312k BGB cancellation page
//
// German law requires a permanently available, directly reachable
// cancellation route for contracts concluded on a website, and it must not
// sit behind a login. The footer's cancel link is the
// Kündigungsschaltfläche; this page is the Bestätigungsseite and its submit
// button the Bestätigungsschaltfläche.
//
// The page holds the form and the button and nothing else: § 312k Abs. 2
// lists what it may contain, and the BGH reads that list as closed (no
// offers, no hints, no detours — BGH I ZR 200/25, 16 July 2026). Everything
// worth saying beyond the form comes after the declaration, on the receipt.
//
// The form asks for what § 312k Abs. 2 lists — type of termination (and
// the reason for an extraordinary one), identification, the contract, the
// time the contract is to end, and where the confirmation goes. Only the
// email is required; it both identifies the contract and receives the
// confirmation. No account, no password, no captcha.
//
// The receipt shows the declaration with its time of receipt and offers it
// as a file and for printing, which is what § 312k Abs. 3 asks for.
//
// Wording comes from the locale bundle (src/site/legal/<locale>.js); the
// field structure lives here so it cannot drift out of sync with the wiring.
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
  radioChoice,
  textField,
  wireDeclarationReceipt,
  wireSiteForm,
} from './site-form.js';

const CONTACT_EMAIL = YANTA_LEGAL.contactEmail;

let s = null;

function mailLink() {
  return `<a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>`;
}

function undoParams() {
  const params = new URLSearchParams(location.search);
  const reference = params.get('undo') || '';
  const token = params.get('t') || '';

  return reference && token ? { reference, token } : null;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(iso) {
  try {
    return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'long', timeZone: 'UTC' })
      .format(new Date(`${iso}T00:00:00Z`));
  } catch {
    return iso;
  }
}

/* The declaration as it reads for the current choices. */
function declarationText(form) {
  const kind = form.querySelector('input[name="kind"]:checked')?.value;
  if (kind === 'extraordinary') return s.declarationExtraordinary;

  const end = form.querySelector('input[name="end"]:checked')?.value;
  const date = form.querySelector('#yanta-cancel-endDate')?.value;

  return end === 'date' && date
    ? fill(s.declarationDate, { date: escapeHtml(formatDate(date)) })
    : s.declaration;
}

function undoContent() {
  return `
    <article class="yanta-legal-doc">
      <h1>${escapeHtml(s.undoHeading)}</h1>
      <p>${fill(escapeHtml(s.undoBody), {
        ref: `<span class="yanta-receipt__reference">${escapeHtml(undoParams().reference)}</span>`,
      })}</p>
      <div class="yanta-btn-row">
        <button type="button" class="yanta-site-btn primary" id="yanta-cancel-undo">
          ${escapeHtml(s.undoButton)}
        </button>
      </div>
      <p class="yanta-form__status" role="status" aria-live="polite"></p>
    </article>
  `;
}

/** The /cancel page body. Wire it up with wireCancelPage() after mounting. */
export async function cancelContent() {
  ensureSiteFormCss();

  ({ strings: s } = await legalFormStrings('cancel'));

  if (undoParams()) return undoContent();

  return `
    <article class="yanta-legal-doc">
      <h1>${escapeHtml(s.heading)}</h1>

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

        <div class="yanta-form__field" id="yanta-cancel-reason-field" hidden>
          <label for="yanta-cancel-reason">${escapeHtml(s.reasonLabel)}</label>
          <textarea id="yanta-cancel-reason" name="reason"></textarea>
        </div>

        <fieldset class="yanta-form__choices" id="yanta-cancel-end">
          <legend class="yanta-form__legend">${escapeHtml(s.endLegend)}</legend>
          ${radioChoice({
            name: 'end',
            value: 'asap',
            title: s.endAsap,
            description: s.endAsapHint,
            checked: true,
          })}
          <label class="yanta-form__choice">
            <input type="radio" name="end" value="date">
            <span class="yanta-form__choice-text">
              <b>${escapeHtml(s.endDate)}</b>
              <span>${escapeHtml(s.endDateHint)}</span>
              <input
                type="date"
                id="yanta-cancel-endDate"
                name="endDate"
                min="${todayIso()}"
                aria-label="${escapeHtml(s.endDate)}"
              >
            </span>
          </label>
        </fieldset>

        ${textField({
          id: 'yanta-cancel-email',
          label: s.emailLabel,
          type: 'email',
          autocomplete: 'email',
          hint: escapeHtml(s.emailHint),
          required: true,
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
          hint: escapeHtml(s.refHint),
        })}

        <p class="yanta-form__declaration" id="yanta-cancel-declaration">${escapeHtml(s.declaration)}</p>

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

function wireUndo() {
  const button = document.getElementById('yanta-cancel-undo');
  const status = document.querySelector('.yanta-form__status');
  if (!button) return;

  button.addEventListener('click', async () => {
    const { reference, token } = undoParams();
    button.disabled = true;
    status.textContent = s.undoBusy;
    status.dataset.tone = '';

    try {
      await apiFetch('/api/cancellation/undo', {
        method: 'POST',
        body: { reference, token },
      });
      button.remove();
      status.textContent = s.undoDone;
    } catch (err) {
      button.disabled = false;
      status.dataset.tone = 'error';
      status.innerHTML = fill(escapeHtml(err?.status === 400 ? s.undoInvalid : s.undoFailed), { mail: mailLink() });
    }
  });
}

export function wireCancelPage() {
  if (!s) return;

  if (undoParams()) {
    wireUndo();
    return;
  }

  const form = document.getElementById('yanta-cancel-form');
  const reasonField = document.getElementById('yanta-cancel-reason-field');
  const endField = document.getElementById('yanta-cancel-end');
  const dateInput = document.getElementById('yanta-cancel-endDate');
  const declaration = document.getElementById('yanta-cancel-declaration');

  if (!form) return;

  const sync = () => {
    const extraordinary = form.querySelector('input[name="kind"]:checked')?.value === 'extraordinary';
    reasonField.hidden = !extraordinary;
    // An extraordinary termination is immediate; there is no end date to choose.
    endField.hidden = extraordinary;
    declaration.innerHTML = declarationText(form);
  };

  form.addEventListener('change', sync);
  form.addEventListener('input', sync);

  // Picking a date selects "on a specific date".
  dateInput.addEventListener('input', () => {
    if (dateInput.value) form.querySelector('input[name="end"][value="date"]').checked = true;
    sync();
  });

  wireSiteForm({
    formId: 'yanta-cancel-form',
    busyLabel: s.busy,

    validate: (data) => {
      if (!String(data.get('email') || '').includes('@')) {
        return { message: s.needEmail, focus: 'yanta-cancel-email' };
      }

      if (data.get('kind') !== 'extraordinary' && data.get('end') === 'date' && !data.get('endDate')) {
        return { message: s.needDate, focus: 'yanta-cancel-endDate' };
      }

      return '';
    },

    submit: (data) => {
      const extraordinary = data.get('kind') === 'extraordinary';

      return apiFetch('/api/cancellation', {
        method: 'POST',
        body: {
          email: data.get('email'),
          name: data.get('name') || '',
          contractRef: data.get('contractRef') || '',
          kind: data.get('kind') || 'ordinary',
          reason: extraordinary ? data.get('reason') || '' : '',
          endDate: !extraordinary && data.get('end') === 'date' ? data.get('endDate') || '' : '',
          lang: getLocale(),
        },
      });
    },

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
      after: `
        <p>${fill(escapeHtml(s.receiptBody), { mail: mailLink() })}</p>
        <p>${s.keepsData}</p>
        <p>${s.notWithdrawal}</p>
      `,
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
