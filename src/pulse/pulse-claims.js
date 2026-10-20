// ============================================================
// YANTA Pulse — which device runs a routine
//
// Every open device runs the same scheduler against the same routines.
// The shared run log keeps them apart once a run has been recorded, but
// a run takes a minute of model calls, and two devices that are both
// open at 11:00 on Sunday each see the slot as free and each deliver a
// note-gardener card — worded differently, so nothing downstream can
// tell they are the same.
//
// So a device claims the routine first and waits for sync to carry the
// claim across before spending anything. Each device writes only its
// own key, so concurrent claims merge instead of overwriting each other,
// and every device that has seen both picks the same winner: the earlier
// claim, ties to the smaller device id. A device that already sees
// someone else's fresh claim stays out without writing one.
//
// Not a lock: a claim that has not arrived by the end of the wait can
// still lose the race. The wait is sized for a vault poke, which usually
// carries it in a few seconds.
// ============================================================

// How long a claim holds off the other devices — a run, with headroom.
// A device that claimed and then went away stops blocking after this.
export const CLAIM_TTL_MS = 10 * 60 * 1000;

// How long a claimant waits for other devices' claims before deciding.
export const CLAIM_SETTLE_MS = 20_000;

// Old claims are only bookkeeping; drop them when writing.
const CLAIM_KEEP_MS = 48 * 60 * 60 * 1000;

function claimKey(name, deviceId) {
  return `${name}\n${deviceId}`;
}

/** Fresh claims for one routine, winner first. */
export function freshClaims(claims, name, now = Date.now()) {
  const out = [];

  for (const claim of claims.values()) {
    if (claim?.name !== name || !claim.deviceId) continue;

    const at = Number(claim.at);
    if (!Number.isFinite(at) || at <= now - CLAIM_TTL_MS) continue;

    out.push({ name, deviceId: String(claim.deviceId), at });
  }

  return out.sort((a, b) => a.at - b.at || (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0));
}

export function claimWinner(claims, name, now = Date.now()) {
  return freshClaims(claims, name, now)[0] || null;
}

/** Another device holds the routine right now. */
export function claimedElsewhere(claims, name, deviceId, now = Date.now()) {
  const winner = claimWinner(claims, name, now);
  return !!winner && winner.deviceId !== deviceId;
}

export function writeClaim(claims, name, deviceId, now = Date.now()) {
  claims.doc.transact(() => {
    for (const [key, claim] of claims.entries()) {
      if (!(Number(claim?.at) > now - CLAIM_KEEP_MS)) claims.delete(key);
    }

    claims.set(claimKey(name, deviceId), { name, deviceId, at: now });
  });
}
