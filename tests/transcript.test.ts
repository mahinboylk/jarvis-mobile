/**
 * Transcript export tests (GAP-B4, GAP-G2).
 *
 * The exporter is deliberately free of React Native imports precisely so it can
 * be pinned here — the same formatter feeds the share sheet and the bubble's
 * copy action.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { buildSharePayload, formatSingleMessage, formatTranscript } from '../src/utils/transcript';
import { ChatSession } from '../src/types';

// A fixed local timestamp keeps the HH:MM expectations stable. 2026-03-04 is a
// Wednesday; the clock portion is what the exporter renders.
const T0 = new Date(2026, 2, 4, 14, 3, 0).getTime();
const T1 = new Date(2026, 2, 4, 14, 5, 0).getTime();

const session: ChatSession = {
  id: 's1',
  title: 'Weather in London',
  createdAt: T0,
  updatedAt: T1,
  messages: [
    { id: 'a', role: 'user', content: "What's the weather?", timestamp: T0 },
    {
      id: 'b',
      role: 'assistant',
      content: 'Overcast, 11 degrees, sir.',
      timestamp: T1,
      sources: [{ title: 'Open-Meteo', url: 'https://open-meteo.com/' }],
    },
  ],
};

describe('formatTranscript', () => {
  test('renders a headed, timestamped, speaker-labelled document', () => {
    const text = formatTranscript(session, { exportedAt: T1 });

    assert.match(text, /^J\.A\.R\.V\.I\.S\. TRANSCRIPT — Weather in London/);
    assert.match(text, /Exported 2026-03-04 \d{2}:\d{2}/);
    assert.match(text, /2 messages/);
    assert.match(text, /\[\d{2}:\d{2}\] YOU: What's the weather\?/);
    assert.match(text, /\[\d{2}:\d{2}\] JARVIS: Overcast, 11 degrees, sir\./);
    assert.match(text, /End of transcript\.$/);
  });

  test('includes sources by default and omits them on request', () => {
    const withSources = formatTranscript(session, { exportedAt: T1 });
    assert.match(withSources, /SOURCES:/);
    assert.match(withSources, /- Open-Meteo \(https:\/\/open-meteo\.com\/\)/);

    const withoutSources = formatTranscript(session, { exportedAt: T1, includeSources: false });
    assert.doesNotMatch(withoutSources, /SOURCES:/);
    assert.doesNotMatch(withoutSources, /open-meteo/);
  });

  test('a source with no URL is skipped rather than printed as a dead link', () => {
    const broken: ChatSession = {
      ...session,
      messages: [
        {
          id: 'c',
          role: 'assistant',
          content: 'Found it.',
          timestamp: T0,
          sources: [
            { title: 'No link', url: '' },
            { title: 'Good', url: 'https://example.com/' },
          ],
        },
      ],
    };
    const text = formatTranscript(broken, { exportedAt: T1 });
    assert.ok(!text.includes('No link'));
    assert.ok(text.includes('- Good (https://example.com/)'));
  });

  test('falls back to the URL when a source has no title', () => {
    const untitled: ChatSession = {
      ...session,
      messages: [
        {
          id: 'd',
          role: 'assistant',
          content: 'Reference attached.',
          timestamp: T0,
          sources: [{ title: '', url: 'https://example.org/x' }],
        },
      ],
    };
    assert.match(
      formatTranscript(untitled, { exportedAt: T1 }),
      /- https:\/\/example\.org\/x \(https:\/\/example\.org\/x\)/
    );
  });

  test('handles an empty conversation and a missing title', () => {
    const empty = formatTranscript(
      { title: '', messages: [], updatedAt: T0 },
      { exportedAt: T0 }
    );
    assert.match(empty, /TRANSCRIPT — New conversation/);
    assert.match(empty, /0 messages/);
    assert.match(empty, /End of transcript\./);
  });

  test('trims message bodies so indentation is not doubled', () => {
    const padded: ChatSession = {
      ...session,
      messages: [{ id: 'e', role: 'user', content: '   spaced   ', timestamp: T0 }],
    };
    assert.match(formatTranscript(padded, { exportedAt: T0 }), /YOU: spaced\n/);
  });
});

describe('buildSharePayload', () => {
  test('produces a Share-compatible message and title', () => {
    const payload = buildSharePayload(session, { exportedAt: T1 });
    assert.equal(payload.title, 'Jarvis — Weather in London');
    assert.equal(payload.message, formatTranscript(session, { exportedAt: T1 }));
  });

  test('titles an unnamed conversation sensibly', () => {
    const payload = buildSharePayload({ title: '', messages: [], updatedAt: T0 });
    assert.equal(payload.title, 'Jarvis — transcript');
  });
});

describe('formatSingleMessage', () => {
  test('formats one labelled line for the copy action', () => {
    const line = formatSingleMessage(session.messages[1]);
    assert.match(line, /^\[\d{2}:\d{2}\] JARVIS: Overcast, 11 degrees, sir\.$/);
  });
});
