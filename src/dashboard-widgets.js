// ============================================================
// YANTA Dashboard — widget registry
//
// Widgets are self-contained sections rendered above the note grid
// on the dashboard ROOT view (never inside folders). A widget's
// render() may return null to stay hidden (e.g. nothing new to show),
// and is responsible for keeping its own DOM fresh — the dashboard's
// structure-signature cache deliberately skips re-rendering widgets.
//
// This registry is intentionally tiny: it exists so calendar, chat
// and other modules can plug in widgets without dashboard.js knowing
// about any of them.
// ============================================================

const widgets = new Map();

export function registerDashboardWidget({
  id,
  order = 100,
  render,
} = {}) {
  if (!id || typeof render !== 'function') return;

  widgets.set(id, {
    id,
    order,
    render,
  });
}

export function hasDashboardWidgets() {
  return widgets.size > 0;
}

/**
 * Render all registered widgets into the host element.
 * Widgets render independently — one failing must not hide the rest.
 */
export async function renderDashboardWidgetsInto(host) {
  if (!host) return;

  const defs = [...widgets.values()].sort((a, b) => a.order - b.order);

  for (const def of defs) {
    try {
      const node = await def.render();
      if (node && host.isConnected !== false) host.append(node);
    } catch (err) {
      console.warn('[YANTA Dashboard] widget render failed:', def.id, err);
    }
  }
}
