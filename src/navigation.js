// ============================================================
// YANTA — Navigation / History helpers
// Central place for app routes:
// - Dashboard/Home: #dashboard or #dashboard/<folderId>
// - Note:          #<noteId>
// - Calendar:      #calendar
// - Calendar Event:#calendar/<eventId>
//
// Important:
// pushState/replaceState do NOT emit popstate.
// Therefore every programmatic app-route navigation emits
// yanta-app-route-change so fullscreen overlays/surfaces can close.
// ============================================================

function emitAppRouteChange(routeState, {
  replace = false,
} = {}) {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent('yanta-app-route-change', {
    detail: {
      ...routeState,
      replace,
    },
  }));
}

function writeAppHistoryState(routeState, url, {
  replace = false,
} = {}) {
  /*
    If an app route is opened while a transient overlay state is current
    (Graph/RSS/dialog/mobile sidebar), replace that overlay entry instead
    of stacking a normal app route on top of it.

    This prevents:
      URL changed to note/dashboard, but old overlay stays visible.
  */
  const shouldReplace =
    replace ||
    !!history.state?.yantaOverlay;

  history[shouldReplace ? 'replaceState' : 'pushState'](
    routeState,
    '',
    url
  );

  emitAppRouteChange(routeState, {
    replace: shouldReplace,
  });
}

export function dashboardUrl(folderId = null) {
  return folderId
    ? `#dashboard/${encodeURIComponent(folderId)}`
    : '#dashboard';
}

export function noteUrl(noteId) {
  return '#' + encodeURIComponent(noteId);
}

export function calendarUrl() {
  return '#calendar';
}

export function dashboardState(folderId = null) {
  return {
    surface: 'dashboard',
    folderId: folderId || null,
  };
}

export function noteState(noteId) {
  return {
    surface: 'note',
    noteId,
  };
}

export function calendarState() {
  return {
    surface: 'calendar',
  };
}

export function calendarEventUrl(eventId) {
  const id = String(eventId || '').trim();

  return id
    ? `#calendar/${encodeURIComponent(id)}`
    : calendarUrl();
}

export function calendarEventState(eventId) {
  const id = String(eventId || '').trim();

  return {
    surface: 'calendar',
    eventId: id || null,
  };
}

export function pushCalendarEventHistory(eventId) {
  const id = String(eventId || '').trim();

  if (!id) {
    pushCalendarHistory();
    return;
  }

  writeAppHistoryState(
    calendarEventState(id),
    calendarEventUrl(id)
  );
}

export function replaceCalendarEventHistory(eventId) {
  const id = String(eventId || '').trim();

  if (!id) {
    replaceCalendarHistory();
    return;
  }

  writeAppHistoryState(
    calendarEventState(id),
    calendarEventUrl(id),
    {
      replace: true,
    }
  );
}

export function pushDashboardHistory(folderId = null) {
  writeAppHistoryState(
    dashboardState(folderId),
    dashboardUrl(folderId)
  );
}

export function replaceDashboardHistory(folderId = null) {
  writeAppHistoryState(
    dashboardState(folderId),
    dashboardUrl(folderId),
    {
      replace: true,
    }
  );
}

export function pushNoteHistory(noteId) {
  writeAppHistoryState(
    noteState(noteId),
    noteUrl(noteId)
  );
}

export function replaceNoteHistory(noteId) {
  writeAppHistoryState(
    noteState(noteId),
    noteUrl(noteId),
    {
      replace: true,
    }
  );
}

export function pushCalendarHistory() {
  writeAppHistoryState(
    calendarState(),
    calendarUrl()
  );
}

export function replaceCalendarHistory() {
  writeAppHistoryState(
    calendarState(),
    calendarUrl(),
    {
      replace: true,
    }
  );
}

export function parseAppHash(hash = window.location.hash) {
  const raw = decodeURIComponent(String(hash || '').replace(/^#/, ''));

  if (!raw) {
    return {
      surface: null,
      noteId: null,
      folderId: null,
      eventId: null,
    };
  }

  if (raw === 'calendar') {
    return {
      surface: 'calendar',
      noteId: null,
      folderId: null,
      eventId: null,
    };
  }

  if (raw.startsWith('calendar/')) {
    return {
      surface: 'calendar',
      noteId: null,
      folderId: null,
      eventId: raw.slice('calendar/'.length) || null,
    };
  }

  if (raw === 'dashboard') {
    return {
      surface: 'dashboard',
      noteId: null,
      folderId: null,
      eventId: null,
    };
  }

  if (raw.startsWith('dashboard/')) {
    return {
      surface: 'dashboard',
      noteId: null,
      folderId: raw.slice('dashboard/'.length) || null,
      eventId: null,
    };
  }

  if (raw.startsWith('share=') || raw.startsWith('share2=')) {
    return {
      surface: 'share',
      noteId: null,
      folderId: null,
      eventId: null,
    };
  }

  return {
    surface: 'note',
    noteId: raw,
    folderId: null,
    eventId: null,
  };
}

export function currentHistorySurface() {
  return history.state?.surface || parseAppHash().surface || null;
}