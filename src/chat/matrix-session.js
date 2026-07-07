// ============================================================
// YANTA Chat — Matrix session runtime
//
// UI layers must never listen to Matrix SDK events directly.
// We re-emit app-level events on window, same philosophy as
// yanta-note-updated:
//
// - yanta-chat-ready
// - yanta-chat-sync-state
// - yanta-chat-room-updated { roomId }
// - yanta-chat-message { roomId, eventId }
// ============================================================

import {
  toast,
} from '../core.js';

import {
  chatAccount,
} from './chat-api.js';

import {
  getChatCredentials,
  setChatCredentials,
  clearChatCredentials,
} from './chat-store.js';

import {
  bootstrapChatCrypto,
  ingestChatAccountSecrets,
  readChatPasswordFromVault,
} from './matrix-crypto.js';

let matrixLoadPromise = null;
let activeSession = null;
let startPromise = null;
let stopPromise = null;
let unknownTokenRetryInFlight = false;

const MATRIX_STORE_DB = 'yanta-chat-matrix-sdk';
const INITIAL_SYNC_LIMIT = 30;

function reportSessionError(message, err) {
  console.warn('[YANTA Chat Session]', err);
  toast(message || 'Chat connection failed', 'error');
}

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, {
    detail: {
      ts: Date.now(),
      ...detail,
    },
  }));
}

function idle(fn) {
  if ('requestIdleCallback' in window) {
    return requestIdleCallback(fn, {
      timeout: 2500,
    });
  }

  return setTimeout(fn, 250);
}

function normalizeHomeserverUrl(raw = '') {
  const value = String(raw || '').trim();

  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, '');

  return `https://${value.replace(/^\/+|\/+$/g, '')}`;
}

function homeserverFromUserId(userId = '') {
  const m = String(userId || '').match(/^@[^:]+:(.+)$/);
  if (!m) return '';

  return `https://${m[1]}`;
}

function firstString(...values) {
  for (const value of values) {
    const s = String(value ?? '').trim();
    if (s) return s;
  }

  return '';
}

function normalizeAccount(account = {}) {
  const matrix = account.matrix || {};
  const credentials = account.credentials || {};
  const login = account.login || {};

  const userId = firstString(
    account.userId,
    account.user_id,
    account.matrixUserId,
    account.matrix_user_id,
    account.mxid,
    account.mx_id,
    matrix.userId,
    matrix.user_id,
    matrix.mxid,
    credentials.userId,
    credentials.user_id,
    login.userId,
    login.user_id
  );

  const homeserverUrl = normalizeHomeserverUrl(firstString(
    account.homeserverUrl,
    account.homeserver_url,
    account.baseUrl,
    account.base_url,
    account.matrixHomeserverUrl,
    account.matrix_homeserver_url,
    account.matrixBaseUrl,
    account.matrix_base_url,
    matrix.homeserverUrl,
    matrix.homeserver_url,
    matrix.baseUrl,
    matrix.base_url,
    matrix.server,
    matrix.serverUrl,
    matrix.server_url,
    credentials.homeserverUrl,
    credentials.homeserver_url,
    credentials.baseUrl,
    credentials.base_url,
    login.homeserverUrl,
    login.homeserver_url,
    import.meta.env.VITE_YANTA_MATRIX_HOMESERVER_URL,
    homeserverFromUserId(userId)
  ));

  const password = firstString(
    account.password,
    account.matrixPassword,
    account.matrix_password,
    account.loginPassword,
    account.login_password,
    matrix.password,
    matrix.matrixPassword,
    matrix.matrix_password,
    matrix.loginPassword,
    matrix.login_password,
    credentials.password,
    credentials.matrixPassword,
    credentials.matrix_password,
    login.password,
    login.matrixPassword,
    login.matrix_password
  );

  const accessToken = firstString(
    account.accessToken,
    account.access_token,
    account.matrixAccessToken,
    account.matrix_access_token,
    matrix.accessToken,
    matrix.access_token,
    credentials.accessToken,
    credentials.access_token,
    login.accessToken,
    login.access_token
  );

  const deviceId = firstString(
    account.deviceId,
    account.device_id,
    account.matrixDeviceId,
    account.matrix_device_id,
    matrix.deviceId,
    matrix.device_id,
    credentials.deviceId,
    credentials.device_id,
    login.deviceId,
    login.device_id
  );

  return {
    homeserverUrl,
    userId,
    password,
    accessToken,
    deviceId,
  };
}

function isPreparedSyncState(sdk, state) {
  const prepared = sdk.SyncState?.Prepared || 'PREPARED';
  return state === prepared || String(state).toUpperCase() === 'PREPARED';
}

