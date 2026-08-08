/*
  Boot entry.

  The only reason this module exists is that the app must not run at all on
  the landing page. Importing main.js has module-level side effects (settings,
  locale, IndexedDB) — on a marketing visit those would create app state for
  someone who has not even clicked "start" yet, and they would poison the
  returning-visitor check in landing-gate.js, which reads exactly those keys.

  landing-gate.js runs render-blocking in <head> and has already decided by
  the time this executes.

  Cost: app visits pay one extra round trip, because the main chunk is now a
  dynamic import rather than the entry itself. That is the price for not
  shipping the whole bundle to every bounce visitor on the landing page.
*/
if (!window.__yantaLanding) {
  import('./main.js');
}
