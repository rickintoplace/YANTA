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
  escapeHtml,
  YANTA_LEGAL,
} from './legal-links.js';

import {
  ensureSiteFormCss,
  textField,
  wireSiteForm,
} from './site-form.js';

const CONTACT_EMAIL = YANTA_LEGAL.contactEmail;

const CATEGORIES = [
  ['copyright', 'Copyright or trademark infringement'],
  ['personal_data', 'My personal data / privacy violation'],
  ['illegal_content', 'Other illegal content'],
  ['csam', 'Child sexual abuse material'],
  ['malware', 'Malware or phishing'],
  ['impersonation', 'Impersonation'],
  ['other', 'Something else'],
];

/** The /report page body. Wire it up with wireReportPage() after mounting. */
export function reportContent() {
  ensureSiteFormCss();

  return `
    <article class="yanta-legal-doc">
      <h1>Report content</h1>

      <p>
        If a YANTA share link points at content you believe is unlawful, tell
        us here. Anyone can file a notice — no account needed. This is the
        notice-and-action mechanism required by Article 16 of the Digital
        Services Act.
      </p>

      <div class="yanta-note-box">
        <p>
          <strong>What we can and cannot see.</strong> Shared content is
          end-to-end encrypted and we hold no key, so we cannot open a share to
          check it. We assess your description, and where a notice is
          substantiated the measure available to us is to disable the share as
          a whole. That is why a precise explanation and a working link matter
          so much here.
        </p>
      </div>

      <form class="yanta-form" id="yanta-report-form" novalidate>
        ${textField({
          id: 'yanta-report-shareUrl',
          label: 'Exact address of the content',
          hint: 'Paste the full share link, for example https://yanta.page/share/abc123…',
        })}

        <div class="yanta-form__field">
          <label for="yanta-report-category">What is the problem?</label>
          <select id="yanta-report-category" name="category">
            ${CATEGORIES.map(([value, label]) => `
              <option value="${escapeHtml(value)}">${escapeHtml(label)}</option>
            `).join('')}
          </select>
        </div>

        <div class="yanta-form__field">
          <label for="yanta-report-explanation">Why is this content unlawful?</label>
          <textarea id="yanta-report-explanation" name="explanation"></textarea>
          <p class="yanta-form__hint">
            Please be specific: what exactly is there, which right it infringes,
            and — if you hold that right — how we can tell.
          </p>
        </div>

        ${textField({
          id: 'yanta-report-reporterName',
          label: 'Your name',
          optional: true,
          autocomplete: 'name',
        })}

        ${textField({
          id: 'yanta-report-reporterEmail',
          label: 'Your email address',
          type: 'email',
          optional: true,
          autocomplete: 'email',
          hint: 'Needed for the confirmation of receipt and our decision. Reports about child sexual abuse material may be filed anonymously.',
        })}

        <label class="yanta-form__choice">
          <input type="checkbox" name="goodFaith" value="1">
          <span class="yanta-form__choice-text">
            <b>I confirm this notice is accurate and complete</b>
            <span>
              A bona fide belief that the information is correct, as Art. 16(2)(d) DSA requires.
            </span>
          </span>
        </label>

        <div class="yanta-btn-row">
          <button type="submit" class="yanta-site-btn primary yanta-form__submit">
            Submit report
          </button>
        </div>

        <p class="yanta-form__status" role="status" aria-live="polite"></p>
      </form>

      <h2>What happens next</h2>
      <ol>
        <li>We confirm receipt without undue delay, if you gave us an address.</li>
        <li>
          We assess the notice in a timely, diligent, non-arbitrary and
          objective way. We do not use automated moderation, so a human reads
          every report.
        </li>
        <li>
          We tell you the outcome and the reasons for it, along with the
          redress available to you.
        </li>
        <li>
          If we act against content, the person who provided it receives a
          statement of reasons under Art. 17 DSA and can contest the decision.
        </li>
      </ol>

      <h2>Other routes</h2>
      <p>
        You can also write to
        <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>,
        which is our point of contact under Art. 11 and 12 DSA for users and
        authorities alike, in German or English. Postal address:
        ${escapeHtml(YANTA_LEGAL.providerName)},
        ${escapeHtml(YANTA_LEGAL.street)}, ${escapeHtml(YANTA_LEGAL.city)},
        ${escapeHtml(YANTA_LEGAL.country)}.
      </p>
      <p>
        Reporting in bad faith — knowingly false notices — can have legal
        consequences and may lead us to ignore further reports from you.
      </p>
    </article>
  `;
}

export function wireReportPage() {
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
    busyLabel: 'Submitting your report…',

    validate: (data) => {
      if (!String(data.get('shareUrl') || '').trim()) {
        return {
          message: 'Please give the address of the content.',
          focus: 'yanta-report-shareUrl',
        };
      }

      if (String(data.get('explanation') || '').trim().length < 20) {
        return {
          message: 'Please explain why the content is unlawful — a sentence at least.',
          focus: 'yanta-report-explanation',
        };
      }

      if (!data.get('goodFaith')) {
        return {
          message: 'Please confirm that your notice is accurate and complete.',
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
        <h2>Report received</h2>
        <p>
          Your reference is
          <span class="yanta-receipt__reference">${escapeHtml(res?.reference || '—')}</span>.
        </p>
        <p>
          A human will look at it. If you gave us an email address, you will
          get a confirmation now and our decision once we have assessed the
          notice.
        </p>
      </div>
    `,

    errorMessage: (err) => (
      err?.status === 429
        ? `Too many reports from this device. Please email ${CONTACT_EMAIL}.`
        : (err?.message || `We could not record your report. Please email ${CONTACT_EMAIL}.`)
    ),
  });
}
