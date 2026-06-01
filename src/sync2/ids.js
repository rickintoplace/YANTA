// ============================================================
// YANTA Sync2 — IDs and paths
// ============================================================

import { joinRemotePath } from './object-store.js';
import { hmacId } from './crypto.js';

export const SYNC_ROOT = 'yanta-sync-v1';

export function keyCheckPath() {
  return joinRemotePath(SYNC_ROOT, 'keycheck.enc');
}

export function createDeviceId(prefix = 'dev') {
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

  return `${prefix}_${id.replace(/-/g, '').slice(0, 20)}`;
}

export function createVaultId() {
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

  return `vault_${id.replace(/-/g, '').slice(0, 24)}`;
}

export function padSeq(seq) {
  return String(seq).padStart(8, '0');
}

export function bootstrapPath() {
  return joinRemotePath(SYNC_ROOT, 'bootstrap.json');
}

export function vaultUpdatePath(deviceId, seq) {
  return joinRemotePath(
    SYNC_ROOT,
    'vault',
    'updates',
    `${deviceId}-${padSeq(seq)}.ypack.enc`
  );
}

export function vaultSnapshotPath(deviceId, seq) {
  return joinRemotePath(
    SYNC_ROOT,
    'vault',
    'snapshots',
    `${deviceId}-${padSeq(seq)}.ysnap.enc`
  );
}

export async function remoteDocId(nameKey, noteId) {
  return hmacId(nameKey, `doc:${noteId}`, 32);
}

export async function docUpdatePath(nameKey, noteId, deviceId, seq) {
  const id = await remoteDocId(nameKey, noteId);

  return joinRemotePath(
    SYNC_ROOT,
    'docs',
    id,
    'updates',
    `${deviceId}-${padSeq(seq)}.ypack.enc`
  );
}

export async function docSnapshotPath(nameKey, noteId, deviceId, seq) {
  const id = await remoteDocId(nameKey, noteId);

  return joinRemotePath(
    SYNC_ROOT,
    'docs',
    id,
    'snapshots',
    `${deviceId}-${padSeq(seq)}.ysnap.enc`
  );
}

export async function remoteAssetId(nameKey, assetId) {
  return hmacId(nameKey, `asset:${assetId}`, 32);
}

export async function assetBlobPath(nameKey, assetId) {
  const id = await remoteAssetId(nameKey, assetId);
  return joinRemotePath(SYNC_ROOT, 'assets', `${id}.blob.enc`);
}

export async function docUpdatesPrefix(nameKey, noteId) {
  const id = await remoteDocId(nameKey, noteId);
  return joinRemotePath(SYNC_ROOT, 'docs', id, 'updates') + '/';
}

export async function docSnapshotsPrefix(nameKey, noteId) {
  const id = await remoteDocId(nameKey, noteId);
  return joinRemotePath(SYNC_ROOT, 'docs', id, 'snapshots') + '/';
}

export function vaultUpdatesPrefix() {
  return joinRemotePath(SYNC_ROOT, 'vault', 'updates') + '/';
}

export function vaultSnapshotsPrefix() {
  return joinRemotePath(SYNC_ROOT, 'vault', 'snapshots') + '/';
}