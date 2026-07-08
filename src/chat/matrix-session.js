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
  createChatSecretStorageCallbacks,
  installSecretStorageCallbacks,
  hasVaultChatAccount,
  finalizeChatCryptoAfterSync,
} from './matrix-crypto.js';

import {
  waitForVaultDoc,
  vaultSettingsMap,
} from '../sync2/vault-doc.js';

let matrixLoadPromise = null;
let activeSession = null;
let startPromise = null;
let stopPromise = null;
let unknownTokenRetryInFlight = false;

const MATRIX_STORE_DB_PREFIX = 'yanta-chat-matrix-sdk';
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

function isMatrixCryptoStoreMismatchError(err) {
  return /account in the store doesn't match the account in the constructor/i.test(
    err?.message || String(err || '')
  );
}

function safeDbPart(value = '') {
  return String(value || '')
    .replace(/^@/, '')
    .replace(/[^a-z0-9._-]+/gi, '_')
    .slice(0, 80) || 'unknown';
}

function matrixStoreDbName(credentials = {}) {
  /*
    Matrix local timeline state should be scoped by Matrix user + device.
    Warum: Rust crypto stores are device-bound. Reusing one IndexedDB name
    across freshly logged-in Matrix devices can make initRustCrypto fail with
    “account in the store doesn't match”.
  */
  return [
    MATRIX_STORE_DB_PREFIX,
    safeDbPart(credentials.userId),
    safeDbPart(credentials.deviceId),
  ].join('.');
}

function deleteIndexedDatabase(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);

    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error(`Could not delete IndexedDB ${name}`));

    req.onblocked = () => {
      console.warn('[YANTA Chat Session] IndexedDB delete blocked', name);
      resolve(false);
    };
  });
}

/**
 * Clears Matrix SDK local stores after a Matrix device/account mismatch.
 *
 * This does not touch YANTA notes/Vault data. It only removes Matrix SDK local
 * caches/crypto state so the current device can initialize a fresh crypto store.
 */
