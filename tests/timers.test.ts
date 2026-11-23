/**
 * Timer tests (GAP-A1, GAP-G2).
 *
 * `timerService` is an in-app countdown only — there is no
 * `expo-notifications`, so a timer fires while the app is alive and is spoken
 * through the normal speech path. These tests pin the parsing surface, the
 * clamp, cancellation, and the actual fire callback.
 */
import assert from 'node:assert/strict';
import test, { afterEach, describe } from 'node:test';
import { parseDuration, timerService, TimerHandle } from '../src/services/timers';

afterEach(() => {
  timerService.cancelAll();
  timerService.setHandler(null);
});

describe('parseDuration', () => {
  test('a bare number is seconds', () => {
    assert.equal(parseDuration('90'), 90);
    assert.equal(parseDuration('  45  '), 45);
    assert.equal(parseDuration('1.5'), 1.5);
  });

  test('accepts spoken units', () => {
    assert.equal(parseDuration('5 minutes'), 300);
    assert.equal(parseDuration('2 hours'), 7200);
    assert.equal(parseDuration('30 seconds'), 30);
    assert.equal(parseDuration('1 hour 30 minutes'), 5400);
    assert.equal(parseDuration('10 MINS'), 600);
    assert.equal(parseDuration('90 secs'), 90);
  });

  test('accepts compact hour/minute forms', () => {
    assert.equal(parseDuration('2h15m'), 8100);
    assert.equal(parseDuration('1h'), 3600);
    assert.equal(parseDuration('45s'), 45);
  });

  test('accepts the clock form', () => {
    assert.equal(parseDuration('2:30'), 150);
    assert.equal(parseDuration('1:02:03'), 3723);
    assert.equal(parseDuration('0:10'), 10);
  });

  test('returns null when nothing readable is present', () => {
    assert.equal(parseDuration('later'), null);
    assert.equal(parseDuration(''), null);
    assert.equal(parseDuration('   '), null);
    assert.equal(parseDuration('set a timer for later'), null);
  });
});

describe('timerService.describe', () => {
  test('renders natural units', () => {
    assert.equal(timerService.describe(300), '5 minutes');
    assert.equal(timerService.describe(1), '1 second');
    assert.equal(timerService.describe(90), '1 minute 30 seconds');
    assert.equal(timerService.describe(3661), '1 hour 1 minute 1 second');
    assert.equal(timerService.describe(7200), '2 hours');
    assert.equal(timerService.describe(0), '0 seconds');
  });
});

describe('timerService', () => {
  test('starts with no timers and cancels cleanly', () => {
    assert.equal(timerService.count, 0);
    assert.equal(timerService.cancel(), null);

    const handle = timerService.setTimer(300, 'laundry');
    assert.equal(handle.label, 'laundry');
    assert.equal(handle.durationMs, 300_000);
    assert.equal(timerService.count, 1);

    const cancelled = timerService.cancel(handle.id);
    assert.equal(cancelled?.id, handle.id);
    assert.equal(timerService.count, 0);
    assert.equal(timerService.cancel(handle.id), null);
  });

  test('omitting an id cancels the oldest timer', () => {
    const first = timerService.setTimer(300, 'first');
    const second = timerService.setTimer(600, 'second');

    const cancelled = timerService.cancel();
    assert.equal(cancelled?.id, first.id);
    assert.equal(timerService.count, 1);
    assert.equal(timerService.list()[0].id, second.id);
  });

  test('rejects a non-positive or non-finite duration', () => {
    assert.throws(() => timerService.setTimer(0), /positive number/);
    assert.throws(() => timerService.setTimer(-5), /positive number/);
    assert.throws(() => timerService.setTimer(NaN), /positive number/);
    assert.equal(timerService.count, 0);
  });

  test('clamps a sub-second duration up to one second', () => {
    const handle = timerService.setTimer(0.25, 'blink');
    assert.equal(handle.durationMs, 1000);
  });

  test('a label-less timer gets a readable default', () => {
    assert.equal(timerService.setTimer(120).label, '2 minutes');
    assert.equal(timerService.setTimer(60, '   ').label, '1 minute');
  });

  test('list() reports remaining time soonest-first', () => {
    const slow = timerService.setTimer(600, 'slow');
    const quick = timerService.setTimer(60, 'quick');

    const listed = timerService.list();
    assert.deepEqual(
      listed.map((t) => t.id),
      [quick.id, slow.id]
    );
    assert.ok(listed[0].remainingMs <= 60_000);
    assert.ok(listed[0].remainingMs > 0);
    assert.ok(listed.every((t) => t.durationMs > 0));
  });

  test('cancelAll() empties the registry', () => {
    timerService.setTimer(60, 'a');
    timerService.setTimer(61, 'b');
    assert.equal(timerService.count, 2);
    timerService.cancelAll();
    assert.equal(timerService.count, 0);
    assert.deepEqual(timerService.list(), []);
  });
});

describe('timer firing', () => {
  test('invokes the registered handler once and unregisters the timer', async () => {
    const fired: TimerHandle[] = [];
    timerService.setHandler((timer) => fired.push(timer));

    const handle = timerService.setTimer(1, 'tea');
    assert.equal(timerService.count, 1);

    await new Promise((resolve) => setTimeout(resolve, 1300));

    assert.equal(fired.length, 1, 'handler should fire exactly once');
    assert.equal(fired[0].id, handle.id);
    assert.equal(fired[0].label, 'tea');
    assert.equal(fired[0].remainingMs, 0);
    assert.equal(timerService.count, 0, 'fired timer should be removed');
  });

  test('a throwing handler is swallowed instead of killing the app', async () => {
    timerService.setHandler(() => {
      throw new Error('speech engine offline');
    });
    timerService.setTimer(1, 'risky');
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.equal(timerService.count, 0);
  });

  test('a cancelled timer never fires', async () => {
    let fired = false;
    timerService.setHandler(() => {
      fired = true;
    });
    const handle = timerService.setTimer(1, 'cancelled');
    timerService.cancel(handle.id);

    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.equal(fired, false);
    assert.equal(timerService.count, 0);
  });
});