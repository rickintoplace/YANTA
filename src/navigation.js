// ============================================================
// YANTA — Navigation / History helpers
// Central place for app routes:
// - Dashboard/Home: #dashboard or #dashboard/<folderId>
// - Note:          #<noteId>
// - Calendar:      #calendar
// ============================================================

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

export function pushDashboardHistory(folderId = null) {
  history.pushState(
    dashboardState(folderId),
    '',
    dashboardUrl(folderId)
  );
}

export function replaceDashboardHistory(folderId = null) {
  history.replaceState(
    dashboardState(folderId),
    '',
    dashboardUrl(folderId)
  );
}

export function pushNoteHistory(noteId) {
  history.pushState(
    noteState(noteId),
    '',
    noteUrl(noteId)
  );
}

export function replaceNoteHistory(noteId) {
  history.replaceState(
    noteState(noteId),
    '',
    noteUrl(noteId)
  );
}

export function pushCalendarHistory() {
  history.pushState(
    calendarState(),
    '',
    calendarUrl()
  );
}

export function replaceCalendarHistory() {
  history.replaceState(
    calendarState(),
    '',
    calendarUrl()
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