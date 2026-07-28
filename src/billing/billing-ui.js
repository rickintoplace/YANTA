import {
  el,
  lucide,
  toast,
  escapeHtml,
} from '../core.js';

import {
  cloudMe,
} from '../cloud/cloud-api.js';

import { openBoundOverlay } from '../overlay-history.js';

import {
  openBillingCheckout,
  openBillingPortal,
  syncBillingNow,
} from './billing-api.js';

function userWantsEur() {
  const lang = navigator.language || '';

  return (
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
  );
}

export function yantaPlusPriceIds() {
  return {
    monthlyEur: import.meta.env.VITE_PADDLE_PLUS_MONTHLY_EUR_PRICE_ID || '',
    monthlyUsd: import.meta.env.VITE_PADDLE_PLUS_MONTHLY_USD_PRICE_ID || '',
    yearlyEur: import.meta.env.VITE_PADDLE_PLUS_YEARLY_EUR_PRICE_ID || '',
    yearlyUsd: import.meta.env.VITE_PADDLE_PLUS_YEARLY_USD_PRICE_ID || '',
  };
}

export function preferredYantaPlusPriceId({
  interval = 'yearly',
} = {}) {
  const ids = yantaPlusPriceIds();
  const eur = userWantsEur();

  if (interval === 'monthly') {
    return eur
      ? ids.monthlyEur || ids.monthlyUsd || ids.yearlyEur || ids.yearlyUsd
      : ids.monthlyUsd || ids.monthlyEur || ids.yearlyUsd || ids.yearlyEur;
  }

  return eur
    ? ids.yearlyEur || ids.yearlyUsd || ids.monthlyEur || ids.monthlyUsd
    : ids.yearlyUsd || ids.yearlyEur || ids.monthlyUsd || ids.monthlyEur;
}

export function yantaPlusPriceLabel({
  interval = 'yearly',
} = {}) {
  const eur = userWantsEur();

  if (interval === 'monthly') {
    return eur ? '€6/month' : '$6/month';
  }

  return eur ? '€60/year' : '$60/year';
}

export async function openYantaPlusUpgrade({
  interval = 'yearly',
} = {}) {
  const priceId = preferredYantaPlusPriceId({
    interval,
  });

  if (!priceId) {
    toast('YANTA Plus checkout is not configured yet.', 'error');
    throw new Error('YANTA Plus price id missing.');
  }

  await openBillingCheckout(priceId);
}

export async function openYantaBillingPortal() {
  await openBillingPortal();
}

