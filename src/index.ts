/**
 * @codai/sdk — official TypeScript client for the codai AI gateway.
 *
 * Full-surface client:
 *   - chat(): OpenAI-compatible completions with codai extensions
 *     (session, agent mode, compaction, best-of)
 *   - chatStream(): SSE streaming with an async-iterator interface
 *   - agents.run(): server-side agent loop (POST /v1/agents/run)
 *   - feedback(): thumbs rating on a completed request
 *   - models(): list models available to the key
 *
 * Zero dependencies; works in Node 18+ (global fetch) and modern edge
 * runtimes. Memory tools (memory_recall / memory_remember) and skills
 * (use_skill) are GATEWAY-NATIVE — the model invokes them server-side;
 * nothing to call from the SDK beyond enabling a session.
 */

export interface CodaiClientOptions {
  apiKey: string;
  /** Defaults to https://ai.codai.ro */
  baseUrl?: string;
  /** Stable conversation/session id — enables session memory + stickiness. */
  sessionId?: string;
  /** Default request timeout (ms). Default 120_000. */
  timeoutMs?: number;
  /** Retries on 429/5xx with exponential backoff. Default 2. */
  maxRetries?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<Record<string, unknown>>;
  tool_call_id?: string;
  name?: string;
}

export interface ChatOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: Array<Record<string, unknown>>;
  /** codai extension: plan-and-execute agent mode (Pro+). */
  agentMode?: boolean;
  /** codai extension: server-side context compaction ('auto'). */
  compact?: 'auto';
  /** codai extension: best-of-N override (0 disables, 3 forces). */
  bestOf?: 0 | 3;
  /** Attribution id recorded on tool calls (agent fleets). */
  agentId?: string;
  /** Per-call session override. */
  sessionId?: string;
  signal?: AbortSignal;
}

export interface ChatResult {
  /** Assistant message content (first choice). */
  content: string;
  /** Raw OpenAI-shaped response. */
  raw: Record<string, unknown>;
  /** Request id — pass to feedback(). */
  requestId: string | null;
  /** Which upstream model actually served (x-codai-routed-to). */
  routedTo: string | null;
  /** Verification status for verified-execution responses ('passed'|'refined'|…), if present. */
  execVerify: string | null;
  usage: { promptTokens: number; completionTokens: number } | null;
}

export interface AgentRunOptions {
  task: string;
  context?: string;
  system?: string;
  model?: string;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  result: string;
  model: string;
  eventId: string | null;
  usage: Record<string, unknown> | null;
}

export type EphemeralScope = 'realtime' | 'audio' | 'embeddings';

export interface EphemeralToken {
  token: string;
  expiresAt: string;
  scope: EphemeralScope;
}

export interface TranscriptionOptions {
  /** Audio file contents. */
  file: Blob | Uint8Array | ArrayBuffer;
  /** Filename hint (extension drives format detection). Default audio.webm */
  filename?: string;
  model?: string;
  signal?: AbortSignal;
}

export interface SpeechOptions {
  input: string;
  model?: string;
  voice?: string;
  signal?: AbortSignal;
}

export interface EmbeddingsOptions {
  input: string | string[];
  model?: string;
  dimensions?: number;
  signal?: AbortSignal;
}