export async function clearChatMatrixLocalStoresForDebugOnly() {
  try {
    const dbs = typeof indexedDB.databases === 'function'
      ? await indexedDB.databases()
      : [];

    const names = dbs
      .map((db) => db.name)
      .filter(Boolean)
      .filter((name) => {
        const n = String(name || '');

        if (n === 'yanta-chat') return false;

        return (
          n === MATRIX_STORE_DB_PREFIX ||
          n.startsWith(`${MATRIX_STORE_DB_PREFIX}.`) ||

          // Matrix JS SDK default stores.
          n.startsWith('matrix-js-sdk') ||
          n.startsWith('matrix_js_sdk') ||

          // Rust/WASM crypto store variants used by Matrix SDK builds.
          n.includes('matrix-sdk') ||
          n.includes('matrix_sdk') ||
          n.includes('matrix-rust') ||
          n.includes('matrix_rust')
        );
      });

    for (const name of names) {
      await deleteIndexedDatabase(name);
    }

    return {
      cleared: names,
    };
  } catch (err) {
    reportSessionError('Could not reset local Chat crypto storage.', err);
    throw err;
  }
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

function createMatrixSdkStore(sdk, credentials = {}) {
  if (!sdk.IndexedDBStore) return null;

  return new sdk.IndexedDBStore({
    indexedDB: window.indexedDB,
    dbName: matrixStoreDbName(credentials),

    /*
      Intentionally no localStorage for secrets.
      Matrix room/timeline state is persisted in IndexedDB.

      Wichtig:
      matrix-js-sdk prefixes this internally, e.g.
      matrix-js-sdk:yanta-chat-matrix-sdk.<user>.<device>

      Warum:
      IndexedDBStore.startup() MUST run after the store was assigned to the
      Matrix client via createClient({ store }). New SDK builds enforce this.
    */
  });
}

async function startupMatrixSdkStore(matrixStore) {
  if (!matrixStore) return false;

  if (typeof matrixStore.startup !== 'function') {
    return false;
  }

  await matrixStore.startup();
  return true;
}

function matrixCryptoStorePrefix(credentials = {}) {
  /*
    Critical:
    Matrix Rust crypto stores are bound to exactly one Matrix user+device.
    The timeline store dbName alone is not enough; Rust crypto also needs a
    device-scoped prefix. Otherwise password re-login creates a new device,
    but initRustCrypto() opens the old default crypto store and fails with:
    “the account in the store doesn't match the account in the constructor”.
  */
  return [
    MATRIX_STORE_DB_PREFIX,
    'crypto',
    safeDbPart(credentials.userId),
    safeDbPart(credentials.deviceId),
  ].join('.');
}

function createClientFromCredentials(sdk, credentials, matrixStore) {
  const cryptoCallbacks = createChatSecretStorageCallbacks();

  const client = sdk.createClient({
    baseUrl: credentials.homeserverUrl,
    userId: credentials.userId,
    accessToken: credentials.accessToken,
    deviceId: credentials.deviceId,
    store: matrixStore || undefined,

    // Rust crypto / Matrix SDK crypto store isolation.
    cryptoStorePrefix: matrixCryptoStorePrefix(credentials),

    /*
      Critical:
      Provide Secret Storage callbacks at client construction time. Some
      matrix-js-sdk builds copy callbacks into SecretStorage during createClient
      and do not fully pick up later setCryptoCallbacks() calls.
    */
    cryptoCallbacks,

    timelineSupport: true,
    useAuthorizationHeader: true,
  });

  installSecretStorageCallbacks(client);

  return client;
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

      let matrixStore = createMatrixSdkStore(sdk, credentials);
      let client = createClientFromCredentials(sdk, credentials, matrixStore);

      await startupMatrixSdkStore(matrixStore);

      installSecretStorageCallbacks(client);

      try {
        await initClientCrypto(client);
      } catch (err) {
        if (!isMatrixCryptoStoreMismatchError(err)) {
          throw err;
        }

        /*
          Rust crypto stores are bound to one Matrix user+device identity.
          If password login creates a new Matrix device, the old default
          crypto store can block startup. Reset Matrix SDK local stores and
          retry once with device-scoped store names.
        */
        console.warn(
          '[YANTA Chat Session] Matrix crypto store/device mismatch; resetting local Matrix stores',
          err
        );

        try {
          matrixStore?.destroy?.();
        } catch {}

        await clearChatMatrixLocalStoresForDebugOnly();

        matrixStore = createMatrixSdkStore(sdk, credentials);
        client = createClientFromCredentials(sdk, credentials, matrixStore);

        await startupMatrixSdkStore(matrixStore);

        installSecretStorageCallbacks(client);

        await initClientCrypto(client);
      }

      const sessionId = `${credentials.userId}:${credentials.deviceId}:${Date.now()}`;

      const unwire = wireLifecycleEvents({
        sdk,
        client,
        sessionId,
      });

      const cryptoBootstrapResult = await bootstrapChatCrypto(client, {
        firstDevice,
        account: normalizedAccount,
      });

      /*
        Publish the client before startClient().
        Why:
        Matrix sync events can fire immediately. UI/listeners should already be
        able to resolve the active client while crypto finalization continues.
      */
      activeSession = {
        sdk,
        client,
        store: matrixStore,
        sessionId,
        credentials,
        startedAt: Date.now(),
        crypto: {
          bootstrap: cryptoBootstrapResult,
          keyBackup: null,
        },
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

      await client.startClient({
        initialSyncLimit: INITIAL_SYNC_LIMIT,
      });

      /*
        Critical for multi-device old-message decryption:
        Key Backup must be finalized after initial sync reached PREPARED.
        Doing this before startClient() can make the SDK miss backup account
        data and old messages show "sent before this device logged in".
      */
      const keyBackupResult = await finalizeChatCryptoAfterSync(client, {
        sdk,
        firstDevice,
        timeoutMs: 25_000,
      });

      activeSession.crypto = {
        bootstrap: cryptoBootstrapResult,
        keyBackup: keyBackupResult,
      };

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
const CHAT_AUTO_RESUME_BACKOFF_MS = 30_000;

let chatAutoResumeInstalled = false;
let chatAutoResumeTimer = 0;
let chatAutoResumeRunning = false;
let chatAutoResumeBackoffUntil = 0;
let unobserveChatAccount = null;

function isChatPendingError(err) {
  return err?.code === 'ECHAT_NOT_READY';
}

function requestChatAutoResume(reason = 'auto-resume', delay = 500) {
  clearTimeout(chatAutoResumeTimer);

  const waitMs = Math.max(
    Number(delay || 0),
    Math.max(0, chatAutoResumeBackoffUntil - Date.now())
  );

  chatAutoResumeTimer = window.setTimeout(() => {
    runChatAutoResume(reason).catch((err) => {
      console.warn('[YANTA Chat Session] auto-resume runner failed', err);
      toast('Could not resume Chat.', 'error');
    });
  }, waitMs);
}

async function hasAnyChatResumeSignal() {
  await waitForVaultDoc();

  const { hasEncryptedChatCredentials } = await import('./chat-store.js');

  const hasLocalCredentials = await hasEncryptedChatCredentials();
  const hasVaultAccount = hasVaultChatAccount();

  return {
    hasLocalCredentials,
    hasVaultAccount,
    any: hasLocalCredentials || hasVaultAccount,
  };
}

async function runChatAutoResume(reason = 'auto-resume') {
  if (activeSession?.client || startPromise || chatAutoResumeRunning) {
    return activeSession;
  }

  if (Date.now() < chatAutoResumeBackoffUntil) {
    requestChatAutoResume(reason, chatAutoResumeBackoffUntil - Date.now());
    return null;
  }

  chatAutoResumeRunning = true;

  try {
    const signal = await hasAnyChatResumeSignal();

    if (!signal.any) {
      return null;
    }

    /*
      Why:
      Local Matrix credentials are device-specific. On a new synced device they
      are intentionally absent. A Vault Chat account means we should create a
      fresh Matrix device by password login, then restore crypto from Vault.
    */
    return await startChatSession({
      reason,
    });
  } catch (err) {
    if (isChatPendingError(err)) {
      // Not an error: Sync2 may not have delivered chatAccount yet.
      console.info('[YANTA Chat Session] Chat account not ready yet:', reason);
      return null;
    }

    chatAutoResumeBackoffUntil = Date.now() + CHAT_AUTO_RESUME_BACKOFF_MS;

    reportSessionError('Could not resume Chat.', err);

    return null;
  } finally {
    chatAutoResumeRunning = false;
  }
}

function installChatAutoResumeWatchers() {
  if (chatAutoResumeInstalled) return;

  chatAutoResumeInstalled = true;

  waitForVaultDoc()
    .then(() => {
      const settings = vaultSettingsMap();

      const handler = (event) => {
        if (!event?.keysChanged?.has?.('chatAccount')) return;

        requestChatAutoResume('vault-chat-account-ready', 200);
      };

      settings.observe(handler);

      unobserveChatAccount = () => {
        try {
          settings.unobserve(handler);
        } catch {}
      };

      if (hasVaultChatAccount()) {
        requestChatAutoResume('vault-chat-account-present', 200);
      }
    })
    .catch((err) => {
      console.warn('[YANTA Chat Session] could not watch Vault Chat account', err);
      toast('Could not watch Chat account sync.', 'error');
    });

  window.addEventListener('yanta-vault-hydrated', () => {
    requestChatAutoResume('vault-hydrated', 600);
  });

  window.addEventListener('yanta-sync2-runtime-ready', () => {
    requestChatAutoResume('sync2-runtime-ready', 1200);
  });

  window.addEventListener('online', () => {
    requestChatAutoResume('online', 1000);
  });

  window.addEventListener('focus', () => {
    requestChatAutoResume('focus', 1000);
  });
}

/**
 * Starts Chat in browser idle time when local credentials or a Vault-synced
 * Chat account exist.
 */
export function scheduleChatAutoResume({
  delay = 800,
} = {}) {
  installChatAutoResumeWatchers();

  idle(() => {
    requestChatAutoResume('auto-resume', delay);
  });
}

/**
 * Stops the Chat auto-resume watcher.
 */
export function stopChatAutoResumeForDebugOnly() {
  clearTimeout(chatAutoResumeTimer);
  chatAutoResumeTimer = 0;

  if (unobserveChatAccount) {
    unobserveChatAccount();
    unobserveChatAccount = null;
  }

  chatAutoResumeInstalled = false;
  chatAutoResumeRunning = false;
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
 * Repairs Matrix encryption backup for this device.
 *
 * Use this on an existing device that can still decrypt old messages. It will
 * create/enable Matrix Key Backup and upload locally known room keys so newly
 * added devices can restore historical messages.
 */
export async function repairChatEncryptionBackupNow({
  reason = 'manual-key-backup-repair',
} = {}) {
  try {
    const session =
      activeSession ||
      await startChatSession({
        reason,
      });

    if (!session?.client) {
      throw new Error('Chat session is not connected.');
    }

    const result = await finalizeChatCryptoAfterSync(session.client, {
      sdk: session.sdk,
      firstDevice: false,
      timeoutMs: 30_000,
    });

    session.crypto = {
      ...(session.crypto || {}),
      keyBackup: result,
    };

    if (result.ok) {
      toast('Chat encryption keys repaired.', 'success');
    } else {
      toast('Chat encryption repair finished with warnings.', 'error');
    }

    return result;
  } catch (err) {
    reportSessionError('Could not repair Chat encryption keys.', err);
    throw err;
  }
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