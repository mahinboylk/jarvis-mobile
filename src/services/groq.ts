import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { authHeaders, hasGroqCredentials, resolveEndpoint } from '../config/env';
import {
  CHAT_MODEL_OPTIONS,
  GROQ_API_BASE,
  GROQ_ASR_MODEL,
  GROQ_CHAT_MODEL,
  JARVIS_SYSTEM_PROMPT,
  TIMEOUTS,
} from '../config/models';
import { ChatMessage, LLMChatMessage, SearchSource, StreamEvent } from '../types';
import { backoffDelayMs, parseRetryAfter, sleep, withTimeout } from '../utils/async';
import { planContext, planToMessages } from '../utils/context';
import {
  asrRequestQueue,
  awaitRateLimitGate,
  chatRequestQueue,
  rateLimitRemainingMs,
  reportRateLimit,
} from '../utils/queue';
import { evaluateExpression, formatNumber } from './calculator';
import { connectivity, isNetworkError } from './connectivity';
import { markThrottled, readGroqQuota, setQuota } from './quota';
import { parseDuration, timerService } from './timers';
import { getWeather } from './weather';
import { webSearch } from './webSearch';

const GROQ_AUTH_HELP =
  'Groq rejected the API key (401/403). Create a new free key at ' +
  'console.groq.com → API Keys, then update EXPO_PUBLIC_GROQ_API_KEY.';

/** Every tool the model may call. At most one runs per reply. */
export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the live web for current events, news, scores, prices, or facts after the model knowledge cutoff. Returns titled snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Short search query, e.g. "temperature in Paris"' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description:
        "Return the device's current local date, time, weekday and timezone. Use for any clock question.",
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Optional IANA timezone to convert into, e.g. "America/New_York".',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Evaluate a mathematical expression exactly. Use instead of mental arithmetic.',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'e.g. "12 * (7 + 3) / 4", "sqrt(2)", "15% of" is not supported — use 0.15*15',
          },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Current weather conditions for a city. Omit location to use the device region.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name, e.g. "London" or "San Francisco".' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_timer',
      description:
        'Start a countdown timer that announces itself when it fires. Timer runs while the app is open.',
      parameters: {
        type: 'object',
        properties: {
          duration: { type: 'string', description: 'e.g. "5 minutes", "90 seconds", "1 hour 30 minutes"' },
          label: { type: 'string', description: 'Optional short label, e.g. "tea".' },
        },
        required: ['duration'],
      },
    },
  },
] as const;

export interface ChatRequest {
  userPrompt: string;
  history?: ChatMessage[];
  concise?: boolean;
  model?: string;
  persona?: string;
  /** BCP-47 tag used for the system context. */
  locale?: string;
  /** Caller-owned abort signal, so the UI can cancel a slow reply. */
  signal?: AbortSignal;
  /** Live progress: tokens, tool start, sources. */
  onEvent?: (event: StreamEvent) => void;
  /** Attached image (GAP-A6) — a data URL sent as a multimodal part. */
  image?: { dataUrl: string };
}

export interface ChatResult {
  text: string;
  sources: SearchSource[];
}

/** Live clock + locale injected every request so date/time answers stay accurate. */
export function buildSystemPrompt(opts: {
  concise: boolean;
  persona: string;
  locale: string;
}): string {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const parts = [JARVIS_SYSTEM_PROMPT];
  if (opts.persona.trim()) parts.push(`Additional user preferences:\n${opts.persona.trim()}`);
  if (opts.concise) parts.push('Keep replies to one or two short sentences.');
  parts.push(
    'LIVE CONTEXT (authoritative):\n' +
      `- Local time now: ${now.toString()}\n` +
      `- Timezone: ${tz}\n` +
      `- Locale: ${opts.locale}\n` +
      `- ISO: ${now.toISOString()}`
  );
  return parts.join('\n\n');
}

/** Fall back to the default when a persisted model id is no longer offered. */
export function resolveChatModel(requested?: string): string {
  const id = (requested || '').trim();
  if (!id) return GROQ_CHAT_MODEL;
  return CHAT_MODEL_OPTIONS.some((m) => m.id === id) ? id : GROQ_CHAT_MODEL;
}

