// Generate a VAPID keypair for YANTA Web Push.
//
//   node gen-vapid.mjs
//
// Then:
//   - put VAPID_PUBLIC_KEY into wrangler.toml [vars]
//   - put the private JWK into a secret:
//       npx wrangler@4 secret put VAPID_PRIVATE_KEY   (paste the JSON)
//   - set VITE_VAPID_PUBLIC_KEY in the app build env to the same public key
//     (optional — the app also fetches it from /api/push/config).

import { webcrypto as crypto } from 'node:crypto';

const kp = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);

const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)); // 65 bytes
const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);

const b64url = (u8) => Buffer.from(u8).toString('base64url');

console.log('\nVAPID_PUBLIC_KEY (var, non-secret):');
console.log(b64url(publicRaw));

console.log('\nVAPID_PRIVATE_KEY (secret — paste into `wrangler secret put VAPID_PRIVATE_KEY`):');
console.log(JSON.stringify(privateJwk));
console.log('');
