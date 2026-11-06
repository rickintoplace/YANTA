import { describe, it, expect, afterEach } from 'vitest';

import {
  registerCalendarBridge,
  unregisterCalendarBridge,
  registerSpaceEventProvider,
  unregisterSpaceEventProvider,
  mountedSpaceEventProviderForCategory,
} from '../../src/spaces/calendar-registry.js';

const folder = {
  spaceId: 'space_folder',
  isOwner: false,
  role: 'read',
  categories: () => [{ id: 'cal_couple' }, { id: 'cal_work' }],
  events: () => [],
};

afterEach(() => {
  unregisterSpaceEventProvider('space_folder');
  unregisterCalendarBridge('space_calendar');
});

describe('two shares bringing the same calendar', () => {
  it('a shared folder alone makes its calendars read-only', () => {
    registerSpaceEventProvider(folder);
    expect(mountedSpaceEventProviderForCategory('cal_couple')).toBe(folder);
  });

  it('the calendar joined with an edit link wins over the folder', () => {
    registerSpaceEventProvider(folder);
    registerCalendarBridge({ spaceId: 'space_calendar', categoryId: 'cal_couple', isOwner: false, canWrite: true });
    expect(mountedSpaceEventProviderForCategory('cal_couple')).toBeNull();
    // Other calendars of the folder stay read-only.
    expect(mountedSpaceEventProviderForCategory('cal_work')).toBe(folder);
  });
});
