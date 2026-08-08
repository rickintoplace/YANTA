import {
  ensureLegalFooterCss,
  legalFooterHtml,
} from './legal-footer.js';

import {
  billingStatus,
  openBillingCheckout,
  openBillingPortal,
} from '../billing/billing-api.js';

import {
  cloudMe,
} from '../cloud/cloud-api.js';

import { BRAND_LOGO_SVG } from '../brand-logo.js';

import {
  getAppContent,
  wireGetAppPage,
} from './get-app-content.js';

import { accessibilityContent } from './accessibility-content.js';

import {
  metricsContent,
  wireMetricsPage,
} from './metrics-content.js';
import { legalDocument } from './legal-documents.js';

import {
  cancelContent,
  wireCancelPage,
} from './cancel-content.js';

import {
  reportContent,
  wireReportPage,
} from './report-content.js';

import {
  deleteAccountContent,
  wireDeleteAccountPage,
} from './delete-account-content.js';

import {
  escapeHtml,
  legalLinkUrl,
  YANTA_APP_ORIGIN,
  YANTA_LEGAL as LEGAL,
} from './legal-links.js';

import { syncBillingNow } from '../billing/billing-api.js';
import { t } from '../i18n/index.js';

const CONTACT_EMAIL = LEGAL.contactEmail;

const PLUS_MONTHLY_EUR =
  import.meta.env.VITE_PADDLE_PLUS_MONTHLY_EUR_PRICE_ID || '';

const PLUS_MONTHLY_USD =
  import.meta.env.VITE_PADDLE_PLUS_MONTHLY_USD_PRICE_ID || '';

const PLUS_YEARLY_EUR =
  import.meta.env.VITE_PADDLE_PLUS_YEARLY_EUR_PRICE_ID || '';

const PLUS_YEARLY_USD =
  import.meta.env.VITE_PADDLE_PLUS_YEARLY_USD_PRICE_ID || '';

function brandLogoSvg() {
  return BRAND_LOGO_SVG;
}

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

function currencySymbol() {
  return userCurrency() === 'EUR' ? '€' : '$';
}

function money(monthly = true) {
  return `${currencySymbol()}${monthly ? 6 : 60}`;
}

/*
  Only emit a checkout button for a price that is actually configured.
  A missing yearly/monthly price id must never render as a dead
  "Price unavailable" button — we simply omit it.
*/
function plusCheckoutButtonsHtml(ids) {
  const buttons = [];

  if (ids.monthly) {
    buttons.push(`
      <button class="yanta-site-btn primary" data-checkout="${escapeHtml(ids.monthly)}">
        Start monthly
      </button>
    `);
  }

  if (ids.yearly) {
    buttons.push(`
      <button class="yanta-site-btn${ids.monthly ? '' : ' primary'}" data-checkout="${escapeHtml(ids.yearly)}">
        Yearly · ${escapeHtml(money(false))}/year
      </button>
    `);
  }

  return buttons.join('\n');
}

function envFlagEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value || '').trim().toLowerCase()
  );
}

function checkoutEnabled() {
  return envFlagEnabled(import.meta.env.VITE_PADDLE_CHECKOUT_ENABLED);
}

function setButtonBusy(btn, busy, label = '') {
  if (!btn) return;

  if (busy) {
    btn.dataset.oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = label || 'Working…';
    return;
  }

  btn.disabled = false;

  if (btn.dataset.oldText) {
    btn.textContent = btn.dataset.oldText;
    delete btn.dataset.oldText;
  }
}

