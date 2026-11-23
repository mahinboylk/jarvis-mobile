/**
 * Serialized request queue with a shared rate-limit gate (GAP-E2).
 *
 * Backoff alone is not enough: when a 429 lands, every *other* in-flight and
 * queued call is also about to be rejected, and each one independently backing
 * off multiplies the pressure on the endpoint. Two things fix that here:
 *
 * 1. **A FIFO queue** — provider calls leave one at a time (configurable), so a
 *    burst of UI activity can no longer fan out into parallel requests.
 * 2. **A shared cooldown** — any 429 publishes a global "not before" timestamp;
 *    everything behind it waits for that instant instead of retrying into the
 *    same wall. `Retry-After` wins over computed backoff.
 *
 * The gate is also observable so Settings can surface quota state (GAP-D4).
 */

export interface RateLimitState {
  /** Absolute epoch-ms before which no request should be sent. 0 = no cooldown. */
  cooldownUntil: number;
  /** Provider that reported the limit, e.g. "groq". */
  provider: string;
  /** Free-form label, e.g. "429 rate_limited" or "tokens_per_minute". */
  reason: string;
  epochMs: number;
}

export interface RequestQueueOptions {
  /** How many tasks may run at once. 1 = strictly serialized (default). */
  concurrency?: number;
}

const MAX_COOLDOWN_MS = 30_000;

let cooldownUntil = 0;
let cooldownProvider = '';
let cooldownReason = '';
const listeners = new Set<(state: RateLimitState) => void>();

const publish = (): void => {
  const snapshot = getRateLimitState();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      /* a listener must never break the queue */
    }
  });
};

/** Current cooldown snapshot (GAP-D4 reads this for the settings surface). */
export function getRateLimitState(): RateLimitState {
  return {
    cooldownUntil,
    provider: cooldownProvider,
    reason: cooldownReason,
    epochMs: Date.now(),
  };
}

/** Milliseconds left on the global cooldown (0 when clear). */
export function rateLimitRemainingMs(): number {
  return Math.max(0, cooldownUntil - Date.now());
}

/** Subscribe to cooldown changes. Returns an unsubscribe function. */
export function subscribeRateLimit(listener: (state: RateLimitState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Publish a rate-limit hit so every queued and future request waits.
 * @param provider "groq" | "fish"
 * @param waitMs   how long to hold off (already parsed from Retry-After)
 * @param reason   short label for the UI
 */
export function reportRateLimit(provider: string, waitMs: number, reason = '429'): void {
  const bounded = Math.min(Math.max(0, waitMs), MAX_COOLDOWN_MS);
  const until = Date.now() + bounded;
  if (until <= cooldownUntil) return;
  cooldownUntil = until;
  cooldownProvider = provider;
  cooldownReason = reason;
  publish();
}

/** Clear the cooldown (used when a probe succeeds or the user retries). */
export function clearRateLimit(): void {
  if (cooldownUntil === 0) return;
  cooldownUntil = 0;
  cooldownProvider = '';
  cooldownReason = '';
  publish();
}

const wait = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * Block while the shared cooldown is active. Callers with an abort signal bail
 * out as soon as the user barges in.
 */
export async function awaitRateLimitGate(signal?: AbortSignal): Promise<void> {
  for (;;) {
    const remaining = rateLimitRemainingMs();
    if (remaining <= 0) return;
    await wait(Math.min(remaining, MAX_COOLDOWN_MS), signal);
  }
}

export interface RequestQueue {
  /** Run `task` once a slot is free and the cooldown has elapsed. */
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  /** Tasks waiting for a slot (0 when idle). */
  readonly pending: number;
  /** Tasks currently executing. */
  readonly active: number;
}

/**
 * Create a FIFO task queue. `run()` resolves/rejects exactly like `task`, so it
 * is a drop-in wrapper for an existing call site.
 */
export function createRequestQueue(options: RequestQueueOptions = {}): RequestQueue {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  let active = 0;
  const waiters: (() => void)[] = [];
  let waiting = 0;

  const pump = (): void => {
    while (active < concurrency && waiters.length > 0) {
      active += 1;
      const grant = waiters.shift()!;
      grant();
    }
  };

  const queue = {
    async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      // Always queue so ordering is strictly FIFO, even when a slot is free —
      // pump() grants synchronously in that case, so nothing is really lost.
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        let granted = false;

        const onAbort = () => {
          if (granted) return;
          const index = waiters.indexOf(waiter);
          if (index !== -1) {
            waiters.splice(index, 1);
            waiting -= 1;
          }
          reject(abortError());
        };

        const waiter = () => {
          granted = true;
          signal?.removeEventListener('abort', onAbort);
          waiting -= 1;
          resolve();
        };

        signal?.addEventListener('abort', onAbort, { once: true });
        waiting += 1;
        waiters.push(waiter);
        pump();
      });

      try {
        await awaitRateLimitGate(signal);
        return await task();
      } finally {
        active -= 1;
        pump();
      }
    },
    get pending() {
      return waiting;
    },
    get active() {
      return active;
    },
  };

  return queue;
}

/** Shared queue for Groq chat completions — one reply at a time (GAP-E2). */
export const chatRequestQueue = createRequestQueue({ concurrency: 1 });

/** Shared queue for STT requests so a retry cannot race a fresh transcription. */
export const asrRequestQueue = createRequestQueue({ concurrency: 1 });
