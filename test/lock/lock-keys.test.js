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

  it('a passkey unwraps the same data key, survives a password change and can be removed', async () => {
    await keys.setLockPassword('correct horse');
    const ldk = new Uint8Array(keys.localDataKey());
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));

    await keys.addPasskeyWrap({ credentialId: 'cred1', prfSalt: new Uint8Array(32), prfOutput, attachment: 'platform' });
    await keys.setLockPassword('battery staple');
    keys.forgetUnlockedKey();

    expect(await keys.unlockWithPasskeyOutput('cred1', crypto.getRandomValues(new Uint8Array(32)))).toBe(false);
    expect(await keys.unlockWithPasskeyOutput('other', prfOutput)).toBe(false);
    expect(await keys.unlockWithPasskeyOutput('cred1', prfOutput)).toBe(true);
    expect([...keys.localDataKey()]).toEqual([...ldk]);

    await keys.removePasskeyWrap('cred1');
    keys.forgetUnlockedKey();
    expect(await keys.unlockWithPasskeyOutput('cred1', prfOutput)).toBe(false);
  }, 30_000);

  it('adding a passkey needs the device unlocked', async () => {
    await keys.setLockPassword('correct horse');
    keys.forgetUnlockedKey();
    await expect(keys.addPasskeyWrap({ credentialId: 'c', prfSalt: new Uint8Array(32), prfOutput: new Uint8Array(32) })).rejects.toThrow('locked');
  }, 30_000);
});
