import { Platform } from 'react-native';

/**
 * Browser speech recognition (GAP-F1 + GAP-C9 fallback).
 *
 * `expo-audio` ships no `AudioStream` in its web build, so the PCM capture
 * path is dead on the web target by design. Rather than leaving voice input
 * broken there (GAP-F1), this module drives the browser's own
 * `SpeechRecognition` / `webkitSpeechRecognition`, which is the platform-native
 * ASR and needs no API key.
 *
 * ### GAP-C9 (offline / on-device STT) — evaluation
 *
 * On **web** this closes the gap outright: the browser's recogniser runs
 * locally where the OS provides one (Chrome/Safari on-device, macOS dictation)
 * and, unlike the Groq path, it keeps working when the network drops mid
 * utterance — `onerror` reports `network` instead of a thrown fetch.
 *
 * On **native** there is no equivalent inside Expo Go. The candidates were:
 *
 * | Option | Verdict |
 * |---|---|
 * | `@react-native-voice/voice` (Vosk/SherpaOnnx) | Requires a custom dev/client build — incompatible with the Expo Go badge this repo is built around. |
 * | `expo-speech` | TTS only; no recognition API. |
 * | Whisper in-JS | No Hermes-compatible WASM runtime is small enough to ship in Expo Go. |
 *
 * The recommendation is therefore: keep Groq Whisper as the native path, treat
 * a dev-build recogniser as a follow-up that *replaces* the Expo Go target, and
 * keep this module as the web implementation.
 */

type RecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type RecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
};

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((event: unknown) => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

export interface WebSpeechOptions {
  /** BCP-47 tag, e.g. `en-GB`. */
  locale: string;
  /** Fired with the committed transcript so far (final + interim). */
  onTranscript: (text: string, final: boolean) => void;
  /** Fired when recognition stops on its own (end of utterance). */
  onEnd: () => void;
  /** Fatal recogniser error, already human-readable. */
  onError: (message: string) => void;
}

export interface WebSpeechSession {
  /** Committed text collected so far. */
  transcript(): string;
  /** Politely end — `onEnd` fires afterwards. */
  stop(): void;
  /** End immediately; `onEnd` must be ignored by the caller. */
  cancel(): void;
}

const ctor = ():
  | (new () => RecognitionLike)
  | null => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const scope = window as unknown as Record<string, unknown>;
  const candidate = (scope.SpeechRecognition ?? scope.webkitSpeechRecognition) as
    | (new () => RecognitionLike)
    | undefined;
  return typeof candidate === 'function' ? candidate : null;
};

/** True when this runtime can accept voice input at all. */
export const isWebSpeechSupported = (): boolean => ctor() !== null;

const friendlyError = (code?: string): string => {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked for Jarvis. Allow it in your browser settings and try again.';
    case 'no-speech':
      return "I didn't catch that, sir. Tap the microphone and try again.";
    case 'audio-capture':
      return 'No microphone was found. Check your input device and retry.';
    case 'network':
      return 'The browser speech service is unreachable — you appear to be offline.';
    case 'language-not-supported':
      return `This browser does not support speech recognition for that language.`;
    default:
      return 'Speech recognition stopped unexpectedly. Please try again.';
  }
};

/**
 * Start a recognition session. The returned handle exposes the committed text
 * so the caller can decide when the turn is over (tap, or automatic end).
 */
export function listenWebSpeech(options: WebSpeechOptions): WebSpeechSession | null {
  const Ctor = ctor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = options.locale || 'en-GB';
  recognition.continuous = true;
  recognition.interimResults = true;

  let finalText = '';
  let cancelled = false;

  recognition.onstart = () => {
    /* listening — the store already reflects this */
  };

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!result) continue;
      const piece = result[0]?.transcript ?? '';
      if (result.isFinal) finalText += `${piece} `;
      else interim += piece;
    }
    const committed = (finalText + interim).replace(/\s+/g, ' ').trim();
    if (committed) options.onTranscript(committed, finalText.trim().length > 0 && !interim);
  };

  recognition.onerror = (event) => {
    if (cancelled) return;
    const code = event?.error;
    if (code === 'aborted') return;
    options.onError(friendlyError(code));
  };

  recognition.onend = () => {
    if (cancelled) return;
    options.onEnd();
  };

  try {
    recognition.start();
  } catch (error) {
    options.onError((error as Error)?.message || friendlyError('start-failed'));
    return null;
  }

  return {
    transcript: () => finalText.replace(/\s+/g, ' ').trim(),
    stop: () => {
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    },
    cancel: () => {
      cancelled = true;
      try {
        recognition.abort();
      } catch {
        /* already stopped */
      }
    },
  };
}
