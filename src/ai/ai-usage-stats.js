// ============================================================
// YANTA AI — usage stats for this tab
//
// What the requests of this session cost and how much of each prompt
// came from the provider's cache. Prompt caching is what makes a long
// agent loop cheap, and it silently breaks when something volatile
// lands early in the prompt — this is how to see it.
//
//   window.yantaAiStats()   → totals and the last requests
// ============================================================

const RECENT_MAX = 40;

const totals = {
  requests: 0,
  promptTokens: 0,
  cachedTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  cost: 0,
};

const recent = [];

export function recordAiUsage(model, usage, { source = '' } = {}) {
  if (!usage || typeof usage !== 'object') return;

  const prompt = Number(usage.prompt_tokens || 0);
  const cached = Number(usage.prompt_tokens_details?.cached_tokens || 0);
  const completion = Number(usage.completion_tokens || 0);
  const reasoning = Number(usage.completion_tokens_details?.reasoning_tokens || 0);
  const cost = Number(usage.cost || 0);

  totals.requests++;
  totals.promptTokens += prompt;
  totals.cachedTokens += cached;
  totals.completionTokens += completion;
  totals.reasoningTokens += reasoning;
  totals.cost += Number.isFinite(cost) ? cost : 0;

  recent.push({ at: Date.now(), model: String(model || ''), source, prompt, cached, completion, reasoning, cost });
  if (recent.length > RECENT_MAX) recent.shift();
}

export function aiUsageStats() {
  return {
    ...totals,
    cacheHitRate: totals.promptTokens ? totals.cachedTokens / totals.promptTokens : 0,
    recent: [...recent],
  };
}

if (typeof window !== 'undefined') {
  window.yantaAiStats = aiUsageStats;
}