export class CodaiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'CodaiError';
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class Codai {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly sessionId?: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(opts: CodaiClientOptions) {
    if (!opts.apiKey) throw new Error('Codai: apiKey is required');
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://ai.codai.ro').replace(/\/$/, '');
    this.sessionId = opts.sessionId;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.maxRetries = opts.maxRetries ?? 2;
  }

  // ---------------------------------------------------------------- chat
  async chat(opts: ChatOptions): Promise<ChatResult> {
    const res = await this.request('/v1/chat/completions', this.chatBody(opts, false), {
      signal: opts.signal,
      headers: this.chatHeaders(opts),
    });
    const raw = (await res.json()) as Record<string, unknown>;
    const choices = raw.choices as Array<{ message?: { content?: string } }> | undefined;
    const usage = raw.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    return {
      content: String(choices?.[0]?.message?.content ?? ''),
      raw,
      requestId: res.headers.get('x-request-id'),
      routedTo: res.headers.get('x-codai-routed-to'),
      execVerify: res.headers.get('x-codai-exec-verify'),
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
          }
        : null,
    };
  }

  /** Streaming chat: async-iterate text deltas; `final` resolves afterwards. */
  async *chatStream(opts: ChatOptions): AsyncGenerator<string, void, undefined> {
    const res = await this.request('/v1/chat/completions', this.chatBody(opts, true), {
      signal: opts.signal,
      headers: this.chatHeaders(opts),
    });
    const reader = res.body?.getReader();
    if (!reader) throw new CodaiError('no response body', res.status, null);
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are \n\n separated; keep the trailing partial in buffer.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            const chunk = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            /* keep-alives / comments */
          }
        }
      }
    }
  }

  // -------------------------------------------------------------- agents
  readonly agents = {
    run: async (opts: AgentRunOptions): Promise<AgentRunResult> => {
      const res = await this.request(
        '/v1/agents/run',
        {
          task: opts.task,
          ...(opts.context ? { context: opts.context } : {}),
          ...(opts.system ? { system: opts.system } : {}),
          ...(opts.model ? { model: opts.model } : {}),
        },
        { signal: opts.signal },
      );
      const body = (await res.json()) as Record<string, unknown>;
      return {
        result: String(body.result ?? ''),
        model: String(body.model ?? ''),
        eventId: (body.event_id as string) ?? null,
        usage: (body.usage as Record<string, unknown>) ?? null,
      };
    },
  };

  // ------------------------------------------------------------ feedback
  /** Rate a completed request: +1 (helpful) or -1 (not helpful). */
  async feedback(requestId: string, rating: 1 | -1, comment?: string): Promise<void> {
    await this.request('/v1/feedback', {
      event_id: requestId,
      rating,
      ...(comment ? { comment } : {}),
    });
  }

  // -------------------------------------------------------------- models
  async models(): Promise<Array<{ id: string }>> {
    const res = await this.request('/v1/models', null, { method: 'GET' });
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return body.data ?? [];
  }

  // -------------------------------------------------------------- tokens
  /**
   * Mint a short-lived scoped token (60–3600s) for browser/webview clients.
   * The token authenticates only its scope's surface; chat is not mintable.
   */
  async mintToken(scope: EphemeralScope, ttlSeconds?: number): Promise<EphemeralToken> {
    const res = await this.request('/v1/tokens', {
      scope,
      ...(ttlSeconds !== undefined ? { ttl_seconds: ttlSeconds } : {}),
    });
    const body = (await res.json()) as {
      token: string;
      expires_at: string;
      scope: EphemeralScope;
    };
    return { token: body.token, expiresAt: body.expires_at, scope: body.scope };
  }

  // ---------------------------------------------------------- embeddings
  async embeddings(opts: EmbeddingsOptions): Promise<{ embeddings: number[][]; raw: unknown }> {
    const res = await this.request(
      '/v1/embeddings',
      {
        model: opts.model ?? 'codai-embed',
        input: opts.input,
        ...(opts.dimensions !== undefined ? { dimensions: opts.dimensions } : {}),
      },
      { signal: opts.signal },
    );
    const body = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    return { embeddings: (body.data ?? []).map((d) => d.embedding), raw: body };
  }

  // --------------------------------------------------------------- audio
  readonly audio = {
    /** Speech-to-text (multipart upload, max 25 MB). Returns the transcript. */
    transcribe: async (opts: TranscriptionOptions): Promise<string> => {
      const form = new FormData();
      const blob = opts.file instanceof Blob ? opts.file : new Blob([opts.file as BlobPart]);
      form.append('file', blob, opts.filename ?? 'audio.webm');
      form.append('model', opts.model ?? 'codai-transcribe');
      const res = await fetch(`${this.baseUrl}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: opts.signal ?? AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        let errBody: unknown = null;
        try {
          errBody = await res.json();
        } catch {
          /* non-JSON */
        }
        throw new CodaiError(`codai /v1/audio/transcriptions → ${res.status}`, res.status, errBody);
      }
      const body = (await res.json()) as { text?: string };
      return body.text ?? '';
    },

    /** Text-to-speech. Returns the audio bytes (default mp3). */
    speech: async (opts: SpeechOptions): Promise<ArrayBuffer> => {
      const res = await this.request(
        '/v1/audio/speech',
        {
          model: opts.model ?? 'codai-tts',
          input: opts.input,
          voice: opts.voice ?? 'alloy',
        },
        { signal: opts.signal },
      );
      return res.arrayBuffer();
    },
  };

  // ------------------------------------------------------------ internal
  private chatBody(opts: ChatOptions, stream: boolean): Record<string, unknown> {
    return {
      model: opts.model ?? 'codai',
      messages: opts.messages,
      stream,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.tools ? { tools: opts.tools } : {}),
    };
  }

  private chatHeaders(opts: ChatOptions): Record<string, string> {
    const h: Record<string, string> = {};
    const session = opts.sessionId ?? this.sessionId;
    if (session) h['x-codai-session-id'] = session;
    if (opts.agentMode) h['x-codai-mode'] = 'agent';
    if (opts.compact) h['x-codai-compact'] = opts.compact;
    if (opts.bestOf !== undefined) h['x-codai-best-of'] = String(opts.bestOf);
    if (opts.agentId) h['x-codai-agent-id'] = opts.agentId;
    return h;
  }

  private async request(
    path: string,
    body: unknown,
    init: { signal?: AbortSignal; headers?: Record<string, string>; method?: string } = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method: init.method ?? 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            ...(body !== null ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers,
          },
          ...(body !== null ? { body: JSON.stringify(body) } : {}),
          signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
        });
        if (res.ok) return res;
        if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
          await sleep(500 * 2 ** attempt + Math.random() * 250);
          continue;
        }
        let errBody: unknown = null;
        try {
          errBody = await res.json();
        } catch {
          /* non-JSON error */
        }
        throw new CodaiError(`codai ${path} → ${res.status}`, res.status, errBody);
      } catch (err) {
        if (err instanceof CodaiError) throw err;
        lastErr = err;
        if (attempt < this.maxRetries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
      }
    }
    throw new CodaiError(`codai ${path} failed after retries: ${String(lastErr)}`, 0, null);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export default Codai;