function isUnknownTokenError(err) {
  return (
    err?.errcode === 'M_UNKNOWN_TOKEN' ||
    err?.data?.errcode === 'M_UNKNOWN_TOKEN' ||
    err?.httpStatus === 401 ||
    err?.statusCode === 401 ||
    /M_UNKNOWN_TOKEN|unknown token/i.test(err?.message || '')
  );
}

function eventIdOf(ev) {
  return ev?.getId?.() || ev?.event?.event_id || ev?.event_id || '';
}

function roomIdOf(room, ev) {
  return (
    room?.roomId ||
    ev?.getRoomId?.() ||
    ev?.event?.room_id ||
    ev?.room_id ||
    ''
  );
}

function messageTypeOf(ev) {
  return ev?.getType?.() || ev?.event?.type || ev?.type || '';
}

function isTimelineLiveEvent(sdk, data = {}) {
  if (data.liveEvent === true) return true;

  const eventTimeline = sdk.EventTimeline || {};
  return !data.toStartOfTimeline && data.timeline !== eventTimeline.BACKWARDS;
}

/**
 * Dynamically loads matrix-js-sdk and initializes Rust crypto WASM once.
 */
export async function ensureMatrixLoaded() {
  if (matrixLoadPromise) return matrixLoadPromise;

  matrixLoadPromise = (async () => {
    try {
      const [
        sdkMod,
        wasmMod,
      ] = await Promise.all([
        import('matrix-js-sdk'),
        import('@matrix-org/matrix-sdk-crypto-wasm'),
      ]);

      const sdk = sdkMod.default || sdkMod;
      const wasm = wasmMod.default || wasmMod;

      const initWasm =
        typeof wasm === 'function'
          ? wasm
          : wasm?.initAsync || wasm?.init || null;

      if (typeof initWasm === 'function') {
        try {
          await initWasm();
        } catch (err) {
          // Some bundlers/SDK versions initialize WASM internally.
          if (!/already initialized|initialized already/i.test(err?.message || '')) {
            throw err;
          }
        }
      }

      if (typeof sdk.initRustCrypto === 'function') {
        await sdk.initRustCrypto();
      }

      return {
        sdk,
      };
    } catch (err) {
      matrixLoadPromise = null;
      reportSessionError('Could not load Chat encryption.', err);
      throw err;
    }
  })();

  return matrixLoadPromise;
}

async function createMatrixSdkStore(sdk) {
  if (!sdk.IndexedDBStore) return null;

  const matrixStore = new sdk.IndexedDBStore({
    indexedDB: window.indexedDB,
    dbName: MATRIX_STORE_DB,

    /*
      Intentionally no localStorage for secrets.
      Matrix room/timeline state is persisted in IndexedDB.
    */
  });

  if (typeof matrixStore.startup === 'function') {
    await matrixStore.startup();
  }

  return matrixStore;
}

function createClientFromCredentials(sdk, credentials, matrixStore) {
  return sdk.createClient({
    baseUrl: credentials.homeserverUrl,
    userId: credentials.userId,
    accessToken: credentials.accessToken,
    deviceId: credentials.deviceId,
    store: matrixStore || undefined,
    timelineSupport: true,
    useAuthorizationHeader: true,
  });
}

async function initClientCrypto(client) {
  if (typeof client.initRustCrypto === 'function') {
    await client.initRustCrypto();
    return true;
  }

  const cryptoApi = client.getCrypto?.() || client.crypto;
  if (cryptoApi) return true;

  throw new Error('Matrix Rust crypto is not available');
}

async function loginWithVaultPassword({
  sdk,
  account = null,
} = {}) {
  const input = normalizeAccount(account || {});
  const vaultAccount = await readChatPasswordFromVault();

  const userId =
    input.userId ||
    vaultAccount?.userId ||
    '';

  const homeserverUrl = normalizeHomeserverUrl(
    input.homeserverUrl ||
    vaultAccount?.homeserverUrl ||
    homeserverFromUserId(userId)
  );

  const password =
    input.password ||
    vaultAccount?.password ||
    '';

  if (!homeserverUrl || !userId || !password) {
    const err = new Error(
      'Chat account is not ready on this device yet. Missing Matrix login secret in local credentials and Vault.'
    );

    err.code = 'ECHAT_NOT_READY';
    err.missing = {
      homeserverUrl: !homeserverUrl,
      userId: !userId,
      password: !password,
    };

    throw err;
  }

  const loginClient = sdk.createClient({
    baseUrl: homeserverUrl,
    timelineSupport: true,
  });

  const res = await loginClient.loginRequest({
    type: 'm.login.password',
    identifier: {
      type: 'm.id.user',
      user: userId,
    },
    user: userId,
    password,
    initial_device_display_name: 'YANTA',
  });

  const credentials = {
    homeserverUrl,
    userId: res?.user_id || userId,
    deviceId: res?.device_id || '',
    accessToken: res?.access_token || '',
  };

  await setChatCredentials(credentials);

  return {
    credentials,
    password,
  };
}

