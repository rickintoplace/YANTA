// ============================================================
// YANTA Chat — Matrix crypto/session bootstrap (S2)
//
// Goal:
// - No passphrase.
// - No visible password.
// - Multi-device out of the box.
// - Secrets are carried by the existing Sync2 Vault security model.
//
// Secret inventory:
//
// Matrix password:
//   vaultSettingsMap().set('chatAccount', { userId, passwordEnc })
//   passwordEnc = encryptBytes(contentKey, pw, 'yanta-chat-password-v1')
//   synced: yes (VaultDoc)
//
// Access token + deviceId:
//   store.settings chat.credentials.enc
//   encrypted with Sync2 contentKey
//   synced: no, device-local only
//
// 4S recovery key:
//   vaultSettingsMap().set('chatRecovery', { keyEnc })
//   AAD 'yanta-chat-recovery-v1'
//   synced: yes (VaultDoc)
//
// Therefore: whoever owns the YANTA Vault Sync Key owns Chat.
// This is consistent with the rest of the YANTA security model.
// ============================================================

import {
  toast,
} from '../core.js';

import {
  deriveKeys,
  encryptBytes,
  decryptBytes,
  utf8Encode,
  utf8Decode,
  base64UrlEncode,
  base64UrlDecode,
  randomBytes,
} from '../sync2/crypto.js';

import {
  getSync2SyncKey,
} from '../sync2/app-engine.js';

import {
  getVaultDoc,
  vaultSettingsMap,
  safeJsonClone,
} from '../sync2/vault-doc.js';

const CHAT_ACCOUNT_KEY = 'chatAccount';
const CHAT_RECOVERY_KEY = 'chatRecovery';

const CHAT_ROOM_KEYS_KEY = 'chatRoomKeys';
const ROOM_KEYS_AAD = 'yanta-chat-room-keys-v1';

const PASSWORD_AAD = 'yanta-chat-password-v1';
const RECOVERY_AAD = 'yanta-chat-recovery-v1';

const CHAT_CRYPTO_ORIGIN = 'yanta-chat-crypto';

let degradedToastAt = 0;

function reportCryptoError(message, err, detail = {}) {
  console.warn('[YANTA Chat Crypto]', message, err);

  /*
    Crypto setup can legitimately take time during startup / first sync.
    Do not show a toast on every app start. The non-blocking Chat banner is
    enough and can be dismissed by the user.
  */
  window.dispatchEvent(new CustomEvent('yanta-chat-crypto-degraded', {
    detail: {
      message: message || 'Chat encryption is being set up…',
      error: err?.message || String(err || ''),
      ts: Date.now(),
      ...detail,
    },
  }));
}

async function contentKeyForVaultChatSecrets() {
  const syncKey = await getSync2SyncKey();
  const keys = await deriveKeys(syncKey);

  return keys.contentKey;
}

function setVaultSetting(key, value) {
  const doc = getVaultDoc();

  doc.transact(() => {
    vaultSettingsMap().set(String(key), safeJsonClone(value));
  }, CHAT_CRYPTO_ORIGIN);
}

function getCryptoApi(client) {
  return client?.getCrypto?.() || client?.crypto || null;
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

  const homeserverUrl = firstString(
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
    import.meta.env.VITE_YANTA_MATRIX_HOMESERVER_URL
  );

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

  return {
    userId,
    homeserverUrl,
    password,
  };
}

function serializeRecoveryMaterial(material) {
  if (!material) return null;

  const forSdk = material.forSdk ?? material;

  if (typeof forSdk === 'string') {
    return {
      kind: 'encoded',
      encodedPrivateKey: forSdk,
    };
  }

  if (forSdk instanceof Uint8Array) {
    return {
      kind: 'raw',
      privateKeyB64: base64UrlEncode(forSdk),
    };
  }

  if (Array.isArray(forSdk)) {
    return {
      kind: 'tuple',
      keyId: forSdk[0] || '',
      privateKeyB64: forSdk[1] instanceof Uint8Array ? base64UrlEncode(forSdk[1]) : '',
      encodedPrivateKey: typeof forSdk[1] === 'string' ? forSdk[1] : '',
      raw: safeJsonClone(forSdk),
    };
  }

  if (typeof forSdk === 'object') {
    return {
      kind: 'object',
      keyId: forSdk.keyId || forSdk.id || '',
      keyInfo: forSdk.keyInfo || forSdk.info || null,
      encodedPrivateKey:
        forSdk.encodedPrivateKey ||
        forSdk.recoveryKey ||
        forSdk.encoded ||
        '',
      privateKeyB64:
        forSdk.privateKey instanceof Uint8Array
          ? base64UrlEncode(forSdk.privateKey)
          : '',
      raw: safeJsonClone({
        ...forSdk,
        privateKey: undefined,
      }),
    };
  }

  return {
    kind: 'unknown',
    raw: safeJsonClone(forSdk),
  };
}

async function sdkDecodeRecoveryKey(encodedPrivateKey) {
  if (!encodedPrivateKey) return null;

  try {
    const sdkMod = await import('matrix-js-sdk');
    const sdk = sdkMod.default || sdkMod;

    if (typeof sdk.decodeRecoveryKey === 'function') {
      return sdk.decodeRecoveryKey(encodedPrivateKey);
    }

    if (sdk.crypto?.decodeRecoveryKey) {
      return sdk.crypto.decodeRecoveryKey(encodedPrivateKey);
    }
  } catch (err) {
    console.warn('[YANTA Chat Crypto] could not decode Matrix recovery key through SDK', err);
  }

  return null;
}

