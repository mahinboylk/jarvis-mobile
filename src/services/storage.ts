import { File, Paths } from 'expo-file-system';

/**
 * Tiny file-backed JSON store used for conversation + settings persistence.
 *
 * We deliberately use `expo-file-system`'s durable `Paths.document` directory
 * rather than AsyncStorage so the app adds no native dependency and keeps
 * working inside Expo Go.
 */

export const STORAGE_VERSION = 1;

const fileFor = (name: string): File => new File(Paths.document, name);

/** Read and parse a JSON document, returning null when absent or corrupt. */
export async function readJson<T>(name: string): Promise<T | null> {
  try {
    const file = fileFor(name);
    if (!file.exists) return null;
    const raw = await file.text();
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (e) {
    // A corrupt file must never brick startup — fall back to defaults.
    console.warn(`storage: could not read ${name}`, e);
    return null;
  }
}

/** Best-effort synchronous write; never throws into a render/effect path. */
export function writeJson(name: string, value: unknown): void {
  try {
    const file = fileFor(name);
    if (!file.exists) file.create({ overwrite: true });
    file.write(JSON.stringify(value));
  } catch (e) {
    console.warn(`storage: could not write ${name}`, e);
  }
}

export function removeFile(name: string): void {
  try {
    const file = fileFor(name);
    if (file.exists) file.delete();
  } catch (e) {
    console.warn(`storage: could not delete ${name}`, e);
  }
}

/**
 * Coalesces bursts of writes (streaming replies mutate the store rapidly) into
 * one disk write per `waitMs`. Returns a `flush` used on unmount/background.
 */
export function createDebouncedWriter<T>(
  name: string,
  waitMs = 600
): { schedule: (value: T) => void; flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | undefined;
  let hasPending = false;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!hasPending) return;
    hasPending = false;
    writeJson(name, pending);
  };

  const schedule = (value: T) => {
    pending = value;
    hasPending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, waitMs);
  };

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    hasPending = false;
  };

  return { schedule, flush, cancel };
}