function wireLifecycleEvents({
  sdk,
  client,
  sessionId,
}) {
  const listeners = [];

  const on = (target, eventName, fn) => {
    target.on(eventName, fn);
    listeners.push(() => {
      try {
        target.removeListener(eventName, fn);
      } catch {}
    });
  };

  const clientEvents = sdk.ClientEvent || {};
  const roomEvents = sdk.RoomEvent || {};

  const syncEvent = clientEvents.Sync || 'sync';
  const roomEvent = clientEvents.Room || 'Room';
  const timelineEvent = roomEvents.Timeline || 'Room.timeline';
  const receiptEvent = roomEvents.Receipt || 'Room.receipt';
  const nameEvent = roomEvents.Name || 'Room.name';
  const tagsEvent = roomEvents.Tags || 'Room.tags';

  let readyEmitted = false;

  on(client, syncEvent, async (state, prevState, data = {}) => {
    emit('yanta-chat-sync-state', {
      state,
      prevState,
      error: data?.error?.message || '',
    });

    if (isPreparedSyncState(sdk, state) && !readyEmitted) {
      readyEmitted = true;

      emit('yanta-chat-ready', {
        sessionId,
        userId: client.getUserId?.() || '',
        deviceId: client.getDeviceId?.() || '',
      });
    }

    if (data?.error && isUnknownTokenError(data.error)) {
      await handleUnknownToken({
        reason: 'sync',
        error: data.error,
      });
    }
  });

  on(client, roomEvent, (room) => {
    if (!room?.roomId) return;

    emit('yanta-chat-room-updated', {
      roomId: room.roomId,
      reason: 'room',
    });
  });

  on(client, timelineEvent, (ev, room, toStartOfTimeline, removed, data = {}) => {
    const type = messageTypeOf(ev);
    const roomId = roomIdOf(room, ev);
    const eventId = eventIdOf(ev);

    if (!roomId) return;

    emit('yanta-chat-room-updated', {
      roomId,
      reason: 'timeline',
    });

    if (
      eventId &&
      isTimelineLiveEvent(sdk, {
        ...data,
        toStartOfTimeline,
      }) &&
      (
        type === 'm.room.message' ||
        type === 'm.room.encrypted' ||
        type === 'm.sticker'
      )
    ) {
      emit('yanta-chat-message', {
        roomId,
        eventId,
        type,
      });
    }
  });

  for (const evName of [
    receiptEvent,
    nameEvent,
    tagsEvent,
  ]) {
    on(client, evName, (_event, room) => {
      const roomId = room?.roomId || '';
      if (!roomId) return;

      emit('yanta-chat-room-updated', {
        roomId,
        reason: evName,
      });
    });
  }

  return () => {
    for (const off of listeners.splice(0)) {
      off();
    }
  };
}

async function handleUnknownToken({
  reason = 'unknown-token',
  error = null,
} = {}) {
  if (unknownTokenRetryInFlight) return;

  unknownTokenRetryInFlight = true;

  try {
    console.warn('[YANTA Chat Session] Matrix token expired, trying silent re-login', {
      reason,
      errcode: error?.errcode,
    });

    await clearChatCredentials();
    await stopChatSession({
      silent: true,
    });

    await startChatSession({
      forceLogin: true,
      autoRetry: false,
      reason: 'unknown-token-retry',
    });
  } catch (err) {
    reportSessionError('Chat needs to reconnect.', err);

    emit('yanta-chat-crypto-degraded', {
      message: 'Reconnect Chat',
      step: 'unknown-token-retry',
      error: err?.message || String(err),
    });
  } finally {
    unknownTokenRetryInFlight = false;
  }
}

/**
 * Starts or resumes the Matrix Chat session.
 *
 * Flow:
 * 1. Use local encrypted credentials when available.
 * 2. Otherwise login via Vault-synced Matrix password.
 * 3. Create Matrix client with IndexedDBStore + timelineSupport.
 * 4. initRustCrypto(), bootstrapChatCrypto(), startClient().
 */
