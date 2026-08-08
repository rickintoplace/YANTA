/*
  Turning a template's `event` block into a real calendar entry linked to the
  note the template just created.

  Split into its own module so template-picker.js can import calendar.js
  lazily — calendar.js pulls in FullCalendar, and the picker must open fast
  even for the templates that carry no date at all.

  Dates are relative (`inDays`, `startHour`) rather than absolute: a bundled
  template with a fixed date would be in the past by the time anyone used it,
  and a template that hands you an expired invitation is worse than none.
*/

import { putCalendarEvent } from '../calendar.js';

/**
 * When a template's event starts. Exported because the picker fills the note's
 * date placeholders from it — text and calendar entry must agree.
 */
export function eventStartDate(spec, now = new Date()) {
  const start = new Date(now.getTime());

  start.setDate(start.getDate() + Number(spec?.inDays || 0));
  start.setHours(Number(spec?.startHour ?? 9), Number(spec?.startMinute ?? 0), 0, 0);

  return start;
}

export async function createCalendarEventFromTemplate(spec, noteId) {
  if (!spec || !noteId) return null;

  const start = eventStartDate(spec);
  const end = new Date(start.getTime() + Number(spec.durationMinutes || 60) * 60000);

  try {
    return putCalendarEvent({
      title: spec.title || 'Untitled event',
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: !!spec.allDay,
      location: spec.location || '',
      icon: spec.icon || undefined,
      noteId,
    });
  } catch (err) {
    // A missing date must never cost the user the note itself.
    console.warn('[YANTA templates] could not create the linked event', err);
    return null;
  }
}