async function recoveryMaterialForSdk(record, keys = {}) {
  if (!record || typeof record !== 'object') return null;

  const firstKeyId = record.keyId || Object.keys(keys || {})[0] || '';

  if (record.privateKeyB64) {
    const privateKey = base64UrlDecode(record.privateKeyB64);

    return firstKeyId
      ? [firstKeyId, privateKey]
      : privateKey;
  }

  if (record.encodedPrivateKey) {
    const decoded = await sdkDecodeRecoveryKey(record.encodedPrivateKey);

    if (decoded) {
      return firstKeyId
        ? [firstKeyId, decoded]
        : decoded;
    }

    /*
      Compatibility fallback for SDKs that accept encoded recovery keys.
      New YANTA-created records should prefer privateKeyB64 above.
    */
    return firstKeyId
      ? [firstKeyId, record.encodedPrivateKey]
      : record.encodedPrivateKey;
  }

  if (Array.isArray(record.raw)) {
    return record.raw;
  }

  if (record.raw instanceof Uint8Array) {
    return firstKeyId
      ? [firstKeyId, record.raw]
      : record.raw;
  }

  return record.raw || null;
}

async function chatSecretStorageKeyForSdk(keysOrRequest = {}) {
  const keys =
    keysOrRequest?.keys && typeof keysOrRequest.keys === 'object'
      ? keysOrRequest.keys
      : keysOrRequest;

  const recovery = await readChatRecoveryFromVault();

  if (!recovery) {
    throw new Error('Chat recovery key is not available in this Vault yet');
  }

  const material = await recoveryMaterialForSdk(recovery, keys || {});

  if (!material) {
    throw new Error('Could not prepare Chat recovery key for Matrix Secret Storage');
  }

  return material;
}

/**
 * Installs Matrix SDK Secret Storage callbacks backed by the YANTA Vault.
 *
 * Warum:
 * Some matrix-js-sdk flows call client-level cryptoCallbacks later while
 * exporting cross-signing keys or key-backup secrets. Passing
 * getSecretStorageKey only to bootstrapSecretStorage() is not enough there.
 */
/**
 * Returns Matrix SDK Secret Storage callbacks backed by the YANTA Vault.
 */
export function createChatSecretStorageCallbacks() {
  return {
    getSecretStorageKey: async (keysOrRequest = {}) => {
      return chatSecretStorageKeyForSdk(keysOrRequest);
    },

    cacheSecretStorageKey: async (keyId, keyInfo, privateKey) => {
      if (!privateKey) return;

      try {
        await saveChatRecoveryToVault({
          keyId,
          keyInfo: keyInfo || null,
          privateKey,
        });
      } catch (err) {
        reportCryptoError('Could not cache Chat recovery key in Vault.', err, {
          step: 'cache-secret-storage-key',
        });
      }
    },
  };
}

/**
 * Installs Matrix SDK Secret Storage callbacks backed by the YANTA Vault.
 *
 * Warum:
 * Some matrix-js-sdk flows call SecretStorage's own callbacks later while
 * exporting cross-signing keys or key-backup secrets. Passing callbacks only
 * to one bootstrap call is not enough for all SDK builds.
 */
export function installSecretStorageCallbacks(client) {
  if (!client) return false;

  const callbacks = createChatSecretStorageCallbacks();

  if (typeof client.setCryptoCallbacks === 'function') {
    client.setCryptoCallbacks({
      ...(client.cryptoCallbacks || {}),
      ...callbacks,
    });
  }

  client.cryptoCallbacks = {
    ...(client.cryptoCallbacks || {}),
    ...callbacks,
  };

  /*
    Compatibility with SDK builds where SecretStorage captured callbacks at
    construction time. These are intentionally best-effort private-ish fields.
  */
  for (const target of [
    client.secretStorage,
    client._secretStorage,
    client.secretStorageStore,
  ]) {
    if (!target) continue;

    try {
      if (typeof target.setCryptoCallbacks === 'function') {
        target.setCryptoCallbacks(callbacks);
      }
    } catch {}

    try {
      target.cryptoCallbacks = {
        ...(target.cryptoCallbacks || {}),
        ...callbacks,
      };
    } catch {}

    try {
      target.callbacks = {
        ...(target.callbacks || {}),
        ...callbacks,
      };
    } catch {}
  }

  return true;
}

/**
 * Stores the Matrix account password in the synced Vault, encrypted with the
 * Sync2 contentKey.
 */
export async function saveChatPasswordToVault({
  userId,
  password,
  homeserverUrl = '',
} = {}) {
  if (!userId || !password) return false;

  try {
    const contentKey = await contentKeyForVaultChatSecrets();
    const passwordEnc = await encryptBytes(
      contentKey,
      utf8Encode(password),
      PASSWORD_AAD
    );

    const existing = vaultSettingsMap().get(CHAT_ACCOUNT_KEY) || {};

    setVaultSetting(CHAT_ACCOUNT_KEY, {
      ...safeJsonClone(existing),
      userId: String(userId),
      homeserverUrl: String(homeserverUrl || existing.homeserverUrl || ''),
      passwordEnc: utf8Decode(passwordEnc),
      updatedAt: Date.now(),
    });

    return true;
  } catch (err) {
    reportCryptoError('Could not save Chat password to Vault.', err, {
      step: 'save-password',
    });

    return false;
  }
}

