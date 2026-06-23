/**
 * Basic chat completion.
 *
 *   CODAI_API_KEY=sk_... npx tsx examples/chat.ts
 */
import { Codai } from '@codai/sdk';

const codai = new Codai({ apiKey: process.env.CODAI_API_KEY! });

const res = await codai.chat({
  messages: [{ role: 'user', content: 'Give me one tip for clean TypeScript.' }],
});

console.log(res.content);
console.log('routed to:', res.routedTo);
