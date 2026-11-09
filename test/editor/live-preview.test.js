import { describe, it, expect } from 'vitest';
import { lineRanges } from '../../src/editor/live-preview.js';
import { classifyLine } from '../../src/markdown.js';

/** What the line reads as when the hidden ranges are taken out. */
const shown = (text) => {
  const ranges = lineRanges(text, classifyLine(text, { inFence: false }));
  let out = '';
  let at = 0;
  for (const r of ranges) {
    out += text.slice(at, r.from);
    if (r.deco?.widget) out += '•';
    at = r.to;
  }
  return out + text.slice(at);
};

describe('writing view', () => {
  it('shows headings, emphasis and links without their characters', () => {
    expect(shown('## Einkauf für **Samstag**')).toBe('Einkauf für Samstag');
    expect(shown('Ich brauche *frische* Milch, ~~Kaffee~~ und ==Brot==.')).toBe('Ich brauche frische Milch, Kaffee und Brot.');
    expect(shown('Siehe [Rezept](https://example.org) und [[Welcome]].')).toBe('Siehe Rezept und Welcome.');
    expect(shown('[[Projekt Alpha|das Projekt]]')).toBe('das Projekt');
  });

  it('leaves what only looks like Markdown alone', () => {
    expect(shown('snake_case_name und 2*3*4')).toBe('snake_case_name und 2*3*4');
    expect(shown('Code: `**nicht fett**`')).toBe('Code: **nicht fett**');
  });

  it('draws list items, tasks and rules', () => {
    expect(shown('- Äpfel')).toBe('• Äpfel');
    // The checkbox replaces the middle of "[ ]"; the rest of the marker goes.
    expect(shown('- [ ] Wein bestellen')).toBe(' Wein bestellen');
    expect(lineRanges('---', classifyLine('---', { inFence: false }))).toHaveLength(1);
  });
});