/**
 * Reads the Vault-synced Matrix account password.
 */
export async function readChatPasswordFromVault() {
  try {
    const rec = vaultSettingsMap().get(CHAT_ACCOUNT_KEY) || null;
    if (!rec?.passwordEnc || !rec?.userId) return null;

    const contentKey = await contentKeyForVaultChatSecrets();
    const plain = await decryptBytes(
      contentKey,
      utf8Encode(rec.passwordEnc),
      PASSWORD_AAD
    );

    return {
      userId: String(rec.userId),
      homeserverUrl: String(rec.homeserverUrl || ''),
      password: utf8Decode(plain),
    };
  } catch (err) {
    reportCryptoError('Could not unlock Chat password from Vault.', err, {
      step: 'read-password',
    });

    return null;
  }
}

/**
 * Stores the Matrix Secret Storage recovery material in the synced Vault.
 */
export async function saveChatRecoveryToVault(material) {
  try {
    const record = serializeRecoveryMaterial(material);
    if (!record) return false;

    const contentKey = await contentKeyForVaultChatSecrets();

    const keyEnc = await encryptBytes(
      contentKey,
      utf8Encode(JSON.stringify(record)),
      RECOVERY_AAD
    );

    setVaultSetting(CHAT_RECOVERY_KEY, {
      keyEnc: utf8Decode(keyEnc),
      updatedAt: Date.now(),
    });

    return true;
  } catch (err) {
    reportCryptoError('Could not save Chat recovery key to Vault.', err, {
      step: 'save-recovery',
    });

    return false;
  }
}

/**
 * Reads the Vault-synced Matrix Secret Storage recovery material.
 */
export async function readChatRecoveryFromVault() {
  try {
    const rec = vaultSettingsMap().get(CHAT_RECOVERY_KEY) || null;
    if (!rec?.keyEnc) return null;

    const contentKey = await contentKeyForVaultChatSecrets();

    const plain = await decryptBytes(
      contentKey,
      utf8Encode(rec.keyEnc),
      RECOVERY_AAD
    );

    return JSON.parse(utf8Decode(plain));
  } catch (err) {
    reportCryptoError('Could not unlock Chat recovery key from Vault.', err, {
      step: 'read-recovery',
    });

    return null;
  }
}

async function createMatrixSecretStorageKey() {
  /*
    Matrix JS SDK expects createSecretStorageKey() to return an object:
      { keyInfo, privateKey }

    privateKey must be raw 32-byte key material. Returning only Uint8Array is
    not accepted by all SDK builds and can cause WebCrypto importKey() errors.

    Warum:
    YANTA does not show a recovery phrase. The Sync2 Vault is the recovery
    channel, so we store the raw privateKey encrypted in VaultDoc settings.
  */
  const privateKey = randomBytes(32);

  return {
    forSdk: {
      keyInfo: {
        algorithm: 'm.secret_storage.v1.aes-hmac-sha2',
        name: 'YANTA Chat Recovery',
      },
      privateKey,
    },
    vault: privateKey,
  };
}

async function authUploadDeviceSigningKeysWithPassword(makeRequest, {
  userId,
  password,
} = {}) {
  if (!password) {
    throw new Error('Chat Matrix password missing for cross-signing UIA');
  }

  const auth = {
    type: 'm.login.password',
    identifier: {
      type: 'm.id.user',
      user: userId,
    },
    user: userId,
    password,
  };

  if (typeof makeRequest === 'function') {
    return makeRequest(auth);
  }

  return auth;
}

function isMissingServerSecretStorageBootstrapError(err) {
  return /createSecretStorageKey is not set|unable to create a new secret storage key|m\.secret_storage\.default_key/i.test(
    err?.message || String(err || '')
  );
}

async function bootstrapNewSecretStorage(client, cryptoApi) {
  installSecretStorageCallbacks(client);

  let generated = null;

  await cryptoApi.bootstrapSecretStorage({
    setupNewSecretStorage: true,

    createSecretStorageKey: async () => {
      generated = await createMatrixSecretStorageKey();

      /*
        Spec-critical ordering:
        Store the generated recovery material in the Vault before returning it
        to Matrix bootstrap so a crash after bootstrap does not strand the
        account without Vault-carried recovery.
      */
      await saveChatRecoveryToVault(generated.vault);

      return generated.forSdk;
    },

    /*
      Important:
      During bootstrapSecretStorage() the SDK may immediately store existing
      backup/cross-signing secrets and calls getSecretStorageKey again. Without
      this callback some SDK builds fail with:
      “No getSecretStorageKey callback supplied”.
    */
    getSecretStorageKey: async (keysOrRequest = {}) => {
      const keys =
        keysOrRequest?.keys && typeof keysOrRequest.keys === 'object'
          ? keysOrRequest.keys
          : keysOrRequest;

      const keyId = Object.keys(keys || {})[0] || '';

      if (generated?.vault) {
        return keyId
          ? [keyId, generated.vault]
          : generated.vault;
      }

      return chatSecretStorageKeyForSdk(keysOrRequest);
    },
  });

  installSecretStorageCallbacks(client);

  return 'created';
}

