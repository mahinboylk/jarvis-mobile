import { AccessibilityInfo } from 'react-native';

/**
 * Screen-reader helpers (GAP-F2).
 *
 * `accessibilityLiveRegion` only fires when an *already mounted* node changes
 * its content. A transcript is append-only, so every reply mounts a brand new
 * bubble that would never be announced — new content must be pushed explicitly
 * with `announceForAccessibility`.
 */

/** Announce `message` to assistive tech. Silently ignores failures. */
export function announce(message: string | null | undefined): void {
  const text = (message ?? '').trim();
  if (!text) return;
  try {
    AccessibilityInfo.announceForAccessibility(text);
  } catch {
    // Web/older RN builds may not expose the native method.
  }
}

/** First `max` characters of `text`, ellipsised on a word boundary. */
export function truncateForSpeech(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Announce an assistant reply once it settles (never for streamed tokens). */
export function announceReply(text: string): void {
  announce(truncateForSpeech(text));
}

/** Announce a transition into the `error` state so it is never silent. */
export function announceError(message: string): void {
  announce(`Error. ${truncateForSpeech(message, 180)}`);
}