function fmtBytes(n) {
  const value = Number(n || 0);

  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;

  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function ensureCss() {
  if (document.getElementById('yanta-billing-ui-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-billing-ui-css';
  style.textContent = `
.yanta-billing-modal-card {
  width: min(560px, 94vw);
}

.yanta-billing-modal-body {
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.yanta-billing-hero {
  display: flex;
  gap: 12px;
  align-items: flex-start;

  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 13px;

  background: var(--bg-elev-2);
}

.yanta-billing-hero-icon {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 14px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
}

.yanta-billing-hero strong {
  display: block;
  color: var(--text);
  font-size: 15px;
  line-height: 1.25;
}

.yanta-billing-hero p {
  margin: 5px 0 0;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.45;
}

.yanta-billing-box {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev);
}

.yanta-billing-box strong {
  color: var(--text);
}

.yanta-billing-box p {
  margin: 5px 0 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.yanta-billing-status {
  min-height: 18px;
  color: var(--text-faint);
  font-size: 12px;
  white-space: pre-wrap;
}

.yanta-billing-status.error {
  color: var(--red);
}

.yanta-billing-status.success {
  color: var(--green);
}
`;
  document.head.append(style);
}

export function showCloudQuotaDialog(detail = {}) {
  ensureCss();

  const modal = el('div', {
    class: 'modal yanta-billing-modal',
  });

  const errorCode =
    detail.serverCode ||
    detail.error ||
    detail.code ||
    '';

  const maxBytes =
    detail.maxBytes ||
    detail.response?.maxBytes ||
    0;

  const message =
    detail.message ||
    'YANTA Cloud could not upload because a plan limit was reached.';

  modal.innerHTML = `
    <div class="modal-card yanta-billing-modal-card">
      <header class="modal-head">
        <h3>Cloud limit reached</h3>
        <button class="icon-btn" data-close>&times;</button>
      </header>

      <div class="modal-body yanta-billing-modal-body">
        <div class="yanta-billing-hero">
          <div class="yanta-billing-hero-icon">
            ${lucide('cloud-alert', 26)}
          </div>

          <div>
            <strong>YANTA could not upload new encrypted sync data.</strong>
            <p>${escapeHtml(message)}</p>
          </div>
        </div>

        <div class="yanta-billing-box">
          <strong>What you can do</strong>
          <p>
            First try optimizing cloud storage. YANTA will upload latest encrypted states
            and prune old sync journal objects that are already covered.
          </p>
          <p>
            If your vault simply needs more room, upgrade to YANTA Plus.
          </p>
          ${
            maxBytes
              ? `<p>Current limit: ${escapeHtml(fmtBytes(maxBytes))}</p>`
              : ''
          }
          ${
            errorCode
              ? `<p>Server code: <code>${escapeHtml(errorCode)}</code></p>`
              : ''
          }
        </div>

        <div class="yanta-billing-status" data-status></div>

        <div class="compress-actions">
          <button class="btn" data-optimize>
            ${lucide('archive', 14)}
            Optimize storage
          </button>

          <button class="btn" data-manage>
            ${lucide('credit-card', 14)}
            Manage billing
          </button>

          <span class="grow"></span>

          <button class="btn" data-close>Later</button>

          <button class="btn primary" data-upgrade>
            ${lucide('sparkles', 14)}
            Upgrade to YANTA Plus
          </button>
        </div>
      </div>
    </div>
  `;

  const statusEl = modal.querySelector('[data-status]');

  const close = () => {
    modal.remove();
    release?.();
  };

  // Device-back closes the modal instead of the app.
  const release = openBoundOverlay('billing', {
    close,
    isOpen: () => modal.isConnected,
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
    if (e.target.closest?.('[data-close]')) close();
  });

  modal.querySelector('[data-optimize]')?.addEventListener('click', async () => {
    try {
      statusEl.textContent = 'Optimizing cloud storage…';
      statusEl.className = 'yanta-billing-status';

      if (typeof window.yantaSync2CompactNow !== 'function') {
        throw new Error('Cloud storage optimization is not available yet.');
      }

      const result = await window.yantaSync2CompactNow({
        emergencyHeadroom: true,
        keepSnapshotsPerDoc: 2,
      });

      const freed = Number(result?.freedBytes || 0);

      statusEl.textContent =
        `Optimization complete. Freed ${(freed / 1024 / 1024).toFixed(2)} MB. Try syncing again.`;
      statusEl.className = 'yanta-billing-status success';

      toast('Cloud storage optimized', 'success');

      try {
        await window.yantaSync2Now?.({
          interactive: true,
          catchUp: false,
        });
      } catch {}
    } catch (err) {
      console.error(err);
      statusEl.textContent = err?.message || 'Optimization failed.';
      statusEl.className = 'yanta-billing-status error';
    }
  });

  modal.querySelector('[data-upgrade]')?.addEventListener('click', async () => {
    try {
      statusEl.textContent = 'Opening checkout…';
      await openYantaPlusUpgrade({
        interval: 'yearly',
      });
    } catch (err) {
      console.error(err);
      statusEl.textContent = err?.message || 'Could not open checkout.';
      statusEl.className = 'yanta-billing-status error';
    }
  });

  modal.querySelector('[data-manage]')?.addEventListener('click', async () => {
    try {
      statusEl.textContent = 'Opening billing portal…';
      await openYantaBillingPortal();
    } catch (err) {
      console.error(err);
      statusEl.textContent = err?.message || 'Could not open billing portal.';
      statusEl.className = 'yanta-billing-status error';
    }
  });

  document.body.append(modal);

  return modal;
}

export async function currentBillingSummary() {
  const me = await cloudMe();

  return {
    me,
    plan: me?.user?.plan || 'free',
    planLabel: me?.user?.planLabel || me?.billing?.label || (me?.user?.plan === 'premium' ? 'YANTA Plus' : 'Free'),
    billing: me?.billing || null,
    limits: me?.limits || {},
    usage: me?.usage || {},
  };
}

/*
  Paddle-authoritative refresh. The fast path (`/api/me`) only reads the
  worker DB, so a missed or delayed renewal webhook can leave the plan or
  renewal date stale. This reconciles directly against the Paddle API and
  returns a summary in the same shape as currentBillingSummary().
*/
export async function reconciledBillingSummary() {
  const res = await syncBillingNow();
  const billing = res?.billing || null;

  return {
    me: null,
    plan: billing?.plan || 'free',
    planLabel: billing?.label || (billing?.plan === 'premium' ? 'YANTA Plus' : 'Free'),
    billing,
    limits: res?.limits || {},
    usage: {},
  };
}

function fmtBillingDate(ms) {
  const value = Number(ms || 0);
  if (!value) return '';

  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return '';
  }
}

/*
  Single source of truth for the plan status line and which billing
  buttons to show. Honest, period-aware copy: trials say "free until",
  active subs say "renews", scheduled cancellations say "cancels".
  `afterReconcile` is set once we have already pulled fresh Paddle state,
  so a still-past period no longer promises a refresh that won't happen.
*/
export function describeBillingState({ plan, billing } = {}, { afterReconcile = false } = {}) {
  const sub = billing?.subscription || null;
  const isPlus = plan === 'premium';

  const status = String(sub?.status || '').toLowerCase();
  const endsAt = Number(sub?.currentPeriodEndsAt || 0);
  const endsLabel = escapeHtml(fmtBillingDate(endsAt));
  const cancels = !!sub?.cancelAtPeriodEnd;

  // Period end sits in the past while the sub still claims to be running:
  // the local DB missed a renewal. Reconcile before trusting the date.
  const stale =
    !afterReconcile &&
    isPlus &&
    endsAt > 0 &&
    endsAt < Date.now() &&
    (status === 'trialing' || status === 'active');

  if (!isPlus) {
    return {
      isPlus: false,
      stale: false,
      showUpgrade: true,
      showManage: !!sub,
      html: `
        <strong>Free plan.</strong>
        Upgrade when you need more encrypted cloud storage, more devices, or higher Included AI limits.
      `,
    };
  }

  let html;

  if (stale) {
    html = `
      <strong style="color:var(--green)">YANTA Plus is active.</strong>
      Refreshing your renewal date…
    `;
  } else if (status === 'trialing') {
    html = cancels
      ? `
        <strong style="color:var(--green)">YANTA Plus trial is active.</strong>
        ${endsLabel ? `Your trial ends ${endsLabel} and won't renew — you won't be charged.` : `Your trial won't renew.`}
      `
      : `
        <strong style="color:var(--green)">YANTA Plus trial is active.</strong>
        ${endsLabel ? `Free until ${endsLabel}, then your subscription begins automatically.` : `Your subscription begins automatically when the trial ends.`}
      `;
  } else if (status === 'past_due') {
    html = `
      <strong style="color:var(--yellow)">Payment needs attention.</strong>
      Update your payment method to keep YANTA Plus.
    `;
  } else if (cancels || status === 'canceled') {
    html = endsLabel
      ? `
        <strong style="color:var(--green)">YANTA Plus is active.</strong>
        Your subscription is canceled — you keep Plus until ${endsLabel}.
      `
      : `<strong style="color:var(--green)">YANTA Plus is active.</strong>`;
  } else if (endsLabel) {
    html = `
      <strong style="color:var(--green)">YANTA Plus is active.</strong>
      Renews ${endsLabel}.
    `;
  } else {
    html = `
      <strong style="color:var(--green)">YANTA Plus is active.</strong>
      Thank you for supporting YANTA.
    `;
  }

  return {
    isPlus: true,
    stale,
    showUpgrade: false,
    showManage: true,
    html,
  };
}