async function maybeBootstrapSecretStorage(client, {
  firstDevice,
} = {}) {
  const cryptoApi = getCryptoApi(client);
  if (!cryptoApi?.bootstrapSecretStorage) return false;

  if (firstDevice) {
    return bootstrapNewSecretStorage(client, cryptoApi);
  }

  const recovery = await readChatRecoveryFromVault();

  if (!recovery) {
    throw new Error('Chat recovery key is not available in this Vault yet');
  }

  try {
    await cryptoApi.bootstrapSecretStorage({
      getSecretStorageKey: async ({ keys } = {}) => {
        return recoveryMaterialForSdk(recovery, keys);
      },
    });

    return 'restored';
  } catch (err) {
    /*
      Migration/repair case:
      The Vault already contains YANTA's recovery material, but the Matrix
      account itself has no server-side Secret Storage default key yet
      because the account was created before AP3 completed crypto bootstrap.

      In that specific state we are allowed to create Secret Storage now and
      overwrite the Vault recovery record with the newly accepted raw key.
    */
    if (!isMissingServerSecretStorageBootstrapError(err)) {
      throw err;
    }

    console.warn('[YANTA Chat Crypto] Matrix Secret Storage is missing on server; creating it now', err);

    return bootstrapNewSecretStorage(client, cryptoApi);
  }
}

async function maybeBootstrapCrossSigning(client, {
  userId,
  password,
} = {}) {
  const cryptoApi = getCryptoApi(client);
  if (!cryptoApi?.bootstrapCrossSigning) return false;

  if (typeof cryptoApi.isCrossSigningReady === 'function') {
    const ready = await cryptoApi.isCrossSigningReady();
    if (ready) return true;
  }

    await cryptoApi.bootstrapCrossSigning({
    getSecretStorageKey: async (keysOrRequest = {}) => {
        return chatSecretStorageKeyForSdk(keysOrRequest);
    },

    authUploadDeviceSigningKeys: (makeRequest) =>
        authUploadDeviceSigningKeysWithPassword(makeRequest, {
        userId,
        password,
        }),
    });

  return true;
}

async function maybeEnableKeyBackup(client, {
  firstDevice,
} = {}) {
  const cryptoApi = getCryptoApi(client);
  if (!cryptoApi) return false;

  installSecretStorageCallbacks(client);

  let activeVersion = null;

  if (typeof cryptoApi.getActiveSessionBackupVersion === 'function') {
    activeVersion = await cryptoApi.getActiveSessionBackupVersion();
  }

  if (activeVersion && typeof cryptoApi.checkKeyBackupAndEnable === 'function') {
    await cryptoApi.checkKeyBackupAndEnable();
    await forceUploadKnownRoomKeysToBackup(client);
    return true;
  }

  if (firstDevice && typeof cryptoApi.resetKeyBackup === 'function') {
    await cryptoApi.resetKeyBackup();
    await forceUploadKnownRoomKeysToBackup(client);
    return true;
  }

  if (typeof cryptoApi.checkKeyBackupAndEnable === 'function') {
    await cryptoApi.checkKeyBackupAndEnable();
    await forceUploadKnownRoomKeysToBackup(client);
    return true;
  }

  return false;
}

async function maybeRestoreKeyBackup(client) {
  const cryptoApi = getCryptoApi(client);
  if (!cryptoApi) return false;
    installSecretStorageCallbacks(client);

  if (typeof cryptoApi.restoreKeyBackupWithSecretStorage === 'function') {
    await cryptoApi.restoreKeyBackupWithSecretStorage();
    return true;
  }

  if (typeof cryptoApi.restoreKeyBackup === 'function') {
    await cryptoApi.restoreKeyBackup();
    return true;
  }

  if (typeof cryptoApi.checkKeyBackupAndEnable === 'function') {
    await cryptoApi.checkKeyBackupAndEnable();
    return true;
  }

  return false;
}

function emitChatCryptoEvent(name, detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent(name, {
      detail: {
        ts: Date.now(),
        ...detail,
      },
    }));
  } catch {}
}

function isPreparedSyncStateValue(sdk, value) {
  const prepared = sdk?.SyncState?.Prepared || 'PREPARED';
  const s = String(value || '').toUpperCase();

  return value === prepared || s === 'PREPARED';
}

/**
 * Waits until Matrix initial sync reached PREPARED.
 *
 * Why:
 * Key Backup account data and room state are only reliable after the first
 * sync. Restoring backup before PREPARED often leaves old messages undecryptable.
 */
