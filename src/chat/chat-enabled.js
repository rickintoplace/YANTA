// ============================================================
// YANTA Chat — availability switch
//
// Chat is switched OFF (2026-09-09).
//
// Why: the Matrix homeserver behind yanta.me was hosted on a machine that
// the provider terminated and wiped. Every account, room, message and
// device key under that server is gone, and there is no server to talk to
// at all. Leaving the entry points in place would offer people a feature
// that cannot work — a chat button that always fails is worse than no
// chat button.
//
// Nothing is deleted. Every module stays, every import still resolves;
// only the ways *into* chat are hidden, so bringing it back is this one
// constant plus a working homeserver.
//
// Before flipping it back to true:
//   1. A homeserver answers at MATRIX_HS_URL.
//   2. /api/chat/provision can re-issue credentials for accounts that
//      already have a chat_accounts row — otherwise every existing user
//      is locked out by the 409 "already has a Matrix account" branch,
//      because their old account no longer exists on the new server.
//   3. Space invites over Matrix DMs (src/spaces/space-matrix.js) work
//      again; until then shares are delivered by link.
// ============================================================

export const CHAT_ENABLED = false;

export function isChatEnabled() {
  return CHAT_ENABLED;
}
