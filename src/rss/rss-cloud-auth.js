// ============================================================
// YANTA Sources / RSS — Cloud auth gate
// ============================================================

import {
  cloudMe,
} from '../cloud/cloud-api.js';

let authCache = {
  checkedAt: 0,
  state: null,
};

const AUTH_CACHE_MS = 30_000;

export async function getRssCloudAuthState({
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

export async function requireRssCloudAuth() {
  const auth = await getRssCloudAuthState({
    force: true,
  });

  if (auth.authenticated) return auth;

  const err = new Error('Sign in to YANTA Cloud to use Sources.');
  err.code = 'EAUTH_REQUIRED';
  err.status = 401;
  err.auth = auth;

  throw err;
}

export function isRssAuthRequiredError(err) {
  return (
    err?.code === 'EAUTH_REQUIRED' ||
    err?.status === 401 ||
    /sign in to yanta cloud/i.test(err?.message || '')
  );
}

export async function openYantaCloudLoginForSources() {
  const mod = await import('../sync2/yanta-cloud-setup-ui.js');

  await mod.openYantaCloudSetup();

  authCache = {
    checkedAt: 0,
    state: null,
  };
}