export function waitForChatPrepared(client, {
  sdk = null,
  timeoutMs = 20_000,
} = {}) {
  if (!client) {
    return Promise.resolve(false);
  }

  if (isPreparedSyncStateValue(sdk, client.getSyncState?.())) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let done = false;
    let timer = 0;

    const finish = (ok) => {
      if (done) return;

      done = true;
      clearTimeout(timer);

      try {
        client.removeListener?.('sync', onSync);
      } catch {}

      try {
        const ev = sdk?.ClientEvent?.Sync;
        if (ev) client.removeListener?.(ev, onSync);
      } catch {}

      resolve(!!ok);
    };

    const onSync = (state) => {
      if (isPreparedSyncStateValue(sdk, state)) {
        finish(true);
      }
    };

    try {
      client.on?.('sync', onSync);

      const ev = sdk?.ClientEvent?.Sync;
      if (ev && ev !== 'sync') {
        client.on?.(ev, onSync);
      }
    } catch (err) {
      /*
        Kein Toast: Das ist kein User-Fehlerpfad. finalizeChatCryptoAfterSync()
        läuft trotzdem weiter; echte Probleme melden sich über
        yanta-chat-crypto-degraded und den Chat-Banner.
      */
      console.warn('[YANTA Chat Crypto] could not subscribe to Matrix sync state', err);
      finish(false);
      return;
    }

    timer = window.setTimeout(() => {
      // Kein Toast: langsamer Initial-Sync ist normal, kein Fehler.
      console.info('[YANTA Chat Crypto] Matrix sync did not reach PREPARED before key backup timeout');
      finish(false);
    }, Math.max(3000, Number(timeoutMs || 20_000)));
  });
}

async function activeChatBackupVersion(cryptoApi) {
  if (!cryptoApi) return '';

  try {
    const active = await cryptoApi.getActiveSessionBackupVersion?.();

    if (active) {
      return String(active.version || active);
    }
  } catch (err) {
    console.warn('[YANTA Chat Crypto] could not read active key backup version', err);
  }

  try {
    const info = await cryptoApi.getKeyBackupInfo?.();

    if (info?.version) return String(info.version);
    if (info?.version_id) return String(info.version_id);
  } catch (err) {
    console.warn('[YANTA Chat Crypto] could not read server key backup info', err);
  }

  return '';
}

async function ensureChatServerKeyBackupExists(client, {
  allowCreate = true,
} = {}) {
  const cryptoApi = getCryptoApi(client);

  if (!cryptoApi) {
    throw new Error('Matrix crypto API is not available.');
  }

  installSecretStorageCallbacks(client);

  let version = await activeChatBackupVersion(cryptoApi);

  if (version) {
    return {
      created: false,
      version,
    };
  }

  if (!allowCreate) {
    return {
      created: false,
      version: '',
    };
  }

  if (typeof cryptoApi.resetKeyBackup !== 'function') {
    throw new Error('Matrix key backup creation is not supported by this SDK version.');
  }

  /*
    Why:
    If no server-side key backup exists, old messages can never be restored on
    newly logged-in devices. resetKeyBackup() creates a new backup version
    protected by Secret Storage, whose recovery key is stored in YANTA Vault.
  */
  await cryptoApi.resetKeyBackup();

  version = await activeChatBackupVersion(cryptoApi);

  return {
    created: true,
    version,
  };
}

async function enableChatKeyBackup(client) {
  const cryptoApi = getCryptoApi(client);

  if (!cryptoApi) return false;

  installSecretStorageCallbacks(client);

  if (typeof cryptoApi.checkKeyBackupAndEnable === 'function') {
    await cryptoApi.checkKeyBackupAndEnable();
    return true;
  }

  if (typeof cryptoApi.enableKeyBackup === 'function') {
    await cryptoApi.enableKeyBackup();
    return true;
  }

  return false;
}

async function forceUploadKnownRoomKeysToBackup(client) {
  const cryptoApi = getCryptoApi(client);
  if (!cryptoApi) return false;

  installSecretStorageCallbacks(client);

  /*
    Matrix SDK versions expose this differently.
    Some methods return void even on success, so "no throw" counts as success.
  */
  const candidates = [
    () => cryptoApi.backupAllGroupSessions?.(),
    () => cryptoApi.scheduleAllGroupSessionsForBackup?.(),
    () => cryptoApi.backupManager?.backupAllGroupSessions?.(),
    () => cryptoApi.backupManager?.scheduleAllGroupSessionsForBackup?.(),
    () => client.crypto?.backupManager?.backupAllGroupSessions?.(),
    () => client.crypto?.backupManager?.scheduleAllGroupSessionsForBackup?.(),
  ];

  for (const run of candidates) {
    try {
      const maybePromise = run();

      if (maybePromise === undefined) {
        continue;
      }

      await maybePromise;
      return true;
    } catch (err) {
      console.warn('[YANTA Chat Crypto] room-key backup upload attempt failed', err);
    }
  }

  /*
    Fallback:
    scheduleAllGroupSessionsForBackup often returns undefined. Try it directly
    and treat no-throw as success.
  */
  for (const fn of [
    cryptoApi.scheduleAllGroupSessionsForBackup,
    cryptoApi.backupManager?.scheduleAllGroupSessionsForBackup,
    client.crypto?.backupManager?.scheduleAllGroupSessionsForBackup,
  ]) {
    if (typeof fn !== 'function') continue;

    try {
      await fn.call(cryptoApi.backupManager || client.crypto?.backupManager || cryptoApi);
      return true;
    } catch (err) {
      console.warn('[YANTA Chat Crypto] fallback room-key backup scheduling failed', err);
    }
  }

  return false;
}

/**
 * Finalizes Matrix key backup after initial sync.
 *
 * Call this after client.startClient(). It:
 * - waits for PREPARED sync state,
 * - creates/enables server-side key backup if missing,
 * - restores old room keys from Secret Storage,
 * - forces upload of locally known room keys for future devices.
 */
