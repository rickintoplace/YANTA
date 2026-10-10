import { describe, it, expect, beforeEach, vi } from 'vitest';

const settings = new Map();
vi.mock('../../src/core.js', () => ({
  store: {
    settings: {
      get: async (k, d) => (settings.has(k) ? structuredClone(settings.get(k)) : d),
      set: async (k, v) => { settings.set(k, structuredClone(v)); },
    },
  },
}));

const keys = await import('../../src/lock/lock-keys.js');
const { generateSyncKey } = await import('../../src/sync2/crypto.js');

beforeEach(() => {
  settings.clear();
  keys.forgetUnlockedKey();
});

describe('app lock keys', () => {
  it('unlocks with the right password only, and with the recovery key', async () => {
    const syncKey = generateSyncKey();
    await keys.setLockPassword('correct horse', { syncKey });
    const ldk = new Uint8Array(keys.localDataKey());
    keys.forgetUnlockedKey();

    expect(await keys.unlockWithPassword('wrong')).toBe(false);
    expect(keys.isUnlocked()).toBe(false);

    expect(await keys.unlockWithPassword('correct horse')).toBe(true);
    expect([...keys.localDataKey()]).toEqual([...ldk]);
    keys.forgetUnlockedKey();

    expect(await keys.unlockWithRecoveryKey(generateSyncKey())).toBe(false);
    expect(await keys.unlockWithRecoveryKey(syncKey)).toBe(true);
    expect([...keys.localDataKey()]).toEqual([...ldk]);
  }, 30_000);

  it('a new password keeps the same data key', async () => {
    const syncKey = generateSyncKey();
    await keys.setLockPassword('first-pass', { syncKey });
    const ldk = [...keys.localDataKey()];
    await keys.setLockPassword('second-pass', { syncKey });
    keys.forgetUnlockedKey();

    expect(await keys.unlockWithPassword('first-pass')).toBe(false);
    expect(await keys.unlockWithPassword('second-pass')).toBe(true);
    expect([...keys.localDataKey()]).toEqual(ldk);
  }, 30_000);

  it('stores no password and no plain key', async () => {
    await keys.setLockPassword('correct horse', { syncKey: generateSyncKey() });
    const stored = JSON.stringify(settings.get('lock.v1'));
    expect(stored).not.toContain('correct horse');
    expect(stored).not.toContain(Buffer.from(keys.localDataKey()).toString('base64url'));
  }, 30_000);
});
