// ============================================================
// YANTA AI — Context Drag & Drop payload helpers
// ============================================================

export const YANTA_AI_CONTEXT_MIME = 'application/x-yanta-ai-context+json';

export function normalizeAiContextRef(ref = {}) {
  const kind = String(ref.kind || '').trim();
  const id = String(ref.id || ref.sourceId || '').trim();

  if (!kind || !id) return null;

  if (!['note', 'folder', 'event'].includes(kind)) return null;

  return {
    kind,
    id,
  };
}

export function setAiContextDragData(dataTransfer, refs = []) {
  if (!dataTransfer) return;

  const items = (refs || [])
    .map(normalizeAiContextRef)
    .filter(Boolean);

  if (!items.length) return;

  const payload = {
    v: 1,
    items,
  };

  try {
    dataTransfer.setData(YANTA_AI_CONTEXT_MIME, JSON.stringify(payload));
  } catch {}

  try {
    dataTransfer.setData(
      'text/plain',
      items.length === 1
        ? `YANTA ${items[0].kind}: ${items[0].id}`
        : `${items.length} YANTA items`
    );
  } catch {}
}

export function readAiContextDragData(dataTransfer) {
  if (!dataTransfer) return [];

  const out = [];

  try {
    const raw = dataTransfer.getData(YANTA_AI_CONTEXT_MIME);

    if (raw) {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed?.items) ? parsed.items : [];

      out.push(...items.map(normalizeAiContextRef).filter(Boolean));
    }
  } catch {}

  // Fallbacks for older/internal drags.
  try {
    const noteId = dataTransfer.getData('text/yanta-note');
    if (noteId) out.push({ kind: 'note', id: noteId });
  } catch {}

  try {
    const folderId = dataTransfer.getData('text/yanta-folder');
    if (folderId) out.push({ kind: 'folder', id: folderId });
  } catch {}

  try {
    const eventRaw = dataTransfer.getData('text/yanta-calendar-event');

    if (eventRaw) {
      const ev = JSON.parse(eventRaw);
      if (ev?.eventId) out.push({ kind: 'event', id: ev.eventId });
      else if (ev?.id) out.push({ kind: 'event', id: ev.id });
    }
  } catch {}

  const seen = new Set();

  return out.filter((item) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function dataTransferHasAiContext(dataTransfer) {
  const types = [...(dataTransfer?.types || [])];

  return (
    types.includes(YANTA_AI_CONTEXT_MIME) ||
    types.includes('text/yanta-note') ||
    types.includes('text/yanta-folder') ||
    types.includes('text/yanta-calendar-event')
  );
}