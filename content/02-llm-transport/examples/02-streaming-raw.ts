/**
 * Example 2.2: Streaming with the raw Anthropic SDK
 *
 * Shows how the SDK exposes streaming events. This is what your transport layer
 * is going to wrap into a normalized protocol.
 *
 * Notice the event types: message_start, content_block_start, content_block_delta,
 * content_block_stop, message_delta, message_stop.
 *
 * Run with:
 *   ANTHROPIC_API_KEY=sk-... npx tsx 02-streaming-raw.ts
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const stream = await client.messages.stream({
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 200,
  messages: [
    { role: "user", content: "Tell me a 3-sentence story about a robot learning to bake bread." },
  ],
});

console.log("\n--- Streaming ---\n");
for await (const event of stream) {
  // Print every event type to see the protocol
  console.log(`[${event.type}]`, event.type === "content_block_delta" ? event.delta : "");
}
console.log("\n--- Done ---\n");

const final = await stream.finalMessage();
console.log("Final message:", JSON.stringify(final, null, 2));