export async function finalizeChatCryptoAfterSync(client, {
  sdk = null,
  firstDevice = false,
  timeoutMs = 20_000,
} = {}) {
  installSecretStorageCallbacks(client);

  const result = {
    ok: true,
    degraded: false,
    prepared: false,
    steps: {},
  };

  const step = async (name, fn) => {
    try {
      result.steps[name] = await fn();
    } catch (err) {
      result.ok = false;
      result.degraded = true;

      reportCryptoError('Chat encryption keys could not be fully restored.', err, {
        step: name,
        firstDevice,
      });
    }
  };

  result.prepared = await waitForChatPrepared(client, {
    sdk,
    timeoutMs,
  });

  await step('ensure-key-backup', () =>
    ensureChatServerKeyBackupExists(client, {
      allowCreate: true,
    })
  );

  await step('enable-key-backup', () =>
    enableChatKeyBackup(client)
  );

  await step('restore-key-backup', () =>
    maybeRestoreKeyBackup(client)
  );

  await step('upload-known-room-keys', () =>
    forceUploadKnownRoomKeysToBackup(client)
  );

  emitChatCryptoEvent('yanta-chat-key-backup-ready', {
    ok: result.ok,
    degraded: result.degraded,
    steps: result.steps,
  });

  return result;
}

async function maybeSelfSignOwnDevice(client) {
  const cryptoApi = getCryptoApi(client);
  const deviceId = client?.getDeviceId?.() || client?.deviceId || '';

  if (!cryptoApi || !deviceId) return false;

  if (typeof cryptoApi.crossSignDevice === 'function') {
    await cryptoApi.crossSignDevice(deviceId);
    return true;
  }

  if (typeof cryptoApi.requestOwnUserVerification === 'function') {
    const request = await cryptoApi.requestOwnUserVerification();

    // Some SDKs auto-complete own-device verification when cross-signing
    // secrets are available. Do not block if the API exposes no completion hook.
    await request?.waitFor?.(() => true).catch(() => {});
    return true;
  }

  return false;
}

/**
 * Persists Matrix password from provisioning responses into the Vault.
 *
 * Safe to call repeatedly. It only updates the encrypted Vault settings entry
 * when the response actually contains a password.
 */
export async function ingestChatAccountSecrets(account = {}) {
  const clean = normalizeAccount(account);

  if (!clean.userId || !clean.password) {
    return {
      savedPassword: false,
      userId: clean.userId,
      homeserverUrl: clean.homeserverUrl,
    };
  }

  const savedPassword = await saveChatPasswordToVault(clean);

  return {
    savedPassword,
    userId: clean.userId,
    homeserverUrl: clean.homeserverUrl,
  };
}

/**
 * Bootstraps Matrix E2EE, Secret Storage, Cross-Signing and Key Backup.
 *
 * This function is intentionally robust/idempotent. Crypto setup problems do
 * not hard-fail Chat startup; they emit yanta-chat-crypto-degraded so the UI
 * can show a non-blocking “Encryption is being set up…” banner and retry on
 * next start.
 */
export async function bootstrapChatCrypto(client, {
  firstDevice = false,
  account = null,
} = {}) {
  installSecretStorageCallbacks(client);
  const normalized = normalizeAccount(account || {});
  let vaultAccount = await readChatPasswordFromVault();

  if (normalized.password && normalized.userId) {
    await saveChatPasswordToVault(normalized);
    vaultAccount = {
      userId: normalized.userId,
      homeserverUrl: normalized.homeserverUrl || vaultAccount?.homeserverUrl || '',
      password: normalized.password,
    };
  }

  const userId =
    normalized.userId ||
    vaultAccount?.userId ||
    client?.getUserId?.() ||
    '';

  const password =
    normalized.password ||
    vaultAccount?.password ||
    '';

  const result = {
    ok: true,
    degraded: false,
    steps: {},
  };

  const step = async (name, fn) => {
    try {
      result.steps[name] = await fn();
    } catch (err) {
      result.ok = false;
      result.degraded = true;

      reportCryptoError('Chat encryption is being set up…', err, {
        step: name,
        firstDevice,
      });
    }
  };

  let createdSecretStorage = false;

  await step('secret-storage', async () => {
    const mode = await maybeBootstrapSecretStorage(client, {
      firstDevice,
    });

    createdSecretStorage = mode === 'created';

    return mode;
  });

  await step('cross-signing', () =>
    maybeBootstrapCrossSigning(client, {
      userId,
      password,
    })
  );

  /*
    If Secret Storage was created during a repair/migration run, this device is
    effectively the first crypto-bootstrap device for the Matrix account even
    if the session was started via stored credentials.
  */
  if (firstDevice || createdSecretStorage) {
    await step('key-backup-enable', () =>
      maybeEnableKeyBackup(client, {
        firstDevice: true,
      })
    );
  } else {
    await step('self-sign-device', () =>
      maybeSelfSignOwnDevice(client)
    );

    await step('key-backup-restore', () =>
      maybeRestoreKeyBackup(client)
    );
  }

  return result;
}

/**
 * Returns true when this Vault already contains a synced Chat account secret.
 */
