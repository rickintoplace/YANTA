// ============================================================
// YANTA Shared Spaces — calendar bridge registry
//
// Tiny shared surface between the calendar module and the spaces
// layer so neither has to import the other at module-eval time.
// calendar.js asks "is this category shared, and through which
// bridge?"; space-session registers/unregisters live bridges here.
// ============================================================

const bridges = new Map(); // spaceId -> CalendarBridge

export function registerCalendarBridge(bridge) {
  bridges.set(bridge.spaceId, bridge);
}

export function unregisterCalendarBridge(spaceId) {
  bridges.delete(spaceId);
}

export function calendarBridges() {
  return [...bridges.values()];
}

export function calendarBridgeForSpace(spaceId) {
  return bridges.get(spaceId) || null;
}

export function calendarBridgeForCategory(categoryId) {
  if (!categoryId) return null;

  for (const bridge of bridges.values()) {
    if (bridge.categoryId === categoryId) return bridge;
  }

  return null;
}

/** Bridges whose category was mounted from someone else's share. */
export function mountedCalendarBridges() {
  return calendarBridges().filter((bridge) => !bridge.isOwner);
}

export function categoryIsShared(categoryId) {
  return !!calendarBridgeForCategory(categoryId);
}
