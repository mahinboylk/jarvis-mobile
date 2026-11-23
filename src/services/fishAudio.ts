import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { authHeaders, env, hasFishCredentials, resolveEndpoint } from '../config/env';
import {
  FISH_AUDIO,
  FISH_AUDIO_API_BASE,
  FISH_AUDIO_WALLET_BASE,
  TIMEOUTS,
} from '../config/models';
import { useChatStore } from '../state/chatStore';
import { VoiceOption } from '../types';
import { connectivity } from './connectivity';
import { setQuota } from './quota';
import { audioService } from './audio';
import { ttsCacheKey, lookupClip, storeClip, pruneClips } from './ttsCache';

export interface TTSResult {
  isFallback: boolean;
  played: boolean;
}

export interface SpeakOptions {
  fishVoiceId?: string;
  deviceVoiceId?: string | null;
  rate?: number;
  pitch?: number;
  locale?: string;
  /** Skip the Fish Audio attempt entirely (used for timer chimes, etc.). */
  deviceOnly?: boolean;
}

/** Incremental speech pipeline fed by the LLM token stream. */
export interface SpeechSession {
  /** Append streamed text; complete sentences are queued for playback. */
  push(chunk: string): void;
  /** Flush the tail and resolve once everything queued has been spoken. */
  finish(onComplete?: () => void): Promise<TTSResult>;
  /** Abandon the session immediately. */
  cancel(): void;
}

/** Monotonic id so barge-in / stopAll cancels in-flight sentence playback. */
let speakEpoch = 0;

const SENTENCE_BOUNDARY = /[.!?…]+["')\]]*\s/g;

/**
 * Walk a string and split it at completed sentence boundaries.
 * No lookbehind is used — Hermes does not support it.
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const sentences: string[] = [];
  let start = 0;
  SENTENCE_BOUNDARY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_BOUNDARY.exec(normalized)) !== null) {
    const end = match.index + match[0].length;
    const sentence = normalized.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }
  const tail = normalized.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences.length > 0 ? sentences : [normalized];
}

/**
 * Split only at boundaries that are already followed by whitespace, so a
 * partially streamed word ("Don't sto") is never spoken as its own sentence.
 * Returns the complete sentences plus the unconsumed remainder.
 */
export function takeCompleteSentences(buffer: string): { sentences: string[]; rest: string } {
  const normalized = buffer.replace(/\s+/g, ' ');
  const sentences: string[] = [];
  let start = 0;
  let lastBoundary = -1;

  SENTENCE_BOUNDARY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_BOUNDARY.exec(normalized)) !== null) {
    lastBoundary = match.index + match[0].length;
  }
  if (lastBoundary <= 0) return { sentences: [], rest: normalized };

  const head = normalized.slice(0, lastBoundary);
  SENTENCE_BOUNDARY.lastIndex = 0;
  while ((match = SENTENCE_BOUNDARY.exec(head)) !== null) {
    const end = match.index + match[0].length;
    const sentence = head.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }

  return { sentences, rest: normalized.slice(lastBoundary) };
}

/** Device voices available for the settings picker. */
export async function listDeviceVoices(): Promise<VoiceOption[]> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    return voices.map((voice) => ({
      id: voice.identifier,
      name: voice.name || voice.identifier,
      language: voice.language || '',
    }));
  } catch (e) {
    console.warn('Could not enumerate device voices', e);
    return [];
  }
}

export class FishAudioService {
  private hasWarnedAboutCredit = false;

  private resolveVoiceId(override?: string): string {
    return (override || '').trim() || env.fishAudioModelId || FISH_AUDIO.JARVIS_VOICE_ID;
  }

  /**
   * Synthesize `text`, reusing a locally cached clip when the same phrase was
   * spoken before with the same voice. Cached clips are never deleted after
   * playback, so the second utterance costs nothing and starts instantly.
   */
  private async synthesize(
    text: string,
    voiceId: string
  ): Promise<{ uri: string; cached: boolean }> {
    const key = ttsCacheKey(text, voiceId, FISH_AUDIO.TTS_MODEL);
    const cachedUri = lookupClip(key);
    if (cachedUri) return { uri: cachedUri, cached: true };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUTS.TTS_TIMEOUT_MS);
    let response: Awaited<ReturnType<typeof fetch>>;

