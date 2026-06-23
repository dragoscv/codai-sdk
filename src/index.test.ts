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
});
