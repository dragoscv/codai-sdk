/**
 * Streaming chat completion.
 *
 *   CODAI_API_KEY=sk_... npx tsx examples/streaming.ts
 */
import { Codai } from 'codai-sdk';

const codai = new Codai({ apiKey: process.env.CODAI_API_KEY! });

for await (const delta of codai.chatStream({
  messages: [{ role: 'user', content: 'Write a haiku about streaming data.' }],
})) {
  process.stdout.write(delta);
}
process.stdout.write('\n');