    try {
      response = await fetch(resolveEndpoint('fish', FISH_AUDIO_API_BASE, '/tts'), {
        method: 'POST',
        headers: {
          ...authHeaders('fish'),
          'Content-Type': 'application/json',
          model: FISH_AUDIO.TTS_MODEL,
        },
        body: JSON.stringify({
          text,
          reference_id: voiceId,
          format: 'mp3',
          mp3_bitrate: 64,
          normalize: true,
          latency: 'low',
          chunk_length: 100,
        }),
        signal: controller.signal,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        throw new Error(`Fish Audio TTS timed out after ${TIMEOUTS.TTS_TIMEOUT_MS / 1000}s.`);
      }
      connectivity.reportFailure(e);
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Fish Audio returned status ${response.status}: ${errorBody}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('Received empty audio payload from Fish Audio.');
    }

    const bytes = new Uint8Array(arrayBuffer);
    connectivity.reportSuccess();

    try {
      const uri = storeClip(key, bytes);
      pruneClips();
      return { uri, cached: false };
    } catch (cacheError) {
      // Cache failure must never break speech — fall back to a temp clip.
      console.warn('TTS cache write failed, using temp file', cacheError);
      const file = new File(
        Paths.cache,
        `jarvis_response_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`
      );
      file.create({ overwrite: true });
      file.write(bytes);
      return { uri: file.uri, cached: false };
    }
  }

  /** Speak through the device voice (expo-speech). Always resolves. */
  private speakWithDevice(
    text: string,
    options: SpeakOptions,
    onComplete?: () => void
  ): Promise<TTSResult> {
    return new Promise((resolve) => {
      try {
        Speech.speak(text, {
          language: options.locale || 'en-GB',
          pitch: options.pitch ?? 0.95,
          rate: options.rate ?? 1.05,
          ...(options.deviceVoiceId ? { voice: options.deviceVoiceId } : {}),
          onDone: () => {
            if (onComplete) onComplete();
            resolve({ isFallback: true, played: true });
          },
          onStopped: () => {
            if (onComplete) onComplete();
            resolve({ isFallback: true, played: false });
          },
          onError: (err) => {
            console.error('expo-speech error:', err);
            if (onComplete) onComplete();
            resolve({ isFallback: true, played: false });
          },
        });
      } catch (speechErr) {
        console.error('Failed to initiate expo-speech:', speechErr);
        if (onComplete) onComplete();
        resolve({ isFallback: true, played: false });
      }
    });
  }

  /** Best-effort removal of a synthesized clip from the cache. */
  private deleteClip(uri: string | null | undefined): void {
    if (!uri) return;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch (_) {}
  }

  /** Wait for an in-flight synthesis, then delete the clip (cancel path). */
  private discardClip(prefetch: Promise<{ uri: string; cached: boolean }> | null): void {
    if (!prefetch) return;
    prefetch
      .then((clip) => {
        if (!clip.cached) this.deleteClip(clip.uri);
      })
      .catch(() => {});
  }

  /** Halt every form of speech and invalidate in-flight sessions. */
  async stopAll(): Promise<void> {
    speakEpoch += 1;
    try {
      await audioService.stopPlayback();
    } catch (_) {}
    try {
      const isSpeaking = await Speech.isSpeakingAsync();
      if (isSpeaking) await Speech.stop();
    } catch (_) {}
  }

