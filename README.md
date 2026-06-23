# @codai/sdk

[![npm version](https://img.shields.io/npm/v/@codai/sdk.svg)](https://www.npmjs.com/package/@codai/sdk)
[![license](https://img.shields.io/npm/l/@codai/sdk.svg)](./LICENSE)

Official TypeScript SDK for the [codai](https://codai.ro) AI gateway — a single
OpenAI-compatible endpoint with smart routing, sessions, server-side agents,
streaming, embeddings, audio, and feedback.

- **Zero dependencies** — uses the platform `fetch`.
- Works in **Node 18+** and modern edge runtimes.
- **OpenAI-compatible** chat surface with codai extensions.
- Fully typed.

```bash
npm install @codai/sdk
# or
pnpm add @codai/sdk
```

> You need a codai API key. Get one at **[codai.ro](https://codai.ro)**.

## Quickstart

```ts
import { Codai } from '@codai/sdk';

const codai = new Codai({ apiKey: process.env.CODAI_API_KEY! });

const res = await codai.chat({
  messages: [{ role: 'user', content: 'Explain async iterators in one line.' }],
});

console.log(res.content);
console.log(res.routedTo); // which upstream model actually served
```

## Streaming

```ts
for await (const delta of codai.chatStream({
  messages: [{ role: 'user', content: 'Write a haiku about TypeScript.' }],
})) {
  process.stdout.write(delta);
}
```

## Server-side agent

Run a plan-and-execute loop on the gateway — the heavy lifting (planning, tool
use, iteration) happens server-side; your client stays thin.

```ts
const run = await codai.agents.run({
  task: 'Summarize the key points of the provided text.',
  context: '…your input…',
});

console.log(run.result);
```

## Feedback

```ts
const res = await codai.chat({ messages: [{ role: 'user', content: 'hi' }] });
if (res.requestId) {
  await codai.feedback(res.requestId, 1); // 1 = 👍, -1 = 👎
}
```

## Embeddings

```ts
const { embeddings } = await codai.embeddings({ input: ['hello', 'world'] });
```

## Audio

```ts
// Speech-to-text
const text = await codai.audio.transcribe({ file: audioBytes, filename: 'clip.webm' });

// Text-to-speech
const wav = await codai.audio.speech({ input: 'Hello from codai.' });
```

## List models

```ts
const models = await codai.models();
```

## Configuration

```ts
const codai = new Codai({
  apiKey: process.env.CODAI_API_KEY!,
  baseUrl: 'https://ai.codai.ro', // default
  sessionId: 'my-project', // enables session memory + stickiness
  timeoutMs: 120_000,
  maxRetries: 2,
});
```

## codai extensions

The chat surface is OpenAI-compatible, with a few opt-in extensions:

| Option            | Description                                                             |
| ----------------- | ----------------------------------------------------------------------- |
| `sessionId`       | Stable conversation id — enables session memory and routing stickiness. |
| `agentMode`       | Plan-and-execute agent mode (Pro+).                                     |
| `compact: "auto"` | Server-side context compaction.                                         |
| `bestOf`          | Best-of-N sampling override (`0` disables, `3` forces).                 |

## Migrating from the OpenAI SDK

The chat payload is OpenAI-shaped, so migration is mostly swapping the client:

```ts
// before: openai.chat.completions.create({ model, messages })
// after:
const res = await codai.chat({ messages });
```

## Error handling

```ts
import { Codai, CodaiError } from '@codai/sdk';

try {
  await codai.chat({ messages: [{ role: 'user', content: 'hi' }] });
} catch (err) {
  if (err instanceof CodaiError) {
    console.error(err.status, err.message, err.body);
  }
}
```

## License

[MIT](./LICENSE) © codai
