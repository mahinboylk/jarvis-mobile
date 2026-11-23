/**
 * Groq model configuration, Jarvis persona, and app-wide defaults.
 * Model IDs verified against console.groq.com/docs/models.
 */

export const JARVIS_SYSTEM_PROMPT = `You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), Tony Stark's personal cybernetic artificial intelligence.
Tone and persona guidelines:
- Witty, articulate, calm, loyal, and slightly formal British-butler disposition.
- Address the user respectfully (e.g. "sir", or naturally).
- Keep spoken responses short (2 to 4 sentences maximum) because your words are synthesized aloud via Text-To-Speech.
- Maintain high scientific intelligence, tactical clarity, and subtle dry humor when appropriate.
- Never use markdown asterisks (*whispers* or *smiles*), bullet lists, headings, or code fences — they sound unnatural when read aloud by the speech synthesizer. Write plain spoken prose.
Real-time rules:
- Use the live clock in the system context for any question about today's date, time, day, or timezone — never guess from training data.
- Call get_current_time for clock questions, get_weather for weather, calculate for arithmetic, set_timer for countdowns, and web_search for news, scores, prices, or current events.
- Call at most one tool per reply. Do not chain tools.
- Do not announce that you are searching or calculating; only speak the final answer.`;

export const GROQ_API_BASE = 'https://api.groq.com/openai/v1';

/** Free-plan default chat model. */
export const GROQ_CHAT_MODEL = 'qwen/qwen3.8-27b';

/** Selectable chat models for the in-app picker (first entry is the default). */
export const CHAT_MODEL_OPTIONS: { id: string; label: string; note: string }[] = [
  { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', note: 'Balanced. Default.' },
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', note: 'Most articulate.' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B', note: 'Fastest replies.' },
];

/** Badge/settings display model. */
export const CHAT_MODEL_BADGE = GROQ_CHAT_MODEL;

/** Free-plan ASR — whisper-large-v3. */
export const GROQ_ASR_MODEL = 'whisper-large-v3';

export const FISH_AUDIO_API_BASE = 'https://api.fish.audio/v1';

/**
 * Fish Audio credit balance (GAP-D4).
 * Note: deliberately *not* under `/v1` — the documented path is
 * `GET https://api.fish.audio/wallet/{user_id}/api-credit`, so the base here is
 * the bare host and the path is supplied at the call site.
 */
export const FISH_AUDIO_WALLET_BASE = 'https://api.fish.audio';

/**
 * Fish Audio TTS voice selection.
 *
 * Public library voices work with any API key via `reference_id` — no private
 * cloning required. `s2.1-pro-free` is the free developer tier; omitting the
 * `model` header falls back to paid `s2.1-pro`, which returns 402 when credit
 * is empty.
 */
export const FISH_AUDIO = {
  JARVIS_VOICE_ID: '612b878b113047d9a770c069c8b4fdfe',
  TTS_MODEL: 's2.1-pro-free',
} as const;

/** Voices offered in Settings. Users may also paste any Fish Audio model id. */
export const FISH_AUDIO_VOICE_OPTIONS: { id: string; label: string }[] = [
  { id: '612b878b113047d9a770c069c8b4fdfe', label: 'Jarvis (MCU)' },
];

/** Keyless weather + geocoding (Open-Meteo). */
export const OPEN_METEO = {
  GEOCODE: 'https://geocoding-api.open-meteo.com/v1/search',
  FORECAST: 'https://api.open-meteo.com/v1/forecast',
} as const;

/** Latency budgets. A user-visible reply must land inside ~10s. */
export const TIMEOUTS = {
  CHAT_DEADLINE_MS: 12_000,
  STREAM_IDLE_MS: 6_000,
  ASR_TIMEOUT_MS: 10_000,
  SEARCH_TIMEOUT_MS: 2_500,
  WEATHER_TIMEOUT_MS: 3_000,
  TTS_TIMEOUT_MS: 4_000,
  MAX_TOOL_ROUNDS: 1,
  /** Max retries on 429/5xx before surfacing the failure. */
  MAX_RETRIES: 3,
} as const;

/** Shortest clip worth sending to Whisper (guards against stray double-taps). */
export const MIN_RECORDING_MS = 400;

/** Resolve the device locale, falling back to British English. */
export const resolveDeviceLocale = (): string => {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return typeof locale === 'string' && locale.length > 0 ? locale : 'en-GB';
  } catch {
    return 'en-GB';
  }
};

export const DEFAULT_SPEECH = {
  fishVoiceId: '',
  deviceVoiceId: null as string | null,
  rate: 1.05,
  pitch: 0.95,
  locale: 'en-GB',
} as const;

export const DEFAULT_SETTINGS = {
  voiceEnabled: true,
  conciseResponses: false,
  continuousMode: false,
  chatModel: GROQ_CHAT_MODEL,
  persona: '',
  speech: { ...DEFAULT_SPEECH, locale: resolveDeviceLocale() },
} as const;
