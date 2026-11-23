import { ChatMessage, ChatSession, SearchSource } from '../types';

/**
 * Plain-text transcript export (GAP-B4).
 *
 * Kept free of React Native imports so the exact same formatter is unit-tested
 * and reused by the share sheet, the clipboard copy, and any future PDF/Markdown
 * exporter.
 */

const LABEL: Record<string, string> = {
  user: 'YOU',
  assistant: 'JARVIS',
  system: 'SYSTEM',
};

export interface TranscriptOptions {
  /** Override the export timestamp (tests pass a fixed value). */
  exportedAt?: number;
  /** Include source URLs for replies that used live search. Default true. */
  includeSources?: boolean;
}

const pad = (value: number): string => String(value).padStart(2, '0');

const clock = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const dayStamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const sourceLines = (sources: SearchSource[]): string[] =>
  sources.filter((source) => !!source.url).map((source) => `   - ${source.title || source.url} (${source.url})`);

/** One conversation rendered as copyable text. */
export function formatTranscript(
  session: Pick<ChatSession, 'title' | 'messages' | 'updatedAt'>,
  options: TranscriptOptions = {}
): string {
  const { includeSources = true, exportedAt = Date.now() } = options;
  const title = session.title || 'New conversation';
  const divider = '-'.repeat(48);

  const header = [
    `J.A.R.V.I.S. TRANSCRIPT — ${title}`,
    `Exported ${dayStamp(exportedAt)} ${clock(exportedAt)}`,
    `${session.messages.length} message${session.messages.length === 1 ? '' : 's'}`,
    divider,
  ];

  const body = session.messages.map((message) => {
    const label = LABEL[message.role] ?? LABEL.system;
    const lines = [`[${clock(message.timestamp)}] ${label}: ${message.content.trim()}`];
    if (includeSources && message.sources && message.sources.length > 0) {
      lines.push('   SOURCES:');
      lines.push(...sourceLines(message.sources));
    }
    return lines.join('\n');
  });

  return [...header, ...body, divider, 'End of transcript.'].join('\n').trim();
}

/** Share-sheet payload for the active thread. */
export function buildSharePayload(
  session: Pick<ChatSession, 'title' | 'messages' | 'updatedAt'>,
  options: TranscriptOptions = {}
): { message: string; title: string } {
  const message = formatTranscript(session, options);
  return { message, title: `Jarvis — ${session.title || 'transcript'}` };
}

/** Convenience for a single message (used by the bubble's copy action). */
export function formatSingleMessage(message: ChatMessage): string {
  const label = LABEL[message.role] ?? LABEL.system;
  return `[${clock(message.timestamp)}] ${label}: ${message.content.trim()}`;
}
