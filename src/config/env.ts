/**
 * Centralized environment variable accessor.
 *
 * Two credential modes are supported:
 *
 * 1. **Direct (default)** — `EXPO_PUBLIC_GROQ_API_KEY` / `EXPO_PUBLIC_FISH_AUDIO_API_KEY`
 *    are read at build time and shipped inside the bundle. Convenient for local
 *    development, but the values are extractable from a release IPA/APK.
 * 2. **Proxy (recommended for release)** — set `EXPO_PUBLIC_JARVIS_PROXY_URL` to a
 *    small server that holds the real keys (see `proxy/README.md`). The app then
 *    talks to the proxy with no `Authorization` header and no secret in the bundle.
 *
 * Keys pasted in-app at first run are stored on-device and override (1) — see
 * `loadRuntimeKeys()` / `setRuntimeKey()` below.
 */

import { readJson, writeJson } from '../services/storage';

export interface AppEnv {
  groqApiKey: string;
  fishAudioApiKey: string;
  fishAudioModelId: string;
  /** Base URL of the key-holding proxy, or '' to call providers directly. */
  proxyUrl: string;
}

const normalize = (value: string | undefined): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeUrl = (value: string | undefined): string =>
  normalize(value).replace(/\/+$/, '');

export const env: AppEnv = {
  groqApiKey: normalize(process.env.EXPO_PUBLIC_GROQ_API_KEY),
  fishAudioApiKey: normalize(process.env.EXPO_PUBLIC_FISH_AUDIO_API_KEY),
  fishAudioModelId: normalize(process.env.EXPO_PUBLIC_FISH_AUDIO_MODEL_ID),
  proxyUrl: normalizeUrl(process.env.EXPO_PUBLIC_JARVIS_PROXY_URL),
};

// ── runtime (on-device) key overlay ────────────────────────────────────────
//
// `.env` values are inlined at bundle time, so a user who installs the app
// without building their own bundle has no way to add a key. Pasting a key in
// the first-run card persists it here; it takes precedence over the build-time
// value so a device-local override always wins.

const KEYS_FILE = 'jarvis_keys.json';

interface RuntimeKeys {
  groq: string;
  fish: string;
}

const runtimeKeys: RuntimeKeys = { groq: '', fish: '' };
let keysLoadPromise: Promise<void> | null = null;

/** Read persisted device-local keys. Safe to call repeatedly. */
export function loadRuntimeKeys(): Promise<void> {
  if (!keysLoadPromise) {
    keysLoadPromise = (async () => {
      try {
        const stored = await readJson<Partial<RuntimeKeys>>(KEYS_FILE);
        if (stored?.groq) runtimeKeys.groq = normalize(stored.groq);
        if (stored?.fish) runtimeKeys.fish = normalize(stored.fish);
      } catch (e) {
        console.warn('could not read saved API keys', e);
      }
    })();
  }
  return keysLoadPromise;
}

/** Persist a device-local key (empty string clears it). */
export function setRuntimeKey(kind: keyof RuntimeKeys, value: string): void {
  runtimeKeys[kind] = normalize(value);
  writeJson(KEYS_FILE, runtimeKeys);
}

/** Resolved Groq key: device-local override first, then the build-time value. */
const groqKey = (): string => runtimeKeys.groq || env.groqApiKey;
const fishKey = (): string => runtimeKeys.fish || env.fishAudioApiKey;

// True when requests should be routed through the key-holding proxy.
// (Named `isProxyMode`, not `useProxy` — it is a plain predicate, not a hook.)
export const isProxyMode = (): boolean => env.proxyUrl.length > 0;

/** True when a Groq call can be made (key present, or a proxy is set). */
export const hasGroqCredentials = (): boolean => isProxyMode() || groqKey().length > 0;

/** True when a Fish Audio call can be made (key present, or a proxy is set). */
export const hasFishCredentials = (): boolean => isProxyMode() || fishKey().length > 0;

/** Absolute URL for a provider path, routed through the proxy when configured. */
export const resolveEndpoint = (provider: 'groq' | 'fish', base: string, path: string): string =>
  isProxyMode() ? `${env.proxyUrl}/${provider}${path}` : `${base}${path}`;

/**
 * Auth headers for a provider call. Empty when proxying — the proxy injects the
 * real key, so nothing sensitive ever reaches the client.
 */
export const authHeaders = (kind: 'groq' | 'fish'): Record<string, string> => {
  if (isProxyMode()) return {};
  const key = kind === 'groq' ? groqKey() : fishKey();
  return { Authorization: `Bearer ${key}` };
};
