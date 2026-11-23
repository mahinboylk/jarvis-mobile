import { Directory, File, Paths } from 'expo-file-system';

/**
 * Disk cache for synthesized speech clips, keyed by voice + text.
 *
 * Jarvis repeats short phrases constantly ("Yes, sir.", greetings, timer
 * announcements). Caching them locally removes a paid Fish Audio round-trip and
 * makes the second utterance effectively instant.
 */

const DIR_NAME = 'jarvis-tts';
const MAX_ENTRIES = 80;

let dirEnsured = false;

const cacheDir = (): Directory => new Directory(Paths.cache, DIR_NAME);

const ensureDir = (): void => {
  if (dirEnsured) return;
  const dir = cacheDir();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  dirEnsured = true;
};

/** Stable, filesystem-safe key for a (text, voice, locale) triple. */
export function ttsCacheKey(text: string, voiceId: string, locale: string): string {
  const input = `${voiceId}::${locale}::${text.trim().replace(/\s+/g, ' ')}`;
  // FNV-1a 32-bit — fast, dependency-free, and adequate for cache bucketing.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}_${input.length.toString(36)}`;
}

const fileForKey = (key: string): File => new File(cacheDir(), `tts_${key}.mp3`);

/** Returns a playable URI when a usable cached clip exists, else null. */
export function lookupClip(key: string): string | null {
  try {
    ensureDir();
    const file = fileForKey(key);
    if (!file.exists) return null;
    const info = file.info();
    if (info && typeof info.size === 'number' && info.size <= 0) {
      file.delete();
      return null;
    }
    return file.uri;
  } catch {
    return null;
  }
}

/** Persist a clip and return its URI. */
export function storeClip(key: string, bytes: Uint8Array): string {
  ensureDir();
  const file = fileForKey(key);
  if (!file.exists) file.create({ intermediates: true, overwrite: true });
  file.write(bytes);
  return file.uri;
}

/** Delete every cached clip. */
export function clearClips(): void {
  try {
    const dir = cacheDir();
    if (!dir.exists) return;
    dir.list().forEach((entry) => {
      try {
        entry.delete();
      } catch (_) {}
    });
  } catch (e) {
    console.warn('ttsCache: clear failed', e);
  }
}

/** Bound the cache size; evicts least-recently-modified entries first. */
export function pruneClips(max = MAX_ENTRIES): void {
  try {
    const dir = cacheDir();
    if (!dir.exists) return;
    const files = dir.list().filter((entry): entry is File => entry instanceof File);
    if (files.length <= max) return;

    const stamped = files.map((file) => {
      let modified = 0;
      try {
        modified = file.info()?.modificationTime ?? 0;
      } catch {
        modified = 0;
      }
      return { file, modified };
    });

    stamped
      .sort((a, b) => a.modified - b.modified || a.file.uri.localeCompare(b.file.uri))
      .slice(0, Math.max(0, files.length - max))
      .forEach(({ file }) => {
        try {
          file.delete();
        } catch (_) {}
      });
  } catch (e) {
    console.warn('ttsCache: prune failed', e);
  }
}

export function cachedClipCount(): number {
  try {
    const dir = cacheDir();
    return dir.exists ? dir.list().length : 0;
  } catch {
    return 0;
  }
}
