// ============================================================
// @i18n-locked
// YANTA AI — Local context/history stats
//
// No API calls. No costs.
// Token count is intentionally an estimate because tokenizers are model-specific.
// ============================================================

import { t } from '../i18n/index.js';

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


export function formatAiContextMeterStats(stats) {
  const history = stats?.history || {};
  const context = stats?.context || {};
  const total = stats?.total || {};

  const n = (v) => Number(v || 0);

  const parts = [
    t('ai.context.meter.tokens', { count: n(total.estimatedTokens) }),
    t('ai.context.meter.words', { count: n(total.words) }),
    t('ai.context.meter.chars', { count: n(total.chars) }),
  ];

  if (context.items) parts.push(t('ai.context.meter.items', { count: n(context.items) }));
  if (total.images) parts.push(t('ai.context.meter.images', { count: n(total.images) }));
  if (total.audio) parts.push(t('ai.context.meter.audio', { count: n(total.audio) }));
  if (total.unsupported) parts.push(t('ai.context.meter.unsupported', { count: n(total.unsupported) }));
  if (history.messages) parts.push(t('ai.context.meter.messages', { count: n(history.messages) }));

  return parts.join(' · ');
}

export function aiContextMeterTitle(stats) {
  const history = stats?.history || {};
  const context = stats?.context || {};
  const total = stats?.total || {};

  const n = (v) => Number(v || 0);

  return [
    t('ai.context.meter.titleEstimated', { tokens: n(total.estimatedTokens) }),
    t('ai.context.meter.titleTotal', { words: n(total.words), chars: n(total.chars) }),
    t('ai.context.meter.titleHistory', { messages: n(history.messages), words: n(history.words), chars: n(history.chars) }),
    t('ai.context.meter.titleAttached', { items: n(context.items), words: n(context.words), chars: n(context.chars) }),
    context.images ? t('ai.context.meter.titleImages', { count: n(context.images) }) : '',
    context.audio ? t('ai.context.meter.titleAudio', { count: n(context.audio) }) : '',
    context.unsupported ? t('ai.context.meter.titleUnsupported', { count: n(context.unsupported) }) : '',
    '',
    t('ai.context.meter.titleNote'),
  ].filter(Boolean).join('\n');
}