export function hasVaultChatAccount() {
  try {
    const rec = vaultSettingsMap().get(CHAT_ACCOUNT_KEY) || null;

    return !!(
      rec &&
      rec.userId &&
      rec.passwordEnc
    );
  } catch (err) {
    console.warn('[YANTA Chat Crypto] could not inspect Vault Chat account', err);
    toast('Could not inspect Chat account state.', 'error');
    return false;
  }
}

/**
 * Returns true when this Vault contains Matrix Secret Storage recovery material.
 */
export function hasVaultChatRecovery() {
  try {
    const rec = vaultSettingsMap().get(CHAT_RECOVERY_KEY) || null;
    return !!rec?.keyEnc;
  } catch (err) {
    console.warn('[YANTA Chat Crypto] could not inspect Vault Chat recovery', err);
    toast('Could not inspect Chat recovery state.', 'error');
    return false;
  }
}

async function sdkEncodeRecoveryKey(privateKey) {
  try {
    const sdkMod = await import('matrix-js-sdk');
    const sdk = sdkMod.default || sdkMod;

    if (typeof sdk.encodeRecoveryKey === 'function') {
      return sdk.encodeRecoveryKey(privateKey);
    }

    if (sdk.crypto?.encodeRecoveryKey) {
      return sdk.crypto.encodeRecoveryKey(privateKey);
    }
  } catch (err) {
    console.warn('[YANTA Chat Crypto] could not encode Matrix recovery key through SDK', err);
    toast('Could not format Chat recovery key.', 'error');
  }

  return '';
}

/**
 * Reads the Vault-decrypted Matrix recovery key as display/copy text.
 *
 * Warum:
 * YANTA stores the actual recovery material encrypted in the Sync2 Vault.
 * Showing it is a deliberate high-risk user action and must only happen
 * behind UI warnings.
 */
export async function readChatRecoveryKeyTextForDisplay() {
  try {
    const record = await readChatRecoveryFromVault();

    if (!record) {
      throw new Error('Chat recovery key is not available in this Vault.');
    }

    if (record.encodedPrivateKey) {
      return {
        kind: 'matrix-recovery-key',
        text: String(record.encodedPrivateKey),
      };
    }

    if (record.privateKeyB64) {
      const privateKey = base64UrlDecode(record.privateKeyB64);
      const encoded = await sdkEncodeRecoveryKey(privateKey);

      return {
        kind: encoded ? 'matrix-recovery-key' : 'raw-private-key',
        text: encoded || `raw:${record.privateKeyB64}`,
      };
    }

    throw new Error('Unsupported Chat recovery key record.');
  } catch (err) {
    console.warn('[YANTA Chat Crypto] Could not read recovery key for display', err);
    toast('Could not unlock Chat recovery key.', 'error');

    throw err;
  }
}

/**
 * Returns a simple Chat crypto health summary for settings/details UI.
 */
export async function getChatCryptoHealth(client) {
  try {
    const cryptoApi = getCryptoApi(client);

    if (!cryptoApi) {
      return {
        available: false,
        crossSigningReady: false,
        backupVersion: '',
      };
    }

    const crossSigningReady =
      await cryptoApi.isCrossSigningReady?.().catch((err) => {
        console.warn('[YANTA Chat Crypto] could not read cross-signing state', err);
        toast('Could not read Chat verification state.', 'error');
        return false;
      });

    let backupVersion = '';

    try {
      const active = await cryptoApi.getActiveSessionBackupVersion?.();
      backupVersion = String(active?.version || active || '');
    } catch (err) {
      console.warn('[YANTA Chat Crypto] could not read backup version', err);
      toast('Could not read Chat key backup state.', 'error');
    }

    return {
      available: true,
      crossSigningReady: !!crossSigningReady,
      backupVersion,
    };
  } catch (err) {
    console.warn('[YANTA Chat Crypto] Could not inspect crypto health', err);
    toast('Could not inspect Chat encryption.', 'error');

    return {
      available: false,
      crossSigningReady: false,
      backupVersion: '',
      error: err?.message || String(err),
    };
  }
}

function normalizeExportedRoomKeys(value) {
  if (!value) return [];

  if (Array.isArray(value)) return value;

  if (Array.isArray(value.room_keys)) return value.room_keys;
  if (Array.isArray(value.rooms)) return value.rooms;
  if (Array.isArray(value.sessions)) return value.sessions;
  if (Array.isArray(value.exported_room_keys)) return value.exported_room_keys;

  return [];
}

async function callRoomKeyExportCandidate(fn, receiver) {
  if (typeof fn !== 'function') return null;

  /*
    SDK compatibility:
    - client.exportRoomKeys()
    - crypto.exportRoomKeys()
    Some builds accept options, some accept none.
  */
  try {
    return await fn.call(receiver);
  } catch (err1) {
    try {
      return await fn.call(receiver, {});
    } catch (err2) {
      console.warn('[YANTA Chat Crypto] room-key export candidate failed', err1, err2);
      return null;
    }
  }
}

async function exportRoomKeysFromClient(client) {
  const cryptoApi = getCryptoApi(client);

  const candidates = [
    [client?.exportRoomKeys, client],
    [cryptoApi?.exportRoomKeys, cryptoApi],
    [client?.crypto?.exportRoomKeys, client.crypto],
  ];

  for (const [fn, receiver] of candidates) {
    const result = await callRoomKeyExportCandidate(fn, receiver);
    const keys = normalizeExportedRoomKeys(result);

    if (keys.length) return keys;
  }

  return [];
}

