/**
 * Server-side agent run.
 *
 *   CODAI_API_KEY=sk_... npx tsx examples/agent.ts
 */
import { Codai } from '@codai/sdk';

const codai = new Codai({ apiKey: process.env.CODAI_API_KEY! });

const run = await codai.agents.run({
  task: 'Summarize the following text in 3 bullet points.',
  context: 'codai is an OpenAI-compatible AI gateway with smart routing.',
});

console.log(run.result);
