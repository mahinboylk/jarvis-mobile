/**
 * Serialized request queue + shared rate-limit gate tests (GAP-E2, GAP-G2).
 *
 * The failure mode these guard against is subtle: it is not "a retry happens",
 * it is "every in-flight call independently retries into the same 429 wall and
 * multiplies the pressure". So the assertions below are about *ordering* and
 * *mutual exclusion*, not just eventual success.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  awaitRateLimitGate,
  clearRateLimit,
  createRequestQueue,
  getRateLimitState,
  rateLimitRemainingMs,
  reportRateLimit,
  subscribeRateLimit,
} from '../src/utils/queue';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createRequestQueue', () => {
  test('default concurrency of 1 keeps tasks strictly sequential', async () => {
    const queue = createRequestQueue();
    const log: string[] = [];
    let running = 0;
    let maxConcurrent = 0;

    const task = (name: string) => async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      log.push(`start:${name}`);
      await tick(10);
      log.push(`end:${name}`);
      running -= 1;
      return name;
    };

    await Promise.all([queue.run(task('a')), queue.run(task('b')), queue.run(task('c'))]);

    assert.equal(maxConcurrent, 1, 'two tasks overlapped despite concurrency 1');
    assert.deepEqual(log, ['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
  });

  test('explicit concurrency allows that many parallel tasks', async () => {
    const queue = createRequestQueue({ concurrency: 2 });
    let running = 0;
    let maxConcurrent = 0;

    const task = () => async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await tick(15);
      running -= 1;
    };

    await Promise.all([queue.run(task()), queue.run(task()), queue.run(task())]);
    assert.equal(maxConcurrent, 2);
  });

  test('a non-positive concurrency is clamped back to one slot', async () => {
    const queue = createRequestQueue({ concurrency: 0 });
    let running = 0;
    let maxConcurrent = 0;
    const task = () => async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await tick(5);
      running -= 1;
    };
    await Promise.all([queue.run(task()), queue.run(task())]);
    assert.equal(maxConcurrent, 1);
  });

  test('propagates the task result and rejection unchanged', async () => {
    const queue = createRequestQueue();
    assert.equal(await queue.run(async () => 42), 42);
    await assert.rejects(
      () => queue.run(async () => Promise.reject(new Error('nope'))),
      /nope/
    );
  });

  test('reports pending and active counts', async () => {
    const queue = createRequestQueue();
    assert.equal(queue.pending, 0);
    assert.equal(queue.active, 0);

    // A gate that parks every task until `blocked` is cleared, so we can
    // observe the queue while one task holds the single slot.
    let blocked = true;
    const gate = async () => {
      while (blocked) await tick(1);
    };

    const first = queue.run(gate);
    const second = queue.run(gate);
    await tick(5);

    assert.equal(queue.active, 1, 'first task should occupy the only slot');
    assert.equal(queue.pending, 1, 'second task should be waiting');

    blocked = false;
    await Promise.all([first, second]);
    assert.equal(queue.active, 0);
    assert.equal(queue.pending, 0);
  });

  test('a queued task aborted via its signal never runs', async () => {
    const queue = createRequestQueue();
    const controller = new AbortController();
    let ranBlocking = false;
    let ranQueued = false;

    const blocking = queue.run(async () => {
      ranBlocking = true;
      await tick(40);
    });
    const queued = queue.run(async () => {
      ranQueued = true;
    }, controller.signal);

    await tick(5);
    controller.abort();

    await assert.rejects(queued, (error: unknown) => {
      assert.equal((error as Error).name, 'AbortError');
      return true;
    });
    await blocking;
    assert.equal(ranBlocking, true);
    assert.equal(ranQueued, false, 'an aborted queued task must not execute');
  });

  test('an already-aborted signal prevents the task from running at all', async () => {
    const queue = createRequestQueue();
    const controller = new AbortController();
    controller.abort();
    let ran = false;
    await assert.rejects(() =>
      queue.run(async () => {
        ran = true;
      }, controller.signal)
    );
    assert.equal(ran, false);
  });
});

describe('shared rate-limit gate', () => {
  test('starts clear', () => {
    assert.equal(rateLimitRemainingMs(), 0);
    assert.equal(getRateLimitState().cooldownUntil, 0);
  });

  test('publishes a cooldown that blocks callers behind it', async () => {
    reportRateLimit('groq', 120, '429 rate limited');

    const state = getRateLimitState();
    assert.equal(state.provider, 'groq');
    assert.equal(state.reason, '429 rate limited');
    assert.ok(rateLimitRemainingMs() > 0);

    const started = Date.now();
    await awaitRateLimitGate();
    assert.ok(Date.now() - started >= 100, 'gate released too early');
    assert.equal(rateLimitRemainingMs(), 0);
    clearRateLimit();
  });

  test('a queued task waits for the gate before starting', async () => {
    clearRateLimit();
    const queue = createRequestQueue();
    reportRateLimit('groq', 80, 'test');

    const started = Date.now();
    await queue.run(async () => {});
    assert.ok(Date.now() - started >= 60, 'task ran before the cooldown elapsed');
    clearRateLimit();
  });

  test('the gate itself honours an abort signal', async () => {
    reportRateLimit('groq', 5_000, 'long cooldown');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    const started = Date.now();
    await assert.rejects(awaitRateLimitGate(controller.signal), (error: unknown) => {
      assert.equal((error as Error).name, 'AbortError');
      return true;
    });
    assert.ok(Date.now() - started < 1_000, 'abort should short-circuit the wait');
    clearRateLimit();
  });

  test('a longer cooldown wins and a shorter one cannot shorten it', () => {
    clearRateLimit();
    reportRateLimit('groq', 200, 'first');
    const untilFirst = getRateLimitState().cooldownUntil;
    assert.ok(untilFirst > 0);

    reportRateLimit('groq', 20, 'second');
    assert.equal(
      getRateLimitState().cooldownUntil,
      untilFirst,
      'a shorter cooldown must not win'
    );
    assert.equal(getRateLimitState().reason, 'first', 'reason must not be overwritten');

    clearRateLimit();
    assert.equal(rateLimitRemainingMs(), 0);
  });

  test('subscribers are notified on publish and on clear', () => {
    clearRateLimit();
    const seen: string[] = [];
    const unsubscribe = subscribeRateLimit((state) => seen.push(state.reason || 'cleared'));

    reportRateLimit('fish', 30, '402 credit');
    clearRateLimit();
    unsubscribe();
    reportRateLimit('groq', 10, 'ignored');
    clearRateLimit();

    assert.deepEqual(seen, ['402 credit', 'cleared']);
  });
});
