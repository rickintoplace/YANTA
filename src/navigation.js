// ============================================================
// YANTA — Navigation / History helpers
// Central place for app routes:
// - Dashboard/Home: #dashboard or #dashboard/<folderId>
// - Note:          #<noteId>
// - Calendar:      #calendar
// - Calendar Event:#calendar/<eventId>
// - Chat:          #chat or #chat/<roomId>
//
// Important:
// pushState/replaceState do NOT emit popstate.
// Therefore every programmatic app-route navigation emits
// yanta-app-route-change so fullscreen overlays/surfaces can close.
// ============================================================

function emitAppRouteChange(routeState, {
  replace = false,
  previousSurface = null,
  previousUrl = '',
  replacedOverlay = false,
} = {}) {
  if (typeof window === 'undefined') return;

  const nextSurface = routeState?.surface || null;

  window.dispatchEvent(new CustomEvent('yanta-app-route-change', {
    detail: {
      ...routeState,
      replace,
      previousSurface,
      previousUrl,
      sameSurface: !!previousSurface && previousSurface === nextSurface,
      replacedOverlay,
    },
  }));
}

function writeAppHistoryState(routeState, url, {
  replace = false,
} = {}) {
  /*
    Capture previous route BEFORE pushState/replaceState.
    Important for distinguishing a real surface change
    from an internal subroute update like:
      #chat -> #chat/<roomId>
  */
  const previousParsedRoute = parseAppHash();
  const previousSurface =
    history.state?.surface ||
    previousParsedRoute.surface ||
    null;

  const previousUrl = location.href;
  const hadOverlay = !!history.state?.yantaOverlay;

  /*
    If an app route is opened while a transient overlay state is current
    (Graph/RSS/dialog/mobile sidebar), replace that overlay entry instead
    of stacking a normal app route on top of it.
  */
  const shouldReplace =
    replace ||
    hadOverlay;

  history[shouldReplace ? 'replaceState' : 'pushState'](
    routeState,
    '',
    url
  );

  emitAppRouteChange(routeState, {
    replace: shouldReplace,
    previousSurface,
    previousUrl,
    replacedOverlay: hadOverlay,
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

export function chatUrl(roomId = null) {
  const id = String(roomId || '').trim();

  return id
    ? `#chat/${encodeURIComponent(id)}`
    : '#chat';
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

export function chatState(roomId = null, extra = {}) {
  const id = String(roomId || '').trim();

  return {
    ...extra,
    surface: 'chat',
    roomId: id || null,
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

export function pushChatHistory(roomId = null, extra = {}) {
  writeAppHistoryState(
    chatState(roomId, extra),
    chatUrl(roomId)
  );
}

export function replaceChatHistory(roomId = null) {
  writeAppHistoryState(
    chatState(roomId),
    chatUrl(roomId),
    {
      replace: true,
    }
  );
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
      roomId: null,
    };
  }

  if (raw === 'chat') {
    return {
      surface: 'chat',
      noteId: null,
      folderId: null,
      eventId: null,
      roomId: null,
    };
  }

  if (raw.startsWith('chat/')) {
    return {
      surface: 'chat',
      noteId: null,
      folderId: null,
      eventId: null,
      roomId: raw.slice('chat/'.length) || null,
    };
  }

  if (raw === 'calendar') {
    return {
      surface: 'calendar',
      noteId: null,
      folderId: null,
      eventId: null,
      roomId: null,
    };
  }

  if (raw.startsWith('calendar/')) {
    return {
      surface: 'calendar',
      noteId: null,
      folderId: null,
      eventId: raw.slice('calendar/'.length) || null,
      roomId: null,
    };
  }

  if (raw === 'dashboard') {
    return {
      surface: 'dashboard',
      noteId: null,
      folderId: null,
      eventId: null,
      roomId: null,
    };
  }

  if (raw.startsWith('dashboard/')) {
    return {
      surface: 'dashboard',
      noteId: null,
      folderId: raw.slice('dashboard/'.length) || null,
      eventId: null,
      roomId: null,
    };
  }

  if (raw.startsWith('share=') || raw.startsWith('share2=')) {
    return {
      surface: 'share',
      noteId: null,
      folderId: null,
      eventId: null,
      roomId: null,
    };
  }

  return {
    surface: 'note',
    noteId: raw,
    folderId: null,
    eventId: null,
    roomId: null,
  };
}

export function currentHistorySurface() {
  return history.state?.surface || parseAppHash().surface || null;
}