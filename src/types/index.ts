export type AssistantState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'searching'
  | 'speaking'
  | 'error';

export type MessageRole = 'user' | 'assistant' | 'system';

/** A citable source attached to an assistant reply that used live search. */
export interface SearchSource {
  title: string;
  url: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  /** Present when the reply drew on live web results (attribution). */
  sources?: SearchSource[];
  /** True while tokens are still arriving for a streamed reply. */
  streaming?: boolean;
  /** Local URI of an attached image (GAP-A6), rendered as a thumbnail. */
  imageUri?: string;
}

export interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: {
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }[];
  tool_call_id?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  query: string;
  results: SearchResult[];
  /** Flat text lines fed to the LLM. */
  snippets: string[];
  source: 'duckduckgo' | 'wikipedia' | 'none';
}

/** One conversation thread. Replaces the old single unbounded message list. */
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface SpeechSettings {
  /** Fish Audio `reference_id`. Empty falls back to the built-in Jarvis voice. */
  fishVoiceId: string;
  /** `expo-speech` voice identifier, or null for the platform default. */
  deviceVoiceId: string | null;
  rate: number;
  pitch: number;
  /** BCP-47 tag (e.g. `en-GB`). Drives both ASR and on-device TTS. */
  locale: string;
}

export interface AppSettings {
  voiceEnabled: boolean;
  conciseResponses: boolean;
  /** Re-open the mic automatically after a reply finishes. */
  continuousMode: boolean;
  chatModel: string;
  /** Extra persona instructions appended to the base system prompt. */
  persona: string;
  speech: SpeechSettings;
}

export interface PersistedState {
  version: number;
  activeSessionId: string;
  sessions: ChatSession[];
  settings: AppSettings;
}

export type RetryAction =
  | { type: 'transcribe'; audioUri: string }
  | { type: 'chat'; prompt: string };

/** Simplified microphone permission state for actionable UI copy. */
export interface MicPermissionState {
  status: 'granted' | 'denied' | 'undetermined';
  /** False once the OS stops showing the prompt — only Settings can fix it. */
  canAskAgain: boolean;
}

export interface VoiceOption {
  id: string;
  name: string;
  language: string;
}

/** Emitted by the Groq stream so the UI can show live progress. */
export interface StreamEvent {
  type: 'token' | 'tool_start' | 'sources' | 'done';
  text?: string;
  tool?: string;
  sources?: SearchSource[];
}
