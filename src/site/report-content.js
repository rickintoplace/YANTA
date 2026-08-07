// ============================================================
// YANTA — /report, the DSA Art. 16 notice-and-action mechanism
//
// Public shares make YANTA a hosting service under Art. 3(g)(iii) DSA. The
// micro-enterprise carve-out in Art. 19 covers Section 3 only, so the notice
// mechanism itself applies regardless of size. Art. 16(1) wants it easy to
// access and user-friendly: no account, no captcha, electronic submission.
//
// Art. 16(2) fixes what a notice must let the reporter provide, and each
// field below maps to one of those items.
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
  textField,
  wireSiteForm,
} from './site-form.js';

const CONTACT_EMAIL = YANTA_LEGAL.contactEmail;

// Order shown in the picker; the labels come from the locale bundle.
const CATEGORY_ORDER = [
  'copyright',
  'personal_data',
  'illegal_content',
  'csam',
  'malware',
  'impersonation',
  'other',
];

let s = null;

/** The /report page body. Wire it up with wireReportPage() after mounting. */
export async function reportContent() {
  ensureSiteFormCss();

  const { strings, localised } = await legalFormStrings('report');
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

      <p>${escapeHtml(s.intro)}</p>

      <div class="yanta-note-box">
        <p>${s.encryptedNote}</p>
      </div>

      <form class="yanta-form" id="yanta-report-form" novalidate>
        ${textField({
          id: 'yanta-report-shareUrl',
          label: s.urlLabel,
          hint: s.urlHint,
        })}

        <div class="yanta-form__field">
          <label for="yanta-report-category">${escapeHtml(s.categoryLabel)}</label>
          <select id="yanta-report-category" name="category">
            ${CATEGORY_ORDER.map((value) => `
              <option value="${escapeHtml(value)}">${escapeHtml(s.categories[value])}</option>
            `).join('')}
          </select>
        </div>

        <div class="yanta-form__field">
          <label for="yanta-report-explanation">${escapeHtml(s.explanationLabel)}</label>
          <textarea id="yanta-report-explanation" name="explanation"></textarea>
          <p class="yanta-form__hint">${escapeHtml(s.explanationHint)}</p>
        </div>

        ${textField({
          id: 'yanta-report-reporterName',
          label: s.nameLabel,
          optional: true,
          autocomplete: 'name',
        })}

        ${textField({
          id: 'yanta-report-reporterEmail',
          label: s.emailLabel,
          type: 'email',
          optional: true,
          autocomplete: 'email',
          hint: s.emailHint,
        })}

        <label class="yanta-form__choice">
          <input type="checkbox" name="goodFaith" value="1">
          <span class="yanta-form__choice-text">
            <b>${escapeHtml(s.goodFaith)}</b>
            <span>${escapeHtml(s.goodFaithHint)}</span>
          </span>
        </label>

        <div class="yanta-btn-row">
          <button type="submit" class="yanta-site-btn primary yanta-form__submit">
            ${escapeHtml(s.submit)}
          </button>
        </div>

        <p class="yanta-form__status" role="status" aria-live="polite"></p>
      </form>

      <h2>${escapeHtml(s.nextHeading)}</h2>
      <ol>
        <li>${escapeHtml(s.next1)}</li>
        <li>${escapeHtml(s.next2)}</li>
        <li>${escapeHtml(s.next3)}</li>
        <li>${escapeHtml(s.next4)}</li>
      </ol>

      <h2>${escapeHtml(s.otherHeading)}</h2>
      <p>${fill(s.otherBody, {
        mail: `<a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>`,
        address,
      })}</p>
      <p>${escapeHtml(s.badFaith)}</p>
    </article>
  `;
}

export function wireReportPage() {
  if (!s) return;

  // Prefilled when the reporter came from the footer of the share itself.
  const fromShare = new URLSearchParams(location.search).get('url');

  if (fromShare) {
    const field = document.getElementById('yanta-report-shareUrl');

    if (field) {
      field.value = fromShare;
      document.getElementById('yanta-report-explanation')?.focus();
    }
  }

  wireSiteForm({
    formId: 'yanta-report-form',
    busyLabel: s.busy,

    validate: (data) => {
      if (!String(data.get('shareUrl') || '').trim()) {
        return {
          message: s.needUrl,
          focus: 'yanta-report-shareUrl',
        };
      }

      if (String(data.get('explanation') || '').trim().length < 20) {
        return {
          message: s.needExplanation,
          focus: 'yanta-report-explanation',
        };
      }

      if (!data.get('goodFaith')) {
        return {
          message: s.needGoodFaith,
          focus: 'yanta-report-explanation',
        };
      }

      return '';
    },

    submit: (data) => apiFetch('/api/content-notice', {
      method: 'POST',
      body: {
        shareUrl: data.get('shareUrl'),
        category: data.get('category') || 'other',
        explanation: data.get('explanation'),
        reporterName: data.get('reporterName') || '',
        reporterEmail: data.get('reporterEmail') || '',
        goodFaith: true,
      },
    }),

    receipt: (res) => `
      <div class="yanta-receipt">
        <h2>${escapeHtml(s.receiptHeading)}</h2>
        <p>${fill(s.receiptRef, {
          ref: `<span class="yanta-receipt__reference">${escapeHtml(res?.reference || '—')}</span>`,
        })}</p>
        <p>${escapeHtml(s.receiptBody)}</p>
      </div>
    `,

    errorMessage: (err) => (
      err?.status === 429
        ? fill(s.errRate, { mail: CONTACT_EMAIL })
        : (err?.message || fill(s.errGeneric, { mail: CONTACT_EMAIL }))
    ),
  });
}