async function callRoomKeyImportCandidate(fn, receiver, keys) {
  if (typeof fn !== 'function') return false;

  try {
    await fn.call(receiver, keys, {
      progressCallback: () => {},
    });
    return true;
  } catch (err1) {
    try {
      await fn.call(receiver, keys);
      return true;
    } catch (err2) {
      console.warn('[YANTA Chat Crypto] room-key import candidate failed', err1, err2);
      return false;
    }
  }
}

async function importRoomKeysIntoClient(client, keys = []) {
  if (!client || !Array.isArray(keys) || !keys.length) {
    return {
      imported: false,
      count: 0,
    };
  }

  const cryptoApi = getCryptoApi(client);

  const candidates = [
    [client?.importRoomKeys, client],
    [cryptoApi?.importRoomKeys, cryptoApi],
    [client?.crypto?.importRoomKeys, client.crypto],
  ];

  for (const [fn, receiver] of candidates) {
    const ok = await callRoomKeyImportCandidate(fn, receiver, keys);

    if (ok) {
      return {
        imported: true,
        count: keys.length,
      };
    }
  }

  return {
    imported: false,
    count: keys.length,
  };
}

/**
 * Exports all locally known Matrix Megolm room keys into the synced YANTA Vault.
 *
 * This is the "Signal-quality" fallback path:
 * Matrix key backup is still used, but YANTA also carries a zero-knowledge
 * encrypted room-key snapshot through Sync2.
 */
export async function exportChatRoomKeysToVault(client, {
  reason = 'manual',
} = {}) {
  try {
    if (!client) {
      throw new Error('Matrix client is missing.');
    }

    installSecretStorageCallbacks(client);

    const keys = await exportRoomKeysFromClient(client);

    if (!keys.length) {
      return {
        ok: false,
        count: 0,
        reason: 'no-exported-keys',
      };
    }

    const payload = {
      v: 1,
      exportedAt: Date.now(),
      reason,
      userId: client.getUserId?.() || '',
      deviceId: client.getDeviceId?.() || client.deviceId || '',
      count: keys.length,
      keys,
    };

    const contentKey = await contentKeyForVaultChatSecrets();
    const encrypted = await encryptBytes(
      contentKey,
      utf8Encode(JSON.stringify(payload)),
      ROOM_KEYS_AAD
    );

    setVaultSetting(CHAT_ROOM_KEYS_KEY, {
      v: 1,
      keyEnc: utf8Decode(encrypted),
      count: keys.length,
      updatedAt: Date.now(),
      sourceUserId: payload.userId,
      sourceDeviceId: payload.deviceId,
    });

    emitChatCryptoEvent('yanta-chat-room-keys-exported', {
      ok: true,
      count: keys.length,
      reason,
    });

    return {
      ok: true,
      count: keys.length,
      sourceDeviceId: payload.deviceId,
    };
  } catch (err) {
    reportCryptoError('Could not export Chat room keys to Vault.', err, {
      step: 'export-room-keys-to-vault',
      reason,
    });

    return {
      ok: false,
      count: 0,
      error: err?.message || String(err),
    };
  }
}

export async function readChatRoomKeysFromVault() {
  try {
    const rec = vaultSettingsMap().get(CHAT_ROOM_KEYS_KEY) || null;

    if (!rec?.keyEnc) return null;

    const contentKey = await contentKeyForVaultChatSecrets();
    const plain = await decryptBytes(
      contentKey,
      utf8Encode(rec.keyEnc),
      ROOM_KEYS_AAD
    );

    const payload = JSON.parse(utf8Decode(plain));

    if (!payload || payload.v !== 1 || !Array.isArray(payload.keys)) {
      throw new Error('Unsupported YANTA Chat room-key snapshot.');
    }

    return payload;
  } catch (err) {
    reportCryptoError('Could not read Chat room keys from Vault.', err, {
      step: 'read-room-keys-from-vault',
    });

    return null;
  }
}

/**
 * Imports the synced YANTA room-key snapshot into the current Matrix device.
 */
export async function importChatRoomKeysFromVault(client, {
  reason = 'startup',
} = {}) {
  try {
    if (!client) {
      throw new Error('Matrix client is missing.');
    }

    installSecretStorageCallbacks(client);

    const payload = await readChatRoomKeysFromVault();

    if (!payload?.keys?.length) {
      return {
        ok: false,
        imported: false,
        count: 0,
        reason: 'no-vault-room-keys',
      };
    }

    const result = await importRoomKeysIntoClient(client, payload.keys);

    emitChatCryptoEvent('yanta-chat-room-keys-imported', {
      ok: result.imported,
      count: result.count,
      reason,
    });

    return {
      ok: result.imported,
      imported: result.imported,
      count: result.count,
      exportedAt: payload.exportedAt || 0,
      sourceDeviceId: payload.deviceId || payload.sourceDeviceId || '',
    };
  } catch (err) {
    reportCryptoError('Could not import Chat room keys from Vault.', err, {
      step: 'import-room-keys-from-vault',
      reason,
    });

    return {
      ok: false,
      imported: false,
      count: 0,
      error: err?.message || String(err),
    };
  }
}