interface ToolContext {
  signal?: AbortSignal;
  onSources?: (sources: SearchSource[]) => void;
}

/**
 * Run one tool call and return the text handed back to the model.
 * Never throws for expected failures — the model receives a description of the
 * problem and answers from general knowledge instead.
 */
export async function executeTool(
  name: string | undefined,
  rawArgs: unknown,
  context: ToolContext = {}
): Promise<string> {
  const args =
    rawArgs && typeof rawArgs === 'object' ? (rawArgs as Record<string, unknown>) : {};

  switch (name) {
    case 'web_search': {
      const query = String(args.query ?? '').trim();
      if (!query) return 'No search query was provided.';
      try {
        const search = await withTimeout(
          webSearch(query, context.signal),
          TIMEOUTS.SEARCH_TIMEOUT_MS,
          'web_search'
        );
        if (search.results.length > 0 && context.onSources) {
          context.onSources(
            search.results
              .filter((r) => !!r.url)
              .slice(0, 3)
              .map((r) => ({ title: r.title, url: r.url }))
          );
        }
        if (search.snippets.length === 0) {
          return 'No live results found. Answer from general knowledge and say the info may be current-as-of-training.';
        }
        return search.snippets.join('\n');
      } catch (error) {
        if (isNetworkError(error)) connectivity.reportFailure(error);
        return 'Live search is unavailable right now. Answer from general knowledge and say the information may be out of date.';
      }
    }

    case 'get_current_time': {
      const requested = String(args.timezone ?? '').trim();
      const now = new Date();
      try {
        const formatter = new Intl.DateTimeFormat('en-GB', {
          dateStyle: 'full',
          timeStyle: 'short',
          ...(requested ? { timeZone: requested } : {}),
        });
        const zone = requested || Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
        return `Current time is ${formatter.format(now)} (${zone}). ISO: ${now.toISOString()}.`;
      } catch {
        return `Current local time is ${now.toString()}. ISO: ${now.toISOString()}.`;
      }
    }

    case 'calculate': {
      const expression = String(args.expression ?? '').trim();
      if (!expression) return 'No expression was provided.';
      try {
        const value = evaluateExpression(expression);
        return `${expression} = ${formatNumber(value)}`;
      } catch (error) {
        return `Could not evaluate "${expression}": ${(error as Error)?.message ?? 'invalid expression'}.`;
      }
    }

    case 'get_weather': {
      const location = String(args.location ?? '').trim();
      try {
        const weather = await getWeather(location);
        return weather.summary;
      } catch (error) {
        return `Weather lookup failed: ${(error as Error)?.message ?? 'unknown error'}.`;
      }
    }

    case 'set_timer': {
      const durationText = String(args.duration ?? '').trim();
      const label = String(args.label ?? '').trim();
      const seconds = parseDuration(durationText);
      if (!seconds || seconds <= 0) {
        return `Could not understand the duration "${durationText}". Ask the user to restate it.`;
      }
      try {
        timerService.setTimer(seconds, label);
        return `Timer started for ${timerService.describe(Math.round(seconds))}${
          label ? ` (${label})` : ''
        }. It will announce itself when it fires.`;
      } catch (error) {
        return `Could not start the timer: ${(error as Error)?.message ?? 'unknown error'}.`;
      }
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

/** Whether the JS runtime can incrementally decode a UTF-8 stream. */
export const hasStreamingSupport = (): boolean => typeof TextDecoder !== 'undefined';

interface ToolCallAccumulator {
  id: string;
  name: string;
  args: string;
}

/**
 * Merge one `tool_calls` delta from an SSE chunk. OpenAI-compatible streams
 * deliver the function name once and the JSON arguments in fragments, keyed by
 * array index.
 */
export function mergeToolCallDelta(
  target: Map<number, ToolCallAccumulator>,
  deltas: unknown
): void {
  if (!Array.isArray(deltas)) return;
  deltas.forEach((raw, fallbackIndex) => {
    const delta = raw as {
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    };
    const index = typeof delta?.index === 'number' ? delta.index : fallbackIndex;
    const existing = target.get(index) ?? { id: '', name: '', args: '' };
    target.set(index, {
      id: delta?.id || existing.id,
      name: delta?.function?.name || existing.name,
      args: existing.args + (delta?.function?.arguments ?? ''),
    });
  });
}

/**
 * Incremental SSE reader. Calls `onLine` for every `data:` payload (already
 * stripped of the prefix) and stops at the terminal `[DONE]` sentinel.
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onLine: (payload: string) => void,
  onIdle?: () => void,
  idleMs = TIMEOUTS.STREAM_IDLE_MS
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdle = () => {
    if (!onIdle || !idleMs) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      onIdle();
      try {
        void reader.cancel();
      } catch (_) {}
    }, idleMs);
  };

  resetIdle();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') return;
          if (payload) onLine(payload);
        }
        newline = buffer.indexOf('\n');
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) {
      const payload = tail.slice(5).trim();
      if (payload && payload !== '[DONE]') onLine(payload);
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    try {
      reader.releaseLock();
    } catch (_) {}
  }
}

type GroqResponse = Awaited<ReturnType<typeof expoFetch>>;

export class GroqService {
  private controllers = new Set<AbortController>();

  /** Cancel every in-flight completion — the UI's stop control calls this. */
  cancelAll(): void {
    this.controllers.forEach((controller) => {
      try {
        controller.abort();
      } catch (_) {}
    });
    this.controllers.clear();
  }

  /**
   * Transcribe an audio file using Groq's free Whisper endpoint.
   * `locale` selects the spoken language hint (first subtag, e.g. "en").
   * Serialized behind the chat queue family so a retry cannot race a fresh
   * transcription (GAP-E2).
   */
  async transcribeAudio(
    audioUri: string,
    locale = 'en',
    signal?: AbortSignal
  ): Promise<string> {
    if (!hasGroqCredentials()) {
      throw new Error('Groq API Key is not configured. Please check your .env file.');
    }

    return asrRequestQueue.run(
      () => this.runTranscription(audioUri, locale, signal),
      signal
    );
  }

  private async runTranscription(
    audioUri: string,
    locale: string,
    signal?: AbortSignal
  ): Promise<string> {
    const audioFile = new File(audioUri);
    if (!audioFile.exists) {
      throw new Error('Recording file not found. Please try recording again.');
    }

    const formData = new FormData();
    formData.append('file', audioFile, audioFile.name);
    formData.append('model', GROQ_ASR_MODEL);
    formData.append('language', (locale || 'en').slice(0, 2).toLowerCase());
    formData.append('response_format', 'json');

    const controller = new AbortController();
    const forwardAbort = () => {
      try {
        controller.abort();
      } catch (_) {}
    };
    if (signal) {
      if (signal.aborted) forwardAbort();
      else signal.addEventListener('abort', forwardAbort, { once: true });
    }

    try {
      const response = await withTimeout(
        this.fetchWithRetry(
          resolveEndpoint('groq', GROQ_API_BASE, '/audio/transcriptions'),
          {
            method: 'POST',
            headers: { ...authHeaders('groq') },
            body: formData,
          },
          controller.signal
        ),
        TIMEOUTS.ASR_TIMEOUT_MS,
        'Groq transcription'
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Groq ASR error response:', response.status, errorText);
        if (response.status === 401 || response.status === 403) throw new Error(GROQ_AUTH_HELP);
        throw new Error(`Groq transcription failed (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      return (data.text || '').trim();
    } catch (e) {
      connectivity.reportFailure(e);
      throw e;
    } finally {
      if (signal) signal.removeEventListener('abort', forwardAbort);
    }
  }

  /**
   * Stream a reply, executing at most one tool round. Tokens are emitted
   * through `onEvent` so the UI can print and speak sentence-by-sentence
   * instead of waiting for the whole completion.
   *
   * Serialized through `chatRequestQueue` (GAP-E2): a burst of turns can no
   * longer fan out into parallel calls against an already rate-limited
   * endpoint, and an abort while queued skips the request entirely.
   */
  async getChatCompletion(request: ChatRequest): Promise<ChatResult> {
    if (!hasGroqCredentials()) {
      throw new Error('Groq API Key is not configured. Please check your .env file.');
    }

    return chatRequestQueue.run(() => this.runCompletion(request), request.signal);
  }

  private async runCompletion(request: ChatRequest): Promise<ChatResult> {
    const controller = new AbortController();
    this.controllers.add(controller);

    const external = request.signal;
    if (external?.aborted) {
      try {
        controller.abort();
      } catch (_) {}
    }
    const forwardAbort = () => {
      try {
        controller.abort();
      } catch (_) {}
    };
    if (external) {
      if (external.aborted) forwardAbort();
      else external.addEventListener('abort', forwardAbort);
    }

    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      forwardAbort();
    }, TIMEOUTS.CHAT_DEADLINE_MS);

    try {
      const result = await this.runChatLoop(this.buildMessages(request), {
        model: resolveChatModel(request.model),
        signal: controller.signal,
        onEvent: request.onEvent,
      });
      return result;
    } catch (e: any) {
      connectivity.reportFailure(e);
      if (external?.aborted) throw new Error('Cancelled.');
      if (timedOut) {
        throw new Error(
          `No reply within ${TIMEOUTS.CHAT_DEADLINE_MS / 1000}s. Free capacity may be saturated — retry shortly.`
        );
      }
      if (e?.status === 401 || e?.status === 403) throw new Error(GROQ_AUTH_HELP);
      throw e;
    } finally {
      clearTimeout(deadline);
      this.controllers.delete(controller);
      if (external) external.removeEventListener('abort', forwardAbort);
    }
  }

  private buildMessages(request: ChatRequest): LLMChatMessage[] {
    // Explicit budget instead of a blind `.slice(-8)` (GAP-B5): turns are kept
    // while both a count cap *and* a character cap allow it, and everything
    // older folds into a rolling digest that still reaches the model.
    const plan = planContext(request.history ?? []);

    return [
      {
        role: 'system',
        content: buildSystemPrompt({
          concise: !!request.concise,
          persona: request.persona ?? '',
          locale: request.locale ?? 'en-GB',
        }),
      },
      ...planToMessages(plan),
      ...(request.image
        ? [
            {
              role: 'user' as const,
              content: [
                { type: 'text', text: request.userPrompt || 'What is in this image?' },
                { type: 'image_url', image_url: { url: request.image.dataUrl } },
              ] as unknown as string,
            },
          ]
        : [{ role: 'user' as const, content: request.userPrompt }]),
    ];
  }

  private async runChatLoop(
    messages: LLMChatMessage[],
    opts: { model: string; signal: AbortSignal; onEvent?: (event: StreamEvent) => void }
  ): Promise<ChatResult> {
    const sources: SearchSource[] = [];
    let round = 0;

    while (round <= TIMEOUTS.MAX_TOOL_ROUNDS) {
      const { content, toolCalls } = await this.streamOnce(messages, opts);

      if (toolCalls.length > 0 && round < TIMEOUTS.MAX_TOOL_ROUNDS) {
        messages.push({
          role: 'assistant',
          content,
          tool_calls: toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.args },
          })),
        });

        for (const call of toolCalls) {
          if (opts.signal.aborted) break;
          opts.onEvent?.({ type: 'tool_start', tool: call.name });
          let args: unknown = {};
          try {
            args = JSON.parse(call.args || '{}');
          } catch {
            args = {};
          }
          const resultText = await executeTool(call.name, args, {
            signal: opts.signal,
            onSources: (found) => {
              sources.push(...found);
              opts.onEvent?.({ type: 'sources', sources: found });
            },
          });
          messages.push({
            role: 'tool',
            tool_call_id: call.id || `call_${round}`,
            content: resultText,
          });
        }

        round += 1;
        continue;
      }

      const trimmed = content.trim();
      return {
        text: trimmed || 'I have processed your request, sir, but received an empty transmission.',
        sources,
      };
    }

    return { text: 'I was unable to complete that request, sir.', sources };
  }

  /**
   * One completion round. Requests SSE when the runtime can decode it
   * incrementally, otherwise falls back to a single JSON response.
   */
  private async streamOnce(
    messages: LLMChatMessage[],
    opts: { model: string; signal: AbortSignal; onEvent?: (event: StreamEvent) => void }
  ): Promise<{ content: string; toolCalls: ToolCallAccumulator[] }> {
    const streaming = hasStreamingSupport();
    const payload: Record<string, unknown> = {
      model: opts.model,
      messages,
      temperature: 0.7,
      max_tokens: 384,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
    };
    if (streaming) payload.stream = true;

    const response = await this.fetchWithRetry(
      resolveEndpoint('groq', GROQ_API_BASE, '/chat/completions'),
      {
        method: 'POST',
        headers: { ...authHeaders('groq'), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: opts.signal,
      },
      opts.signal
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Groq Chat Completion error:', response.status, errorText);
      const error: any = new Error(`Groq LLM completion failed (${response.status}): ${errorText}`);
      error.status = response.status;
      throw error;
    }

    const toolMap = new Map<number, ToolCallAccumulator>();
    let content = '';

    if (!streaming || !response.body) {
      const data = await response.json();
      const choice = data?.choices?.[0]?.message;
      content = typeof choice?.content === 'string' ? choice.content : '';
      mergeToolCallDelta(toolMap, choice?.tool_calls);
    } else {
      await readSseStream(response.body, (rawPayload) => {
        let parsed: any;
        try {
          parsed = JSON.parse(rawPayload);
        } catch {
          return;
        }
        const delta = parsed?.choices?.[0]?.delta;
        if (!delta) return;
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          opts.onEvent?.({ type: 'token', text: delta.content });
        }
        if (delta.tool_calls) mergeToolCallDelta(toolMap, delta.tool_calls);
      });
    }

    const toolCalls = Array.from(toolMap.values()).filter((call) => !!call.name);
    return { content, toolCalls };
  }

  /**
   * POST with bounded retries. 429 and 5xx are retried honouring `Retry-After`;
   * transport failures are retried with jittered exponential backoff.
   *
   * Every attempt first waits on the *shared* rate-limit gate, and every 429
   * publishes one — so when the free tier throttles, all queued work holds fire
   * together instead of each caller independently backing off into the same
   * wall (GAP-E2). Rate-limit headers are forwarded to the quota snapshot
   * (GAP-D4).
   */
  private async fetchWithRetry(
    url: string,
    init: Parameters<typeof expoFetch>[1],
    signal: AbortSignal
  ): Promise<GroqResponse> {
    let attempt = 0;

    for (;;) {
      try {
        await awaitRateLimitGate(signal);
        const response = await expoFetch(url, init);
        const retryableStatus = response.status === 429 || response.status >= 500;
        const headers = response.headers;

        if (response.status === 429) {
          const retryAfterMs = parseRetryAfter(headers?.get?.('retry-after') ?? null);
          const waitMs = retryAfterMs ?? backoffDelayMs(attempt);
          reportRateLimit('groq', waitMs, '429 rate limited');
          markThrottled('groq', Math.max(1, Math.round(waitMs / 1000)));
        }

        if (retryableStatus && attempt < TIMEOUTS.MAX_RETRIES) {
          const retryAfter = parseRetryAfter(headers?.get?.('retry-after') ?? null);
          // Never wake up before the global cooldown lifts — otherwise we
          // re-trigger the same rejection and lengthen the queue behind us.
          const waitMs = Math.max(
            backoffDelayMs(attempt, retryAfter),
            rateLimitRemainingMs()
          );
          console.warn(
            `groq: HTTP ${response.status}, retry ${attempt + 1}/${TIMEOUTS.MAX_RETRIES} in ${waitMs}ms`
          );
          attempt += 1;
          await sleep(waitMs);
          if (signal.aborted) {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            throw abortError;
          }
          continue;
        }

        if (response.ok) {
          connectivity.reportSuccess();
          const quota = readGroqQuota(headers);
          if (quota) setQuota(quota);
        }
        return response;
      } catch (error) {
        const canRetry = isNetworkError(error) && attempt < TIMEOUTS.MAX_RETRIES && !signal.aborted;
        if (!canRetry) throw error;
        const waitMs = Math.max(backoffDelayMs(attempt), rateLimitRemainingMs());
        attempt += 1;
        console.warn(`groq: transport error, retry ${attempt}/${TIMEOUTS.MAX_RETRIES} in ${waitMs}ms`);
        await sleep(waitMs);
      }
    }
  }
}

export const groqService = new GroqService();