function injectCss() {
  if (document.getElementById('yanta-site-pages-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-site-pages-css';
  style.textContent = `
:root {
  color-scheme: dark light;
}

/* The hidden attribute must win over .yanta-site-btn's explicit display. */
[hidden] { display: none !important; }

html.yanta-site-page,
body.yanta-site-page {
  height: auto !important;
  min-height: 100% !important;
  overflow: auto !important;
}

body.yanta-site-page {
  position: static !important;
}

html.yanta-site-page * {
  box-sizing: border-box;
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
  margin-top: 24px;
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

/* PAngV: the VAT and renewal statement belongs next to the price itself. */
.yanta-price-tax {
  margin: -12px 0 16px;
  color: var(--text-dim, #625a49);
  font-size: 12.5px;
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

/*
  Inline links inherit the body colour and carry an underline instead of a
  hue: the UA default blue is unreadable on the dark theme, and the accent
  olive clears 4.5:1 on neither background. The underline also keeps links
  distinguishable without relying on colour (WCAG 1.4.1).
*/
.yanta-legal-doc a,
.yanta-note-box a,
.yanta-faq a {
  color: var(--text, #29251d);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

.yanta-legal-doc a:hover,
.yanta-note-box a:hover,
.yanta-faq a:hover {
  color: var(--accent, #8FA31E);
}

/* Keyboard focus has to be visible on every control of the site shell. */
.yanta-site :is(a, button):focus-visible {
  outline: 2px solid var(--accent, #8FA31E);
  outline-offset: 2px;
  border-radius: 7px;
}

/* Wide tables scroll inside their own box; the page never scrolls sideways. */
.yanta-legal-table {
  overflow-x: auto;
  margin: 14px 0;
  border: 1px solid color-mix(in srgb, var(--border, #d8c7a5) 72%, transparent);
  border-radius: 12px;
}

.yanta-legal-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.yanta-legal-table th,
.yanta-legal-table td {
  padding: 10px 14px;
  text-align: left;
  vertical-align: top;
}

.yanta-legal-table th {
  color: var(--text, #29251d);
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;
}

.yanta-legal-table tbody tr {
  border-top: 1px solid color-mix(in srgb, var(--border, #d8c7a5) 55%, transparent);
}

.yanta-legal-table td {
  color: var(--text-dim, #625a49);
}

.yanta-legal-quote {
  margin: 14px 0;
  padding: 14px 18px;
  border-left: 3px solid var(--accent, #8FA31E);
  border-radius: 0 10px 10px 0;
  background: var(--bg-elev, #f7efd8);
}

.yanta-legal-quote p {
  margin: 0 0 10px;
}

.yanta-legal-quote p:last-child {
  margin-bottom: 0;
}

.yanta-legal-doc h3 {
  margin: 22px 0 6px;
  font-size: 16px;
}

/* Sits above an untranslated document, so it must read as a note, not chrome. */
.yanta-legal-lang-note {
  margin-top: 0;
  margin-bottom: 22px;
}

.yanta-legal-lang-note p {
  font-size: 13.5px;
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

/*
  Product nav only. Every site page carries the full legal set in its footer,
  so repeating it up here just crowds the bar once a seventh page exists.
*/
const SITE_NAV_LINKS = [
  { key: 'getApp', href: '/get-app' },
  { key: 'pricing', href: '/pricing' },
];

function siteNavHtml(currentPath) {
  return SITE_NAV_LINKS.map((link) => {
    const current = link.href === currentPath
      ? ' aria-current="page"'
      : '';

    return `<a href="${escapeHtml(legalLinkUrl(link.href))}"${current}>${escapeHtml(t(`site.nav.${link.key}`))}</a>`;
  }).join('\n');
}

function shell(content, { title = '', currentPath = '' } = {}) {
  injectCss();
  ensureLegalFooterCss();

  document.title = title ? `${title} · YANTA` : 'YANTA';

  document.documentElement.classList.add('yanta-site-page');
  document.body.classList.add('yanta-site-page');

  document.body.innerHTML = `
    <div class="yanta-site">
      <header class="yanta-site-header">
        <nav class="yanta-site-nav">
          <a class="brand yanta-site-brand" href="${escapeHtml(YANTA_APP_ORIGIN)}">
            <div class="sidebar-head">
              <div class="brand">
                <span class="brand-mark">${brandLogoSvg()}</span>
                <span>YANTA</span>
              </div>
            </div>
          </a>
          <div class="yanta-site-nav-links">
            ${siteNavHtml(currentPath)}
          </div>
        </nav>
      </header>

      <main class="yanta-site-main">
        ${content}
      </main>

      ${legalFooterHtml({
        id: 'yanta-site-legal-footer',
        variant: 'site',
      })}
    </div>
  `;
}

function billingBannerHtml() {
  const params = new URLSearchParams(location.search);
  const state = params.get('billing') || '';

  if (state === 'success') {
    return `
      <section class="yanta-note-box yanta-billing-banner success" id="billing-success-banner">
        <p>
          <strong>Thank you.</strong>
          Paddle is confirming your YANTA Plus subscription.
          <span id="billing-success-status">Checking your billing status…</span>
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

async function refreshBillingSuccessBanner() {
  const params = new URLSearchParams(location.search);
  if (params.get('billing') !== 'success') return;
  const statusEl = document.getElementById('billing-success-status');
  if (!statusEl) return;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      /*
        Active reconciliation instead of passively waiting for the webhook.
        First attempts force a server-side sync against the Paddle API.
      */
      const res = attempt < 3
        ? await syncBillingNow()
        : await billingStatus();
      const plan = res?.billing?.plan || '';
      const label = res?.billing?.label || '';
      if (plan === 'premium') {
        statusEl.textContent = `Your plan is now ${label || 'YANTA Plus'}.`;
        return;
      }
      statusEl.textContent = 'Still waiting for Paddle confirmation…';
    } catch (err) {
      if (err?.status === 401) {
        statusEl.textContent = 'Open YANTA and sign in to see your updated plan.';
        return;
      }
      statusEl.textContent = 'Still waiting for Paddle confirmation…';
    }
    await new Promise((resolve) => setTimeout(resolve, 1800 + attempt * 500));
  }
  statusEl.textContent =
    'Payment received. Your plan may take a moment to update. Please refresh YANTA Cloud settings shortly.';
}

function pricingContent() {
  const ids = priceIds();

  return `
    <section class="yanta-site-hero">
      <div class="yanta-site-kicker">YANTA Cloud</div>
      <h1>A calm workspace for notes, drawings and encrypted sync.</h1>
      <p>
        YANTA is a personal knowledge workspace for Markdown notes, drawings,
        tasks, calendar events, sources and cross-device sync. Start free.
        Upgrade to YANTA Plus when you need more storage and higher usage limits.
      </p>
    </section>

    ${billingBannerHtml()}

    <section class="yanta-pricing-grid">
      <article class="yanta-price-card">
        <h2>Free</h2>
        <p class="yanta-price-sub">
          For trying YANTA Cloud or syncing a small personal encrypted vault.
        </p>

        <div class="yanta-price">
          <strong>${escapeHtml(currencySymbol())}0</strong>
          <span>/ forever</span>
        </div>

        <p class="yanta-price-tax">${escapeHtml(t('site.price.freeNote'))}</p>

        <ul class="yanta-feature-list">
          <li>30 MB encrypted cloud sync storage budget*</li>
          <li>1 cloud vault</li>
          <li>3 connected devices</li>
          <li>Included AI credit budget for limited use**</li>
          <li>Encrypted backup export</li>
          <li>Local-first browser storage</li>
        </ul>

        <div class="yanta-btn-row">
          <a class="yanta-site-btn" href="${escapeHtml(YANTA_APP_ORIGIN)}">Open YANTA</a>
        </div>
      </article>

      <article class="yanta-price-card featured">
        <h2>YANTA Plus</h2>
        <p class="yanta-price-sub">
          For larger personal vaults, more devices, regular sync and higher Included AI limits.
        </p>

        <div class="yanta-price">
          <strong>${escapeHtml(money(true))}</strong>
          <span>/ month</span>
        </div>

        <p class="yanta-price-tax">${escapeHtml(t('site.price.taxNote'))}</p>

        <ul class="yanta-feature-list">
          <li>5 GB encrypted cloud sync storage budget*</li>
          <li>5 cloud vaults</li>
          <li>8 connected devices</li>
          <li>Higher Included AI credit budget for everyday lightweight use**</li>
          <li>Higher Sources/RSS limits</li>
        </ul>

        <div class="yanta-btn-row">
          ${plusCheckoutButtonsHtml(ids)}

          <button class="yanta-site-btn" data-portal>
            Manage billing
          </button>
        </div>
      </article>
    </section>

    <section class="yanta-note-box">
      <p>${escapeHtml(t('site.price.vatBox'))}
        <a class="yanta-site-link" href="/cancel">${escapeHtml(t('site.legal.cancel'))}</a>.
      </p>

      <p style="margin-top:8px">${escapeHtml(t('site.price.withdrawalBox'))}
        <a class="yanta-site-link" href="/withdrawal">${escapeHtml(t('site.title.refund'))}</a>.
      </p>
    </section>

    <section class="yanta-note-box">
      <p>
        <strong>* Cloud sync storage budget:</strong>
        This is the total encrypted YANTA Cloud Sync budget for your account.
        It includes encrypted notes and assets as well as sync metadata, vault snapshots,
        update history, indexes, encryption overhead and other technical data needed
        for reliable cross-device sync. The amount of visible note or asset content you
        can store may therefore be lower than the headline storage number.
      </p>

      <p style="margin-top:8px">
        <strong>** Included AI:</strong>
        Included AI is a fair-use credit budget, not an unlimited fixed number of prompts.
        Actual availability depends on model cost, prompt/context size, output length,
        tool usage, daily/monthly credit limits, rate limits and abuse protection.
        For heavy AI usage, you can use BYOK with your own OpenRouter key.
      </p>
    </section>

    <section class="yanta-note-box">
      <p>
        <strong>How to upgrade:</strong>
        Sign in to YANTA Cloud, then choose a YANTA Plus plan here or from
        <strong>Settings → Sync → YANTA Plus</strong>. Your subscription is linked
        to your YANTA Cloud account.
      </p>
    </section>

    <section class="yanta-note-box">
      <p>
        <strong>Privacy note:</strong>
        YANTA Cloud stores encrypted sync objects for your personal vault.
        Notes, drawings and assets are encrypted before upload. Your Recovery Key
        stays on your devices. YANTA cannot recover encrypted notes without it.
      </p>
    </section>

    <section class="yanta-note-box">
      <p>
        <strong>Billing:</strong>
        YANTA Plus subscriptions are processed by Paddle as Merchant of Record.
        Paddle handles payment methods, invoices and applicable taxes.
        YANTA is operated by <a class="yanta-site-link" href="${escapeHtml(LEGAL.portfolioUrl)}" target="_blank" rel="noopener">rickintoplace</a>.
      </p>
    </section>

    <section class="yanta-faq">
      <h2>Questions</h2>

      <div class="yanta-faq-grid">
        <div class="yanta-faq-item">
          <h3>Can YANTA read my notes?</h3>
          <p>
            No. YANTA Cloud is designed around client-side encryption for sync data.
            The server stores encrypted sync objects and operational metadata, not plaintext note contents.
          </p>
        </div>

        <div class="yanta-faq-item">
          <h3>What is YANTA Plus?</h3>
          <p>
            Plus increases usage limits: encrypted cloud sync storage budget, devices,
            cloud vaults, Included AI credit budget and Sources/RSS limits. It does not
            unlock exclusive features for now.
          </p>
        </div>

        <div class="yanta-faq-item">
          <h3>What happens if I cancel?</h3>
          <p>
            You keep Plus until the end of the paid period. Afterwards your account returns to Free limits.
          </p>
        </div>

        <div class="yanta-faq-item">
          <h3>What if I exceed Free limits after cancellation?</h3>
          <p>
            Existing encrypted data is not automatically deleted. New cloud uploads may be blocked
            until you reduce usage or subscribe again.
          </p>
        </div>

        <div class="yanta-faq-item">
          <h3>Can I export my data?</h3>
          <p>
            Yes. YANTA supports encrypted .yanta backups and readable Markdown exports.
          </p>
        </div>

        <div class="yanta-faq-item">
          <h3>Is YANTA a file hosting service?</h3>
          <p>
            No. YANTA Cloud is for encrypted sync of YANTA workspace data such as notes,
            drawings, calendar metadata and related assets.
          </p>
        </div>
      </div>
    </section>
  `;
}


/*
  One entry per public route. `render` returns the <main> markup, `wire`
  runs after the shell is in the DOM. Keep the paths in sync with
  SITE_PAGE_PATHS (legal-links.js) and the host's rewrite rules.
*/
const SITE_ROUTES = new Map([
  ['/pricing', {
    titleKey: 'site.title.pricing',
    render: pricingContent,
    wire: () => {
      wirePricingButtons();
      refreshBillingSuccessBanner();
    },
  }],
  ['/terms', {
    titleKey: 'site.title.terms',
    render: () => legalDocument('terms'),
  }],
  ['/privacy', {
    titleKey: 'site.title.privacy',
    render: () => legalDocument('privacy'),
  }],
  /*
    One document, two routes: the statutory withdrawal notice and the
    voluntary refund policy belong on the same page, and both names have to
    resolve — /refund because it is linked from elsewhere and from Paddle,
    /withdrawal because that is what the notice is called.
  */
  ['/refund', {
    titleKey: 'site.title.refund',
    render: () => legalDocument('withdrawal'),
  }],
  ['/withdrawal', {
    titleKey: 'site.title.refund',
    render: () => legalDocument('withdrawal'),
  }],
  ['/imprint', {
    titleKey: 'site.title.imprint',
    render: () => legalDocument('imprint'),
  }],
  ['/licenses', {
    titleKey: 'site.title.licenses',
    render: () => legalDocument('licenses'),
  }],
  ['/accessibility', {
    titleKey: 'site.title.accessibility',
    render: accessibilityContent,
  }],
  ['/cancel', {
    titleKey: 'site.title.cancel',
    render: cancelContent,
    wire: wireCancelPage,
  }],
  ['/delete-account', {
    titleKey: 'site.title.deleteAccount',
    render: deleteAccountContent,
    wire: wireDeleteAccountPage,
  }],
  ['/report', {
    titleKey: 'site.title.report',
    render: reportContent,
    wire: wireReportPage,
  }],
  /*
    Owner-only funnel dashboard. `titleText` instead of a titleKey: it is not a
    user-facing surface, so it stays English and out of the locale catalogues.
  */
  ['/metrics', {
    titleText: 'Metrics',
    render: metricsContent,
    wire: wireMetricsPage,
  }],
  ['/get-app', {
    titleKey: 'site.title.getApp',
    render: getAppContent,
    wire: wireGetAppPage,
  }],
]);

export async function mountSitePage() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const route = SITE_ROUTES.get(path);

  if (!route) return;

  // Legal documents resolve their locale bundle lazily, so render can be async.
  const content = await route.render();

  shell(content, {
    title: route.titleText || t(route.titleKey),
    currentPath: path,
  });

  route.wire?.();
}

