// ESLint flat config (ESLint 9+).
//
// Beyond baseline hygiene it ships one YANTA-specific guard —
// `yanta/no-untranslated-literal` — that prevents hardcoded UI strings from
// creeping back into files you've already migrated to i18n. It is opt-in:
// a file only comes under the guard once it carries an `@i18n-locked` pragma
// comment. Migrate a module, translate its strings via t(), add the pragma,
// and ESLint fails the build on any future English literal in it.

import globals from 'globals';

// --- Inline rule: flag likely user-facing string literals in locked files ---
// Scoped to plain string literals (not template literals) to stay quiet around
// the CSS-in-JS template blocks common in this codebase. Heuristic: a literal
// with a space and a letter reads as a sentence; single-word tokens (ids,
// classes, keys) are ignored.
const noUntranslatedLiteral = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow hardcoded UI string literals in @i18n-locked files' },
    messages: { untranslated: 'Untranslated string literal "{{ text }}" — route it through t().' },
  },
  create(context) {
    const src = context.sourceCode ?? context.getSourceCode();
    if (!src.getText().includes('@i18n-locked')) return {};

    const looksUserFacing = (s) => /\s/.test(s) && /\p{L}/u.test(s.trim()) && s.trim().length > 1;

    return {
      Literal(node) {
        if (typeof node.value !== 'string' || !looksUserFacing(node.value)) return;

        const p = node.parent;
        // Skip import/export sources.
        if (p.type === 'ImportDeclaration' || p.type === 'ExportNamedDeclaration' || p.type === 'ExportAllDeclaration') return;
        // Skip object/class property keys.
        if ((p.type === 'Property' || p.type === 'PropertyDefinition' || p.type === 'MethodDefinition') && p.key === node && !p.computed) return;
        // Skip the argument of t('…') / t.plural('…').
        if (p.type === 'CallExpression' && p.callee?.type === 'Identifier' && p.callee.name === 't') return;

        context.report({ node, messageId: 'untranslated', data: { text: node.value.slice(0, 40) } });
      },
    };
  },
};

export default [
  { ignores: ['dist/**', 'vendor/**', 'node_modules/**', 'public/**', 'scripts/**'] },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    plugins: { yanta: { rules: { 'no-untranslated-literal': noUntranslatedLiteral } } },
    rules: { 'yanta/no-untranslated-literal': 'error' },
  },
];
