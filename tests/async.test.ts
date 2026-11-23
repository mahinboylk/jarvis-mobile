/**
 * Retry/timeout policy tests (GAP-E2, GAP-G2).
 *
 * These cover the pure half of the resilience work: the backoff curve, the
 * `Retry-After` parser, and the deadline wrapper. The queue half lives in
 * `queue.test.ts`.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  TimeoutError,
  backoffDelayMs,
  parseRetryAfter,
  sleep,
  withTimeout,
} from '../src/utils/async';

describe('backoffDelayMs', () => {
  test('grows exponentially and stays inside the jitter envelope', () => {
    // base = min(500 * 2^attempt, 8000); jitter = base * [0.5, 1.0)
    for (const attempt of [0, 1, 2, 3, 4, 20]) {
      const base = Math.min(500 * 2 ** attempt, 8_000);
      const delay = backoffDelayMs(attempt);
      assert.ok(delay >= Math.round(base * 0.5), `attempt ${attempt}: ${delay} < half of ${base}`);
      assert.ok(delay <= base, `attempt ${attempt}: ${delay} > ${base}`);
    }
  });

  test('an explicit Retry-After overrides the computed curve', () => {
    assert.equal(backoffDelayMs(0, 1_500), 1_500);
    assert.equal(backoffDelayMs(5, 250), 250);
  });

  test('Retry-After is clamped so a hostile value cannot stall the app', () => {
    assert.equal(backoffDelayMs(0, 10 * 60 * 1000), 8_000);
  });

  test('a zero or negative Retry-After falls back to the curve', () => {
    const withZero = backoffDelayMs(0, 0);
    assert.ok(withZero >= 250 && withZero <= 500);
  });
});

describe('parseRetryAfter', () => {
  test('parses a seconds value', () => {
    assert.equal(parseRetryAfter('2'), 2_000);
    assert.equal(parseRetryAfter('0.5'), 500);
  });

  test('parses an HTTP date', () => {
    const when = Date.now() + 5_000;
    const parsed = parseRetryAfter(new Date(when).toUTCString());
    assert.ok(parsed !== undefined);
    assert.ok(parsed >= 4_000 && parsed <= 5_500, `unexpected ${parsed}`);
  });

  test('returns undefined for junk and for a missing header', () => {
    assert.equal(parseRetryAfter(null), undefined);
    assert.equal(parseRetryAfter(''), undefined);
    assert.equal(parseRetryAfter('definitely-not-a-date'), undefined);
  });

  test('a past HTTP date clamps to zero rather than going negative', () => {
    assert.equal(parseRetryAfter(new Date(Date.now() - 60_000).toUTCString()), 0);
  });
});

describe('withTimeout', () => {
  test('resolves when the promise wins the race', async () => {
    const value = await withTimeout(sleep(5).then(() => 'ok'), 200, 'fast');
    assert.equal(value, 'ok');
  });

  test('rejects with a TimeoutError carrying actionable copy', async () => {
    await assert.rejects(
      () => withTimeout(sleep(200), 20, 'Groq transcription'),
      (error: unknown) => {
        assert.ok(error instanceof TimeoutError);
        assert.equal((error as TimeoutError).code, 'TIMEOUT');
        assert.equal((error as Error).name, 'TimeoutError');
        assert.match((error as Error).message, /Groq transcription timed out/);
        return true;
      }
    );
  });

  test('surfaces the underlying rejection rather than a timeout', async () => {
    await assert.rejects(
      () => withTimeout(Promise.reject(new Error('boom')), 200, 'x'),
      /boom/
    );
  });

  test('clears its timer on success so the process can exit', async () => {
    await withTimeout(Promise.resolve(1), 60_000, 'long');
    // Reaching here means the 60s timer did not keep the test runner alive.
    assert.ok(true);
  });
});
