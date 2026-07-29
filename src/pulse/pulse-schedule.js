// ============================================================
// YANTA Pulse — schedule evaluation
//
// Supports two `when` forms:
//   - 5-field cron: "0 7 * * 1-5"  (minute hour day month weekday)
//   - plain interval: "45m", "2h", "1d"
//
// Everything is evaluated in the device's local timezone, which is the
// only interpretation that matches what a user means by "at 7".
// ============================================================

const MINUTE_MS = 60_000;

/** "45m" | "2h" | "1d" | "90" (bare number = minutes) → ms, else 0. */
export function parseDuration(value) {
  const m = /^(\d+(?:\.\d+)?)\s*([smhd]?)$/i.exec(String(value ?? '').trim());

  if (!m) return 0;

  const n = Number(m[1]);
  const unit = (m[2] || 'm').toLowerCase();

  const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];

  return Number.isFinite(n) ? Math.round(n * factor) : 0;
}

/** How far back a missed cron run stays worth catching up on. */
export const CATCH_UP_WINDOW_MS = 36 * 60 * 60 * 1000;

/** How far ahead we resolve the next run for background wake-ups. */
export const LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;

const FIELD_RANGES = [
  [0, 59],   // minute
  [0, 23],   // hour
  [1, 31],   // day of month
  [1, 12],   // month
  [0, 6],    // day of week (0 = Sunday)
];

function matchesField(spec, value, [min, max]) {
  for (const part of String(spec).split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;

    if (!Number.isFinite(step) || step < 1) return false;

    let from = min;
    let to = max;

    if (rangePart !== '*') {
      const bounds = rangePart.split('-');

      from = Number(bounds[0]);
      to = bounds.length > 1 ? Number(bounds[1]) : from;

      if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
    }

    if (value < from || value > to) continue;
    if ((value - from) % step === 0) return true;
  }

  return false;
}

export function isCronExpression(when) {
  return String(when || '').trim().split(/\s+/).length === 5;
}

export function matchesCron(expr, date) {
  const fields = String(expr || '').trim().split(/\s+/);

  if (fields.length !== 5) return false;

  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ];

  return fields.every((spec, i) => matchesField(spec, values[i], FIELD_RANGES[i]));
}

function floorToMinute(ms) {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

/**
 * The most recent scheduled moment that has passed but not yet run, or
 * 0 when the routine is not due.
 *
 * Scanning backwards (rather than forward from `lastRunAt`) means a
 * device that was off for a week fires each routine exactly once on
 * return instead of replaying every missed slot.
 */
export function dueSince(routine, lastRunAt = 0, now = Date.now()) {
  const when = String(routine?.when || '').trim();

  if (!when) return 0;

  const interval = isCronExpression(when) ? 0 : parseDuration(when);

  if (interval) {
    if (!lastRunAt) return floorToMinute(now);
    return now - lastRunAt >= interval ? floorToMinute(now) : 0;
  }

  if (!isCronExpression(when)) return 0;

  const earliest = Math.max(
    Number(lastRunAt) || 0,
    now - CATCH_UP_WINDOW_MS,
  );

  const cursor = new Date(floorToMinute(now));

  while (cursor.getTime() > earliest) {
    if (matchesCron(when, cursor)) return cursor.getTime();
    cursor.setTime(cursor.getTime() - MINUTE_MS);
  }

  return 0;
}

/**
 * Next moment this routine wants to run, or 0 when it has no clock
 * trigger (event-only routines wake on their sensor, not on a timer).
 */
export function nextDueAt(routine, lastRunAt = 0, now = Date.now()) {
  const when = String(routine?.when || '').trim();

  if (!when) return 0;

  const interval = isCronExpression(when) ? 0 : parseDuration(when);

  if (interval) {
    return Math.max(now, (Number(lastRunAt) || now) + interval);
  }

  if (!isCronExpression(when)) return 0;

  const cursor = new Date(floorToMinute(now) + MINUTE_MS);
  const limit = now + LOOKAHEAD_MS;

  while (cursor.getTime() <= limit) {
    if (matchesCron(when, cursor)) return cursor.getTime();
    cursor.setTime(cursor.getTime() + MINUTE_MS);
  }

  return 0;
}
