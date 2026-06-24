import {
  YANTA_CLOUD_BASE_URL,
} from '../cloud/cloud-api.js';

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
  successUrl = `${location.origin}/pricing?billing=success`,
  cancelUrl = `${location.origin}/pricing?billing=cancel`,
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
  const res = await createBillingCheckout({
    priceId,
  });

  if (!res?.checkoutUrl) {
    throw new Error('Checkout URL missing.');
  }

  location.href = res.checkoutUrl;
}

export async function openBillingPortal() {
  const res = await fetchJson('/api/billing/portal', {
    method: 'POST',
  });

  if (!res?.portalUrl) {
    throw new Error('Billing portal URL missing.');
  }

  location.href = res.portalUrl;
}