// ============================================================
// YANTA AI — Local context/history stats
//
// No API calls. No costs.
// Token count is intentionally an estimate because tokenizers are model-specific.
// ============================================================

export function countWords(text = '') {
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`~\[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return clean ? clean.split(/\s+/).length : 0;
}

export function estimateTokensFromChars(chars = 0) {
  const n = Math.max(0, Number(chars || 0));

  // Common rough English/German heuristic.
  // We display this as "~ tokens", never as exact billing truth.
  return Math.ceil(n / 4);
}

export function textStats(text = '') {
  const s = String(text || '');

  return {
    words: countWords(s),
    chars: s.length,
    estimatedTokens: estimateTokensFromChars(s.length),
  };
}

function messageContentToText(content) {
  if (typeof content === 'string') return content;
  if (content == null) return '';

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return String(part.text || '');
        if (part?.type === 'image_url') return '[image]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return String(content || '');
}

export function conversationText(messages = []) {
  return (messages || [])
    .map((msg) => {
      const role = String(msg?.role || 'message');
      const tool = msg?.toolName ? `:${msg.toolName}` : '';
      const content = messageContentToText(msg?.content);

      return `${role}${tool}:\n${content}`;
    })
    .join('\n\n---\n\n');
}

export function conversationStats(messages = []) {
  const text = conversationText(messages);

  return {
    ...textStats(text),
    messages: (messages || []).length,
  };
}

export function contextItemsStats(items = []) {
  return (items || []).reduce((acc, item) => {
    acc.items += 1;
    acc.words += Number(item?.stats?.words || 0);
    acc.chars += Number(item?.stats?.chars || 0);

    if (item?.kind === 'image') acc.images += 1;
    if (item?.kind === 'audio') acc.audio += 1;
    if (item?.meta?.unsupported) acc.unsupported += 1;

    return acc;
  }, {
    items: 0,
    words: 0,
    chars: 0,
    images: 0,
    audio: 0,
    unsupported: 0,
  });
}

export function computeAiContextMeterStats({
  messages = [],
  contextItems = [],
} = {}) {
  const history = conversationStats(messages);
  const context = contextItemsStats(contextItems);

  const totalChars = history.chars + context.chars;
  const totalWords = history.words + context.words;

  return {
    history,
    context,

    total: {
      words: totalWords,
      chars: totalChars,
      estimatedTokens: estimateTokensFromChars(totalChars),
      images: context.images,
      audio: context.audio,
      unsupported: context.unsupported,
    },
  };
}

function plural(n, one, many = `${one}s`) {
  return `${Number(n || 0).toLocaleString()} ${Number(n || 0) === 1 ? one : many}`;
}

export function formatAiContextMeterStats(stats) {
  const history = stats?.history || {};
  const context = stats?.context || {};
  const total = stats?.total || {};

  const parts = [
    `~${Number(total.estimatedTokens || 0).toLocaleString()} tokens`,
    plural(total.words || 0, 'word'),
    plural(total.chars || 0, 'char'),
  ];

  if (context.items) {
    parts.push(plural(context.items, 'context item'));
  }

  if (total.images) {
    parts.push(plural(total.images, 'image'));
  }

  if (total.audio) {
    parts.push(plural(total.audio, 'audio'));
  }

  if (total.unsupported) {
    parts.push(`${Number(total.unsupported).toLocaleString()} unsupported`);
  }

  if (history.messages) {
    parts.push(plural(history.messages, 'message'));
  }

  return parts.join(' · ');
}

export function aiContextMeterTitle(stats) {
  const history = stats?.history || {};
  const context = stats?.context || {};
  const total = stats?.total || {};

  return [
    `Estimated total: ~${Number(total.estimatedTokens || 0).toLocaleString()} tokens`,
    `Total: ${Number(total.words || 0).toLocaleString()} words · ${Number(total.chars || 0).toLocaleString()} chars`,
    `History: ${Number(history.messages || 0).toLocaleString()} messages · ${Number(history.words || 0).toLocaleString()} words · ${Number(history.chars || 0).toLocaleString()} chars`,
    `Attached context: ${Number(context.items || 0).toLocaleString()} items · ${Number(context.words || 0).toLocaleString()} words · ${Number(context.chars || 0).toLocaleString()} chars`,
    context.images ? `Images: ${Number(context.images).toLocaleString()}` : '',
    context.audio ? `Audio: ${Number(context.audio).toLocaleString()}` : '',
    context.unsupported ? `Unsupported: ${Number(context.unsupported).toLocaleString()}` : '',
    '',
    'Token count is a local estimate. Exact tokens are model-specific.',
  ].filter(Boolean).join('\n');
}