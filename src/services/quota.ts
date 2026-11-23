/**
 * Provider quota / rate-limit transparency (GAP-D4).
 *
 * Groq publishes its free-tier budget on every response; the app previously
 * threw that away, so a user only discovered the limit by being rejected. This
 * module keeps the latest snapshot in memory (it is per-session, per-account
 * and must never be persisted to disk) and lets Settings subscribe to it.
 *
 * `expo/fetch` exposes headers on the response object, so the values here come
 * straight from the provider rather than being inferred.
 */

export type QuotaProvider = 'groq' | 'fish';

export interface QuotaSnapshot {
  provider: QuotaProvider;
  /** Remaining requests in the current window, when the provider tells us. */
  requestsRemaining?: number;
  /** Size of the current window. */
  requestsLimit?: number;
  /** Remaining tokens in the current window (chat models only). */
  tokensRemaining?: number;
  tokensLimit?: number;
  /** Fish Audio credit balance, exactly as the wallet API reports it. */
  credit?: string;
  /** Epoch-ms when the window resets. */
  resetAt?: number;
  /** Seconds the provider asked us to wait (429 only). */
  retryAfterSec?: number;
  /** True once the provider has actually rejected us. */
  throttled: boolean;
  /** Epoch-ms the snapshot was taken. */
  updatedAt: number;
}

const snapshots: Partial<Record<QuotaProvider, QuotaSnapshot>> = {};
let cache: Partial<Record<QuotaProvider, QuotaSnapshot>> = {};
const listeners = new Set<() => void>();

const notify = (): void => {
  // Rebuild the identity-stable cache before notifying so `useSyncExternalStore`
  // sees a fresh object exactly once per change instead of looping.
  cache = { ...snapshots };
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* a subscriber must never break the caller */
    }
  });
};

/**
 * Latest snapshot. Quota is tracked **per provider** so Groq's request budget
 * and Fish Audio's credit balance do not clobber one another.
 */
export function getQuota(provider?: QuotaProvider): QuotaSnapshot | null {
  if (provider) return snapshots[provider] ?? null;
  return snapshots.groq ?? snapshots.fish ?? null;
}

/** Every provider snapshot currently known (identity-stable between changes). */
export function getAllQuotas(): Partial<Record<QuotaProvider, QuotaSnapshot>> {
  return cache;
}

/** Subscribe to quota changes; returns an unsubscribe function. */
export function subscribeQuota(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Replace (or merge into) one provider's snapshot. */
export function setQuota(next: QuotaSnapshot): void {
  snapshots[next.provider] = { ...snapshots[next.provider], ...next };
  notify();
}

export function clearQuota(): void {
  if (Object.keys(snapshots).length === 0) return;
  delete snapshots.groq;
  delete snapshots.fish;
  notify();
}

const headerNumber = (headers: Headers, name: string): number | undefined => {
  const raw = headers?.get?.(name);
  if (raw == null || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};

const headerDate = (headers: Headers, name: string): number | undefined => {
  const raw = headers?.get?.(name);
  if (!raw) return undefined;
  // Groq/RateLimit style: `10000, 1` → reset in 1 second.
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Date.now() + Math.max(0, seconds * 1000);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Read Groq's rate-limit headers into a snapshot. Returns null (and leaves the
 * previous snapshot alone) when the response carries none.
 */
export function readGroqQuota(
  headers: Headers,
  opts: { throttled?: boolean; retryAfterSec?: number } = {}
): QuotaSnapshot | null {
  const requestsRemaining = headerNumber(headers, 'x-ratelimit-remaining-requests');
  const requestsLimit = headerNumber(headers, 'x-ratelimit-limit-requests');
  const tokensRemaining = headerNumber(headers, 'x-ratelimit-remaining-tokens');
  const tokensLimit = headerNumber(headers, 'x-ratelimit-limit-tokens');
  const resetAt = headerDate(headers, 'x-ratelimit-reset-requests');
  const retryAfterSec = opts.retryAfterSec ?? headerNumber(headers, 'retry-after');

  const hasData =
    requestsRemaining !== undefined ||
    tokensRemaining !== undefined ||
    resetAt !== undefined ||
    retryAfterSec !== undefined;
  if (!hasData) return null;

  return {
    provider: 'groq',
    ...(requestsRemaining !== undefined ? { requestsRemaining } : {}),
    ...(requestsLimit !== undefined ? { requestsLimit } : {}),
    ...(tokensRemaining !== undefined ? { tokensRemaining } : {}),
    ...(tokensLimit !== undefined ? { tokensLimit } : {}),
    ...(resetAt !== undefined ? { resetAt } : {}),
    ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
    throttled: !!opts.throttled,
    updatedAt: Date.now(),
  };
}

/** Record a rejection so Settings can show why a call was refused. */
export function markThrottled(provider: QuotaProvider, retryAfterSec?: number): void {
  const previous = snapshots[provider];
  setQuota({
    ...previous,
    provider,
    ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
    throttled: true,
    updatedAt: Date.now(),
  });
}
