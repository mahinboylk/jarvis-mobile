/** Shared async helpers: timeouts, retry backoff, and small delays. */

export class TimeoutError extends Error {
  code = 'TIMEOUT';
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${Math.round(ms / 1000)}s. Check your connection and retry.`);
    this.name = 'TimeoutError';
  }
}

/** Reject if `promise` has not settled within `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exponential backoff with jitter and a Retry-After override, used to survive
 * Groq's free-tier 429s without hammering the endpoint.
 */
export function backoffDelayMs(attempt: number, retryAfterMs?: number): number {
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    return Math.min(retryAfterMs, 8_000);
  }
  const base = Math.min(500 * 2 ** attempt, 8_000);
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

/** Parse a `Retry-After` header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}
