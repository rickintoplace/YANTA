import { initializePaddle } from '@paddle/paddle-js';

let paddlePromise = null;

function envEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value || '').trim().toLowerCase()
  );
}

export function paddleCheckoutEnabled() {
  return envEnabled(import.meta.env.VITE_PADDLE_CHECKOUT_ENABLED);
}

export function paddleClientToken() {
  return String(import.meta.env.VITE_PADDLE_CLIENT_TOKEN || '').trim();
}

export async function getPaddle() {
  if (!paddleCheckoutEnabled()) {
    return null;
  }

  const token = paddleClientToken();

  if (!token) {
    throw new Error('Paddle client-side token is missing.');
  }

  if (!token.startsWith('live_')) {
    throw new Error('Paddle client-side token must be a Production live_ token.');
  }

  if (!paddlePromise) {
    paddlePromise = initializePaddle({
      environment: 'production',
      token,
    });
  }

  return paddlePromise;
}

function preferredTheme() {
  const explicit = document.documentElement.dataset.theme;

  if (explicit === 'dark' || explicit === 'light') {
    return explicit;
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
    ? 'dark'
    : 'light';
}

export async function openPaddleCheckout({
  transactionId,
  checkoutUrl,
  successUrl,
} = {}) {
  const paddle = await getPaddle().catch((err) => {
    console.warn('[YANTA Billing] Paddle overlay unavailable, falling back to redirect.', err);
    return null;
  });

  if (paddle && transactionId) {
    paddle.Checkout.open({
      transactionId,
      settings: {
        displayMode: 'overlay',
        theme: preferredTheme(),
        successUrl,
      },
    });

    return;
  }

  if (checkoutUrl) {
    window.location.assign(checkoutUrl);
    return;
  }

  throw new Error('Checkout could not be opened.');
}