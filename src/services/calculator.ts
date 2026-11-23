/**
 * Safe arithmetic evaluator for the `calculate` tool.
 *
 * A hand-written recursive-descent parser — deliberately **not** `eval` or
 * `new Function`, both of which would let a model-authored string execute
 * arbitrary code inside the app.
 */

const FUNCTIONS: Record<string, (n: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

type Token = { type: 'num'; value: number } | { type: 'op'; value: string };

/** Strip conversational padding so "what is 12 * 7?" still evaluates. */
export function normalizeExpression(input: string): string {
  return input
    .toLowerCase()
    .replace(/[×✕]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/\bwhat('s| is)\b|\bcalculate\b|\bcompute\b|\bequals?\b|\bplease\b/g, '')
    .replace(/[?=]/g, '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\bx\b/g, '*')
    .trim();
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ') {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < src.length && /[0-9._]/.test(src[i])) {
        if (src[i] !== '_') num += src[i];
        i += 1;
      }
      const value = Number(num);
      if (!Number.isFinite(value)) throw new Error(`Not a number: ${num}`);
      tokens.push({ type: 'num', value });
      continue;
    }
    if (/[a-z]/.test(ch)) {
      let name = '';
      while (i < src.length && /[a-z0-9]/.test(src[i])) {
        name += src[i];
        i += 1;
      }
      tokens.push({ type: 'op', value: name });
      continue;
    }
    if ('+-*/^%()'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }
    throw new Error(`Unsupported character: ${ch}`);
  }
  return tokens;
}

/** Evaluate a math expression, throwing a readable error on bad input. */
export function evaluateExpression(input: string): number {
  const src = normalizeExpression(input);
  if (!src) throw new Error('Empty expression.');

  const tokens = tokenize(src);
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const isOp = (value: string): boolean => {
    const t = peek();
    return !!t && t.type === 'op' && t.value === value;
  };
  const eat = (value: string): void => {
    if (!isOp(value)) throw new Error(`Expected "${value}".`);
    pos += 1;
  };

  const parseExpr = (): number => {
    let left = parseTerm();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[pos++] as { value: string }).value;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };

  const parseTerm = (): number => {
    let left = parseUnary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = (tokens[pos++] as { value: string }).value;
      const right = parseUnary();
      if (op === '*') left *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero.');
        left /= right;
      } else {
        if (right === 0) throw new Error('Modulo by zero.');
        left %= right;
      }
    }
    return left;
  };

  const parseUnary = (): number => {
    if (isOp('-')) {
      pos += 1;
      return -parseUnary();
    }
    if (isOp('+')) {
      pos += 1;
      return parseUnary();
    }
    return parsePower();
  };

  const parsePower = (): number => {
    const base = parsePrimary();
    if (isOp('^')) {
      pos += 1;
      // Right-associative, so 2^3^2 === 2^9.
      return Math.pow(base, parseUnary());
    }
    return base;
  };

  const parsePrimary = (): number => {
    const token = peek();
    if (!token) throw new Error('Unexpected end of expression.');

    if (token.type === 'num') {
      pos += 1;
      return token.value;
    }

    if (token.value === '(') {
      pos += 1;
      const value = parseExpr();
      eat(')');
      return value;
    }

    const name = token.value;
    if (name in CONSTANTS) {
      pos += 1;
      return CONSTANTS[name];
    }
    if (name in FUNCTIONS) {
      pos += 1;
      eat('(');
      const arg = parseExpr();
      eat(')');
      return FUNCTIONS[name](arg);
    }
    throw new Error(`Unknown symbol: ${name}`);
  };

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('Unexpected trailing input.');
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number.');
  return result;
}

/** Round for speech: avoids reading out 12 decimal places. */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}
