import { useEffect, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { AppState, Linking } from 'react-native';
import { audioService } from '../services/audio';
import { connectivity } from '../services/connectivity';
import { fishAudioService, SpeechSession } from '../services/fishAudio';
import { groqService } from '../services/groq';
import { timerService } from '../services/timers';
import {
  isWebSpeechSupported,
  listenWebSpeech,
  WebSpeechSession,
} from '../services/webSpeech';
import {
  flushChatPersistence,
  hydrateChatStore,
  selectActiveMessages,
  useChatStore,
} from '../state/chatStore';
import { AssistantState, ChatMessage, RetryAction } from '../types';
import { announceError, announceReply } from '../utils/a11y';

/**
 * Orchestrates one voice conversation:
 *
 *   mic → record (RMS → orb) → Whisper → Groq stream → Fish Audio/device TTS
 *
 * Cancellation is the fiddly part. Every user-initiated turn takes a monotonically
 * increasing `runId`; a stale run may not touch the store, so a barge-in during
 * transcription or a slow stream can never resurrect a dead UI. The chat request
 * additionally carries a real `AbortController` so the network call itself stops.
 */

export interface UseJarvisResult {
  messages: ChatMessage[];
  state: AssistantState;
  errorMessage: string | null;
  /** Idle → record → stop. While busy this acts as the STOP control. */
  toggleRecording: () => void;
  /** Send a typed directive, optionally with an attached image (GAP-A6). */
  sendTextMessage: (text: string, image?: PendingImage) => void;
  retryTranscription: () => void;
  clearMessages: () => void;
}

/** Image handed from the composer to the model on the current turn only. */
export interface PendingImage {
  /** `data:<mime>;base64,<payload>` for `image_url.url`. */
  dataUrl: string;
  /** Local URI retained on the message so the transcript can show it. */
  uri: string;
}

const HELP_TEXT = {
  noWords: "I couldn't make out any words, sir. Tap the microphone and try again.",
  tooBrief:
    'That was too brief to transcribe, sir. Tap the microphone, speak, then tap again.',
  micBlocked:
    'Microphone access is blocked for Jarvis. Opening Settings — please enable the microphone, then return.',
  micDenied: 'Microphone access is needed to talk to Jarvis.',
  recordFailed: 'Recording failed. Please try once more.',
} as const;

const friendlyError = (error: unknown): string => {
  const name = (error as { name?: string })?.name ?? '';
  if (name === 'AbortError') return '';
  const raw = String((error as { message?: string })?.message ?? error ?? '').trim();
  if (!raw) return 'Something went wrong while composing a reply.';
  if (/cancelled/i.test(raw)) return '';
  if (!connectivity.isOnline()) return 'You appear to be offline, sir — I cannot reach the network.';
  return raw;
};

/**
 * Completion cue (GAP-C10): a light success haptic plus a screen-reader
 * announcement, so a reply that lands while the phone is in a pocket — or the
 * user is not looking at it — is still perceptible.
 */
const cueCompletion = (text: string): void => {
  if (!text.trim()) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  announceReply(text);
};

/**
 * History to send for `prompt`. The prompt itself has usually already been
 * written into the transcript (or is being retried), so drop a trailing copy
 * rather than sending the same user turn twice.
 */
const historyFor = (prompt: string): ChatMessage[] => {
  const all = selectActiveMessages(useChatStore.getState());
  const last = all[all.length - 1];
  return last && last.role === 'user' && last.content === prompt ? all.slice(0, -1) : all;
};

export function useJarvis(): UseJarvisResult {
  const messages = useChatStore(selectActiveMessages);
  const state = useChatStore((s) => s.state);
  const errorMessage = useChatStore((s) => s.errorMessage);

  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const speechRef = useRef<SpeechSession | null>(null);
  /** Clip kept on a transcription failure so RETRY can reuse it. */
  const retryClipRef = useRef<string | null>(null);
  /** Re-entrancy guards: VAD auto-stop and a user tap can race. */
  const finishingRef = useRef(false);
  const autoStopRef = useRef(false);
  /** Active browser recognition session (web build only) — see webSpeech.ts. */
  const webSessionRef = useRef<{ gen: number; session: WebSpeechSession } | null>(null);
  const webGenRef = useRef(0);

  const isStale = (runId: number): boolean => runIdRef.current !== runId;
  const bumpRun = (): number => ++runIdRef.current;

  /** Last-resort handler: anything that escapes a flow still lands in the UI. */
  const handleUnexpected = (error: unknown) => {
    console.warn('jarvis: unhandled flow error', error);
    const store = useChatStore.getState();
    store.setError(friendlyError(error) || HELP_TEXT.recordFailed);
    store.setAssistantState('idle');
  };

  // ── lifecycle ─────────────────────────────────────────────────────────────

  useEffect(() => {
    void hydrateChatStore();
    return () => {
      flushChatPersistence();
    };
  }, []);

  // Offline/online feeds the header banner; passive reports keep it cheap.
  useEffect(() => {
    useChatStore.getState().setOnline(connectivity.isOnline());
    return connectivity.subscribe((online) => useChatStore.getState().setOnline(online));
  }, []);

  // A firing timer announces itself over the normal speech path.
  useEffect(() => {
    timerService.setHandler((timer) => {
      const store = useChatStore.getState();
      if (!store.settings.voiceEnabled) return;
      store.setAssistantState('speaking');
      fishAudioService
        .speak(`Your ${timer.label} is up, sir.`, () => {
          if (useChatStore.getState().state === 'speaking') {
            useChatStore.getState().setAssistantState('idle');
          }
        }, store.settings.speech)
        .catch(() => {
          if (useChatStore.getState().state === 'speaking') {
            useChatStore.getState().setAssistantState('idle');
          }
        });
    });
    return () => timerService.setHandler(null);
  }, []);

  // Flush pending state when the app is backgrounded — the debounce window is
  // otherwise long enough to lose the last exchange if iOS kills the process.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') flushChatPersistence();
    });
    return () => sub.remove();
  }, []);

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Abort the network call, stop speech, drop the mic, and settle on idle. */
  async function cancelEverything(): Promise<void> {
    bumpRun();
    abortRef.current?.abort();
    abortRef.current = null;
    groqService.cancelAll();

    const session = speechRef.current;
    speechRef.current = null;
    session?.cancel();

    // Web build: abandon browser recognition (GAP-F1) alongside the PCM mic.
    const web = webSessionRef.current;
    webSessionRef.current = null;
    web?.session.cancel();

    await Promise.allSettled([fishAudioService.stopAll(), audioService.stopPlayback()]);
    if (audioService.isRecording()) {
      const uri = await audioService.stopRecording();
      if (uri) await audioService.deleteRecording(uri);
    }

    const store = useChatStore.getState();
    store.setAudioLevel(0);
    store.setAssistantState('idle');
    store.setRetryInfo(null);
  }

  /**
   * Run one assistant turn for an already-stored user prompt.
   * Streams tokens into the transcript and, when voice is on, into the
   * sentence-boundary TTS pipeline so speech starts before generation ends.
   */
  async function runReply(prompt: string, image?: PendingImage): Promise<void> {
    const store = useChatStore.getState();
    const settings = store.settings;
    const history = historyFor(prompt);

    const runId = bumpRun();
    const controller = new AbortController();
    abortRef.current = controller;
    let completedText = '';

    const assistantId = store.beginAssistantMessage();
    store.setRetryInfo(null);
    store.setAssistantState('thinking');

    const session: SpeechSession | null = settings.voiceEnabled
      ? fishAudioService.beginSession({ ...settings.speech })
      : null;
    speechRef.current = session;

    try {
      const result = await groqService.getChatCompletion({
        userPrompt: prompt,
        history,
        concise: settings.conciseResponses,
        model: settings.chatModel,
        persona: settings.persona,
        locale: settings.speech.locale,
        signal: controller.signal,
        ...(image ? { image: { dataUrl: image.dataUrl } } : {}),
        onEvent: (event) => {
          if (isStale(runId)) return;
          const current = useChatStore.getState();
          if (event.type === 'token' && event.text) {
            current.appendToken(assistantId, event.text);
            session?.push(event.text);
          } else if (event.type === 'tool_start') {
            // A tool round supersedes anything streamed so far — start clean.
            current.updateMessage(assistantId, { content: '' });
            current.setAssistantState(
              event.tool === 'web_search' ? 'searching' : 'thinking'
            );
          } else if (event.type === 'sources' && event.sources) {
            current.setSources(assistantId, event.sources);
          }
        },
      });

      if (isStale(runId)) return;

      // The loop may have streamed across a tool round — the authoritative
      // final text wins over the accumulated deltas.
      useChatStore.getState().updateMessage(assistantId, {
        content: result.text,
        streaming: false,
        ...(result.sources.length > 0 ? { sources: result.sources } : {}),
      });
      useChatStore.getState().setAssistantState(session ? 'speaking' : 'idle');

      if (session) {
        speechRef.current = session;
        await session.finish();
        if (isStale(runId)) return;
        speechRef.current = null;
      }

      completedText = result.text;
    } catch (error) {
      if (isStale(runId)) return;
      session?.cancel();
      const message = friendlyError(error);
      const cancelled = controller.signal.aborted || message === '';

      const current = useChatStore.getState();
      const partial = current.sessions
        .find((s) => s.id === current.activeSessionId)
        ?.messages.find((m) => m.id === assistantId);
      if (!partial?.content.trim()) current.removeMessage(assistantId);
      else current.finishMessage(assistantId);

      if (cancelled) {
        current.setAssistantState('idle');
        return;
      }

      current.setError(message);
      current.setRetryInfo({ type: 'chat', prompt } satisfies RetryAction);
      current.setAssistantState('error');
      announceError(message);
      setTimeout(() => {
        const latest = useChatStore.getState();
        if (latest.state === 'error') latest.setAssistantState('idle');
      }, 1600);
      return;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (speechRef.current === session) speechRef.current = null;
      if (!isStale(runId)) useChatStore.getState().setAudioLevel(0);
    }

    if (isStale(runId)) return;
    // Haptic + screen-reader cue that the reply has fully landed (GAP-C10/F2).
    cueCompletion(completedText);
    useChatStore.getState().setAssistantState('idle');

    // Continuous mode reopens the mic so a follow-up needs no extra tap.
    if (useChatStore.getState().settings.continuousMode) {
      await beginListening();
    }
  }

  // ── transcription ────────────────────────────────────────────────────────

  async function transcribeAndReply(audioUri: string): Promise<void> {
    const runId = bumpRun();
    const locale = useChatStore.getState().settings.speech.locale || 'en-GB';
    useChatStore.getState().setAssistantState('transcribing');
    useChatStore.getState().setRetryInfo(null);

    let text = '';
    try {
      text = (
        await groqService.transcribeAudio(audioUri, locale.slice(0, 2).toLowerCase())
      ).trim();
    } catch (error) {
      if (isStale(runId)) return;
      const message = friendlyError(error) || 'Transcription failed. Please try again.';
      // Keep the clip so RETRY can replay it without re-recording.
      retryClipRef.current = audioUri;
      const store = useChatStore.getState();
      store.setError(message);
      store.setRetryInfo({ type: 'transcribe', audioUri } satisfies RetryAction);
      store.setAssistantState('error');
      announceError(message);
      setTimeout(() => {
        const latest = useChatStore.getState();
        if (latest.state === 'error') latest.setAssistantState('idle');
      }, 1600);
      return;
    }

    if (isStale(runId)) return;

    await audioService.deleteRecording(audioUri);
    if (retryClipRef.current === audioUri) retryClipRef.current = null;

    if (!text) {
      const store = useChatStore.getState();
      store.setError(HELP_TEXT.noWords);
      store.setAssistantState('idle');
      return;
    }

    useChatStore.getState().addMessage({ role: 'user', content: text });
    await runReply(text);
  }

  // ── recording ────────────────────────────────────────────────────────────

  /**
   * Resolve the mic permission, explaining *why* before prompting. When the OS
   * has stopped showing the dialog (`canAskAgain === false`) the only fix is
   * the system Settings screen, so we deep-link there instead of looping.
   */
  async function ensureMicPermission(): Promise<boolean> {
    const permission = await audioService.getPermissionState();
    if (permission.status === 'granted') return true;

    if (permission.canAskAgain) {
      const granted = await audioService.requestPermission();
      if (granted) return true;
      // The prompt may have just been declined — re-read to see if we are now
      // permanently blocked, and route the user to Settings if so.
      const after = await audioService.getPermissionState();
      if (after.canAskAgain) {
        useChatStore.getState().setError(HELP_TEXT.micDenied);
        return false;
      }
    }

    useChatStore.getState().setError(HELP_TEXT.micBlocked);
    void Linking.openSettings().catch(() => {});
    return false;
  }

  async function beginListening(): Promise<void> {
    const store = useChatStore.getState();
    if (store.state === 'listening') return;
    store.setError(null);
    store.setRetryInfo(null);

    // A fresh recording supersedes any clip kept for retry — reclaim it.
    if (retryClipRef.current) {
      const stale = retryClipRef.current;
      retryClipRef.current = null;
      await audioService.deleteRecording(stale);
    }

    // On web the browser owns the mic prompt (GAP-F1) — expo-audio's permission
    // API has no web build, so the native check must be skipped there.
    const browserSpeech = isWebSpeechSupported();
    if (!browserSpeech && !(await ensureMicPermission())) {
      useChatStore.getState().setAssistantState('idle');
      return;
    }

    // Starting a recording is itself a barge-in: kill any live turn first.
    bumpRun();
    abortRef.current?.abort();
    abortRef.current = null;
    groqService.cancelAll();
    const session = speechRef.current;
    speechRef.current = null;
    session?.cancel();

    const previousWeb = webSessionRef.current;
    webSessionRef.current = null;
    previousWeb?.session.cancel();

    await Promise.allSettled([fishAudioService.stopAll(), audioService.stopPlayback()]);

    if (browserSpeech) {
      startBrowserListening();
      return;
    }

    try {
      const started = await audioService.startRecording(
        (level) => useChatStore.getState().setAudioLevel(level),
        // Voice-activity auto-stop (GAP-C4): close the clip once room tone has
        // persisted, so a forgotten mic does not record the rest of the day.
        () => {
          if (autoStopRef.current) return;
          if (useChatStore.getState().state !== 'listening') return;
          autoStopRef.current = true;
          finishListening()
            .catch(handleUnexpected)
            .finally(() => {
              autoStopRef.current = false;
            });
        }
      );
      if (!started) {
        useChatStore.getState().setAudioLevel(0);
        useChatStore.getState().setAssistantState('idle');
        return;
      }
      useChatStore.getState().setAssistantState('listening');
    } catch (error) {
      useChatStore.getState().setAudioLevel(0);
      useChatStore.getState().setError(friendlyError(error) || HELP_TEXT.recordFailed);
      useChatStore.getState().setAssistantState('idle');
    }
  }

  /**
   * Start browser speech recognition instead of the PCM stream (GAP-F1).
   *
   * The recogniser auto-ends after a sustained silence, which is the web
   * counterpart of the native VAD (GAP-C4) — `onEnd` therefore closes the turn
   * without a second tap.
   */
  function startBrowserListening(): void {
    const runId = runIdRef.current;
    const gen = ++webGenRef.current;
    const locale = useChatStore.getState().settings.speech.locale || 'en-GB';

    const session = listenWebSpeech({
      locale,
      onTranscript: (text) => {
        if (webGenRef.current !== gen || isStale(runId)) return;
        // Stand-in for the native mic RMS: growing text means audible input.
        useChatStore.getState().setAudioLevel(Math.min(1, 0.35 + text.length / 160));
      },
      onEnd: () => {
        if (webGenRef.current !== gen || isStale(runId)) return;
        // A null ref means we already consumed this session (tap or cancel).
        if (webSessionRef.current === null) return;
        if (finishingRef.current) return;
        if (useChatStore.getState().state !== 'listening') return;
        finishListening().catch(handleUnexpected);
      },
      onError: (message) => {
        if (webGenRef.current !== gen) return;
        webSessionRef.current = null;
        const store = useChatStore.getState();
        store.setAudioLevel(0);
        store.setError(message);
        store.setAssistantState('idle');
        announceError(message);
      },
    });

    if (!session) {
      useChatStore.getState().setAssistantState('idle');
      return;
    }

    webSessionRef.current = { gen, session };
    useChatStore.getState().setAssistantState('listening');
  }

  /**
   * Turn that already has its final text (browser ASR) into a user message and
   * a reply. Shared shape with `transcribeAndReply`, minus the Whisper round.
   */
  async function completeTextTurn(rawText: string, runId: number): Promise<void> {
    if (isStale(runId)) return;
    const text = rawText.replace(/\s+/g, ' ').trim();

    if (!text) {
      const store = useChatStore.getState();
      store.setError(HELP_TEXT.noWords);
      store.setAssistantState('idle');
      announceError(HELP_TEXT.noWords);
      return;
    }

    useChatStore.getState().addMessage({ role: 'user', content: text });
    await runReply(text);
  }

  async function finishListening(): Promise<void> {
    // The VAD may close the clip while the user is simultaneously tapping the
    // mic; only the first caller may consume the recording.
    if (finishingRef.current) return;
    finishingRef.current = true;
    try {
      await finishListeningInner();
    } finally {
      finishingRef.current = false;
    }
  }

  async function finishListeningInner(): Promise<void> {
    const runId = runIdRef.current;

    // Web build: there is no WAV — the browser already produced text.
    const web = webSessionRef.current;
    if (web) {
      // Clearing the ref invalidates any `onend` still queued behind us.
      webSessionRef.current = null;
      const text = web.session.transcript();
      web.session.stop();
      useChatStore.getState().setAudioLevel(0);
      if (isStale(runId)) return;
      await completeTextTurn(text, runId);
      return;
    }

    const audioUri = await audioService.stopRecording();
    useChatStore.getState().setAudioLevel(0);
    // A barge-in landed while the WAV was being encoded — discard quietly.
    if (isStale(runId)) {
      if (audioUri) await audioService.deleteRecording(audioUri);
      return;
    }
    if (!audioUri) {
      useChatStore.getState().setError(HELP_TEXT.recordFailed);
      useChatStore.getState().setAssistantState('idle');
      return;
    }
    if (audioService.isLastClipTooShort()) {
      await audioService.deleteRecording(audioUri);
      useChatStore.getState().setError(HELP_TEXT.tooBrief);
      useChatStore.getState().setAssistantState('idle');
      return;
    }
    await transcribeAndReply(audioUri);
  }

  // ── public API ───────────────────────────────────────────────────────────
  //
  // These are exposed as fire-and-forget callbacks, so each wraps its async
  // body: a rejection must surface as a banner, never as an unhandled promise.

  async function toggleRecordingImpl(): Promise<void> {
    const current = useChatStore.getState().state;
    if (current === 'listening') {
      await finishListening();
      return;
    }
    // The mic doubles as the STOP control while Jarvis is busy (barge-in).
    if (
      current === 'transcribing' ||
      current === 'thinking' ||
      current === 'searching' ||
      current === 'speaking'
    ) {
      await cancelEverything();
      return;
    }
    await beginListening();
  }

  async function sendTextMessageImpl(raw: string, image?: PendingImage): Promise<void> {
    const prompt = raw.trim() || (image ? 'Describe this image.' : '');
    if (!prompt) return;
    const store = useChatStore.getState();
    if (
      store.state === 'thinking' ||
      store.state === 'transcribing' ||
      store.state === 'searching'
    ) {
      return;
    }
    if (store.state === 'speaking') await cancelEverything();

    useChatStore.getState().addMessage({
      role: 'user',
      content: prompt,
      ...(image ? { imageUri: image.uri } : {}),
    });
    await runReply(prompt, image);
  }

  async function retryTranscriptionImpl(): Promise<void> {
    const info = useChatStore.getState().retryInfo;
    if (!info) return;
    useChatStore.getState().setRetryInfo(null);
    useChatStore.getState().setError(null);

    if (info.type === 'transcribe') {
      const audioUri = info.audioUri;
      if (!audioUri) return;
      useChatStore.getState().setAssistantState('transcribing');
      await transcribeAndReply(audioUri);
      return;
    }
    await runReply(info.prompt);
  }

  function clearMessages(): void {
    useChatStore.getState().clearMessages();
  }

  function toggleRecording(): void {
    toggleRecordingImpl().catch(handleUnexpected);
  }

  function sendTextMessage(text: string, image?: PendingImage): void {
    sendTextMessageImpl(text, image).catch(handleUnexpected);
  }

  function retryTranscription(): void {
    retryTranscriptionImpl().catch(handleUnexpected);
  }

  return {
    messages,
    state,
    errorMessage,
    toggleRecording,
    sendTextMessage,
    retryTranscription,
    clearMessages,
  };
}


