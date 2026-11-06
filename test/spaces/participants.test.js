import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/core.js', () => ({ state: { spaces: new Map() }, store: { settings: { get: async () => '' } } }));
vi.mock('../../src/sync2/y-idb-persistence.js', () => ({ IndexeddbPersistence: class {} }));

const { foldParticipants } = await import('../../src/spaces/space-people.js');

const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

describe('one entry per person in a shared calendar', () => {
  it('folds the names the "Couple Calendar" accumulated into two people', async () => {
    // The shapes found on the server on 2026-11-06, after the owner's
    // roster refresh adds e-mail hashes and aliases.
    const roster = new Map([
      ['@froschi:yanta.me', { role: 'write', emailHash: await sha('rhohlbein@proton.me') }],
      ['rickintoplace@proton.me', { role: 'owner', emailHash: await sha('rickintoplace@proton.me'), aliases: ['@rick:yanta.me'] }],
    ]);
    const profiles = new Map([
      ['@rick:yanta.me', { name: 'Rick', self: true, at: 1785481902589 }],
      ['@froschi:yanta.me', { name: 'froschi', self: true, at: 1785482953144 }],
      ['rickintoplace@proton.me', { name: 'rickintoplace', self: true, at: 1793997065465 }],
      ['rhohlbein@proton.me', { name: 'rhohlbein', self: true, at: 1793997100000 }],
    ]);
    const activity = [{ by: 'Someone', at: 1793991844581 }, { by: '@rick:yanta.me', at: 1786105646686 }];

    const people = await foldParticipants({ roster, profiles, activity, me: 'rickintoplace@proton.me' });

    expect(people.map((p) => [p.name, p.role, p.isMe])).toEqual([
      ['Rick', 'owner', true],
      ['froschi', 'write', false],
    ]);
  });
});
