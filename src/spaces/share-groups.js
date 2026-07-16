// ============================================================
// YANTA Shared Spaces — share groups (local address book)
//
// A group is a personal, device-local shortcut: a named list of
// Matrix IDs ("Family", "Team"). Sharing with a group just expands
// to per-member grants — the server and the E2EE key delivery stay
// strictly per-person, so leaving/kicking still works per member.
// ============================================================

import { store } from '../core.js';

const SETTINGS_KEY = 'share.groups.v1';

let cache = null;

export async function loadShareGroups() {
  if (cache) return cache;

  const raw = await store.settings.get(SETTINGS_KEY, null).catch(() => null);

  cache = Array.isArray(raw)
    ? raw
        .filter((g) => g && g.id && g.name)
        .map((g) => ({
          id: String(g.id),
          name: String(g.name),
          members: Array.isArray(g.members) ? g.members.map(String) : [],
        }))
    : [];

  return cache;
}

function persist() {
  store.settings.set(SETTINGS_KEY, cache || []).catch(() => {});
}

export async function createShareGroup(name) {
  await loadShareGroups();

  const group = {
    id: `grp_${Math.random().toString(36).slice(2, 10)}`,
    name: String(name || 'Group').trim() || 'Group',
    members: [],
  };

  cache.push(group);
  persist();

  return group;
}

export async function renameShareGroup(groupId, name) {
  await loadShareGroups();

  const group = cache.find((g) => g.id === groupId);
  if (!group) return null;

  group.name = String(name || group.name).trim() || group.name;
  persist();

  return group;
}

export async function deleteShareGroup(groupId) {
  await loadShareGroups();
  cache = cache.filter((g) => g.id !== groupId);
  persist();
}

export async function setShareGroupMembers(groupId, members) {
  await loadShareGroups();

  const group = cache.find((g) => g.id === groupId);
  if (!group) return null;

  group.members = [...new Set(members.map((m) => String(m).trim()).filter(Boolean))];
  persist();

  return group;
}

export async function addShareGroupMember(groupId, matrixUserId) {
  await loadShareGroups();

  const group = cache.find((g) => g.id === groupId);
  if (!group) return null;

  return setShareGroupMembers(groupId, [...group.members, matrixUserId]);
}

export async function removeShareGroupMember(groupId, matrixUserId) {
  await loadShareGroups();

  const group = cache.find((g) => g.id === groupId);
  if (!group) return null;

  return setShareGroupMembers(
    groupId,
    group.members.filter((m) => m !== matrixUserId)
  );
}