export async function startChatSession({
  account = null,
  firstDevice = false,
  forceLogin = false,
  autoRetry = true,
  reason = 'manual',
} = {}) {
  if (startPromise && !forceLogin) return startPromise;
  if (activeSession && !forceLogin) return activeSession;

  startPromise = (async () => {
    try {
      const { sdk } = await ensureMatrixLoaded();

      if (forceLogin && activeSession) {
        await stopChatSession({
          silent: true,
        });
      }

      const normalizedAccount = normalizeAccount(account || {});

      if (normalizedAccount.password && normalizedAccount.userId) {
        await ingestChatAccountSecrets(normalizedAccount);
      }

      let credentials = !forceLogin
        ? await getChatCredentials()
        : null;

      if (!credentials) {
        const login = await loginWithVaultPassword({
          sdk,
          account: normalizedAccount,
        });

        credentials = login.credentials;
      }

      const matrixStore = await createMatrixSdkStore(sdk);
      const client = createClientFromCredentials(sdk, credentials, matrixStore);

      await initClientCrypto(client);

      const sessionId = `${credentials.userId}:${credentials.deviceId}:${Date.now()}`;

      const unwire = wireLifecycleEvents({
        sdk,
        client,
        sessionId,
      });

      const cryptoResult = await bootstrapChatCrypto(client, {
        firstDevice,
        account: normalizedAccount,
      });

      await client.startClient({
        initialSyncLimit: INITIAL_SYNC_LIMIT,
      });

      activeSession = {
        sdk,
        client,
        store: matrixStore,
        sessionId,
        credentials,
        startedAt: Date.now(),
        crypto: cryptoResult,
        unwire,

        /**
         * Stops this Chat session.
         */
        async stop() {
          return stopChatSession();
        },
      };

      window.yantaMatrixClient = client;
      window.yantaChatSession = activeSession;

      emit('yanta-chat-sync-state', {
        state: 'STARTED',
        reason,
      });

      return activeSession;
    } catch (err) {
      activeSession = null;

      if (autoRetry && isUnknownTokenError(err)) {
        console.warn('[YANTA Chat Session] local token rejected, retrying with Vault password', err);

        await clearChatCredentials();

        return startChatSession({
          account,
          firstDevice: false,
          forceLogin: true,
          autoRetry: false,
          reason: 'unknown-token-start-retry',
        });
      }

      reportSessionError('Could not start Chat.', err);

      emit('yanta-chat-crypto-degraded', {
        message: 'Chat could not connect.',
        step: 'start-session',
        error: err?.message || String(err),
      });

      throw err;
    } finally {
      startPromise = null;
    }
  })();

  return startPromise;
}

/**
 * Stops the active Matrix Chat session and unregisters SDK listeners.
 */
export async function stopChatSession({
  silent = false,
} = {}) {
  if (stopPromise) return stopPromise;

  stopPromise = (async () => {
    const session = activeSession;
    activeSession = null;

    if (!session) return true;

    try {
      session.unwire?.();

      if (typeof session.client?.stopClient === 'function') {
        session.client.stopClient();
      }

      if (typeof session.store?.destroy === 'function') {
        await session.store.destroy();
      }

      if (window.yantaMatrixClient === session.client) {
        window.yantaMatrixClient = null;
      }

      if (window.yantaChatSession === session) {
        window.yantaChatSession = null;
      }

      emit('yanta-chat-sync-state', {
        state: 'STOPPED',
      });

      return true;
    } catch (err) {
      if (!silent) {
        reportSessionError('Could not stop Chat cleanly.', err);
      } else {
        console.warn('[YANTA Chat Session] stop failed', err);
      }

      return false;
    } finally {
      stopPromise = null;
    }
  })();

  return stopPromise;
}

/**
 * Returns the current active Chat session, if any.
 */
export function getChatSession() {
  return activeSession;
}

/**
 * Returns true when a Matrix Chat session is currently active.
 */
export function isChatSessionStarted() {
  return !!activeSession?.client;
}

/**
 * Starts Chat in browser idle time when local credentials exist.
 */
export function scheduleChatAutoResume() {
  idle(async () => {
    try {
      const { hasEncryptedChatCredentials } = await import('./chat-store.js');

      if (!await hasEncryptedChatCredentials()) return;

      await startChatSession({
        reason: 'auto-resume',
      });
    } catch (err) {
      reportSessionError('Could not resume Chat.', err);
    }
  });
}

/**
 * Convenience hook for AP2 onboarding events.
 */
export function installChatAccountReadyListener() {
  window.addEventListener('yanta-chat-account-ready', (e) => {
    const detail = e.detail || {};

    startChatSession({
      account: detail.account || null,
      firstDevice: detail.source === 'chat-provision',
      reason: detail.source || 'chat-account-ready',
    }).catch((err) => {
      reportSessionError('Could not open Chat.', err);
    });
  });
}

/**
 * Ensures account metadata exists, then starts Chat.
 *
 * Useful for buttons/command palette actions that want “open Chat” behavior
 * without importing onboarding UI at startup.
 */
export async function ensureChatSessionAndOpen(options = {}) {
  try {
    let account = options.account || null;

    if (!account) {
      const res = await chatAccount();
      account = res?.account || res || null;
    }

    return startChatSession({
      account,
      firstDevice: false,
      reason: options.reason || 'open-chat',
    });
  } catch (err) {
    reportSessionError('Could not open Chat.', err);
    throw err;
  }
}