// ============================================================
// YANTA — /delete-account
//
// Serves two masters. GDPR Art. 17 wants erasure to be genuinely available,
// and Google Play requires a publicly reachable URL that explains and starts
// account deletion without installing the app.
//
// Signed-in visitors get the real thing: a typed confirmation that deletes
// immediately. Everyone else gets the explanation plus the routes to it,
// because deleting an account for someone who merely typed their address
// would be the obvious abuse.
//
// Wording comes from the locale bundle (src/site/legal/<locale>.js).
// ============================================================

import {
  apiFetch,
  cloudMe,
} from '../cloud/cloud-api.js';

import {
  englishOnlyNotice,
  legalFormStrings,
} from './legal-documents.js';

import {
  escapeHtml,
  YANTA_APP_ORIGIN,
  YANTA_LEGAL,
} from './legal-links.js';

import {
  ensureSiteFormCss,
  fill,
  wireSiteForm,
} from './site-form.js';

const CONTACT_EMAIL = YANTA_LEGAL.contactEmail;

let s = null;

export async function deleteAccountContent() {
  ensureSiteFormCss();

  const { strings, localised } = await legalFormStrings('del');
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

      <p>${s.intro}</p>

      <div class="yanta-note-box">
        <p>${s.cancelInstead}</p>
      </div>

      <h2>${escapeHtml(s.exportHeading)}</h2>
      <p>${s.exportBody}</p>

      <h2>${escapeHtml(s.goesHeading)}</h2>
      <ul>
        ${s.goes.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>

      <h2>${escapeHtml(s.staysHeading)}</h2>
      <div class="yanta-legal-table">
        <table>
          <thead>
            <tr>${s.staysCols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${s.stays.map(([what, why]) => `
              <tr><td><strong>${escapeHtml(what)}</strong></td><td>${escapeHtml(why)}</td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <h2>${escapeHtml(s.doItHeading)}</h2>
      <div id="yanta-delete-account-panel">
        <p class="yanta-form__status">${escapeHtml(s.checking)}</p>
      </div>

      <h2>${escapeHtml(s.noSignInHeading)}</h2>
      <p>${fill(s.noSignInBody, {
        mail: `<a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>`,
        address,
      })}</p>
    </article>
  `;
}

function signedOutPanelHtml() {
  return `
    <p>${escapeHtml(s.signedOut)}</p>
    <div class="yanta-btn-row">
      <a class="yanta-site-btn primary" href="${escapeHtml(YANTA_APP_ORIGIN)}">
        ${escapeHtml(s.signIn)}
      </a>
    </div>
  `;
}

function signedInPanelHtml(email) {
  return `
    <p>${fill(s.signedIn, { email: escapeHtml(email) })}</p>

    <form class="yanta-form" id="yanta-delete-account-form" novalidate>
      <div class="yanta-form__field">
        <label for="yanta-delete-confirm">${escapeHtml(s.confirmLabel)}</label>
        <input type="text" id="yanta-delete-confirm" name="confirm" autocomplete="off" spellcheck="false">
      </div>

      <div class="yanta-btn-row">
        <button type="submit" class="yanta-site-btn yanta-form__submit danger">
          ${escapeHtml(s.submit)}
        </button>
      </div>

      <p class="yanta-form__status" role="status" aria-live="polite"></p>
    </form>
  `;
}

export async function wireDeleteAccountPage() {
  const panel = document.getElementById('yanta-delete-account-panel');

  if (!panel || !s) return;

  const me = await cloudMe().catch(() => ({ authenticated: false }));

  if (!me?.authenticated) {
    panel.innerHTML = signedOutPanelHtml();
    return;
  }

  panel.innerHTML = signedInPanelHtml(me?.user?.email || '');

  wireSiteForm({
    formId: 'yanta-delete-account-form',
    busyLabel: s.busy,

    validate: (data) => (
      String(data.get('confirm') || '').trim().toUpperCase() === 'DELETE'
        ? ''
        : { message: s.needConfirm, focus: 'yanta-delete-confirm' }
    ),

    submit: (data) => apiFetch('/api/account', {
      method: 'DELETE',
      body: { confirm: data.get('confirm') },
    }),

    receipt: () => `
      <div class="yanta-receipt">
        <h2>${escapeHtml(s.receiptHeading)}</h2>
        <p>${escapeHtml(s.receiptBody)}</p>
        <p>${escapeHtml(s.receiptLocal)}</p>
      </div>
    `,

    errorMessage: (err) => (
      err?.status === 401
        ? s.errExpired
        : (err?.message || fill(s.errGeneric, { mail: CONTACT_EMAIL }))
    ),
  });
}
