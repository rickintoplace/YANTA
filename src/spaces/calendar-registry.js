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

// ---------------- shared-event providers --------------------------
//
// A calendar space is not the only source of events that arrive from
// someone else: a folder space carries the events linked to its notes.
// The calendar module folds every MOUNTED provider into its in-memory
// state, so it needs one way to enumerate them, whatever kind of space
// they came from.
//
// Provider contract:
//   { spaceId, role, isOwner, canWrite, title, categories(), events() }

const eventProviders = new Map(); // spaceId -> provider

export function registerSpaceEventProvider(provider) {
  eventProviders.set(provider.spaceId, provider);
}

export function unregisterSpaceEventProvider(spaceId) {
  eventProviders.delete(spaceId);
}

export function spaceEventProviders() {
  return [...eventProviders.values()];
}

/** Providers whose events came from someone else's share. */
export function mountedSpaceEventProviders() {
  return spaceEventProviders().filter((provider) => !provider.isOwner);
}

export function spaceEventProviderForSpace(spaceId) {
  return eventProviders.get(spaceId) || null;
}

/**
 * The mounted provider a category was hydrated from, if any — the
 * calendar uses it to keep such a category out of the local vault.
 */
export function mountedSpaceEventProviderForCategory(categoryId) {
  if (!categoryId) return null;

  for (const provider of mountedSpaceEventProviders()) {
    if (provider.categories().some((cat) => cat.id === categoryId)) return provider;
  }

  return null;
}
