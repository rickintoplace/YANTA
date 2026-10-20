import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import {
  CLAIM_TTL_MS,
  claimedElsewhere,
  claimWinner,
  writeClaim,
} from '../../src/pulse/pulse-claims.js';

function device() {
  const doc = new Y.Doc();
  return { doc, claims: doc.getMap('pulseClaims') };
}

function exchange(a, b) {
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
  Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
}

const T = Date.parse('2026-10-18T11:00:00Z');

describe('pulse run claims', () => {
  it('two devices claiming the same slot agree on one winner', () => {
    const laptop = device();
    const phone = device();

    writeClaim(phone.claims, 'note-gardener', 'phone', T + 35_000);
    writeClaim(laptop.claims, 'note-gardener', 'laptop', T + 5_000);
    exchange(laptop, phone);

    const now = T + 60_000;
    expect(claimWinner(laptop.claims, 'note-gardener', now).deviceId).toBe('laptop');
    expect(claimWinner(phone.claims, 'note-gardener', now).deviceId).toBe('laptop');
    expect(claimedElsewhere(phone.claims, 'note-gardener', 'phone', now)).toBe(true);
    expect(claimedElsewhere(laptop.claims, 'note-gardener', 'laptop', now)).toBe(false);
  });

  it('breaks a tie on the device id, the same way everywhere', () => {
    const a = device();
    const b = device();

    writeClaim(a.claims, 'loose-ends', 'device-b', T);
    writeClaim(b.claims, 'loose-ends', 'device-a', T);
    exchange(a, b);

    expect(claimWinner(a.claims, 'loose-ends', T).deviceId).toBe('device-a');
    expect(claimWinner(b.claims, 'loose-ends', T).deviceId).toBe('device-a');
  });

  it('keeps routines apart', () => {
    const a = device();

    writeClaim(a.claims, 'loose-ends', 'phone', T);

    expect(claimedElsewhere(a.claims, 'note-gardener', 'laptop', T)).toBe(false);
  });

  it('stops blocking once a claim is stale', () => {
    const a = device();

    writeClaim(a.claims, 'loose-ends', 'phone', T);

    expect(claimedElsewhere(a.claims, 'loose-ends', 'laptop', T + CLAIM_TTL_MS - 1)).toBe(true);
    expect(claimedElsewhere(a.claims, 'loose-ends', 'laptop', T + CLAIM_TTL_MS)).toBe(false);
  });

  it('prunes old claims when writing', () => {
    const a = device();

    writeClaim(a.claims, 'loose-ends', 'phone', T);
    writeClaim(a.claims, 'note-gardener', 'laptop', T + 3 * 24 * 60 * 60 * 1000);

    expect([...a.claims.keys()]).toEqual(['note-gardener\nlaptop']);
  });
});
