// ============================================================
// YANTA Shared Spaces — key material
//
// A space has two independent secrets, both generated client-side
// and never sent to any server:
//
// - rootKey:      possession = READ access. HKDF-derives the AES-GCM
//                 content key + HMAC name key (namespaced with the
//                 'yanta-space-v1' salt so it can never collide with
//                 private-vault key material).
// - writerSecret: possession = live WRITE fast path. Derives the
//                 y-webrtc room + password per epoch, so readers
//                 (who only hold the rootKey) can never even join
//                 the writers' WebRTC room. Server-side writes are
//                 additionally gated by the write token / member role.
//
// Epochs exist for revocation: bumping the epoch rotates the WebRTC
// credentials without re-encrypting content.
// ============================================================

import {
  deriveKeys,
  randomBytes,
  base64UrlEncode,
  base64UrlDecode,
  utf8Encode,
} from '../sync2/crypto.js';

export const SPACE_KDF_SALT = 'yanta-space-v1';

export function generateSpaceSecret() {
  return base64UrlEncode(randomBytes(32));
}

export function generateSpaceToken() {
  return base64UrlEncode(randomBytes(24));
}

export async function deriveSpaceKeys(rootKey) {
  return deriveKeys(rootKey, { salt: SPACE_KDF_SALT });
}

export async function deriveWriterRoomCredentials(writerSecret, epoch = 1) {
  const raw = base64UrlDecode(writerSecret);

  if (raw.byteLength !== 32) {
    throw new Error('Writer secret must decode to 32 bytes');
  }

  const ikm = await crypto.subtle.importKey(
    'raw',
    raw,
    'HKDF',
    false,
    ['deriveBits']
  );

  const params = (info) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: utf8Encode('yanta-space-webrtc-v1'),
    info: utf8Encode(info),
  });

  const roomBits = await crypto.subtle.deriveBits(params(`room:${epoch}`), ikm, 128);
  const pskBits = await crypto.subtle.deriveBits(params(`psk:${epoch}`), ikm, 256);

  return {
    room: 'yanta-space-' + base64UrlEncode(new Uint8Array(roomBits)),
    password: base64UrlEncode(new Uint8Array(pskBits)),
  };
}
