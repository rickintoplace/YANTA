// ============================================================
// YANTA — Shared mutable state for features that span modules.
// Lives in its own file to avoid circular imports between
// markdown.js (renderer) and features.js (wikilink index updates).
// ============================================================

export const wikilinkIndex = new Map();   // titleLower -> noteId
