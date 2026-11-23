import {
  AudioModule,
  createAudioPlayer,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStream,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { MIN_RECORDING_MS } from '../config/models';
import { MicPermissionState } from '../types';

const isRuntimeNotReady = (e: unknown): boolean => {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('runtime not ready') || msg.includes('Cannot find native module');
};

// Riva/Parakeet wants 16-bit mono audio; resample anything else to 16 kHz.
const ASR_SAMPLE_RATE = 16000;

// Status updates drive didJustFinish detection; the 500 ms default adds up to
// half a second of silence between pipelined TTS sentences.
const PLAYBACK_UPDATE_INTERVAL_MS = 250;

/** Throttle for amplitude callbacks — 20 Hz is plenty for a glow. */
const LEVEL_EMIT_INTERVAL_MS = 50;

/**
 * Voice-activity detection used for auto-stop (GAP-C4).
 *
 * `computeLevel()` already subtracts a noise floor, so anything under
 * `SILENCE_LEVEL` is room tone rather than speech. After `SILENCE_MS` of
 * continuous room tone the recording closes itself — no second tap needed —
 * but never before `MIN_RECORDING_MS` so a slow start cannot cut the user off
 * mid-word.
 */
const SILENCE_LEVEL = 0.02;
const SILENCE_MS = 3500;


/** Convert an int16 LE interleaved PCM buffer to mono float32 at 16 kHz. */
export function bufferToMono16k(data: ArrayBuffer, inRate: number, inChannels: number): Float32Array {
  const src = new Int16Array(data);
  const channels = Math.max(1, inChannels || 1);
  const frames = Math.floor(src.length / channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += src[i * channels + c] / 32768;
    mono[i] = sum / channels;
  }
  if (!inRate || inRate === ASR_SAMPLE_RATE) return mono;
  const outLen = Math.max(1, Math.floor((frames * ASR_SAMPLE_RATE) / inRate));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = (i * (frames - 1)) / Math.max(1, outLen - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, frames - 1);
    const frac = pos - i0;
    out[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
  }
  return out;
}

/** Root-mean-square loudness mapped to a usable 0..1 glow intensity. */
export function computeLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  // Speech typically sits around 0.05–0.2 RMS; scale and clamp for the orb.
  return Math.max(0, Math.min(1, (rms - 0.005) * 6));
}

