// ============================================================
// YANTA Calendar — FullCalendar, loaded on demand
//
// FullCalendar with its plugins is roughly 600 KB of source. Only the
// calendar view needs it; everything else in calendar.js (events state,
// recurrence, the vault bridge the dashboard and Pulse read from) runs
// at boot without it. calendar.js imports this module when the view
// first opens, and once at idle after boot so that opening is instant.
// ============================================================

import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';

/*
  Why no locales-all import: the full package (~65 languages) is large.
  fullCalendarLocale() maps almost always onto these core languages; only
  rarer navigator.language values load the full package (calendar.js).
*/
import deLocale from '@fullcalendar/core/locales/de';
import frLocale from '@fullcalendar/core/locales/fr';
import esLocale from '@fullcalendar/core/locales/es';
import itLocale from '@fullcalendar/core/locales/it';
import nlLocale from '@fullcalendar/core/locales/nl';
import enGbLocale from '@fullcalendar/core/locales/en-gb';

export { Calendar };

export const FC_PLUGINS = [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin];

export const CORE_FC_LOCALES = [deLocale, frLocale, esLocale, itLocale, nlLocale, enGbLocale];
