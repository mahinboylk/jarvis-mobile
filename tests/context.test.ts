/**
 * Context budget tests (GAP-B5, GAP-G2).
 *
 * The old behaviour was `.slice(-8)`: a fixed turn count that ignored how large
 * each turn was and silently forgot everything older. These tests pin the
 * replacement — a two-sided cap (count *and* characters) whose overflow is
 * folded into a rolling digest instead of being discarded.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  CONTEXT_CHAR_BUDGET,
  CONTEXT_MAX_MESSAGES,
  buildSummary,
  digestLine,
  planContext,
  planToMessages,
} from '../src/utils/context';
import { ChatMessage } from '../src/types';

let seq = 0;
const msg = (role: ChatMessage['role'], content: string): ChatMessage => ({
  id: `m${(seq += 1)}`,
  role,
  content,
  timestamp: 1_000 + seq,
});

describe('planContext', () => {
  test('keeps a small history whole and produces no digest', () => {
    const history = [msg('user', 'hello'), msg('assistant', 'Good evening, sir.')];
    const plan = planContext(history);

    assert.equal(plan.kept.length, 2);
    assert.equal(plan.summary, '');
    assert.equal(plan.droppedCount, 0);
    assert.ok(plan.usedChars > 0);
  });

  test('drops the oldest turns past the message cap', () => {
    const history = Array.from({ length: CONTEXT_MAX_MESSAGES + 5 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`)
    );

    const plan = planContext(history);

    assert.equal(plan.kept.length, CONTEXT_MAX_MESSAGES);
    assert.equal(plan.droppedCount, 5);
    // The *newest* turns survive, and they stay in chronological order.
    assert.equal(plan.kept[plan.kept.length - 1].content, `turn ${history.length - 1}`);
    const timestamps = plan.kept.map((m) => m.timestamp);
    assert.deepEqual(timestamps, timestamps.slice().sort((a, b) => a - b));
    assert.match(plan.summary, /trimmed for length \(5 messages\)/);
  });

  test('the character budget bites before the message cap', () => {
    // Ten 800-char turns = 8000 chars, twice the 4000-char budget.
    const history = Array.from({ length: 10 }, (_, i) =>
      msg('user', `t${i}-${'x'.repeat(795)}`)
    );

    const plan = planContext(history);

    assert.ok(plan.kept.length < CONTEXT_MAX_MESSAGES, 'char cap should bind first');
    assert.ok(plan.kept.length > 0);
    assert.equal(plan.droppedCount, history.length - plan.kept.length);
  });

  test('an explicit budget and message cap are honoured', () => {
    const history = Array.from({ length: 6 }, (_, i) => msg('user', `y${i}-${'y'.repeat(48)}`));
    const plan = planContext(history, { budgetChars: 120, maxMessages: 2 });

    assert.equal(plan.kept.length, 2);
    assert.ok(plan.usedChars <= 120 + plan.summary.length);
    assert.equal(plan.droppedCount, 4);
  });

  test('a single oversized turn is elided rather than sent whole', () => {
    const plan = planContext([msg('user', 'z'.repeat(5_000))], { budgetChars: 10_000 });

    assert.equal(plan.kept.length, 1);
    assert.ok(plan.kept[0].content.length <= 601, `kept ${plan.kept[0].content.length} chars`);
    assert.ok(plan.kept[0].content.endsWith('…'));
  });

  test('the newest turn is kept even when it alone busts the budget', () => {
    const plan = planContext([msg('user', 'a'.repeat(9_000))], { budgetChars: 100 });

    assert.equal(plan.kept.length, 1);
    assert.equal(plan.droppedCount, 0);
    assert.equal(plan.summary, '');
  });

  test('blank messages are ignored entirely', () => {
    const plan = planContext([msg('user', '  '), msg('user', 'real'), msg('assistant', '')]);
    assert.equal(plan.kept.length, 1);
    assert.equal(plan.kept[0].content, 'real');
    assert.equal(plan.droppedCount, 0);
  });

  test('an empty history yields an empty plan', () => {
    const plan = planContext([]);
    assert.deepEqual(plan.kept, []);
    assert.equal(plan.summary, '');
    assert.equal(plan.usedChars, 0);
  });

  test('a lone message larger than the default budget still survives', () => {
    const plan = planContext([msg('user', 'w'.repeat(CONTEXT_CHAR_BUDGET + 500))]);
    assert.equal(plan.kept.length, 1);
  });
});

describe('buildSummary / digestLine', () => {
  test('labels each speaker', () => {
    assert.equal(digestLine(msg('user', 'open the pod bay doors')), 'You: open the pod bay doors');
    assert.equal(
      digestLine(msg('assistant', 'I am afraid I cannot.')),
      'Jarvis: I am afraid I cannot.'
    );
  });

  test('collapses whitespace and truncates a very long turn', () => {
    const line = digestLine(msg('user', `a\n\n  b${'c'.repeat(900)}`));
    assert.ok(line.startsWith('You: a b'), `got ${line.slice(0, 20)}`);
    assert.ok(line.length < 700, `line was ${line.length} chars`);
    assert.ok(line.endsWith('…'));
  });

  test('an empty drop list produces no digest', () => {
    assert.equal(buildSummary([]), '');
  });

  test('prefers the newest dropped turns when the cap bites', () => {
    const dropped = Array.from({ length: 40 }, (_, i) => msg('user', `old message ${i}`));
    const summary = buildSummary(dropped, 300);

    assert.ok(summary.length <= 300, `summary was ${summary.length} chars`);
    assert.ok(summary.includes('old message 39'), 'newest dropped turn should be present');
    assert.ok(!summary.includes('old message 0'), 'oldest dropped turn should be squeezed out');
  });

  test('always keeps at least one dropped turn even with a tiny budget', () => {
    const summary = buildSummary([msg('user', 'irreplaceable context')], 40);
    assert.match(summary, /Earlier in this conversation/);
    assert.ok(summary.length > 0);
  });
});

describe('planToMessages', () => {
  test('emits the history verbatim when nothing was dropped', () => {
    const history = [msg('user', 'first'), msg('assistant', 'second')];
    const messages = planToMessages(planContext(history));

    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].content, 'first');
    assert.equal(messages[1].role, 'assistant');
    assert.equal(messages[1].content, 'second');
  });

  test('a digest is a system message, never a user turn', () => {
    const history = Array.from({ length: CONTEXT_MAX_MESSAGES + 2 }, (_, i) =>
      msg('user', `turn ${i}`)
    );
    const messages = planToMessages(planContext(history));

    assert.equal(messages[0].role, 'system');
    assert.equal(messages.filter((m) => m.role === 'system').length, 1);
    assert.equal(messages.length, CONTEXT_MAX_MESSAGES + 1);
  });
});