import {
  YANTA_CLOUD_BASE_URL,
} from '../cloud/cloud-api.js';

import {
  openPaddleCheckout as openPaddleOverlayCheckout,
} from './paddle-client.js';

export const YANTA_APP_ORIGIN =
  (import.meta.env.VITE_APP_ORIGIN || 'https://yanta.page').replace(/\/+$/, '');

export const BILLING_PUBLIC_ORIGIN =
  (import.meta.env.VITE_BILLING_PUBLIC_ORIGIN || YANTA_APP_ORIGIN).replace(/\/+$/, '');

function apiUrl(path) {
  const base = String(YANTA_CLOUD_BASE_URL || '/cloud-api').replace(/\/+$/, '');
  const clean = String(path || '').replace(/^\/+/, '');

  return `${base}/${clean}`;
}

async function parseJsonError(res, fallback) {
  try {
    const json = await res.json();
    return json?.message || json?.error?.message || json?.error || fallback;
  } catch {
    try {
      return await res.text();
    } catch {
      return fallback;
    }
  }
}

async function fetchJson(path, {
  method = 'GET',
  body = null,
} = {}) {
  const res = await fetch(apiUrl(path), {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : null,
  });

  if (!res.ok) {
    const err = new Error(await parseJsonError(res, `HTTP ${res.status}`));
    err.status = res.status;
    throw err;
  }

  return res.json();
}

export function billingStatus() {
  return fetchJson('/api/billing/status');
}

export async function createBillingCheckout({
  priceId,
  successUrl = `${BILLING_PUBLIC_ORIGIN}/pricing?billing=success`,
  cancelUrl = `${BILLING_PUBLIC_ORIGIN}/pricing?billing=cancel`,
} = {}) {
  if (!priceId) {
    throw new Error('YANTA Plus price id is missing.');
  }

  return fetchJson('/api/billing/checkout', {
    method: 'POST',
    body: {
      priceId,
      successUrl,
      cancelUrl,
    },
  });
}

export async function openBillingCheckout(priceId) {
  const successUrl = `${BILLING_PUBLIC_ORIGIN}/pricing?billing=success`;
  const cancelUrl = `${BILLING_PUBLIC_ORIGIN}/pricing?billing=cancel`;

  const res = await createBillingCheckout({
    priceId,
    successUrl,
    cancelUrl,
  });

  await openPaddleOverlayCheckout({
    transactionId: res.transactionId,
    checkoutUrl: res.checkoutUrl,
    successUrl,
    cancelUrl,
  });
}

export async function openBillingPortal() {
  const res = await fetchJson('/api/billing/portal', {
    method: 'POST',
  });

  if (!res?.portalUrl) {
    throw new Error('Billing portal URL missing.');
  }

  window.location.assign(res.portalUrl);
}

export function billingPageUrl(path = '/pricing') {
  const clean = String(path || '/pricing').startsWith('/')
    ? String(path || '/pricing')
    : `/${path}`;

  return `${BILLING_PUBLIC_ORIGIN}${clean}`;
}

export function syncBillingNow() {
  return fetchJson('/api/billing/sync', {
    method: 'POST',
  });
}

/*
  Paddle Overlay completion → reconcile immediately.
  The webhook usually wins the race, but this guarantees the plan
  flips within seconds even if the webhook is delayed or lost.
*/
if (typeof window !== 'undefined') {
  window.addEventListener('yanta:paddle-checkout-completed', async () => {
    try {
      const res = await syncBillingNow();
      window.dispatchEvent(new CustomEvent('yanta:billing-updated', {
        detail: res?.billing || null,
      }));
    } catch (err) {
      console.warn('[YANTA Billing] Post-checkout sync failed', err);
    }
  });
}