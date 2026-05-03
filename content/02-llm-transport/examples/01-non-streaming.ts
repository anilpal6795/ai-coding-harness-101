/**
 * Example 2.1: Non-streaming Anthropic call
 *
 * The simplest possible LLM call. No streaming, no tools, no agent loop.
 * Useful for tests and to feel the request/response cycle.
 *
 * Run with:
 *   ANTHROPIC_API_KEY=sk-... npx tsx 01-non-streaming.ts
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 256,
  messages: [
    { role: "user", content: "Say hello in exactly 3 words." },
  ],
});

console.log("Stop reason:", response.stop_reason);
console.log("Content:", response.content);
console.log("Usage:", response.usage);
