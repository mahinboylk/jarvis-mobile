/**
 * Calculator tests (GAP-A3, GAP-G2).
 *
 * The evaluator is hand-written specifically to avoid `eval`/`new Function`,
 * because its input is model-authored. These tests pin both the arithmetic and
 * the refusal behaviour — a parser that silently accepts junk is as bad as one
 * that runs code.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  evaluateExpression,
  formatNumber,
  normalizeExpression,
} from '../src/services/calculator';

describe('normalizeExpression', () => {
  test('strips conversational padding', () => {
    assert.equal(normalizeExpression('what is 12 * 7?'), '12 * 7');
    assert.equal(normalizeExpression("What's 8 + 1?"), '8 + 1');
    assert.equal(normalizeExpression('please calculate 9 - 4'), '9 - 4');
    assert.equal(normalizeExpression('equals 5 + 5'), '5 + 5');
  });

  test('maps spoken and typographic operators', () => {
    assert.equal(normalizeExpression('6 × 7'), '6 * 7');
    assert.equal(normalizeExpression('8 ÷ 2'), '8 / 2');
    assert.equal(normalizeExpression('9 − 3'), '9 - 3');
    assert.equal(normalizeExpression('9 – 3'), '9 - 3');
    assert.equal(normalizeExpression('5 x 4'), '5 * 4');
  });

  test('removes digit-group commas', () => {
    assert.equal(normalizeExpression('1,000 + 1'), '1000 + 1');
  });
});

describe('evaluateExpression', () => {
  test('respects precedence and parentheses', () => {
    assert.equal(evaluateExpression('12 * (7 + 3) / 4'), 30);
    assert.equal(evaluateExpression('2 + 3 * 4'), 14);
    assert.equal(evaluateExpression('(2 + 3) * 4'), 20);
  });

  test('handles unary signs', () => {
    assert.equal(evaluateExpression('-5 + 3'), -2);
    assert.equal(evaluateExpression('+4 - -4'), 8);
    assert.equal(evaluateExpression('-(2 + 3)'), -5);
  });

  test('^ is right-associative', () => {
    assert.equal(evaluateExpression('2^3^2'), 512);
    assert.equal(evaluateExpression('2^10'), 1024);
  });

  test('supports modulo', () => {
    assert.equal(evaluateExpression('10 % 3'), 1);
  });

  test('resolves functions and constants', () => {
    assert.equal(evaluateExpression('sqrt(2)'), Math.SQRT2);
    assert.equal(evaluateExpression('round(2.6)'), 3);
    assert.equal(evaluateExpression('abs(0 - 7)'), 7);
    assert.equal(evaluateExpression('pi'), Math.PI);
    assert.equal(evaluateExpression('log(1000)'), 3);
    assert.equal(evaluateExpression('ceil(1.1) + floor(1.9)'), 3);
  });

  test('accepts underscores as digit separators', () => {
    assert.equal(evaluateExpression('1_000 + 1'), 1001);
  });

  test('evaluates a conversational question end to end', () => {
    assert.equal(evaluateExpression('what is 12 * 7?'), 84);
    assert.equal(evaluateExpression('what is 0.15 * 200?'), 30);
  });

  test('refuses the documented "15% of N" phrasing rather than guessing', () => {
    // models.ts tells the model this form is unsupported; the parser must
    // reject it loudly so the tool result can say so.
    assert.throws(() => evaluateExpression('what is 15% of 200'), /Unknown symbol: of/);
  });

  test('refuses to divide by zero', () => {
    assert.throws(() => evaluateExpression('1 / 0'), /Division by zero/);
    assert.throws(() => evaluateExpression('5 % 0'), /Modulo by zero/);
  });

  test('rejects unknown symbols and unbalanced input', () => {
    assert.throws(() => evaluateExpression('foo(2)'), /Unknown symbol/);
    assert.throws(() => evaluateExpression('2 +'), /Unexpected end/);
    assert.throws(() => evaluateExpression('(2 + 3'), /Expected "\)"/);
    assert.throws(() => evaluateExpression('2 3'), /Unexpected trailing input/);
  });

  test('rejects characters that could smuggle code', () => {
    const reject = /Unsupported character|Unknown symbol|Not a number/;
    assert.throws(() => evaluateExpression('process.exit(1)'), reject);
    assert.throws(() => evaluateExpression('a;b'), reject);
    assert.throws(() => evaluateExpression('`1`'), reject);
    assert.throws(() => evaluateExpression('require("fs")'), reject);
  });

  test('rejects an empty expression', () => {
    assert.throws(() => evaluateExpression(''), /Empty expression/);
    assert.throws(() => evaluateExpression('what is?'), /Empty expression/);
  });
});

describe('formatNumber', () => {
  test('leaves integers alone', () => {
    assert.equal(formatNumber(30), '30');
    assert.equal(formatNumber(-2), '-2');
  });

  test('rounds speech-hostile precision', () => {
    assert.equal(formatNumber(1 / 3), '0.333333');
    assert.equal(formatNumber(1.5), '1.5');
    assert.equal(formatNumber(Math.SQRT2), '1.414214');
  });
});
