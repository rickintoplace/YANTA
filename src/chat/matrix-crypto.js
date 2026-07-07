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

const PASSWORD_AAD = 'yanta-chat-password-v1';
const RECOVERY_AAD = 'yanta-chat-recovery-v1';

const CHAT_CRYPTO_ORIGIN = 'yanta-chat-crypto';

let degradedToastAt = 0;

function reportCryptoError(message, err, detail = {}) {
  console.warn('[YANTA Chat Crypto]', message, err);

  // Avoid toast storms during retry-heavy Matrix startup.
  if (Date.now() - degradedToastAt > 15_000) {
    degradedToastAt = Date.now();
    toast(message || 'Chat encryption is being set up…', 'error');
  }

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
    return true;
  }

  if (firstDevice && typeof cryptoApi.resetKeyBackup === 'function') {
    await cryptoApi.resetKeyBackup();
    return true;
  }

  if (typeof cryptoApi.checkKeyBackupAndEnable === 'function') {
    await cryptoApi.checkKeyBackupAndEnable();
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