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

function normalizeAccount(account = {}) {
  const userId = String(
    account.userId ||
    account.matrixUserId ||
    account.mxid ||
    account.matrix?.userId ||
    ''
  ).trim();

  const homeserverUrl = String(
    account.homeserverUrl ||
    account.baseUrl ||
    account.matrixHomeserverUrl ||
    account.matrix?.homeserverUrl ||
    import.meta.env.VITE_YANTA_MATRIX_HOMESERVER_URL ||
    ''
  ).trim();

  const password = String(
    account.password ||
    account.matrixPassword ||
    account.matrix?.password ||
    ''
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

  if (record.privateKeyB64) {
    const privateKey = base64UrlDecode(record.privateKeyB64);

    return record.keyId
      ? [record.keyId, privateKey]
      : privateKey;
  }

  if (record.encodedPrivateKey) {
    const decoded = await sdkDecodeRecoveryKey(record.encodedPrivateKey);

    if (decoded) {
      return record.keyId
        ? [record.keyId, decoded]
        : decoded;
    }

    // Some SDK versions accept the encoded recovery key directly.
    return record.keyId
      ? [record.keyId, record.encodedPrivateKey]
      : record.encodedPrivateKey;
  }

  if (Array.isArray(record.raw)) {
    return record.raw;
  }

  const keyIds = Object.keys(keys || {});
  if (keyIds.length && record.raw?.privateKey) {
    return [keyIds[0], record.raw.privateKey];
  }

  return record.raw || null;
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

async function createMatrixSecretStorageKey(client) {
  const sdkMod = await import('matrix-js-sdk');
  const sdk = sdkMod.default || sdkMod;

  if (typeof client?.createRecoveryKeyFromPassphrase === 'function') {
    const generated = await client.createRecoveryKeyFromPassphrase();
    return {
      forSdk: generated,
      vault: generated,
    };
  }

  if (typeof sdk.createRecoveryKeyFromPassphrase === 'function') {
    const generated = await sdk.createRecoveryKeyFromPassphrase();
    return {
      forSdk: generated,
      vault: generated,
    };
  }

  if (sdk.crypto?.createRecoveryKeyFromPassphrase) {
    const generated = await sdk.crypto.createRecoveryKeyFromPassphrase();
    return {
      forSdk: generated,
      vault: generated,
    };
  }

  /*
    Fallback only for SDK builds without helper exports.
    Rust crypto-capable Matrix JS SDK builds normally provide one of the
    helpers above. We still generate strong random material so the failure mode
    is explicit instead of silently using weak/null key material.
  */
  const privateKey = randomBytes(32);

  return {
    forSdk: privateKey,
    vault: {
      privateKey,
      encodedPrivateKey: base64UrlEncode(privateKey),
    },
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

async function maybeBootstrapSecretStorage(client, {
  firstDevice,
} = {}) {
  const cryptoApi = getCryptoApi(client);
  if (!cryptoApi?.bootstrapSecretStorage) return false;

  if (firstDevice) {
    await cryptoApi.bootstrapSecretStorage({
      setupNewSecretStorage: true,
      createSecretStorageKey: async () => {
        const generated = await createMatrixSecretStorageKey(client);

        /*
          Spec-critical ordering:
          Store the generated recovery material in the Vault before returning it
          to Matrix bootstrap so a crash after bootstrap does not strand the
          account without Vault-carried recovery.
        */
        await saveChatRecoveryToVault(generated.vault);

        return generated.forSdk;
      },
    });

    return true;
  }

  const recovery = await readChatRecoveryFromVault();

  if (!recovery) {
    throw new Error('Chat recovery key is not available in this Vault yet');
  }

  await cryptoApi.bootstrapSecretStorage({
    getSecretStorageKey: async ({ keys } = {}) => {
      return recoveryMaterialForSdk(recovery, keys);
    },
  });

  return true;
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

  await step('secret-storage', () =>
    maybeBootstrapSecretStorage(client, {
      firstDevice,
    })
  );

  await step('cross-signing', () =>
    maybeBootstrapCrossSigning(client, {
      userId,
      password,
    })
  );

  if (firstDevice) {
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