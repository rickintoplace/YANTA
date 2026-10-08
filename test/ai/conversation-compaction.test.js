import { describe, it, expect } from 'vitest';
import {
  needsCompaction,
  compactConversation,
  historySinceSummary,
  summaryMessages,
} from '../../src/ai/conversation-compaction.js';

const turn = (role, content) => ({ role, content, ts: 1 });
const chat = (n, size = 100) => Array.from({ length: n }, (_, i) => turn(i % 2 ? 'assistant' : 'user', `${i}:`.padEnd(size, 'x')));

describe('conversation compaction', () => {
  it('triggers on size or count, not for short chats', () => {
    expect(needsCompaction(chat(6, 20_000))).toBe(false);
    expect(needsCompaction(chat(10, 5_000))).toBe(true);
    expect(needsCompaction(chat(32, 10))).toBe(true);
    expect(needsCompaction(chat(20, 10))).toBe(false);
  });

  it('folds all but the latest turns into a summary placed before them', async () => {
    const conversation = chat(12);
    conversation.splice(3, 0, { role: 'tool', toolName: 'search_notes', content: '{}' });
    let request = null;

    const summary = await compactConversation(conversation, {
      keepRecent: 4,
      complete: async ({ messages }) => {
        request = messages;
        return { content: '## Goal\nTest.' };
      },
    });

    expect(summary.role).toBe('summary');
    expect(summary.covers).toBe(8);
    // Tool messages are not summarised; the transcript has the 8 folded turns.
    expect(request[1].content).toMatch(/User: 0:/);
    expect(request[1].content).toMatch(/Assistant: 7:/);
    expect(request[1].content).not.toMatch(/8:/);

    const { summary: text, messages } = historySinceSummary(conversation);
    expect(text).toBe('## Goal\nTest.');
    expect(messages.map((m) => m.content.split(':')[0])).toEqual(['8', '9', '10', '11']);
    expect(messages[0].role).toBe('user');
  });

  it('merges the previous summary on the next compaction', async () => {
    const conversation = [...chat(4), { role: 'summary', content: 'OLD SUMMARY', covers: 10 }, ...chat(10)];
    let request = null;

    const summary = await compactConversation(conversation, {
      keepRecent: 4,
      complete: async ({ messages }) => { request = messages; return { content: 'NEW' }; },
    });

    expect(request[1].content).toMatch(/# Previous summary\nOLD SUMMARY/);
    expect(summary.covers).toBe(16);
    expect(historySinceSummary(conversation).summary).toBe('NEW');
  });

  it('does nothing when there is too little', async () => {
    const conversation = chat(4);
    expect(await compactConversation(conversation, { complete: async () => ({ content: 'x' }) })).toBeNull();
    expect(summaryMessages('')).toEqual([]);
    expect(summaryMessages('S')[0].content).toMatch(/S$/);
  });
});
