// ============================================================
// YANTA AI — citable sources of one answer
//
// Every tool result that brings in source text — a web page, a search
// hit, a feed article, a note — gets a number. The model sees it as
// `cite: n` in the tool result and cites `[n]`; the registry keeps the
// full text, exactly as the tool returned it, so the quotes in the
// answer can be checked against what was actually read, not against
// what the model remembers of it (see citation-check.js).
//
// The same source read twice keeps its number.
// ============================================================

/*
  The citation protocol (VeriQuote's) plus how YANTA numbers sources.
  Goes into the system prompt when citation checking is on; harmless
  when a turn reads nothing, because the protocol only applies to
  numbered sources.
*/
export const YANTA_CITATION_PREAMBLE = [
  '# Citing sources',
  '',
  'Tool results that carry a `cite` number are sources: web pages, search results, feed articles and notes you read.',
  'When your answer states facts taken from them, cite them as [n] with that number, following the rules below.',
  'Content without a `cite` number cannot be cited. Answers that use no sources need no citations and no appendix.',
].join('\n');

function sourceKey(kind, item) {
  return `${kind}:${item.url || item.id || item.noteId || item.title || ''}`;
}

export function createSourceRegistry() {
  const byKey = new Map();
  const list = [];

  const add = (kind, item, text) => {
    const clean = String(text || '').trim();
    if (!clean) return null;

    const key = sourceKey(kind, item);
    const existing = byKey.get(key);

    if (existing) {
      // A fuller read of the same source (search hit, then the page) wins.
      if (clean.length > existing.text.length) existing.text = clean;
      return existing.n;
    }

    const source = {
      n: list.length + 1,
      kind,
      id: String(item.id || item.noteId || ''),
      title: String(item.title || item.url || 'Untitled'),
      url: String(item.url || ''),
      text: clean,
    };

    byKey.set(key, source);
    list.push(source);

    return source.n;
  };

  const note = (n) => (n ? { cite: n } : {});

  /**
   * Numbers the sources in a tool result. Returns the result to hand to
   * the model (with `cite` fields), or undefined when nothing in it is
   * citable.
   */
  function register(toolName, result) {
    if (!result || typeof result !== 'object' || result.error) return undefined;

    switch (toolName) {
      case 'web_read':
        return { ...result, ...note(add('web', result, result.text)) };

      case 'web_search':
        if (!Array.isArray(result.results)) return undefined;
        return {
          ...result,
          results: result.results.map((r) => ({
            ...r,
            ...note(add('web', r, [r.title, r.description].filter(Boolean).join('\n'))),
          })),
        };

      case 'rss_read_item':
        return { ...result, ...note(add('rss', result, result.fullText || result.contentText || result.summaryText)) };

      case 'read_note':
        return { ...result, ...note(add('note', result, result.markdown)) };

      case 'read_notes':
        if (!Array.isArray(result)) return undefined;
        return result.map((r) => (r && typeof r === 'object' ? { ...r, ...note(add('note', r, r.markdown)) } : r));

      default:
        return undefined;
    }
  }

  return {
    register,
    get size() {
      return list.length;
    },
    /** In VeriQuote's order: index 0 is [1]. */
    documents() {
      return list.map((s) => ({ id: s.id, title: s.title, url: s.url, text: s.text }));
    },
    list() {
      return list.map(({ n, kind, id, title, url }) => ({ n, kind, id, title, url }));
    },
  };
}
