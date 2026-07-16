// ============================================================
// YANTA Shared Spaces — link format
//
// #space=<base64url(JSON)> in the URL fragment. Fragments never
// reach any server, so all key material can safely travel here.
//
//   Read link:  { v:1, id, k, rt, t, st }
//   Write link: { v:1, id, k, rt, wt, ws, ep, t, st }
//
//   id = space id            k  = rootKey (read access)
//   rt = read token          wt = write token (server write auth)
//   ws = writer secret       ep = webrtc epoch
//   t  = title hint          st = source type ('note' | 'folder' | 'calendar')
// ============================================================

const SOURCE_TYPES = new Set(['note', 'folder', 'calendar']);

function b64urlEncodeString(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeString(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function buildSpaceLink({
  spaceId,
  rootKey,
  readToken = '',
  writeToken = '',
  writerSecret = '',
  epoch = 1,
  title = '',
  sourceType = 'note',
  includeWrite = false,
}) {
  const payload = {
    v: 1,
    id: spaceId,
    k: rootKey,
    rt: readToken,
    t: String(title || '').slice(0, 120),
    st: sourceType,
  };

  if (includeWrite && writeToken && writerSecret) {
    payload.wt = writeToken;
    payload.ws = writerSecret;
    payload.ep = epoch;
  }

  return location.origin + location.pathname + '#space=' + b64urlEncodeString(JSON.stringify(payload));
}

export function parseSpaceFragment(hash) {
  const h = String(hash || '').startsWith('#') ? hash.slice(1) : String(hash || '');

  if (!h.startsWith('space=')) return null;

  try {
    const obj = JSON.parse(b64urlDecodeString(h.slice('space='.length)));

    if (!obj || obj.v !== 1 || !obj.id || !obj.k) return null;

    const hasWrite = !!(obj.wt && obj.ws);

    return {
      spaceId: String(obj.id),
      rootKey: String(obj.k),
      readToken: String(obj.rt || ''),
      writeToken: hasWrite ? String(obj.wt) : '',
      writerSecret: hasWrite ? String(obj.ws) : '',
      epoch: Number(obj.ep || 1),
      title: String(obj.t || ''),
      sourceType: SOURCE_TYPES.has(obj.st) ? obj.st : 'note',
      role: hasWrite ? 'write' : 'read',
    };
  } catch {
    return null;
  }
}
