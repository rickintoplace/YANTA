import { describe, it, expect, vi, beforeEach } from 'vitest';

const devices = new Map();

vi.mock('../../src/sync2/vault-doc.js', () => ({
  getVaultDoc: () => ({ transact: (fn) => fn() }),
  vaultEventsMap: () => new Map(),
  vaultTombstonesMap: () => new Map(),
  vaultDevicesMap: () => devices,
  safeJsonClone: (v) => JSON.parse(JSON.stringify(v)),
}));

const {
  notificationCapableDevices,
  notificationSyncStatusForEvent,
  recordNativeNotificationAck,
} = await import('../../src/notification-sync-status.js');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

function android(id, { name = 'Android phone', created, lastSeenAt, ackAt, versions = {} }) {
  devices.set(id, {
    id,
    name,
    created,
    lastSeenAt,
    notificationSync: { isAndroidApp: true, eventVersions: versions, updatedAt: ackAt },
  });
}

beforeEach(() => {
  devices.clear();
  window.yantaSync2 = { deviceId: 'new-install' };
});

describe('notification-capable devices', () => {
  it('drops the record a reinstall left behind', () => {
    android('old-install', { created: NOW - 90 * DAY, lastSeenAt: NOW - 3 * DAY, ackAt: NOW - 3 * DAY });
    android('new-install', { created: NOW - 2 * DAY, lastSeenAt: NOW, ackAt: NOW });

    expect(notificationCapableDevices().map((d) => d.id)).toEqual(['new-install']);
  });

  it('keeps two phones of the same name that are both in use', () => {
    android('phone-a', { created: NOW - 90 * DAY, lastSeenAt: NOW - DAY, ackAt: NOW - DAY });
    android('new-install', { created: NOW - 30 * DAY, lastSeenAt: NOW, ackAt: NOW });

    expect(notificationCapableDevices().map((d) => d.id).sort()).toEqual(['new-install', 'phone-a']);
  });

  it('records the versions the native scheduler was handed', () => {
    android('new-install', { created: NOW - DAY, lastSeenAt: NOW, ackAt: NOW - DAY });

    recordNativeNotificationAck({}, { 'evt_shared': 123 });

    expect(devices.get('new-install').notificationSync.eventVersions).toEqual({ 'evt_shared': 123 });
    const status = notificationSyncStatusForEvent({
      id: 'evt_shared',
      updated: 123,
      start: new Date(NOW + DAY).toISOString(),
    });
    expect(status.upcoming).toBe(true);
    expect(status.devices[0].state).toBe('synced');
  });

  it('marks a past event as not upcoming', () => {
    android('new-install', { created: NOW - DAY, lastSeenAt: NOW, ackAt: NOW });

    expect(notificationSyncStatusForEvent({ id: 'e', start: new Date(NOW - DAY).toISOString() }).upcoming).toBe(false);
  });
});
