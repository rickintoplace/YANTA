import { describe, it, expect } from 'vitest';
import { compileFormula, evaluateFormula } from '../../src/ai/ui-expr.js';
import { extractWidgets, stripWidgets, formatValue, widgetStateForModel } from '../../src/ai/ui-widgets.js';

describe('formula evaluator', () => {
  it('computes arithmetic, precedence, functions and conditionals', () => {
    expect(evaluateFormula('price * qty * (1 + vat / 100)', { price: 10, qty: 3, vat: 19 })).toBeCloseTo(35.7);
    expect(evaluateFormula('2 + 3 * 4 ^ 2')).toBe(50);
    expect(evaluateFormula('round(10 / 3, 2)')).toBe(3.33);
    expect(evaluateFormula('a > 5 ? 1 : 0', { a: 7 })).toBe(1);
    expect(evaluateFormula('if(a, 10, 20)', { a: 0 })).toBe(20);
    expect(evaluateFormula('max(1, 4, 2) + min(3, -1)')).toBe(3);
    expect(evaluateFormula('pmt(0.05 / 12, 240, 100000)')).toBeCloseTo(659.96, 1);
  });

  it('refuses anything that is not a formula', () => {
    for (const bad of ['alert(1)', 'constructor', 'a.b', 'this', '`x`', '"s"', 'x = 1', '1 +', '__proto__']) {
      expect(Number.isNaN(evaluateFormula(bad, { x: 1 }))).toBe(true);
    }
    expect(() => compileFormula('a['.repeat(10))).toThrow();
  });

  it('gives NaN for division by zero and unknown values', () => {
    expect(Number.isNaN(evaluateFormula('1 / 0'))).toBe(true);
    expect(Number.isNaN(evaluateFormula('missing + 1'))).toBe(true);
  });
});

describe('widget blocks', () => {
  const calc = '```yanta-ui\n{"type":"calculator","title":"Savings","inputs":[{"id":"monthly","label":"Monthly","value":200}],"outputs":[{"id":"year","label":"Per year","formula":"monthly * 12"}]}\n```';

  it('extracts complete, broken and still-streaming blocks', () => {
    const text = `Here you go:\n\n${calc}\n\nAnd a broken one:\n\n\`\`\`yanta-ui\n{nope}\n\`\`\`\n\nStreaming:\n\n\`\`\`yanta-ui\n{"type":"chart",`;
    const { text: out, widgets } = extractWidgets(text);

    expect(widgets).toHaveLength(3);
    expect(widgets[0].spec.type).toBe('calculator');
    expect(widgets[0].spec.inputs[0].id).toBe('monthly');
    expect(widgets[1].error).toBeTruthy();
    expect(widgets[2].pending).toBe(true);
    expect(out).toMatch(/⟦w0⟧[\s\S]*⟦w1⟧[\s\S]*⟦w2⟧/);
    expect(out).not.toMatch(/yanta-ui/);
  });

  it('validates specs: bad ids dropped, limits applied, unknown types rejected', () => {
    const { widgets } = extractWidgets('```yanta-ui\n{"type":"calculator","inputs":[{"id":"ok","value":1},{"id":"no way","value":2}],"outputs":[{"label":"x","formula":"ok*2"}]}\n```\n```yanta-ui\n{"type":"iframe","src":"https://evil"}\n```');
    expect(widgets[0].spec.inputs.map((i) => i.id)).toEqual(['ok']);
    expect(widgets[0].spec.outputs[0].id).toBe('out1');
    expect(widgets[1].error).toMatch(/Unknown widget type/);
  });

  it('summarises widgets for prose-only contexts', () => {
    expect(stripWidgets(`a\n${calc}\nb`)).toMatch(/\[Savings: interactive calculator\]/);
  });

  it('formats values', () => {
    expect(formatValue(NaN)).toBe('—');
    expect(formatValue(1234.5, { format: 'integer' })).toMatch(/1.?235/);
    expect(formatValue(7, { format: 'percent' })).toMatch(/7 %/);
  });

  it('accepts the newer widget types and rejects broken ones', () => {
    const block = (o) => '```yanta-ui\n' + JSON.stringify(o) + '\n```';
    const text = [
      block({ type: 'steps', items: ['A', { title: 'B', status: 'done' }] }),
      block({ type: 'proscons', pros: ['fast'], cons: [] }),
      block({ type: 'choices', options: ['Only one'] }),
      block({ type: 'flashcards', cards: [{ front: 'Q', back: 'A' }] }),
      block({ type: 'timer', minutes: 25, presets: [5, 25] }),
      block({ type: 'timer', minutes: 0 }),
      block({ type: 'progress', items: [{ label: 'Budget', value: 620, target: 800 }, { label: 'bad', value: 1, target: 0 }] }),
    ].join('\n\n');
    const { widgets } = extractWidgets(text);

    expect(widgets[0].spec.items.map((i) => i.status)).toEqual(['todo', 'done']);
    expect(widgets[1].spec.pros).toEqual(['fast']);
    expect(widgets[2].error).toMatch(/two options/);
    expect(widgets[3].spec.cards).toHaveLength(1);
    expect(widgets[4].spec.seconds).toBe(1500);
    expect(widgets[4].spec.presets).toEqual([300, 1500]);
    expect(widgets[5].error).toBeTruthy();
    expect(widgets[6].spec.items).toHaveLength(1);
  });

  it('reports what the user changed in widgets, for the next turn', () => {
    const block = (o) => '```yanta-ui\n' + JSON.stringify(o) + '\n```';
    const text = [
      block({ type: 'calculator', title: 'Savings', inputs: [{ id: 'monthly', value: 250 }, { id: 'years', value: 15 }], outputs: [{ id: 'total', formula: 'monthly * 12 * years' }] }),
      block({ type: 'checklist', title: 'Packing', items: ['Passport', 'Charger'] }),
      block({ type: 'events', title: 'Trip', items: [{ title: 'Flight', start: '2026-11-12T07:40' }] }),
    ].join('\n\n');

    expect(widgetStateForModel(text, { 0: { values: { monthly: 250, years: 15 } } })).toBe('');

    const note = widgetStateForModel(text, { 0: { values: { monthly: 400, years: 15 } }, 1: { done: [true, false] }, 2: { added: [true] } });
    expect(note).toMatch(/Savings: the user set monthly=400, years=15; it now shows total=72000/);
    expect(note).toMatch(/Packing: ticked off 1\/2 \(Passport\)/);
    expect(note).toMatch(/Trip: the user added to their calendar: Flight/);
  });
});
