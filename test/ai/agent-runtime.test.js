import { describe, it, expect } from 'vitest';
import { compactThread, fitHistory } from '../../src/ai/agent-runtime.js';

const tool = (name, size) => ({ role: 'tool', tool_call_id: name, name, content: 'x'.repeat(size) });

describe('compactThread', () => {
  it('leaves a thread under budget alone', () => {
    const thread = [{ role: 'user', content: 'hi' }, tool('a', 5000)];
    expect(compactThread(thread, { maxChars: 10_000 })).toBe(0);
    expect(thread[1].content).toHaveLength(5000);
  });

  it('stubs the oldest results first, down to 60 %, and keeps the recent ones whole', () => {
    const thread = [{ role: 'user', content: 'go' }, tool('a', 4000), tool('b', 4000), tool('c', 4000), tool('d', 4000), tool('e', 4000)];
    const n = compactThread(thread, { maxChars: 15_000, keepRecent: 2 });

    // 20k → stub a, b, c until under 9k; d and e are the recent ones.
    expect(n).toBe(3);
    expect(thread[1].content).toMatch(/Earlier a result \(4000 characters\) removed.*Call the tool again/);
    expect(thread[3].content).toMatch(/Earlier c result/);
    expect(thread[4].content).toHaveLength(4000);
    expect(thread[5].content).toHaveLength(4000);
    expect(thread[1].tool_call_id).toBe('a');
  });

  it('never touches the newest results, even over budget', () => {
    const thread = [tool('a', 50_000), tool('b', 50_000)];
    expect(compactThread(thread, { maxChars: 10_000, keepRecent: 2 })).toBe(0);
  });
});

describe('fitHistory', () => {
  const turns = (n, size = 10) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}`.padEnd(size, '.') }));

  it('keeps a short conversation as is', () => {
    const h = turns(6);
    expect(fitHistory(h)).toBe(h);
  });

  it('keeps the newest messages, starts on a user turn and says what was cut', () => {
    const fitted = fitHistory(turns(50), { maxMessages: 9 });
    expect(fitted[0].content).toMatch(/42 earlier messages/);
    expect(fitted[2]).toEqual({ role: 'user', content: '42'.padEnd(10, '.') });
    expect(fitted.at(-1).content.startsWith('49')).toBe(true);
  });

  it('respects the character budget but always sends the latest message', () => {
    const fitted = fitHistory([...turns(4, 1000), { role: 'user', content: 'y'.repeat(5000) }], { maxChars: 2500 });
    expect(fitted.at(-1).content).toHaveLength(5000);
    expect(fitted.filter((m) => m.content.length >= 1000)).toHaveLength(1);
  });
});