async function wirePricingButtons() {
  const checkoutButtons = [...document.querySelectorAll('[data-checkout]')];
  const portalBtn = document.querySelector('[data-portal]');

  if (!checkoutEnabled()) {
    checkoutButtons.forEach((btn) => {
      btn.textContent = 'Available soon';
      btn.disabled = true;
      btn.title = 'YANTA Plus checkout is not enabled yet.';
    });

    if (portalBtn) {
      portalBtn.textContent = 'Open YANTA';
      portalBtn.addEventListener('click', () => {
        location.href = YANTA_APP_ORIGIN;
      });
    }

    return;
  }

  const me = await cloudMe().catch(() => ({
    authenticated: false,
  }));

  const isAuthenticated = !!me?.authenticated;
  const isPlus =
    me?.user?.plan === 'premium' ||
    me?.billing?.plan === 'premium';

  /*
    Already subscribed: collapse the checkout buttons into a single clear
    status pill instead of repeating "You are on YANTA Plus" per price.
  */
  if (isPlus) {
    checkoutButtons.forEach((btn, i) => {
      if (i === 0) {
        btn.textContent = 'You are on YANTA Plus';
        btn.disabled = true;
        btn.classList.add('primary');
        btn.title = 'Your account already has YANTA Plus.';
      } else {
        btn.hidden = true;
      }
    });
  }

  checkoutButtons.forEach((btn) => {
    if (isPlus) return;

    const priceId = btn.getAttribute('data-checkout') || '';

    if (!priceId) {
      btn.hidden = true;
      return;
    }

    if (!isAuthenticated) {
      btn.textContent = 'Open YANTA to upgrade';

      btn.addEventListener('click', () => {
        location.href = YANTA_APP_ORIGIN;
      });

      return;
    }

    btn.addEventListener('click', async () => {
      setButtonBusy(btn, true, 'Opening secure checkout…');

      try {
        await openBillingCheckout(priceId);

        /*
          Paddle Overlay opens without navigating immediately.
          Restore the button shortly so the page does not look stuck
          if the customer closes the overlay.
        */
        setTimeout(() => {
          setButtonBusy(btn, false);
        }, 1600);
      } catch (err) {
        setButtonBusy(btn, false);

        // Backing out of the withdrawal step is a normal choice, not a fault.
        if (err?.aborted) return;

        console.error(err);

        if (err.status === 401) {
          alert(
            [
              'Please sign in to YANTA Cloud first.',
              '',
              'Open YANTA, sign in to YANTA Cloud, then upgrade from Settings → Sync.',
            ].join('\n')
          );

          location.href = YANTA_APP_ORIGIN;
          return;
        }

        alert(err?.message || 'Could not open checkout.');
      }
    });
  });

  if (!portalBtn) return;

  if (!isAuthenticated) {
    portalBtn.textContent = 'Open YANTA to manage billing';

    portalBtn.addEventListener('click', () => {
      location.href = YANTA_APP_ORIGIN;
    });

    return;
  }

  portalBtn.addEventListener('click', async () => {
    setButtonBusy(portalBtn, true, 'Opening billing portal…');

    try {
      await openBillingPortal();
    } catch (err) {
      console.error(err);

      setButtonBusy(portalBtn, false);

      if (err.status === 401) {
        alert('Please sign in to YANTA Cloud first.');
        location.href = YANTA_APP_ORIGIN;
        return;
      }

      if (err.status === 404) {
        alert('No billing profile exists yet. Subscribe to YANTA Plus first.');
        return;
      }

      alert(err?.message || 'Could not open billing portal.');
    }
  });
}