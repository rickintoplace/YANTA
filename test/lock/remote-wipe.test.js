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

const calls = [];
let wipeAnswer = false;
vi.mock('../../src/cloud/cloud-api.js', () => ({
  apiFetch: async (path, opts = {}) => {
    calls.push({ path, ...opts });
    if (path === '/api/devices/wipe-check') return { ok: true, wipe: wipeAnswer };
    return { ok: true };
  },
}));

const wipeThisDevice = vi.fn(async () => {});
vi.mock('../../src/lock/wipe-device.js', () => ({ wipeThisDevice }));

const { ensureWipeSecret, checkRemoteWipe } = await import('../../src/lock/remote-wipe.js');

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

beforeEach(() => {
  settings.clear();
  calls.length = 0;
  wipeAnswer = false;
  wipeThisDevice.mockClear();
  settings.set('sync2.provider', 'yanta-cloud');
  settings.set('sync2.yantaCloud.vaultId', 'vlt_1');
  window.yantaSync2 = { deviceId: 'dev_1' };
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('remote wipe', () => {
  it('registers only the hash of the secret, once per vault and device', async () => {
    expect(await ensureWipeSecret()).toBe(true);
    expect(await ensureWipeSecret()).toBe(true);

    const registrations = calls.filter((c) => c.path === '/api/devices/wipe-secret');
    expect(registrations).toHaveLength(1);

    const record = settings.get('wipe.v1');
    expect(registrations[0].body).toEqual({ vaultId: 'vlt_1', secretHash: await sha256Hex(record.secret) });
    expect(registrations[0].headers['x-yanta-device-id']).toBe('dev_1');
    expect(JSON.stringify(registrations[0])).not.toContain(record.secret);
  });

  it('does nothing outside YANTA Cloud', async () => {
    settings.set('sync2.provider', 'google-drive');
    expect(await ensureWipeSecret()).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('wipes only when the server says this device was removed, confirming first', async () => {
    await ensureWipeSecret();

    expect(await checkRemoteWipe()).toBe(false);
    expect(wipeThisDevice).not.toHaveBeenCalled();

    wipeAnswer = true;
    expect(await checkRemoteWipe()).toBe(true);
    expect(wipeThisDevice).toHaveBeenCalledWith({ syncFirst: false });

    const paths = calls.map((c) => c.path);
    expect(paths.lastIndexOf('/api/devices/wipe-done')).toBeGreaterThan(paths.lastIndexOf('/api/devices/wipe-check'));
  });

  it('never asks without a registered secret', async () => {
    expect(await checkRemoteWipe()).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
