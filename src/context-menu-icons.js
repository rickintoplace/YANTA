// ============================================================
// YANTA — Central context menu icon mapping
//
// Goal:
// - Existing showMenu({ label }) calls get icons automatically.
// - Explicit item.icon always wins.
// - Label heuristics cover dynamic labels like "Pin / Unpin",
//   "Archive / Unarchive", "New note here", "Delete folder…".
// ============================================================

function cleanLabel(label = '') {
    return String(label || '')
      .replace(/…/g, '')
      .replace(/\.\.\./g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }
  
  function startsAny(s, prefixes = []) {
    return prefixes.some((p) => s.startsWith(p));
  }
  
  function includesAny(s, parts = []) {
    return parts.some((p) => s.includes(p));
  }
  
  export function iconForContextMenuItem(item = {}) {
    if (!item || item === 'hr') return null;
  
    // Explicit icon always wins.
    if (item.icon) return item.icon;
  
    // Metadata rows should stay text-only.
    if (item.meta) return null;
  
    const label = cleanLabel(item.label);
  
    if (!label) return null;
  
    // Destructive fallback.
    if (item.danger) {
      if (includesAny(label, ['delete', 'remove', 'trash'])) return 'trash';
      return 'triangle-alert';
    }
  
    // ----------------------------------------------------------------
    // Open / navigation
    // ----------------------------------------------------------------
    if (label === 'open' || startsAny(label, ['open note'])) return 'file-text';
    if (startsAny(label, ['open folder'])) return 'folder-open';
    if (startsAny(label, ['open linked calendar event'])) return 'calendar-clock';
    if (startsAny(label, ['open event'])) return 'calendar-clock';
    if (startsAny(label, ['open sidebar'])) return 'panel-left-open';
    if (startsAny(label, ['open parent folder'])) return 'folder-up';
    if (startsAny(label, ['show in graph'])) return 'network';
    if (startsAny(label, ['search'])) return 'search';
  
    // ----------------------------------------------------------------
    // Create
    // ----------------------------------------------------------------
    if (startsAny(label, ['new note'])) return 'file-plus';
    if (startsAny(label, ['new text note'])) return 'file-plus';
    if (startsAny(label, ['New checklist'])) return 'list-checks';
    if (startsAny(label, ['new drawing'])) return 'line-squiggle';
    if (startsAny(label, ['new image'])) return 'image-plus';
    if (startsAny(label, ['new folder', 'new subfolder', 'new sub-folder'])) return 'folder-plus';
    if (startsAny(label, ['New event'])) return 'calendar-plus';
    if (startsAny(label, ['create event'])) return 'calendar-plus';
    if (startsAny(label, ['create'])) return 'plus';
  
    // ----------------------------------------------------------------
    // Edit / appearance
    // ----------------------------------------------------------------
    if (startsAny(label, ['rename'])) return 'pencil';
    if (includesAny(label, ['icon & color', 'appearance'])) return 'palette';
    if (startsAny(label, ['edit'])) return 'pencil';
  
    // ----------------------------------------------------------------
    // Pin
    // ----------------------------------------------------------------
    if (startsAny(label, ['pin selected', 'pin'])) return 'pin';
    if (startsAny(label, ['unpin selected', 'unpin'])) return 'pin-off';
  
    // ----------------------------------------------------------------
    // Move / folder operations
    // ----------------------------------------------------------------
    if (startsAny(label, ['move selected', 'move to folder'])) return 'folder-input';
    if (startsAny(label, ['move folder up', 'move out', 'move to root'])) return 'folder-up';
    if (startsAny(label, ['select contents', 'select folder contents'])) return 'list-checks';
    if (startsAny(label, ['select all'])) return 'scan-check';
  
    // ----------------------------------------------------------------
    // Duplicate / copy / export / import
    // ----------------------------------------------------------------
    if (startsAny(label, ['duplicate'])) return 'copy';
    if (startsAny(label, ['copy wikilink'])) return 'brackets';
    if (startsAny(label, ['copy note id'])) return 'hash';
    if (startsAny(label, ['copy'])) return 'copy';
  
    if (startsAny(label, ['export'])) return 'download';
    if (startsAny(label, ['import'])) return 'upload';
    if (startsAny(label, ['paste'])) return 'clipboard';
  
    // ----------------------------------------------------------------
    // Archive
    // ----------------------------------------------------------------
    if (startsAny(label, ['archive'])) return 'archive';
    if (startsAny(label, ['unarchive'])) return 'archive-restore';
  
    // ----------------------------------------------------------------
    // Calendar
    // ----------------------------------------------------------------
    if (startsAny(label, ['unlink calendar event', 'unlink event'])) return 'unlink';
    if (includesAny(label, ['calendar'])) return 'calendar-days';
  
    // ----------------------------------------------------------------
    // Selection
    // ----------------------------------------------------------------
    if (startsAny(label, ['clear selection'])) return 'x';
    if (includesAny(label, ['selected'])) return 'check-square';
  
    // ----------------------------------------------------------------
    // AI
    // ----------------------------------------------------------------
    if (includesAny(label, ['ai', 'assistant'])) return 'bot';
  
    // ----------------------------------------------------------------
    // Share
    // ----------------------------------------------------------------
    if (startsAny(label, ['share note', 'share this note', 'share folder', 'share this folder',])) return 'users';
  

    // ----------------------------------------------------------------
    // Settings / misc
    // ----------------------------------------------------------------
    if (startsAny(label, ['settings'])) return 'settings';
    if (startsAny(label, ['refresh'])) return 'refresh-cw';
    if (startsAny(label, ['recenter'])) return 'crosshair';
  
    return null;
  }