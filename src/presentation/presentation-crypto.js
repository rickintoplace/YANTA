import {
  base64UrlEncode,
  base64UrlDecode,
  randomBytes,
  importAesGcmKey,
  encryptBytes,
  decryptBytes,
  utf8Encode,
  utf8Decode,
} from '../sync2/crypto.js';

const PAYLOAD_AAD = 'yanta-presentation-session-payload-v1';

export function generatePresentationKeyString() {
  return base64UrlEncode(randomBytes(32));
}

export async function presentationKeyFromString(keyString) {
  const raw = base64UrlDecode(keyString);

  if (raw.byteLength !== 32) {
    throw new Error('Presentation key must decode to 32 bytes');
  }

  return importAesGcmKey(raw);
}

export async function encryptPresentationPayload(keyString, payload) {
  const key = await presentationKeyFromString(keyString);

  return utf8Decode(
    await encryptBytes(
      key,
      utf8Encode(JSON.stringify(payload)),
      PAYLOAD_AAD
    )
  );
}

export async function decryptPresentationPayload(keyString, encryptedPayloadString) {
  const key = await presentationKeyFromString(keyString);

  const plain = await decryptBytes(
    key,
    utf8Encode(encryptedPayloadString),
    PAYLOAD_AAD
  );

  return JSON.parse(utf8Decode(plain));
}

export function parsePresentationKeyFromHash(hash = location.hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const params = new URLSearchParams(raw);
  const key = params.get('k') || '';

  if (!key) {
    throw new Error('Missing presentation key. The full link must include #k=...');
  }

  return key;
}

export function makePresentationUrl(sessionId, keyString) {
  return `${location.origin}/present/${encodeURIComponent(sessionId)}#k=${encodeURIComponent(keyString)}`;
}