  /**
   * Open an incremental speech session.
   *
   * The LLM streams tokens in; complete sentences are synthesized (with the next
   * one prefetched while the current one plays) so the first words are audible
   * long before the reply finishes generating.
   */
  beginSession(options: SpeakOptions = {}): SpeechSession {
    const epoch = ++speakEpoch;
    const voiceId = this.resolveVoiceId(options.fishVoiceId);
    const useFish = hasFishCredentials() && !options.deviceOnly;

    const queue: string[] = [];
    const fallbackQueue: string[] = [];
    let buffer = '';
    let finished = false;
    let cancelled = false;
    let loopStarted = false;
    let playedCount = 0;
    let usedFallback = false;
    let wake: (() => void) | null = null;
    let drainResolve: (() => void) | null = null;

    const drained = new Promise<void>((resolve) => {
      drainResolve = resolve;
    });

    const notify = () => {
      const fn = wake;
      wake = null;
      if (fn) fn();
    };

    const waitForWork = () =>
      new Promise<void>((resolve) => {
        wake = resolve;
      });

    const stale = () => cancelled || epoch !== speakEpoch;

    const runLoop = async () => {
      let prefetch: Promise<{ uri: string; cached: boolean }> | null = null;
      try {
        for (;;) {
          if (stale()) {
            this.discardClip(prefetch);
            return;
          }
          if (queue.length === 0) {
            if (finished) return;
            await waitForWork();
            continue;
          }

          const sentence = queue.shift() as string;
          if (!prefetch) prefetch = this.synthesize(sentence, voiceId);

          let clip: { uri: string; cached: boolean } | null = null;
          try {
            clip = await prefetch;
          } catch (e: any) {
            prefetch = null;
            usedFallback = true;
            if (!this.hasWarnedAboutCredit) {
              this.hasWarnedAboutCredit = true;
              console.warn(
                'Fish Audio TTS failed (falling back to on-device speech). ' +
                  'If this persists with status 402, top up API credit at https://fish.audio/app/developers.',
                e?.message || e
              );
            }
            useChatStore.getState().setBanner('Voice synthesis failed — using on-device voice.');
            fallbackQueue.push(sentence);
            continue;
          }
          prefetch = null;

          if (stale()) {
            if (!clip.cached) this.deleteClip(clip.uri);
            return;
          }

          // Prefetch the next sentence while this one plays.
          if (queue.length > 0) {
            prefetch = this.synthesize(queue[0] as string, voiceId);
            prefetch.catch(() => {});
          }

          await audioService.playAudio(clip.uri);
          if (!clip.cached) this.deleteClip(clip.uri);
          playedCount += 1;
        }
      } finally {
        // Mid-pipeline failure: finish the remainder on-device so the reply is
        // never truncated.
        if (!stale() && fallbackQueue.length > 0) {
          try {
            await this.speakWithDevice(fallbackQueue.join(' '), options);
            playedCount += 1;
          } catch (_) {}
        }
        const done = drainResolve;
        drainResolve = null;
        if (done) done();
      }
    };

    const ensureLoop = () => {
      if (loopStarted) return;
      loopStarted = true;
      void runLoop().catch((e) => {
        console.warn('speech session loop failed', e);
      });
    };

    const push = (chunk: string) => {
      if (!chunk || cancelled || finished) return;

      if (!useFish) {
        fallbackQueue.push(chunk);
        return;
      }

      buffer += chunk;
      const { sentences, rest } = takeCompleteSentences(buffer);
      buffer = rest;
      if (sentences.length > 0) {
        queue.push(...sentences);
        ensureLoop();
        notify();
      }
    };

    const cancel = () => {
      cancelled = true;
      notify();
      audioService.stopPlayback().catch(() => {});
    };

    const finish = async (onComplete?: () => void): Promise<TTSResult> => {
      if (cancelled) {
        if (onComplete) onComplete();
        return { isFallback: usedFallback, played: playedCount > 0 };
      }

      if (!useFish) {
        const collected = `${fallbackQueue.join(' ')} ${buffer}`.trim();
        buffer = '';
        fallbackQueue.length = 0;
        if (!collected) {
          if (onComplete) onComplete();
          return { isFallback: true, played: false };
        }
        return this.speakWithDevice(collected, options, onComplete);
      }

      const tail = buffer.trim();
      buffer = '';
      if (tail) queue.push(tail);

      finished = true;
      ensureLoop();
      notify();
      await drained;

      if (onComplete) onComplete();
      return { isFallback: usedFallback, played: playedCount > 0 };
    };

    return { push, finish, cancel };
  }

  /**
   * Speak a complete string in one shot. Used for timer announcements and any
   * utterance that does not arrive as an LLM token stream.
   */
  async speak(
    text: string,
    onComplete?: () => void,
    options: SpeakOptions = {}
  ): Promise<TTSResult> {
    if (!text || !text.trim()) {
      // Nothing to vocalize — don't wake the device voice for whitespace.
      if (onComplete) onComplete();
      return { isFallback: false, played: false };
    }

    await this.stopAll();

    if (!hasFishCredentials() && !this.hasWarnedAboutCredit) {
      this.hasWarnedAboutCredit = true;
      console.warn('Fish Audio API key missing. Using on-device speech fallback.');
    }

    const session = this.beginSession({
      ...options,
      deviceOnly: options.deviceOnly ?? !hasFishCredentials(),
    });
    session.push(text);
    return session.finish(onComplete);
  }


}

export const fishAudioService = new FishAudioService();

/**
 * Read the Fish Audio developer credit balance (GAP-D4).
 *
 * `GET /wallet/self/api-credit` → `{ credit, cumulative_top_up, ... }`.
 * Publishes into the shared quota snapshot that Settings renders and returns
 * the credit string, or null when unavailable (no key, proxy mode without the
 * wallet route, or an offline device).
 */
export async function fetchFishBalance(): Promise<string | null> {
  if (!hasFishCredentials()) return null;

  try {
    const response = await fetch(
      resolveEndpoint('fish', FISH_AUDIO_WALLET_BASE, '/wallet/self/api-credit'),
      {
        method: 'GET',
        headers: { ...authHeaders('fish'), Accept: 'application/json' },
      }
    );
    if (!response.ok) {
      console.warn(`fish audio balance lookup failed: HTTP ${response.status}`);
      return null;
    }

    const data: any = await response.json();
    const credit =
      typeof data?.credit === 'string' ? data.credit : String(data?.credit ?? '').trim();
    if (!credit) return null;

    setQuota({ provider: 'fish', credit, throttled: false, updatedAt: Date.now() });
    return credit;
  } catch (error) {
    console.warn('fish audio balance lookup failed', error);
    return null;
  }
}


