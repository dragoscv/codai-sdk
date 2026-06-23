/**
 * Streaming chat completion.
 *
 *   CODAI_API_KEY=sk_... npx tsx examples/streaming.ts
 */
import { Codai } from 'codai-sdk';

const codai = new Codai({ apiKey: process.env.CODAI_API_KEY! });

const stream = codai.chatStream({
  messages: [{ role: 'user', content: 'Write a haiku about streaming data.' }],
});

for await (const delta of stream) {
  process.stdout.write(delta);
}
process.stdout.write('\n');

const final = await stream.final;
console.log('routed to:', final.routedTo);
console.log('usage:', final.usage);
