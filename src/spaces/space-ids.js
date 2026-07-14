// ============================================================
// YANTA Shared Spaces — remote IDs and paths
//
// Mirrors sync2/ids.js under the 'yanta-space-v1' namespace. Paths
// are relative to the space container; the worker maps them to R2
// under the owner's account. Doc IDs are HMAC-hashed with the space
// name key so paths leak nothing about note IDs or titles.
// ============================================================

import { joinRemotePath } from '../sync2/object-store.js';
import { hmacId } from '../sync2/crypto.js';
import { padSeq } from '../sync2/ids.js';

export const SPACE_ROOT = 'yanta-space-v1';

export function createParticipantId() {
  const raw = crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

  return `sp_${raw.replace(/-/g, '').slice(0, 20)}`;
}

export function spaceManifestPath() {
  return joinRemotePath(SPACE_ROOT, 'manifest.enc');
}

export async function spaceDocId(nameKey, docId) {
  return hmacId(nameKey, `doc:${docId}`, 32);
}

export async function spaceDocUpdatePath(nameKey, docId, participantId, seq) {
  const id = await spaceDocId(nameKey, docId);

  return joinRemotePath(
    SPACE_ROOT,
    'docs',
    id,
    'updates',
    `${participantId}-${padSeq(seq)}.ypack.enc`
  );
}

export async function spaceDocHeadPath(nameKey, docId, participantId) {
  const id = await spaceDocId(nameKey, docId);

  return joinRemotePath(
    SPACE_ROOT,
    'docs',
    id,
    'heads',
    `${participantId}.yhead.enc`
  );
}

export async function spaceDocPrefix(nameKey, docId) {
  const id = await spaceDocId(nameKey, docId);
  return joinRemotePath(SPACE_ROOT, 'docs', id) + '/';
}

export async function spaceDocUpdatesPrefix(nameKey, docId) {
  const id = await spaceDocId(nameKey, docId);
  return joinRemotePath(SPACE_ROOT, 'docs', id, 'updates') + '/';
}

export async function spaceDocHeadsPrefix(nameKey, docId) {
  const id = await spaceDocId(nameKey, docId);
  return joinRemotePath(SPACE_ROOT, 'docs', id, 'heads') + '/';
}
