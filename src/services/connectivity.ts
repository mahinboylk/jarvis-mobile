import { fetch as expoFetch } from 'expo/fetch';

/**
 * Dependency-free connectivity monitor.
 *
 * There is no `@react-native-community/netinfo` in this project (and no native
 * module may be added under Expo Go), so online/offline is inferred two ways:
 *
 * 1. **Passive** — every service reports the outcome of each real request via
 *    `reportSuccess()` / `reportFailure()`. Most users never see a probe.
 * 2. **Active** — while believed offline, a tiny 204 endpoint is polled on a
 *    backoff so the banner clears itself the moment connectivity returns.
 */

const PROBE_URL = 'https://www.gstatic.com/generate_204';
const PROBE_TIMEOUT_MS = 4_000;
const RECHECK_INTERVAL_MS = 10_000;

type Listener = (online: boolean) => void;

let online = true;
let probing = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

const emit = (next: boolean) => {
  if (next === online) return;
  online = next;
  listeners.forEach((fn) => {
    try {
      fn(next);
    } catch (_) {}
  });
};

/**
 * True for failures that mean "no usable network", as opposed to an HTTP error
 * or a deliberate abort. React Native surfaces transport failures as
 * `TypeError: Network request failed`; expo/fetch adds a couple of variants.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: string })?.name ?? '';
  if (name === 'AbortError') return false;
  const message = String((error as { message?: string })?.message ?? error).toLowerCase();
  return (
    name === 'TypeError' ||
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('network error') ||
    message.includes('connection') ||
    message.includes('offline') ||
    message.includes('timed out') ||
    message.includes('timeout')
  );
}

const schedulePoll = () => {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    void connectivity.checkNow();
  }, RECHECK_INTERVAL_MS);
};

const clearPoll = () => {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
};

export const connectivity = {
  isOnline(): boolean {
    return online;
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  /** A real request completed — we are definitely online. */
  reportSuccess(): void {
    clearPoll();
    emit(true);
  },

  /** A transport-level failure occurred — start probing for recovery. */
  reportFailure(error: unknown): void {
    if (!isNetworkError(error)) return;
    emit(false);
    schedulePoll();
  },

  /** Active probe; resolves to the new online state. */
  async checkNow(): Promise<boolean> {
    if (probing) return online;
    probing = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      await expoFetch(PROBE_URL, { signal: controller.signal, method: 'GET' });
      clearPoll();
      emit(true);
    } catch {
      emit(false);
      schedulePoll();
    } finally {
      clearTimeout(timer);
      probing = false;
    }
    return online;
  },

  stop(): void {
    clearPoll();
  },
};
