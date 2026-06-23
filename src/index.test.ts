import { afterEach, describe, expect, it, vi } from 'vitest';
import { Codai, CodaiError } from './index';

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(handler));
}

afterEach(() => vi.unstubAllGlobals());

describe('Codai client', () => {
  it('requires an apiKey', () => {
    expect(() => new Codai({ apiKey: '' })).toThrow('apiKey is required');
  });

  it('chat() sends auth + extension headers and parses the result', async () => {
    let captured: { url?: string; headers?: Record<string, string>; body?: unknown } = {};
    mockFetch(async (url, init) => {
      captured = {
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)),
      };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hi there' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        {
          status: 200,
          headers: { 'x-codai-routed-to': 'claude-haiku-4-5', 'x-request-id': 'req-1' },
        },
      );
    });

    const client = new Codai({ apiKey: 'sk-test', sessionId: 'sess-1' });
    const result = await client.chat({
      messages: [{ role: 'user', content: 'hello' }],
      agentMode: true,
      bestOf: 0,
    });

    expect(captured.url).toBe('https://ai.codai.ro/v1/chat/completions');
    expect(captured.headers!.Authorization).toBe('Bearer sk-test');
    expect(captured.headers!['x-codai-session-id']).toBe('sess-1');
    expect(captured.headers!['x-codai-mode']).toBe('agent');
    expect(captured.headers!['x-codai-best-of']).toBe('0');
    expect((captured.body as { model: string }).model).toBe('codai');
    expect(result.content).toBe('hi there');
    expect(result.routedTo).toBe('claude-haiku-4-5');
    expect(result.requestId).toBe('req-1');
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      if (calls === 1) return new Response('{}', { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
      });
    });
    const client = new Codai({ apiKey: 'sk-test', maxRetries: 1 });
    const result = await client.chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(calls).toBe(2);
    expect(result.content).toBe('ok');
  });

  it('throws CodaiError with status on non-retryable failure', async () => {
    mockFetch(async () => new Response(JSON.stringify({ error: 'bad key' }), { status: 401 }));
    const client = new Codai({ apiKey: 'sk-bad' });
    await expect(client.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      CodaiError,
    );
  });

  it('chatStream() yields SSE deltas', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    mockFetch(
      async () =>
        new Response(new Blob([sse]).stream(), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    const client = new Codai({ apiKey: 'sk-test' });
    const chunks: string[] = [];
    for await (const delta of client.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(delta);
    }
    expect(chunks.join('')).toBe('Hello');
  });

  it('agents.run() posts the task', async () => {
    let captured: unknown;
    mockFetch(async (_url, init) => {
      captured = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ result: 'done', model: 'codai' }), { status: 200 });
    });
    const client = new Codai({ apiKey: 'sk-test' });
    const out = await client.agents.run({ task: 'summarize repo' });
    expect((captured as { task: string }).task).toBe('summarize repo');
    expect(out.result).toBe('done');
  });

  it('chatStream().final resolves with metadata, usage and content', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    mockFetch(
      async () =>
        new Response(new Blob([sse]).stream(), {
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
            'x-request-id': 'req-stream',
            'x-codai-routed-to': 'claude-haiku-4-5',
          },
        }),
    );
    const client = new Codai({ apiKey: 'sk-test' });
    const stream = client.chatStream({ messages: [{ role: 'user', content: 'hi' }] });
    const chunks: string[] = [];
    for await (const delta of stream) chunks.push(delta);
    const final = await stream.final;
    expect(chunks.join('')).toBe('Hello');
    expect(final.content).toBe('Hello');
    expect(final.requestId).toBe('req-stream');
    expect(final.routedTo).toBe('claude-haiku-4-5');
    expect(final.usage).toEqual({ promptTokens: 7, completionTokens: 2 });
    expect(final.toolCalls).toEqual([]);
  });

  it('chatStream() assembles streamed tool calls into final.toolCalls', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\\"ci"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ty\\":\\"Paris\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    mockFetch(
      async () =>
        new Response(new Blob([sse]).stream(), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    const client = new Codai({ apiKey: 'sk-test' });
    const stream = client.chatStream({ messages: [{ role: 'user', content: 'weather?' }] });
    for await (const _delta of stream) {
      void _delta; // drain
    }
    const final = await stream.final;
    expect(final.toolCalls).toHaveLength(1);
    const tc = final.toolCalls[0] as {
      id: string;
      function: { name: string; arguments: string };
    };
    expect(tc.id).toBe('call_1');
    expect(tc.function.name).toBe('get_weather');
    expect(JSON.parse(tc.function.arguments)).toEqual({ city: 'Paris' });
  });

  it('chatStream().final rejects when the request fails', async () => {
    mockFetch(async () => new Response('nope', { status: 401 }));
    const client = new Codai({ apiKey: 'sk-bad', maxRetries: 0 });
    const stream = client.chatStream({ messages: [{ role: 'user', content: 'x' }] });
    await expect(
      (async () => {
        for await (const _delta of stream) {
          void _delta; // should throw before yielding
        }
      })(),
    ).rejects.toThrow(CodaiError);
    await expect(stream.final).rejects.toThrow(CodaiError);
  });

  it('embeddings() returns vectors', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3] }] }), {
          status: 200,
        }),
    );
    const client = new Codai({ apiKey: 'sk-test' });
    const out = await client.embeddings({ input: ['a', 'b'] });
    expect(out.embeddings).toEqual([[0.1, 0.2], [0.3]]);
  });

  it('audio.transcribe() posts multipart and returns text', async () => {
    let isFormData = false;
    mockFetch(async (url, init) => {
      isFormData = init.body instanceof FormData;
      expect(url).toBe('https://ai.codai.ro/v1/audio/transcriptions');
      return new Response(JSON.stringify({ text: 'hello world' }), { status: 200 });
    });
    const client = new Codai({ apiKey: 'sk-test' });
    const text = await client.audio.transcribe({
      file: new Uint8Array([1, 2, 3]),
      filename: 'clip.webm',
    });
    expect(isFormData).toBe(true);
    expect(text).toBe('hello world');
  });

  it('audio.speech() returns audio bytes', async () => {
    mockFetch(async () => new Response(new Uint8Array([4, 5, 6]), { status: 200 }));
    const client = new Codai({ apiKey: 'sk-test' });
    const buf = await client.audio.speech({ input: 'hi' });
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([4, 5, 6]));
  });

  it('mintToken() returns a scoped ephemeral token', async () => {
    let body: unknown;
    mockFetch(async (_url, init) => {
      body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ token: 'eph_abc', expires_at: '2026-01-01T00:00:00Z', scope: 'audio' }),
        { status: 200 },
      );
    });
    const client = new Codai({ apiKey: 'sk-test' });
    const tok = await client.mintToken('audio', 600);
    expect((body as { scope: string; ttl_seconds: number }).scope).toBe('audio');
    expect((body as { ttl_seconds: number }).ttl_seconds).toBe(600);
    expect(tok.token).toBe('eph_abc');
    expect(tok.scope).toBe('audio');
  });

  it('models() lists available models', async () => {
    mockFetch(
      async () => new Response(JSON.stringify({ data: [{ id: 'codai' }] }), { status: 200 }),
    );
    const client = new Codai({ apiKey: 'sk-test' });
    const models = await client.models();
    expect(models).toEqual([{ id: 'codai' }]);
  });
});
