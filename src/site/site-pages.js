import {
  openBillingCheckout,
  openBillingPortal,
} from '../billing/billing-api.js';

const CONTACT_EMAIL = 'rickintoplace@proton.me';

const PLUS_MONTHLY_EUR =
  import.meta.env.VITE_PADDLE_PLUS_MONTHLY_EUR_PRICE_ID || '';

const PLUS_MONTHLY_USD =
  import.meta.env.VITE_PADDLE_PLUS_MONTHLY_USD_PRICE_ID || '';

const PLUS_YEARLY_EUR =
  import.meta.env.VITE_PADDLE_PLUS_YEARLY_EUR_PRICE_ID || '';

const PLUS_YEARLY_USD =
  import.meta.env.VITE_PADDLE_PLUS_YEARLY_USD_PRICE_ID || '';

function userCurrency() {
  const lang = navigator.language || '';

  if (
    lang.startsWith('de') ||
    lang.startsWith('fr') ||
    lang.startsWith('es') ||
    lang.startsWith('it') ||
    lang.startsWith('nl') ||
    lang.startsWith('pt') ||
    lang.startsWith('fi') ||
    lang.startsWith('sv') ||
    lang.startsWith('da') ||
    lang.startsWith('pl') ||
    lang.startsWith('cs') ||
    lang.startsWith('sk') ||
    lang.startsWith('sl') ||
    lang.startsWith('et') ||
    lang.startsWith('lv') ||
    lang.startsWith('lt') ||
    lang.startsWith('el')
  ) {
    return 'EUR';
  }

  return 'USD';
}

function priceIds() {
  const c = userCurrency();

  return c === 'EUR'
    ? {
        currency: 'EUR',
        monthly: PLUS_MONTHLY_EUR || PLUS_MONTHLY_USD,
        yearly: PLUS_YEARLY_EUR || PLUS_YEARLY_USD,
      }
    : {
        currency: 'USD',
        monthly: PLUS_MONTHLY_USD || PLUS_MONTHLY_EUR,
        yearly: PLUS_YEARLY_USD || PLUS_YEARLY_EUR,
      };
}

