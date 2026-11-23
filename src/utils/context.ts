import { ChatMessage, LLMChatMessage } from '../types';

/**
 * Explicit conversation context budget (GAP-B5).
 *
 * Previously the history was `.slice(-8)`: a fixed turn count with no regard
 * for how big each turn actually was. One long pasted log and the window is
 * blown, while everything older is silently dropped *and* silently forgotten.
 *
 * This module caps the history two ways at once — turn count **and** character
 * budget — and folds whatever falls outside into a rolling digest that is sent
 * as an extra system message. Nothing is ever lost from the transcript; only
 * what ships to the model is trimmed.
 *
 * The digest is computed locally and deterministically (no extra LLM round
 * trip), which keeps the budget free and makes the behaviour unit-testable.
 */

/** Hard ceiling on the characters of verbatim history we send. */
export const CONTEXT_CHAR_BUDGET = 4_000;

/** Maximum number of history messages sent verbatim. */
export const CONTEXT_MAX_MESSAGES = 12;

/** Longest single history message before it is elided. */
const MAX_TURN_CHARS = 600;

/** Longest rolling digest shipped as a system message. */
export const SUMMARY_CHAR_BUDGET = 700;

export interface ContextOptions {
  budgetChars?: number;
  maxMessages?: number;
}

export interface ContextPlan {
  /** History messages to send verbatim, oldest first. */
  kept: ChatMessage[];
  /** Rolling digest of everything trimmed, or '' when nothing was dropped. */
  summary: string;
  /** How many messages were folded into `summary`. */
  droppedCount: number;
  /** Characters occupied by `kept` plus `summary`. */
  usedChars: number;
}

const elide = (text: string, max: number): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
};

/** One digest line for a trimmed turn. */
export function digestLine(message: ChatMessage): string {
  const who = message.role === 'user' ? 'You' : 'Jarvis';
  return `${who}: ${elide(message.content, MAX_TURN_CHARS)}`;
}

/**
 * Build the rolling digest for `dropped` messages, capped at `summaryBudget`.
 * Newest dropped turns are kept when the cap bites — they are the ones the
 * model is most likely to need next.
 */
export function buildSummary(dropped: ChatMessage[], summaryBudget = SUMMARY_CHAR_BUDGET): string {
  if (dropped.length === 0) return '';

  const lines = dropped.map(digestLine);
  const header = `[Earlier in this conversation, trimmed for length (${dropped.length} message${
    dropped.length === 1 ? '' : 's'
  }):]`;

  const parts: string[] = [];
  let used = header.length;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const candidate = `${lines[i]}\n`;
    if (used + candidate.length > summaryBudget) break;
    parts.unshift(candidate);
    used += candidate.length;
  }

  // Always keep at least the most recent dropped turn, truncated to fit.
  if (parts.length === 0) {
    const tail = lines[lines.length - 1] ?? '';
    parts.push(`${tail.slice(0, Math.max(0, summaryBudget - header.length - 1))}\n`);
  }

  return `${header}\n${parts.join('').trimEnd()}`;
}

/**
 * Decide which history to send verbatim and what to summarise.
 *
 * Walks backwards from the newest turn, keeping whole messages while both the
 * turn count and the character budget allow it.
 */
export function planContext(
  history: ChatMessage[],
  options: ContextOptions = {}
): ContextPlan {
  const budgetChars = options.budgetChars ?? CONTEXT_CHAR_BUDGET;
  const maxMessages = Math.max(1, options.maxMessages ?? CONTEXT_MAX_MESSAGES);

  const usable = history.filter((message) => message.content.trim().length > 0);

  const kept: ChatMessage[] = [];
  const dropped: ChatMessage[] = [];
  let keptChars = 0;

  // Walk newest → oldest, unshifting so both lists end up chronological.
  for (let i = usable.length - 1; i >= 0; i -= 1) {
    const message = usable[i];
    const trimmed =
      message.content.length > MAX_TURN_CHARS
        ? { ...message, content: `${message.content.slice(0, MAX_TURN_CHARS).trimEnd()}…` }
        : message;

    const fitsCount = kept.length < maxMessages;
    const fitsChars = keptChars + trimmed.content.length <= budgetChars;

    if (fitsCount && fitsChars) {
      kept.unshift(trimmed);
      keptChars += trimmed.content.length;
    } else {
      dropped.unshift(message);
    }
  }

  // If the newest turn alone busts the budget, still send it — the prompt has
  // to exist for the model to answer.
  if (kept.length === 0 && usable.length > 0) {
    const newest = usable[usable.length - 1];
    kept.push(newest);
    keptChars = newest.content.length;
    dropped.length = 0;
  }

  const summary = buildSummary(dropped);

  return {
    kept,
    summary,
    droppedCount: dropped.length,
    usedChars: keptChars + summary.length,
  };
}

/**
 * Turn a plan into the system + history messages that precede the live prompt.
 * The digest is emitted as its own system message so it cannot be mistaken for
 * an instruction from the user.
 */
export function planToMessages(plan: ContextPlan): LLMChatMessage[] {
  const messages: LLMChatMessage[] = [];
  if (plan.summary) messages.push({ role: 'system', content: plan.summary });
  plan.kept.forEach((message) =>
    messages.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    })
  );
  return messages;
}
