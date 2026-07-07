// ============================================================
// YANTA Chat — Cloud auth gate
// ============================================================

import {
  toast,
} from '../core.js';

import {
  cloudMe,
} from '../cloud/cloud-api.js';

let authCache = {
  checkedAt: 0,
  state: null,
};

const AUTH_CACHE_MS = 30_000;

/**
 * Returns cached YANTA Cloud auth state for Chat.
 */
export async function getChatCloudAuthState({
  force = false,
} = {}) {
  const fresh =
    authCache.state &&
    Date.now() - authCache.checkedAt < AUTH_CACHE_MS;

  if (!force && fresh) {
    return authCache.state;
  }

  try {
    const me = await cloudMe();

    authCache = {
      checkedAt: Date.now(),
      state: {
        authenticated: !!me?.authenticated,
        me,
        error: '',
      },
    };
  } catch (err) {
    console.warn('[YANTA Chat] Cloud auth check failed', err);
    toast('Could not verify YANTA Cloud login.', 'error');

    authCache = {
      checkedAt: Date.now(),
      state: {
        authenticated: false,
        me: null,
        error: err?.message || String(err),
      },
    };
  }

  return authCache.state;
}

/**
 * Requires an active YANTA Cloud login before Chat registration.
 */
export async function requireChatCloudAuth() {
  const auth = await getChatCloudAuthState({
    force: true,
  });

  if (auth.authenticated) return auth;

  const err = new Error('Sign in to YANTA Cloud to use Chat.');
  err.code = 'EAUTH_REQUIRED';
  err.status = 401;
  err.auth = auth;

  throw err;
}

/**
 * Returns true when an error means Cloud login is required.
 */
export function isChatAuthRequiredError(err) {
  return (
    err?.code === 'EAUTH_REQUIRED' ||
    err?.status === 401 ||
    /sign in to yanta cloud/i.test(err?.message || '')
  );
}

/**
 * Opens the shared YANTA Cloud login/setup UI for Chat.
 */
export async function openYantaCloudLoginForChat() {
  const mod = await import('../sync2/yanta-cloud-setup-ui.js');

  await mod.openYantaCloudSetup();

  authCache = {
    checkedAt: 0,
    state: null,
  };
}