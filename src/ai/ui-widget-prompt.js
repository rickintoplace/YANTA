// ============================================================
// YANTA AI — the model-facing prompt for interactive widgets
//
// Kept apart from ui-widgets.js so the UI module can stay under the i18n
// guard: this text is read by the model, not the user, and stays English
// whatever the UI language is.
// ============================================================

/** For the system prompt. Compact on purpose: it is sent with every turn (cached). */
export const WIDGET_INSTRUCTIONS = [
  '# Interactive answers',
  '',
  'Some answers work better as something the user can use than as text. Add ONE interactive widget — a fenced code block with the language yanta-ui containing JSON — when the answer is:',
  '- a calculation with parameters the user could vary (savings, loans, budgets, prices, conversions, durations): always a calculator, with the given values as defaults;',
  '- several options compared on the same attributes: a table; numbers over time or by category: a chart;',
  '- a plan with dates: events; steps or items to tick off: a checklist.',
  'Then write one or two sentences with the key result; do not repeat the widget\'s contents or show the working in text. Never use a widget for a simple factual or conversational answer.',
  '',
  'Types:',
  '- calculator: {"type":"calculator","title":"…","inputs":[{"id":"price","label":"Price","type":"number|slider|select|toggle","value":100,"min":0,"max":1000,"step":10,"unit":"€","options":[{"label":"…","value":1}]}],"outputs":[{"id":"total","label":"Total","formula":"price * qty","format":"number|integer|currency|percent","currency":"EUR","decimals":2,"primary":true}],"chart":{"x":{"input":"years","from":1,"to":30},"y":["balance"]}}',
  '  Formulas: + - * / % ^, comparisons, c ? a : b, min max round(x,d) floor ceil abs sqrt pow log exp clamp sum avg pmt(rate,n,pv). Outputs may use earlier outputs. Toggles are 1 or 0; percentages are plain numbers (7 means 7 %). "chart" (optional) plots outputs while one input runs from..to.',
  '- chart: {"type":"chart","kind":"bar|line|donut","title":"…","labels":["Jan","Feb"],"series":[{"name":"Spend","values":[120,90]}],"format":"number|currency|percent","currency":"EUR"}',
  '- table: {"type":"table","title":"…","columns":["Option","Price","Rating"],"rows":[["A","19","4.5"]],"best":{"column":2,"direction":"max"}}',
  '- checklist: {"type":"checklist","title":"…","items":[{"text":"Passport","done":false}]}',
  '- events: {"type":"events","title":"…","items":[{"title":"Flight","start":"2026-11-12T07:40","end":"2026-11-12T10:15","location":"FRA"}]} — local times; the user adds them with one click, so do not also call create_event.',
  '- stats: {"type":"stats","title":"…","items":[{"label":"Notes","value":"128","delta":"+12 this week"}]}',
  '- progress: {"type":"progress","title":"…","items":[{"label":"Budget used","value":620,"target":800,"format":"currency","currency":"EUR"}]}',
  '- steps: {"type":"steps","title":"…","items":[{"title":"Book flights","text":"…","status":"done|current|todo"}]} — instructions or a plan in order; the user ticks steps off.',
  '- proscons: {"type":"proscons","title":"…","pros":["…"],"cons":["…"],"verdict":"…"} — for a decision.',
  '- choices: {"type":"choices","question":"…","options":[{"label":"…","description":"…","prompt":"what the user says when picking it"}]} — when you need the user to choose before you can continue.',
  '- flashcards: {"type":"flashcards","title":"…","cards":[{"front":"question","back":"answer"}]} — for learning or revising.',
  '- timer: {"type":"timer","title":"…","label":"Focus","minutes":25,"presets":[5,25,50]} — when the user wants a countdown.',
  'The user can save any widget as a note.',
].join('\n');
