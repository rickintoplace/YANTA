// ============================================================
// YANTA — unlock the app lock with a passkey
//
// Fingerprint, face or device PIN instead of typing the password. Uses
// the WebAuthn "prf" extension: the passkey derives a secret from a salt
// stored here, and that secret unwraps the same Local Data Key the
// password does (lock-keys.js). Password and recovery key keep working.
//
// Not every browser or password manager supports PRF. Settings only
// offers passkeys where the browser says it can, and a passkey that
// turns out not to support it is not kept.
// ============================================================

import { base64UrlDecode, base64UrlEncode, randomBytes } from '../sync2/crypto.js';

import {
  addPasskeyWrap,
  getLockConfig,
  unlockWithPasskeyOutput,
} from './lock-keys.js';

function toBytes(buffer) {
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

/** Whether this browser can (probably) unlock with a passkey. */
export async function passkeyUnlockSupported() {
  if (!window.isSecureContext || typeof window.PublicKeyCredential !== 'function' || !navigator.credentials) return false;

  try {
    const caps = await window.PublicKeyCredential.getClientCapabilities?.();
    if (caps && caps['extension:prf'] === false) return false;
  } catch {}

  return true;
}

/** Evaluates the PRF of one of the given passkeys; returns { id, output } or null. */
async function evaluatePrf(passkeys) {
  const evalByCredential = {};
  for (const p of passkeys) evalByCredential[p.id] = { first: base64UrlDecode(p.prfSalt) };

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: passkeys.map((p) => ({ type: 'public-key', id: base64UrlDecode(p.id) })),
      userVerification: 'required',
      timeout: 120_000,
      extensions: { prf: { evalByCredential } },
    },
  });

  const output = credential?.getClientExtensionResults?.().prf?.results?.first;
  if (!output) return null;

  return { id: base64UrlEncode(toBytes(credential.rawId)), output: toBytes(output) };
}

/**
 * Creates a passkey and adds it as a way to unlock. The device must be
 * unlocked. Throws with code ENOPRF when the passkey cannot do PRF.
 */
export async function addPasskey({ userName = 'YANTA' } = {}) {
  const prfSalt = randomBytes(32);

  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'YANTA' },
      user: { id: randomBytes(16), name: userName, displayName: userName },
      challenge: randomBytes(32),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { userVerification: 'required', residentKey: 'discouraged' },
      timeout: 120_000,
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });

  const credentialId = base64UrlEncode(toBytes(credential.rawId));
  const prf = credential.getClientExtensionResults?.().prf;
  if (!prf?.enabled && !prf?.results?.first) throw Object.assign(new Error('no prf'), { code: 'ENOPRF' });

  // Some authenticators only evaluate the PRF on sign-in, not on creation.
  let output = prf.results?.first ? toBytes(prf.results.first) : null;
  if (!output) {
    const evaluated = await evaluatePrf([{ id: credentialId, prfSalt: base64UrlEncode(prfSalt) }]);
    output = evaluated?.output || null;
  }
  if (!output) throw Object.assign(new Error('no prf'), { code: 'ENOPRF' });

  await addPasskeyWrap({ credentialId, prfSalt, prfOutput: output, attachment: credential.authenticatorAttachment || '' });
  return credentialId;
}

/** Asks for one of this device's passkeys and unlocks with it. Resolves true/false. */
export async function unlockWithPasskey() {
  const { passkeys = [] } = await getLockConfig();
  if (!passkeys.length) return false;

  const evaluated = await evaluatePrf(passkeys);
  if (!evaluated) return false;

  return unlockWithPasskeyOutput(evaluated.id, evaluated.output);
}
