// ============================================================
// YANTA AI — formula evaluator for chat widgets
//
// Calculator widgets carry formulas written by the model ("price * qty *
// (1 + vat / 100)"). They are evaluated here, never with eval or
// Function: a small tokenizer and recursive-descent parser over numbers,
// variables, arithmetic, comparisons and a fixed list of functions. A
// formula can do nothing but compute a number.
// ============================================================

const FUNCTIONS = {
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  abs: Math.abs,
  sqrt: Math.sqrt,
  pow: Math.pow,
  exp: Math.exp,
  log: (x, base) => (base ? Math.log(x) / Math.log(base) : Math.log(x)),
  floor: Math.floor,
  ceil: Math.ceil,
  round: (x, d = 0) => {
    const f = 10 ** Math.max(0, Math.min(10, Math.trunc(d)));
    return Math.round(x * f) / f;
  },
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
  sum: (...a) => a.reduce((s, v) => s + v, 0),
  avg: (...a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0),
  if: (c, a, b) => (c ? a : b),
  // Payment per period for a loan or savings plan: rate per period, periods, present value.
  pmt: (rate, n, pv) => (rate === 0 ? pv / n : (pv * rate) / (1 - (1 + rate) ** -n)),
};

const MAX_LENGTH = 500;
const MAX_DEPTH = 40;

function tokenize(src) {
  const tokens = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    if (/\s/.test(c)) { i++; continue; }

    const num = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) { tokens.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }

    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { tokens.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }

    const op = /^(<=|>=|==|!=|&&|\|\||[-+*/%^(),<>!?:])/.exec(src.slice(i));
    if (op) { tokens.push({ t: 'op', v: op[0] }); i += op[0].length; continue; }

    throw new Error(`Unexpected "${c}"`);
  }

  return tokens;
}

/** Parses a formula once; the result evaluates against a variable map. */
export function compileFormula(source) {
  const src = String(source ?? '').trim();
  if (!src) throw new Error('Empty formula');
  if (src.length > MAX_LENGTH) throw new Error('Formula too long');

  const tokens = tokenize(src);
  let pos = 0;
  let depth = 0;

  const peek = () => tokens[pos];
  const take = (v) => {
    const tok = tokens[pos];
    if (!tok || (v && tok.v !== v)) throw new Error(`Expected ${v || 'value'}`);
    pos++;
    return tok;
  };
  const is = (v) => peek()?.t === 'op' && peek().v === v;

  const enter = () => {
    if (++depth > MAX_DEPTH) throw new Error('Formula too deep');
  };

  // Precedence, low to high: ?: || && comparison +- */% ^ unary
  function ternary() {
    enter();
    const cond = or();
    if (is('?')) {
      take('?');
      const a = ternary();
      take(':');
      const b = ternary();
      depth--;
      return (vars) => (cond(vars) ? a(vars) : b(vars));
    }
    depth--;
    return cond;
  }

  function binary(next, ops, apply) {
    return () => {
      let left = next();
      while (peek()?.t === 'op' && ops.includes(peek().v)) {
        const op = take().v;
        const right = next();
        const l = left;
        left = (vars) => apply(op, l(vars), right(vars));
      }
      return left;
    };
  }

  const power = () => {
    const base = unary();
    if (is('^')) {
      take('^');
      const exp = power(); // right-associative
      return (vars) => base(vars) ** exp(vars);
    }
    return base;
  };

  const mul = binary(power, ['*', '/', '%'], (op, a, b) => (op === '*' ? a * b : op === '/' ? a / b : a % b));
  const add = binary(mul, ['+', '-'], (op, a, b) => (op === '+' ? a + b : a - b));
  const cmp = binary(add, ['<', '<=', '>', '>=', '==', '!='], (op, a, b) => Number(
    op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : op === '>=' ? a >= b : op === '==' ? a === b : a !== b
  ));
  const and = binary(cmp, ['&&'], (op, a, b) => Number(a && b));
  const or = binary(and, ['||'], (op, a, b) => Number(a || b));

  function unary() {
    if (is('-')) { take('-'); const v = unary(); return (vars) => -v(vars); }
    if (is('+')) { take('+'); return unary(); }
    if (is('!')) { take('!'); const v = unary(); return (vars) => Number(!v(vars)); }
    return primary();
  }

  function primary() {
    const tok = peek();
    if (!tok) throw new Error('Unexpected end');

    if (tok.t === 'num') { take(); return () => tok.v; }

    if (tok.t === 'op' && tok.v === '(') {
      take('(');
      const inner = ternary();
      take(')');
      return inner;
    }

    if (tok.t === 'id') {
      take();
      const name = tok.v;

      if (is('(')) {
        const fn = FUNCTIONS[name.toLowerCase()];
        if (!fn) throw new Error(`Unknown function ${name}`);
        take('(');
        const args = [];
        if (!is(')')) {
          args.push(ternary());
          while (is(',')) { take(','); args.push(ternary()); }
        }
        take(')');
        return (vars) => fn(...args.map((a) => a(vars)));
      }

      if (name === 'true') return () => 1;
      if (name === 'false') return () => 0;
      if (name === 'PI') return () => Math.PI;

      return (vars) => {
        if (!Object.prototype.hasOwnProperty.call(vars, name)) throw new Error(`Unknown value ${name}`);
        return Number(vars[name]);
      };
    }

    throw new Error(`Unexpected "${tok.v}"`);
  }

  const fn = ternary();
  if (pos !== tokens.length) throw new Error(`Unexpected "${tokens[pos].v}"`);

  return (vars = {}) => {
    const v = fn(vars);
    return Number.isFinite(v) ? v : NaN;
  };
}

/** Evaluates once; NaN on any error. */
export function evaluateFormula(source, vars = {}) {
  try {
    return compileFormula(source)(vars);
  } catch {
    return NaN;
  }
}