function money(monthly = true) {
  const c = userCurrency();

  if (c === 'EUR') return monthly ? '€6' : '€60';
  return monthly ? '$6' : '$60';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function injectCss() {
  if (document.getElementById('yanta-site-pages-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-site-pages-css';
  style.textContent = `
:root {
  color-scheme: dark light;
}

html.yanta-site-page,
body.yanta-site-page {
  height: auto !important;
  min-height: 100% !important;
  overflow: auto !important;
}

body.yanta-site-page {
  position: static !important;
}

body {
  margin: 0;
  background: var(--bg, #fff8ef);
  color: var(--text, #29251d);
  font-family: var(--font, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  line-height: 1.55;
}

.yanta-site {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

.yanta-site-header {
  border-bottom: 1px solid var(--border, #d8c7a5);
  background: var(--bg, #fff8ef);
}

.yanta-site-nav {
  width: min(1040px, calc(100vw - 32px));
  margin: 0 auto;
  min-height: 62px;
  display: flex;
  align-items: center;
  gap: 18px;
}

.yanta-site-brand {
  color: var(--text, #29251d);
  font-weight: 850;
  text-decoration: none;
  letter-spacing: 0.02em;
}

.yanta-site-nav-links {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.yanta-site-nav-links a,
.yanta-site-link {
  color: var(--text-dim, #625a49);
  text-decoration: none;
  font-size: 14px;
}

.yanta-site-nav-links a:hover,
.yanta-site-link:hover {
  color: var(--text, #29251d);
}

.yanta-site-main {
  flex: 1;
  width: min(1040px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 54px 0 64px;
}

.yanta-site-hero {
  max-width: 760px;
  margin-bottom: 34px;
}

.yanta-site-kicker {
  color: var(--accent, #8FA31E);
  font-size: 13px;
  font-weight: 850;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.yanta-site-hero h1 {
  margin: 10px 0 12px;
  font-size: clamp(34px, 5vw, 58px);
  line-height: 1.02;
  letter-spacing: -0.035em;
}

.yanta-site-hero p {
  max-width: 660px;
  margin: 0;
  color: var(--text-dim, #625a49);
  font-size: 18px;
}

.yanta-pricing-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: stretch;
}

.yanta-price-card {
  display: flex;
  flex-direction: column;
  padding: 22px;
  border: 1px solid var(--border, #d8c7a5);
  border-radius: 18px;
  background: var(--bg-elev, #f7efd8);
}

.yanta-price-card.featured {
  border-color: color-mix(in srgb, var(--accent, #8FA31E) 45%, var(--border, #d8c7a5));
}

.yanta-price-card h2 {
  margin: 0 0 4px;
  font-size: 22px;
}

.yanta-price-sub {
  min-height: 48px;
  margin: 0 0 18px;
  color: var(--text-dim, #625a49);
}

.yanta-price {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 18px;
}

.yanta-price strong {
  font-size: 38px;
  letter-spacing: -0.04em;
}

.yanta-price span {
  color: var(--text-dim, #625a49);
}

.yanta-feature-list {
  margin: 0 0 22px;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 9px;
}

.yanta-feature-list li {
  display: flex;
  gap: 8px;
  color: var(--text, #29251d);
}

.yanta-feature-list li::before {
  content: "✓";
  color: var(--accent, #8FA31E);
  font-weight: 850;
}

.yanta-btn-row {
  margin-top: auto;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.yanta-site-btn {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 9px 14px;
  border: 1px solid var(--border, #d8c7a5);
  border-radius: 10px;
  background: var(--bg-elev-2, #efe3c7);
  color: var(--text, #29251d);
  font: inherit;
  font-size: 14px;
  font-weight: 750;
  text-decoration: none;
  cursor: pointer;
}

.yanta-site-btn.primary {
  border-color: var(--accent, #8FA31E);
  background: var(--accent, #8FA31E);
  color: white;
}

.yanta-site-btn:hover {
  filter: brightness(1.03);
}

.yanta-note-box,
.yanta-faq,
.yanta-legal-doc {
  margin-top: 24px;
  padding: 18px 20px;
  border: 1px solid var(--border, #d8c7a5);
  border-radius: 16px;
  background: var(--bg-elev, #f7efd8);
}

.yanta-note-box p,
.yanta-faq p {
  margin: 0;
  color: var(--text-dim, #625a49);
}

.yanta-faq h2,
.yanta-legal-doc h1 {
  margin-top: 0;
}

.yanta-faq-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.yanta-faq-item h3 {
  margin: 0 0 6px;
  font-size: 15px;
}

.yanta-faq-item p {
  font-size: 14px;
}

.yanta-site-footer {
  border-top: 1px solid var(--border, #d8c7a5);
  color: var(--text-faint, #95886f);
}

.yanta-site-footer-inner {
  width: min(1040px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 20px 0;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}

.yanta-site-footer-inner a {
  color: var(--text-dim, #625a49);
  text-decoration: none;
}

.yanta-legal-doc {
  max-width: 820px;
}

.yanta-legal-doc h1 {
  font-size: clamp(30px, 5vw, 46px);
  line-height: 1.08;
}

.yanta-legal-doc h2 {
  margin-top: 28px;
}

.yanta-legal-doc p,
.yanta-legal-doc li {
  color: var(--text-dim, #625a49);
}

.yanta-legal-doc strong {
  color: var(--text, #29251d);
}

@media (max-width: 780px) {
  .yanta-pricing-grid,
  .yanta-faq-grid {
    grid-template-columns: 1fr;
  }

  .yanta-site-main {
    padding-top: 34px;
  }
}

.yanta-billing-banner {
  margin: 0 0 22px;
}

.yanta-billing-banner.success {
  border-color: color-mix(in srgb, var(--green, #306D29) 45%, var(--border, #d8c7a5));
}

html.yanta-site-page .app {
  display: none !important;
}

html.yanta-site-page * {
  box-sizing: border-box;
}
`;
  document.head.append(style);
}

function shell(content) {
  injectCss();

  document.title = 'YANTA';

  document.documentElement.classList.add('yanta-site-page');
  document.body.classList.add('yanta-site-page');

  document.body.innerHTML = `
    <div class="yanta-site">
      <header class="yanta-site-header">
        <nav class="yanta-site-nav">
          <a class="yanta-site-brand" href="/">YANTA</a>

          <div class="yanta-site-nav-links">
            <a href="/pricing">Pricing</a>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
            <a href="/refund">Refunds</a>
            <a href="/">Open app</a>
          </div>
        </nav>
      </header>

      <main class="yanta-site-main">
        ${content}
      </main>

      <footer class="yanta-site-footer">
        <div class="yanta-site-footer-inner">
          <span>© ${new Date().getFullYear()} YANTA</span>
          <span>·</span>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/refund">Refunds</a>
          <span>·</span>
          <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>
        </div>
      </footer>
    </div>
  `;
}

function billingBannerHtml() {
  const params = new URLSearchParams(location.search);
  const state = params.get('billing') || '';

  if (state === 'success') {
    return `
      <section class="yanta-note-box yanta-billing-banner success">
        <p>
          <strong>Thank you.</strong>
          Paddle is confirming your YANTA Plus subscription. Open YANTA Cloud Sync settings to see your updated plan.
        </p>
      </section>
    `;
  }

  if (state === 'cancel') {
    return `
      <section class="yanta-note-box yanta-billing-banner">
        <p>
          Checkout was cancelled. Nothing changed.
        </p>
      </section>
    `;
  }

  return '';
}

function pricingContent() {
  const ids = priceIds();

return `
    <section class="yanta-site-hero">
      <div class="yanta-site-kicker">YANTA Cloud</div>
      <h1>Simple plans for encrypted sync.</h1>
      <p>
        Start free. Upgrade when you need more encrypted cloud storage,
        more devices, and higher Included AI limits.
      </p>
    </section>

    ${billingBannerHtml()}

    <section class="yanta-pricing-grid">
      <article class="yanta-price-card">
        <h2>Free</h2>
        <p class="yanta-price-sub">For trying YANTA Cloud or keeping a small encrypted vault in sync.</p>

        <div class="yanta-price">
          <strong>€0</strong>
          <span>/ forever</span>
        </div>

        <ul class="yanta-feature-list">
          <li>25 MB encrypted cloud storage</li>
          <li>1 cloud vault</li>
          <li>3 connected devices</li>
          <li>Included AI: 25 requests/day</li>
          <li>Encrypted backup export</li>
          <li>Public sharing with encrypted payloads</li>
        </ul>

        <div class="yanta-btn-row">
          <a class="yanta-site-btn" href="/">Open YANTA</a>
        </div>
      </article>

      <article class="yanta-price-card featured">
        <h2>YANTA Plus</h2>
        <p class="yanta-price-sub">For larger vaults, more devices, and regular Included AI use.</p>

        <div class="yanta-price">
          <strong>${escapeHtml(money(true))}</strong>
          <span>/ month</span>
        </div>

        <ul class="yanta-feature-list">
          <li>5 GB encrypted cloud storage</li>
          <li>5 cloud vaults</li>
          <li>8 connected devices</li>
          <li>Included AI: 500 requests/day</li>
          <li>Higher Sources/RSS limits</li>
          <li>Customer-friendly billing grace period</li>
        </ul>

        <div class="yanta-btn-row">
          <button class="yanta-site-btn primary" data-checkout="${escapeHtml(ids.monthly)}">
            Start monthly
          </button>

          <button class="yanta-site-btn" data-checkout="${escapeHtml(ids.yearly)}">
            Yearly · ${escapeHtml(money(false))}/year
          </button>

          <button class="yanta-site-btn" data-portal>
            Manage billing
          </button>
        </div>
      </article>
    </section>

    <section class="yanta-note-box">
      <p>
        <strong>Privacy note:</strong>
        YANTA Cloud stores encrypted sync objects. Your notes, drawings and assets are encrypted before upload.
        Your Recovery Key stays on your devices. YANTA cannot recover encrypted notes without it.
      </p>
    </section>

    <section class="yanta-faq">
      <h2>Questions</h2>

      <div class="yanta-faq-grid">
        <div class="yanta-faq-item">
          <h3>Can YANTA read my notes?</h3>
          <p>No. YANTA Cloud stores encrypted sync objects. The Recovery Key is needed to decrypt your vault.</p>
        </div>

        <div class="yanta-faq-item">
          <h3>What happens if I cancel?</h3>
          <p>You keep Plus until the paid period ends. Afterwards the account returns to Free limits.</p>
        </div>

        <div class="yanta-faq-item">
          <h3>What if I exceed Free limits after cancellation?</h3>
          <p>Your existing encrypted data is not deleted automatically. New uploads may be blocked until you reduce usage or upgrade again.</p>
        </div>

        <div class="yanta-faq-item">
          <h3>Can I export my data?</h3>
          <p>Yes. YANTA supports encrypted .yanta backups and readable Markdown exports.</p>
        </div>
      </div>
    </section>
  `;
}

function legalContent(kind) {
  const updated = '2026-01-01';

  if (kind === 'terms') {
    document.title = 'Terms of Service · YANTA';

    return `
      <article class="yanta-legal-doc">
        <h1>Terms of Service</h1>
        <p><strong>Last updated:</strong> ${updated}</p>

        <h2>1. Provider</h2>
        <p>
          YANTA is provided by <strong>Eirik Heilmann,</strong>
          <br>
          <strong>Neustädter Ring 4, 37154 Northeim,
          <br>
          LOWER SAXONY, GERMANY</strong>.
          <br>
          Contact: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.
        </p>

        <h2>2. Service</h2>
        <p>
          YANTA is a local-first workspace for notes, drawings, tasks, sources, calendar items,
          encrypted sync, public sharing and AI-assisted workflows. Features may change,
          be added, be removed, or be limited at any time.
        </p>

        <h2>3. Accounts</h2>
        <p>
          YANTA Cloud accounts use email-based login. You are responsible for keeping access
          to your email account secure and for all activity under your account.
        </p>

        <h2>4. Encryption and Recovery Key</h2>
        <p>
          YANTA Cloud is designed so that note contents and sync objects are encrypted before upload.
          Your Recovery Key is required to decrypt your vault. YANTA is technically NOT able to
          restore encrypted content if your Recovery Key is lost.
        </p>

        <h2>5. Subscriptions</h2>
        <p>
          YANTA Plus increases usage limits such as cloud storage, devices and Included AI credits.
          Payments, taxes, invoices and payment methods are processed by Paddle as Merchant of Record.
          Subscription terms shown in Paddle Checkout apply.
        </p>

        <h2>6. Cancellations and Downgrades</h2>
        <p>
          You can cancel a subscription through the billing portal. Unless stated otherwise,
          Plus access remains available until the end of the paid billing period. After downgrade,
          Free limits apply. If your usage exceeds Free limits, new uploads or some cloud features
          may be restricted until you reduce usage or subscribe again.
        </p>

        <h2>7. Included AI and BYOK</h2>
        <p>
          Included AI is subject to rate limits, credit limits, model availability and abuse protection.
          AI responses may be inaccurate. You are responsible for reviewing AI-generated output before relying on it.
          BYOK mode uses your own OpenRouter key and is subject to OpenRouter’s terms and pricing.
        </p>

        <h2>8. Sources, Web Search and External Content</h2>
        <p>
          YANTA may fetch RSS feeds, YouTube metadata, web pages, search results, citations or weather data
          from third-party services. External content can be inaccurate, unavailable, malicious or subject to
          separate terms.
        </p>

        <h2>9. Public Shares</h2>
        <p>
          Public shares are intended to publish encrypted payloads accessible through a share link.
          Anyone with the share link and key may access the shared content. You are responsible for
          what you share and for revoking shares when needed.
        </p>

        <h2>10. Acceptable Use</h2>
        <p>
          You must not use YANTA for illegal activity, abuse, spam, malware, unauthorized access,
          infringement of third-party rights, or attempts to disrupt or overload the service.
        </p>

        <h2>11. Availability and Changes</h2>
        <p>
          YANTA is provided on an “as is” and “as available” basis. No uninterrupted availability,
          data retention, specific model availability, or permanent feature availability is guaranteed.
        </p>

        <h2>12. Liability</h2>
        <p>
          To the maximum extent permitted by applicable law, liability is limited. Nothing in these Terms
          limits liability where limitation is not permitted by law, including mandatory liability for intent,
          gross negligence, injury to life, body or health under applicable German law.
        </p>

        <h2>13. Termination</h2>
        <p>
          We may suspend or terminate access if you violate these Terms, abuse the service, create security risks,
          or if required by law.
        </p>

        <h2>14. Governing Law</h2>
        <p>
          These Terms are intended to be governed by the laws of Germany, unless mandatory consumer protection
          rules require otherwise.
        </p>
      </article>
    `;
  }

  if (kind === 'privacy') {
    document.title = 'Privacy Policy · YANTA';

    return `
      <article class="yanta-legal-doc">
        <h1>Privacy Policy</h1>
        <p><strong>Last updated:</strong> ${updated}</p>

        <h2>1. Controller</h2>
        <p>
          Controller: <strong>Eirik Heilmann,</strong>
          <br>
          <strong>Neustädter Ring 4, 37154 Northeim,
          <br>
          LOWER SAXONY, GERMANY</strong>.
          <br>
          Contact: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.
        </p>

        <h2>2. Data processed</h2>
        <ul>
          <li>Email address for login and account access.</li>
          <li>Session cookies for authentication.</li>
          <li>Billing customer, transaction and subscription identifiers from Paddle.</li>
          <li>Encrypted sync objects stored in cloud storage.</li>
          <li>Usage counters such as storage bytes, object count, bandwidth, writes and AI credit usage.</li>
          <li>Security/audit metadata such as hashed IP address, event type and timestamp.</li>
          <li>Public share metadata and encrypted public share payloads.</li>
          <li>RSS/feed URLs and external lookup requests when you use Sources features.</li>
          <li>AI prompts and selected context when you use Included AI. YANTA does not intentionally store prompts or completions server-side; they are forwarded transiently to OpenRouter.</li>
        </ul>

        <h2>3. Local-first data</h2>
        <p>
          Much of YANTA data is stored locally in your browser/device using IndexedDB and localStorage.
          Clearing browser data may delete local YANTA data unless you have sync or backups.
        </p>

        <h2>4. Encryption</h2>
        <p>
          YANTA Cloud stores encrypted sync objects. The server sees metadata needed to operate the service,
          such as object path, object size, timestamps and account ownership, but not plaintext note contents.
        </p>

        <h2>5. Legal bases</h2>
        <p>
          Processing is based on contract performance, legitimate interests such as security and abuse prevention,
          consent where required, and legal obligations such as billing/tax records.
        </p>

        <h2>6. Processors and third-party services</h2>
        <p>Depending on which features you use, YANTA may use:</p>
        <ul>
          <li>Cloudflare Workers, D1 and R2 for YANTA Cloud APIs and encrypted object storage.</li>
          <li>Vercel for hosting the web app.</li>
          <li>Paddle for billing, taxes, invoices and subscriptions.</li>
          <li>Resend for login emails.</li>
          <li>OpenRouter for AI processing.</li>
          <li>Brave Search for web search.</li>
          <li>YouTube Data API for YouTube source features.</li>
          <li>Open-Meteo for weather.</li>
          <li>Nominatim/OpenStreetMap for approximate manual location lookup.</li>
          <li>Google APIs if you choose Advanced Google Drive Sync.</li>
          <li>Public y-webrtc signaling infrastructure for live collaboration.</li>
          <li>Crossref, DataCite, OpenLibrary and similar metadata APIs for citation features.</li>
        </ul>

        <h2>7. AI privacy</h2>
        <p>
          In Included AI mode, selected chat messages and context are sent to YANTA Cloud and forwarded to OpenRouter.
          YANTA requests Zero Data Retention routing where supported. Do not include secrets or sensitive personal data
          in prompts unless necessary.
        </p>

        <h2>8. Cookies</h2>
        <p>
          YANTA Cloud uses secure HTTP-only session cookies for login. Paddle may use its own cookies and tracking
          technologies during checkout and billing portal flows.
        </p>

        <h2>9. Retention</h2>
        <p>
          Account, billing and audit records may be retained as needed for service operation, security, accounting,
          tax and legal obligations. Encrypted sync data is retained while your account/vault exists unless deleted,
          subject to technical backups and operational delays.
        </p>

        <h2>10. Your rights</h2>
        <p>
          Depending on applicable law, you may have rights to access, correction, deletion, restriction, portability
          and objection. Contact ${CONTACT_EMAIL}.
        </p>

        <h2>11. Children</h2>
        <p>
          YANTA is not intended for children below the age required to consent to digital services in their jurisdiction.
        </p>

        <h2>12. Changes</h2>
        <p>
          This policy may change as YANTA evolves, including future Android app features such as notifications,
          camera-based image upload or wrapper functionality.
        </p>
      </article>
    `;
  }

  document.title = 'Refund Policy · YANTA';

  return `
    <article class="yanta-legal-doc">
      <h1>Refund Policy</h1>
      <p><strong>Last updated:</strong> ${updated}</p>

      <p>
       Paddle acts as Merchant of Record for paid subscriptions.
      </p>

      <h2>1. Customer-friendly first purchase refund</h2>
      <p>
        If you are unhappy with YANTA Plus, contact us within 14 days of your first purchase.
        We will generally provide a refund if the request appears genuine and the service has not been abused.
      </p>

      <h2>2. Renewals</h2>
      <p>
        Renewal payments are generally non-refundable once a new billing period has started, except where required by law
        or where we decide otherwise at our discretion.
      </p>

      <h2>3. Abuse prevention</h2>
      <p>
        Refunds may be refused in cases of abuse, fraud, repeated refund requests, excessive use intended to avoid payment,
        violation of the Terms, or other misuse.
      </p>

      <h2>4. How to request a refund</h2>
      <p>
        Contact <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> with your account email and Paddle receipt details.
      </p>

      <h2>5. Processing</h2>
      <p>
        Approved refunds are processed through Paddle. Timing depends on Paddle and your payment provider.
      </p>

      <h2>6. Statutory rights</h2>
      <p>
        Nothing in this policy limits mandatory consumer rights that cannot be waived under applicable law.
      </p>
    </article>
  `;
}

export function mountSitePage() {
  const path = location.pathname.replace(/\/+$/, '') || '/';

  if (path === '/pricing') {
    document.title = 'Pricing · YANTA';
    shell(pricingContent());
    wirePricingButtons();
    return;
  }

  if (path === '/terms') {
    shell(legalContent('terms'));
    return;
  }

  if (path === '/privacy') {
    shell(legalContent('privacy'));
    return;
  }

  if (path === '/refund') {
    shell(legalContent('refund'));
    return;
  }
}

function wirePricingButtons() {
  document.querySelectorAll('[data-checkout]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const priceId = btn.getAttribute('data-checkout') || '';

      if (!priceId) {
        alert('YANTA Plus checkout is not configured yet.');
        return;
      }

      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = 'Opening checkout…';

      try {
        await openBillingCheckout(priceId);
      } catch (err) {
        console.error(err);

        if (err.status === 401) {
          alert('Please open YANTA, sign in to YANTA Cloud, then try upgrading again.');
        } else {
          alert(err?.message || 'Could not open checkout.');
        }

        btn.disabled = false;
        btn.textContent = old;
      }
    });
  });

  document.querySelector('[data-portal]')?.addEventListener('click', async () => {
    try {
      await openBillingPortal();
    } catch (err) {
      console.error(err);

      if (err.status === 401) {
        alert('Please open YANTA and sign in to YANTA Cloud first.');
      } else {
        alert(err?.message || 'Could not open billing portal.');
      }
    }
  });
}