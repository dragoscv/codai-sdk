/**
 * Submit feedback on a completion.
 *
 *   CODAI_API_KEY=sk_... npx tsx examples/feedback.ts
 */
import { Codai } from '@codai/sdk';

const codai = new Codai({ apiKey: process.env.CODAI_API_KEY! });

const res = await codai.chat({
  messages: [{ role: 'user', content: 'Hello!' }],
});

if (res.requestId) {
  await codai.feedback(res.requestId, 1); // 1 = 👍, -1 = 👎
  console.log('feedback submitted for', res.requestId);
}