/** Encode mono float32 samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, ASR_SAMPLE_RATE, true);
  view.setUint32(28, ASR_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

class AudioService {
  private stream: AudioStream | null = null;
  private streamSub: { remove: () => void } | null = null;
  private pcmChunks: Float32Array[] = [];
  private streamActive = false;
  private player: AudioPlayer | null = null;
  private playerStatusSub: { remove: () => void } | null = null;
  /** Resolves the in-flight playAudio() promise when playback is stopped from outside. */
  private pendingPlaybackSettle: (() => void) | null = null;
  private isAudioModeConfigured = false;
  private lastLevelEmit = 0;
  private onLevel: ((level: number) => void) | null = null;
  private lastClipMs = 0;
  // ── VAD (auto-stop on silence) ───────────────────────────────────────────
  private onAutoStop: (() => void) | null = null;
  private recordStartedAt = 0;
  private silenceSince = 0;


  /**
   * Configure the audio session for simultaneous recording and loud speaker
   * playback. Safe to call early: swallows "[runtime not ready]" so startup
   * never redboxes. (SDK 57: expo-av was removed — this now uses
   * expo-audio's setAudioModeAsync.)
   *
   * `duckOthers` keeps music playing while Jarvis talks but lowers it, which is
   * the expected assistant behaviour (leaving `interruptionMode` unset lets
   * other apps stay at full volume underneath the reply).
   */
  async configureAudioMode(): Promise<void> {
    if (this.isAudioModeConfigured) return;
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'duckOthers',
        shouldPlayInBackground: true,
      });
      this.isAudioModeConfigured = true;
    } catch (e) {
      if (isRuntimeNotReady(e)) {
        // Native runtime isn't up yet (Fast Refresh / cold start).
        // Leave flag false so the next user interaction retries.
        return;
      }
      // Some platforms reject individual keys; retry with the minimal set so a
      // partial failure never leaves the session unconfigured.
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        this.isAudioModeConfigured = true;
      } catch (inner) {
        console.warn('Failed to configure Audio mode:', e, inner);
      }
    }
  }

  /** Read the current microphone permission without prompting. */
  async getPermissionState(): Promise<MicPermissionState> {
    try {
      const response = await getRecordingPermissionsAsync();
      const status: MicPermissionState['status'] = response.granted
        ? 'granted'
        : response.status === 'undetermined'
          ? 'undetermined'
          : 'denied';
      return { status, canAskAgain: response.canAskAgain !== false };
    } catch (e) {
      if (isRuntimeNotReady(e)) return { status: 'undetermined', canAskAgain: true };
      return { status: 'denied', canAskAgain: false };
    }
  }

  /** Request microphone permission; a false return may also mean "cannot ask again". */
  async requestPermission(): Promise<boolean> {
    try {
      const response = await requestRecordingPermissionsAsync();
      return response.status === 'granted' || response.granted === true;
    } catch (e) {
      if (isRuntimeNotReady(e)) return false;
      console.error('Permission request failed:', e);
      return false;
    }
  }

  /**
   * Start microphone capture as raw PCM and accumulate it for a WAV file.
   * Riva/Parakeet only accepts WAV, OPUS, or FLAC — the HIGH_QUALITY preset
   * records .m4a/AAC, which the ASR endpoint rejects.
   *
   * `onLevel` receives a 0..1 loudness estimate so the HUD orb can react to the
   * user's actual voice instead of a fixed-timing pulse.
   *
   * `onAutoStop` (GAP-C4) fires when voice activity has been absent long enough
   * that continuing to record would only capture room tone.
   */
  async startRecording(
    onLevel?: (level: number) => void,
    onAutoStop?: () => void
  ): Promise<boolean> {
    // expo-audio ships no AudioStream in its web build — fail with a message
    // the user can act on instead of a "not a constructor" TypeError.
    if (Platform.OS === 'web') {
      throw new Error('Voice input is not supported on web — use the text bar below.');
    }

    this.onLevel = onLevel ?? null;
    this.lastLevelEmit = 0;
    this.onAutoStop = onAutoStop ?? null;
    this.silenceSince = 0;
    this.recordStartedAt = Date.now();
    let stream: AudioStream | null = null;

    try {
      await this.stopPlayback();
      await this.configureAudioMode();

      const hasPermission = await this.requestPermission();
      if (!hasPermission) {
        const state = await this.getPermissionState();
        if (!state.canAskAgain) {
          throw new Error(
            'Microphone access is blocked for Jarvis. Enable it in Settings → Apps → Jarvis → Permissions.'
          );
        }
        throw new Error('Microphone permission is required to speak with Jarvis.');
      }

      this.teardownStream();
      // `AudioModule.AudioStream` is a runtime-only member: expo-audio ships the
      // class on the native module object while its `.d.ts` files export the
      // *type* only, so the static resolver cannot see it.
      // eslint-disable-next-line import/namespace
      stream = new AudioModule.AudioStream({
        sampleRate: ASR_SAMPLE_RATE,
        channels: 1,
        encoding: 'int16',
      });
      this.pcmChunks = [];

      // Register the stream *before* start() resolves: a stop arriving while
      // the native stream is still spinning up must be able to reach it,
      // otherwise the microphone would stay hot with no owner to stop it.
      this.stream = stream;
      this.streamActive = true;
      this.streamSub = stream.addListener('audioStreamBuffer', (buffer) => {
        if (!this.streamActive || this.stream !== stream) return;
        try {
          const mono = bufferToMono16k(buffer.data, buffer.sampleRate, buffer.channels);
          this.pcmChunks.push(mono);
          this.emitLevel(mono);
        } catch (_) {}
      });

      await stream.start();

      // Stopped while starting — release this stream only; another one may
      // already have replaced it.
      if (this.stream !== stream) {
        this.stopStream(stream);
        return false;
      }
      return true;
    } catch (e) {
      console.error('startRecording error:', e);
      this.onLevel = null;
      this.onAutoStop = null;
      if (stream && this.stream !== stream) {
        // A stop raced the startup — that is a clean cancel, not a failure.
        this.stopStream(stream);
        return false;
      }
      if (stream) this.teardownStream();
      throw e;
    }
  }

  private emitLevel(mono: Float32Array): void {
    // Compute on every buffer (not on the emit cadence) so the VAD below sees
    // the full envelope; only the *callback* to the UI is throttled.
    const level = computeLevel(mono);
    this.trackSilence(level);

    const callback = this.onLevel;
    if (!callback) return;
    const now = Date.now();
    if (now - this.lastLevelEmit < LEVEL_EMIT_INTERVAL_MS) return;
    this.lastLevelEmit = now;
    try {
      callback(level);
    } catch (_) {}
  }

  /**
   * Close the recording after a sustained run of room tone (GAP-C4).
   * Fires at most once per recording — the handler is cleared on first use and
   * on `stopRecording()`.
   */
  private trackSilence(level: number): void {
    const handler = this.onAutoStop;
    if (!handler) return;
    const now = Date.now();

    if (level >= SILENCE_LEVEL) {
      this.silenceSince = 0;
      return;
    }
    if (this.silenceSince === 0) {
      this.silenceSince = now;
      return;
    }

    // Never auto-stop before the ASR minimum — that would only ever produce a
    // clip we already know is untranscribable.
    const capturedMs = now - this.recordStartedAt;
    if (capturedMs < MIN_RECORDING_MS) return;
    if (now - this.silenceSince < SILENCE_MS) return;

    this.onAutoStop = null;
    this.silenceSince = 0;
    try {
      handler();
    } catch (error) {
      console.warn('VAD auto-stop handler failed:', error);
    }
  }

  /** Duration in ms of the clip produced by the most recent stopRecording(). */
  getLastClipDurationMs(): number {
    return this.lastClipMs;
  }

  /** True when the last clip was shorter than the ASR minimum. */
  isLastClipTooShort(): boolean {
    return this.lastClipMs > 0 && this.lastClipMs < MIN_RECORDING_MS;
  }

  /**
   * Stop capture, encode the accumulated PCM as WAV, and return its URI.
   * Returns null when there is nothing usable to transcribe.
   */
  async stopRecording(): Promise<string | null> {
    this.onLevel = null;
    // Stop the VAD too — a late buffer must not re-fire auto-stop after the
    // user has already ended the clip by hand.
    this.onAutoStop = null;
    this.silenceSince = 0;
    const stream = this.stream;
    if (!stream) {
      this.lastClipMs = 0;
      return null;
    }

    this.streamActive = false;
    if (this.streamSub) {
      try {
        this.streamSub.remove();
      } catch (_) {}
      this.streamSub = null;
    }
    this.stream = null;

    try {
      stream.stop();
    } catch (_) {}

    const chunks = this.pcmChunks;
    this.pcmChunks = [];

    const total = chunks.reduce((n, c) => n + c.length, 0);
    this.lastClipMs = Math.round((total / ASR_SAMPLE_RATE) * 1000);
    if (total === 0) return null;

    const samples = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }

    const file = new File(Paths.cache, `jarvis_input_${Date.now()}.wav`);
    file.create({ overwrite: true });
    file.write(encodeWav(samples));
    return file.uri;
  }

  /**
   * Play a local audio file and resolve when it finishes.
   *
   * The promise also resolves when playback is stopped from outside (barge-in),
   * otherwise the caller's speech pipeline would await a player that no longer
   * exists.
   */
  async playAudio(uri: string, onPlaybackFinish?: () => void): Promise<void> {
    await this.stopPlayback();
    await this.configureAudioMode();

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const settle = (err?: unknown) => {
        if (settled) return;
        settled = true;
        if (this.pendingPlaybackSettle === cancel) this.pendingPlaybackSettle = null;
        this.stopPlayback()
          .catch(() => {})
          .finally(() => {
            if (onPlaybackFinish) onPlaybackFinish();
            if (err) reject(err);
            else resolve();
          });
      };

      // An external stopPlayback() must settle this promise too.
      const cancel = () => settle();
      this.pendingPlaybackSettle = cancel;

      try {
        const player = createAudioPlayer(uri, { updateInterval: PLAYBACK_UPDATE_INTERVAL_MS });
        this.player = player;
        this.playerStatusSub = player.addListener('playbackStatusUpdate', (status) => {
          if (status.didJustFinish && !status.playing) {
            settle();
          } else if (status.error) {
            console.error('playAudio playback error:', status.error);
            settle();
          }
        });
        player.play();
      } catch (e) {
        console.error('playAudio error:', e);
        settle(e);
      }
    });
  }

  /** Halt playback and settle any awaiting playAudio() promise. */
  async stopPlayback(): Promise<void> {
    this.pendingPlaybackSettle = null;

    if (this.playerStatusSub) {
      try {
        this.playerStatusSub.remove();
      } catch (_) {}
      this.playerStatusSub = null;
    }

    if (this.player) {
      const player = this.player;
      this.player = null;
      try {
        player.pause();
      } catch (_) {}
      try {
        player.remove();
      } catch (_) {}
    }
  }

  isRecording(): boolean {
    return this.streamActive;
  }

  isPlaying(): boolean {
    return this.player !== null;
  }

  /** Best-effort delete of a cached recording; ignores missing/invalid uris. */
  async deleteRecording(uri: string | null | undefined): Promise<void> {
    if (!uri) return;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch (_) {}
  }

  private stopStream(stream: AudioStream): void {
    try {
      stream.stop();
    } catch (_) {}
  }

  private teardownStream(): void {
    this.streamActive = false;
    if (this.streamSub) {
      try {
        this.streamSub.remove();
      } catch (_) {}
      this.streamSub = null;
    }
    if (this.stream) {
      const active = this.stream;
      this.stream = null;
      this.stopStream(active);
    }
    this.pcmChunks = [];
  }
}

export const audioService = new AudioService();

