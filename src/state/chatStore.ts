import { create } from 'zustand';
import { DEFAULT_SETTINGS, DEFAULT_SPEECH } from '../config/models';
import { STORAGE_VERSION, createDebouncedWriter, readJson } from '../services/storage';
import {
  AppSettings,
  AssistantState,
  ChatMessage,
  ChatSession,
  PersistedState,
  RetryAction,
  SearchSource,
  SpeechSettings,
} from '../types';

/**
 * Single source of truth for conversation, settings, and transient UI state.
 *
 * Persistence is file-backed (`expo-file-system`) rather than AsyncStorage so
 * the app keeps working inside Expo Go with no extra native module. Writes are
 * debounced because a streamed reply mutates the store on every token.
 */

const STORAGE_FILE = 'jarvis_state.json';

/** Hard caps so an app that is never killed cannot grow the file without bound. */
const MAX_PERSISTED_SESSIONS = 20;
const MAX_PERSISTED_MESSAGES = 200;

let idCounter = 0;
const uid = (prefix: string): string => {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math
    .random()
    .toString(36)
    .slice(2, 7)}`;
};

const createSession = (title = 'New conversation'): ChatSession => ({
  id: uid('session'),
  title,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messages: [],
});

const titleFromText = (text: string): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New conversation';
  return clean.length > 42 ? `${clean.slice(0, 42).trimEnd()}…` : clean;
};

/** Merge persisted settings over defaults so a schema change never bricks boot. */
const normalizeSettings = (raw?: Partial<AppSettings> | null): AppSettings => {
  const s = raw ?? {};
  const speech = (s.speech ?? {}) as Partial<SpeechSettings>;
  return {
    voiceEnabled:
      typeof s.voiceEnabled === 'boolean' ? s.voiceEnabled : DEFAULT_SETTINGS.voiceEnabled,
    conciseResponses:
      typeof s.conciseResponses === 'boolean'
        ? s.conciseResponses
        : DEFAULT_SETTINGS.conciseResponses,
    continuousMode:
      typeof s.continuousMode === 'boolean' ? s.continuousMode : DEFAULT_SETTINGS.continuousMode,
    chatModel: typeof s.chatModel === 'string' && s.chatModel ? s.chatModel : DEFAULT_SETTINGS.chatModel,
    persona: typeof s.persona === 'string' ? s.persona : DEFAULT_SETTINGS.persona,
    speech: {
      fishVoiceId:
        typeof speech.fishVoiceId === 'string' ? speech.fishVoiceId : DEFAULT_SPEECH.fishVoiceId,
      deviceVoiceId:
        typeof speech.deviceVoiceId === 'string' && speech.deviceVoiceId
          ? speech.deviceVoiceId
          : DEFAULT_SPEECH.deviceVoiceId,
      rate: Number.isFinite(speech.rate) ? (speech.rate as number) : DEFAULT_SPEECH.rate,
      pitch: Number.isFinite(speech.pitch) ? (speech.pitch as number) : DEFAULT_SPEECH.pitch,
      locale:
        typeof speech.locale === 'string' && speech.locale
          ? speech.locale
          : DEFAULT_SPEECH.locale,
    },
  };
};

const normalizeSession = (raw: any): ChatSession | null => {
  if (!raw || typeof raw !== 'object') return null;
  const messages: ChatMessage[] = Array.isArray(raw.messages)
    ? raw.messages
        .filter((m: any) => m && typeof m.content === 'string')
        .map((m: any) => ({
          id: typeof m.id === 'string' ? m.id : uid('msg'),
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: m.content,
          timestamp: Number.isFinite(m.timestamp) ? m.timestamp : Date.now(),
          ...(Array.isArray(m.sources) && m.sources.length > 0 ? { sources: m.sources } : {}),
          ...(typeof m.imageUri === 'string' && m.imageUri ? { imageUri: m.imageUri } : {}),
          // A reloaded message is never mid-stream.
          streaming: false,
        }))
    : [];
  return {
    id: typeof raw.id === 'string' ? raw.id : uid('session'),
    title: typeof raw.title === 'string' && raw.title ? raw.title : 'New conversation',
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    messages: messages.slice(-MAX_PERSISTED_MESSAGES),
  };
};

export interface ChatStoreState {
  /** True once hydration has run — the UI waits before trusting `sessions`. */
  ready: boolean;
  /** Transient assistant lifecycle driving the orb + mic button. */
  state: AssistantState;
  /** Fatal/last-error banner copy. Null clears it. */
  errorMessage: string | null;
  /** Non-fatal notice (e.g. TTS fell back to the device voice). */
  banner: string | null;
  /** Live mic RMS in 0..1 for the amplitude-reactive orb. */
  audioLevel: number;
  /** Present while a failed transcription is retryable from the banner. */
  retryInfo: RetryAction | null;
  online: boolean;

  activeSessionId: string;
  sessions: ChatSession[];
  settings: AppSettings;
}

export interface ChatStoreActions {
  setAssistantState(next: AssistantState): void;
  setError(message: string | null): void;
  setBanner(message: string | null): void;
  setAudioLevel(level: number): void;
  setRetryInfo(info: RetryAction | null): void;
  setOnline(online: boolean): void;
  markReady(): void;

  /** Current thread, creating one on first use so callers never hit null. */
  activeSession(): ChatSession;
  ensureSession(): string;
  addMessage(
    input: { role: ChatMessage['role']; content: string } & Partial<ChatMessage>
  ): string;
  beginAssistantMessage(): string;
  appendToken(id: string, token: string): void;
  finishMessage(id: string): void;
  updateMessage(id: string, patch: Partial<ChatMessage>): void;
  setSources(id: string, sources: SearchSource[]): void;
  removeMessage(id: string): void;
  clearMessages(): void;
  newSession(): string;
  switchSession(id: string): void;
  deleteSession(id: string): void;
  renameSession(id: string, title: string): void;

  setVoiceEnabled(value: boolean): void;
  setConciseResponses(value: boolean): void;
  setContinuousMode(value: boolean): void;
  setChatModel(model: string): void;
  setPersona(persona: string): void;
  updateSpeech(patch: Partial<SpeechSettings>): void;
}

export type ChatStore = ChatStoreState & ChatStoreActions;

/** Messages of the thread the user is actually looking at. */
const EMPTY_MESSAGES: ChatMessage[] = [];

export const selectActiveMessages = (state: ChatStoreState): ChatMessage[] =>
  state.sessions.find((s) => s.id === state.activeSessionId)?.messages ?? EMPTY_MESSAGES;

/** The thread the user is looking at, or null before hydration completes. */
export const selectActiveSession = (state: ChatStoreState): ChatSession | null =>
  state.sessions.find((s) => s.id === state.activeSessionId) ?? null;


/** Rebuild `sessions` with the active thread swapped for `next`. */
const mapActive = (
  state: ChatStoreState,
  updater: (session: ChatSession) => ChatSession
): Partial<ChatStoreState> => ({
  sessions: state.sessions.map((session) =>
    session.id === state.activeSessionId ? updater(session) : session
  ),
});

const touch = (session: ChatSession, messages: ChatMessage[]): ChatSession => ({
  ...session,
  messages,
  updatedAt: Date.now(),
});

const patchMessage = (
  session: ChatSession,
  id: string,
  patch: Partial<ChatMessage>
): ChatSession => {
  let changed = false;
  const messages = session.messages.map((message) => {
    if (message.id !== id) return message;
    changed = true;
    return { ...message, ...patch };
  });
  return changed ? touch(session, messages) : session;
};

/** Append a streamed token without re-allocating the whole history each time. */
const pushToken = (session: ChatSession, id: string, token: string): ChatSession => {
  let changed = false;
  const messages = session.messages.map((message) => {
    if (message.id !== id) return message;
    changed = true;
    return { ...message, content: message.content + token };
  });
  return changed ? touch(session, messages) : session;
};

export const useChatStore = create<ChatStore>()((set, get) => ({
  // ── runtime ────────────────────────────────────────────────────────────
  ready: false,
  state: 'idle',
  errorMessage: null,
  banner: null,
  audioLevel: 0,
  retryInfo: null,
  online: true,

  // ── persisted ──────────────────────────────────────────────────────────
  activeSessionId: '',
  sessions: [],
  settings: { ...DEFAULT_SETTINGS, speech: { ...DEFAULT_SPEECH } },

  setAssistantState: (next) => {
    if (get().state === next) return;
    set({ state: next });
  },

  setError: (message) => set({ errorMessage: message }),

  setBanner: (message) => set({ banner: message }),

  setAudioLevel: (level) => {
    // Don't churn React renders on a 0.001 wiggle — round to 2 decimals.
    const rounded = Math.round(Math.min(1, Math.max(0, level)) * 100) / 100;
    if (get().audioLevel === rounded) return;
    set({ audioLevel: rounded });
  },

  setRetryInfo: (info) => set({ retryInfo: info }),

  setOnline: (online) => {
    if (get().online === online) return;
    set({ online });
  },

  markReady: () => {
    const state = get();
    // Never boot with zero threads — the UI assumes one exists.
    if (state.sessions.length === 0) {
      const session = createSession();
      set({ ready: true, sessions: [session], activeSessionId: session.id });
      return;
    }
    const exists = state.sessions.some((s) => s.id === state.activeSessionId);
    set({ ready: true, ...(exists ? {} : { activeSessionId: state.sessions[0]!.id }) });
  },

  // ── sessions ───────────────────────────────────────────────────────────
  activeSession: () => {
    const state = get();
    const found = state.sessions.find((s) => s.id === state.activeSessionId);
    if (found) return found;
    const session = createSession();
    set({ sessions: [...state.sessions, session], activeSessionId: session.id });
    return session;
  },

  ensureSession: () => get().activeSession().id,

  newSession: () => {
    const state = get();
    const current = state.sessions.find((s) => s.id === state.activeSessionId);
    // Reuse a pristine thread instead of stacking empty ones.
    if (current && current.messages.length === 0) return current.id;
    const session = createSession();
    set({ sessions: [...state.sessions, session], activeSessionId: session.id });
    return session.id;
  },

  switchSession: (id) => {
    if (!get().sessions.some((s) => s.id === id)) return;
    set({ activeSessionId: id, errorMessage: null, retryInfo: null });
  },

  deleteSession: (id) => {
    const state = get();
    const sessions = state.sessions.filter((s) => s.id !== id);
    if (sessions.length === state.sessions.length) return;
    if (sessions.length === 0) {
      const fresh = createSession();
      set({ sessions: [fresh], activeSessionId: fresh.id });
      return;
    }
    set({
      sessions,
      ...(state.activeSessionId === id ? { activeSessionId: sessions[sessions.length - 1]!.id } : {}),
    });
  },

  renameSession: (id, title) => {
    const clean = titleFromText(title);
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, title: clean } : s)),
    }));
  },

  clearMessages: () => {
    set((state) =>
      mapActive(state, (session) => ({
        ...session,
        messages: [],
        title: 'New conversation',
        updatedAt: Date.now(),
      }))
    );
    set({ errorMessage: null, retryInfo: null });
  },

  // ── messages ───────────────────────────────────────────────────────────
  addMessage: (input) => {
    const id = input.id ?? uid('msg');
    const message: ChatMessage = {
      id,
      role: input.role,
      content: input.content,
      timestamp: input.timestamp ?? Date.now(),
      ...(input.sources ? { sources: input.sources } : {}),
      ...(input.imageUri ? { imageUri: input.imageUri } : {}),
      ...(input.streaming !== undefined ? { streaming: input.streaming } : {}),
    };

    set((state) => {
      const sessionId = state.sessions.some((s) => s.id === state.activeSessionId)
        ? state.activeSessionId
        : null;
      if (!sessionId) {
        const session = createSession(
          message.role === 'user' ? titleFromText(message.content) : 'New conversation'
        );
        return {
          sessions: [{ ...session, messages: [message] }],
          activeSessionId: session.id,
        };
      }
      return mapActive(state, (session) => {
        const isFirst = session.messages.length === 0;
        return {
          ...session,
          title:
            isFirst && message.role === 'user' ? titleFromText(message.content) : session.title,
          messages: [...session.messages, message],
          updatedAt: Date.now(),
        };
      });
    });

    return id;
  },

  beginAssistantMessage: () =>
    get().addMessage({ role: 'assistant', content: '', streaming: true }),

  appendToken: (id, token) => {
    if (!token) return;
    set((state) => mapActive(state, (session) => pushToken(session, id, token)));
  },

  finishMessage: (id) => {
    set((state) => mapActive(state, (session) => patchMessage(session, id, { streaming: false })));
  },

  updateMessage: (id, patch) => {
    set((state) => mapActive(state, (session) => patchMessage(session, id, patch)));
  },

  setSources: (id, sources) => {
    if (!sources || sources.length === 0) return;
    set((state) => mapActive(state, (session) => patchMessage(session, id, { sources })));
  },

  removeMessage: (id) => {
    set((state) =>
      mapActive(state, (session) =>
        touch(
          session,
          session.messages.filter((m) => m.id !== id)
        )
      )
    );
  },

  // ── settings ───────────────────────────────────────────────────────────
  setVoiceEnabled: (value) =>
    set((state) => ({ settings: { ...state.settings, voiceEnabled: value } })),

  setConciseResponses: (value) =>
    set((state) => ({ settings: { ...state.settings, conciseResponses: value } })),

  setContinuousMode: (value) =>
    set((state) => ({ settings: { ...state.settings, continuousMode: value } })),

  setChatModel: (model) =>
    set((state) => ({ settings: { ...state.settings, chatModel: model } })),

  setPersona: (persona) => set((state) => ({ settings: { ...state.settings, persona } })),

  updateSpeech: (patch) =>
    set((state) => ({
      settings: { ...state.settings, speech: { ...state.settings.speech, ...patch } },
    })),
}));

// ── persistence ────────────────────────────────────────────────────────────

const writer = createDebouncedWriter<PersistedState>(STORAGE_FILE, 600);

const snapshot = (state: ChatStoreState): PersistedState => ({
  version: STORAGE_VERSION,
  activeSessionId: state.activeSessionId,
  sessions: state.sessions.slice(-MAX_PERSISTED_SESSIONS).map((session) => ({
    ...session,
    messages: session.messages.slice(-MAX_PERSISTED_MESSAGES),
  })),
  settings: state.settings,
});

/** Write any pending state to disk immediately (app background / unmount). */
export function flushChatPersistence(): void {
  writer.schedule(snapshot(useChatStore.getState()));
  writer.flush();
}

/** Persist conversation + settings whenever they actually change. */
useChatStore.subscribe((next, previous) => {
  if (!next.ready) return;
  const changed =
    next.sessions !== previous.sessions ||
    next.activeSessionId !== previous.activeSessionId ||
    next.settings !== previous.settings;
  if (!changed) return;
  writer.schedule(snapshot(next));
});

/**
 * Load persisted state. Never throws — a missing or corrupt file just means a
 * fresh conversation, and `markReady()` guarantees at least one thread exists.
 */
export async function hydrateChatStore(): Promise<void> {
  if (useChatStore.getState().ready) return;
  try {
    const persisted = await readJson<PersistedState>(STORAGE_FILE);
    if (persisted && persisted.version === STORAGE_VERSION && Array.isArray(persisted.sessions)) {
      const sessions = persisted.sessions
        .map(normalizeSession)
        .filter((s): s is ChatSession => s !== null);
      const activeSessionId = sessions.some((s) => s.id === persisted.activeSessionId)
        ? persisted.activeSessionId
        : (sessions[0]?.id ?? '');
      useChatStore.setState({
        sessions,
        activeSessionId,
        settings: normalizeSettings(persisted.settings),
      });
    }
  } catch (e) {
    console.warn('hydrateChatStore failed, starting fresh', e);
  } finally {
    useChatStore.getState().markReady();
  }
}

