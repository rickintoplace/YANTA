// ============================================================
// YANTA Editor — markdown line prefixes (no CodeMirror)
//
// Split out of markdown-commands.js so surfaces that only read lines
// (the format menu) do not pull CodeMirror into the boot bundle.
// ============================================================

const LINE_PREFIX_RE =
  /^([ \t]*)(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d+[.)][ \t]+)?([\s\S]*)$/;

/**
 * Split a source line into indentation, block marker and body, and name
 * the block kind. Everything that rewrites lines goes through this so
 * the surfaces cannot drift apart on what counts as a list item.
 */
export function parseLine(text) {
  const [, indent = '', marker = '', body = ''] = LINE_PREFIX_RE.exec(text) || [];

  let kind = 'paragraph';
  let level = 0;

  if (/^#/.test(marker)) {
    kind = 'heading';
    level = marker.trim().length;
  } else if (/^>/.test(marker)) {
    kind = 'quote';
  } else if (/\[[ xX]\]/.test(marker)) {
    kind = 'task';
  } else if (/^[-*+]/.test(marker)) {
    kind = 'bullet';
  } else if (/^\d/.test(marker)) {
    kind = 'ordered';
  }

  return { indent, marker, body, kind, level, checked: /\[[xX]\]/.test(marker) };
}

