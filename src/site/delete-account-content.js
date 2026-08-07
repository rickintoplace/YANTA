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
// ============================================================

import {
  apiFetch,
  cloudMe,
} from '../cloud/cloud-api.js';

import {
  escapeHtml,
  YANTA_APP_ORIGIN,
  YANTA_LEGAL,
} from './legal-links.js';

import {
  ensureSiteFormCss,
  wireSiteForm,
} from './site-form.js';

const CONTACT_EMAIL = YANTA_LEGAL.contactEmail;

const WHAT_GOES = [
  'Your encrypted vaults and every synced object',
  'Notes, drawings and assets stored in YANTA Cloud',
  'Devices, sessions and push subscriptions',
  'Public shares and presentation sessions you created',
  'Shared spaces you own, and your membership in others',
  'Your YANTA Chat account on the Matrix homeserver',
];

const WHAT_STAYS = [
  ['Invoices and payment records', 'German commercial and tax law requires up to 10 years (§ 147 AO, § 257 HGB). They are kept for that and nothing else.'],
  ['Cancellation declarations and content notices', 'Legal records; the link to your person is removed.'],
  ['Anything stored only on your devices', 'We never had it. Clear it in the app or in your browser settings.'],
];

export function deleteAccountContent() {
  ensureSiteFormCss();

  return `
    <article class="yanta-legal-doc">
      <h1>Delete account</h1>

      <p>
        Deleting your YANTA Cloud account removes your data from our servers.
        <strong>It cannot be undone</strong>, and because your content is
        encrypted with a key we never see, we could not restore it even if you
        asked us to.
      </p>

      <div class="yanta-note-box">
        <p>
          <strong>Only want to stop paying?</strong> That is
          <a href="/cancel">Cancel contract</a> — it ends the subscription and
          keeps your data.
        </p>
      </div>

      <h2>Export first</h2>
      <p>
        Open YANTA and use <strong>Settings → Backup</strong> to export your
        notes as readable Markdown or as an encrypted <code>.yanta</code>
        archive. Once the account is gone, so is the copy on our side.
      </p>

      <h2>What is deleted</h2>
      <ul>
        ${WHAT_GOES.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>

      <h2>What we have to keep, and why</h2>
      <div class="yanta-legal-table">
        <table>
          <thead>
            <tr><th>Data</th><th>Reason</th></tr>
          </thead>
          <tbody>
            ${WHAT_STAYS.map(([what, why]) => `
              <tr><td><strong>${escapeHtml(what)}</strong></td><td>${escapeHtml(why)}</td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <h2>Delete it</h2>
      <div id="yanta-delete-account-panel">
        <p class="yanta-form__status">Checking whether you are signed in…</p>
      </div>

      <h2>If you cannot sign in</h2>
      <p>
        Email
        <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>
        from the address the account uses, with "Delete my account" as the
        subject. We verify that the request comes from the account holder and
        delete within 30 days, usually much sooner. Postal requests to
        ${escapeHtml(YANTA_LEGAL.providerName)},
        ${escapeHtml(YANTA_LEGAL.street)}, ${escapeHtml(YANTA_LEGAL.city)},
        ${escapeHtml(YANTA_LEGAL.country)} work too.
      </p>
    </article>
  `;
}

function signedOutPanelHtml() {
  return `
    <p>
      You are not signed in on this device. Sign in to YANTA Cloud first —
      then this page turns into the delete button.
    </p>
    <div class="yanta-btn-row">
      <a class="yanta-site-btn primary" href="${escapeHtml(YANTA_APP_ORIGIN)}">Open YANTA and sign in</a>
    </div>
  `;
}

function signedInPanelHtml(email) {
  return `
    <p>
      Signed in as <strong>${escapeHtml(email)}</strong>. Deleting also cancels
      any active subscription immediately.
    </p>

    <form class="yanta-form" id="yanta-delete-account-form" novalidate>
      <div class="yanta-form__field">
        <label for="yanta-delete-confirm">Type DELETE to confirm</label>
        <input type="text" id="yanta-delete-confirm" name="confirm" autocomplete="off" spellcheck="false">
      </div>

      <div class="yanta-btn-row">
        <button type="submit" class="yanta-site-btn yanta-form__submit danger">
          Delete my account permanently
        </button>
      </div>

      <p class="yanta-form__status" role="status" aria-live="polite"></p>
    </form>
  `;
}

export async function wireDeleteAccountPage() {
  const panel = document.getElementById('yanta-delete-account-panel');

  if (!panel) return;

  const me = await cloudMe().catch(() => ({ authenticated: false }));

  if (!me?.authenticated) {
    panel.innerHTML = signedOutPanelHtml();
    return;
  }

  panel.innerHTML = signedInPanelHtml(me?.user?.email || 'your account');

  wireSiteForm({
    formId: 'yanta-delete-account-form',
    busyLabel: 'Deleting your account…',

    validate: (data) => (
      String(data.get('confirm') || '').trim().toUpperCase() === 'DELETE'
        ? ''
        : {
            message: 'Please type DELETE to confirm.',
            focus: 'yanta-delete-confirm',
          }
    ),

    submit: (data) => apiFetch('/api/account', {
      method: 'DELETE',
      body: { confirm: data.get('confirm') },
    }),

    receipt: () => `
      <div class="yanta-receipt">
        <h2>Your account is deleted</h2>
        <p>
          Your cloud data is gone and you have been signed out. We have sent a
          confirmation by email.
        </p>
        <p>
          Data stored only on this device is still here — clear it in the app
          or in your browser settings.
        </p>
      </div>
    `,

    errorMessage: (err) => (
      err?.status === 401
        ? 'Your session expired. Please sign in again.'
        : (err?.message || `Deletion failed. Please email ${CONTACT_EMAIL}.`)
    ),
  });
}
