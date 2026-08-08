/*
  Funnel counters — client side.

  Fires an aggregate tally on the worker: which event, which A/B variant, which
  referring hostname. Nothing else, ever. There is deliberately no id, no
  session, no "already sent" flag — a flag would be a write to the visitor's
  device, and that write is what turns a counter into a consent question under
  § 25 TDDDG. Everything here must stay derivable from state the app already
  holds in memory.

  Fire-and-forget by design: a counter must never delay, block or break the
  thing the user actually asked for.
*/

import { YANTA_CLOUD_BASE_URL } from '../cloud/cloud-api.js';

const EVENT_URL = `${YANTA_CLOUD_BASE_URL}/api/metrics/event`;

/*
  Hostname only — never a path or a query. A full referrer can carry private
  context (an internal wiki page, a search term); the host is enough to tell
  one launch channel from another.
*/
function referrerHost() {
  try {
    const ref = String(document.referrer || '');
    if (!ref) return 'direct';

    const host = new URL(ref).hostname;
    if (!host || host === location.hostname) return 'direct';

    return host;
  } catch {
    return 'direct';
  }
}

/*
  The variant the visitor actually saw, if this page came from the landing
  page. landing-gate.js puts it in the URL when it hands over; nothing is read
  from storage.
*/
function currentVariant() {
  try {
    const v = String(new URLSearchParams(location.search).get('v') || '').toLowerCase();
    return v === 'a' || v === 'b' ? v : '';
  } catch {
    return '';
  }
}

export function countFunnelEvent(name) {
  const payload = JSON.stringify({
    name,
    variant: currentVariant(),
    source: referrerHost(),
  });

  try {
    const blob = new Blob([payload], { type: 'application/json' });
    if (navigator.sendBeacon?.(EVENT_URL, blob)) return;
  } catch {}

  try {
    fetch(EVENT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {});
  } catch {}
}

/*
  Activation: the workspace went from empty to having something in it.

  Guarded per page session in memory only. A user who wipes everything and
  starts over counts twice; in a daily total that is noise, and it is the right
  trade against writing a marker to their device.
*/
let firstNoteCounted = false;

export function countFirstNoteIfActivation(noteCountBefore, noteCountAfter) {
  if (firstNoteCounted) return;
  if (noteCountBefore !== 0 || noteCountAfter < 1) return;

  firstNoteCounted = true;
  countFunnelEvent('first_note');
}
