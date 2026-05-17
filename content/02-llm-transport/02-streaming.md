# Streaming

Without streaming, your coding agent feels broken. With it, it feels alive. This lesson covers what streaming actually is and how to consume it.

## Why streaming matters

Imagine asking Claude to write a 500-token answer. At 50 tokens/second, that's 10 seconds. Without streaming:

```
User types question.
[10 seconds of nothing — is it broken?]
Full response appears all at once.
```

With streaming:

```
User types question.
Response starts appearing immediately, character by character.
User reads as it streams.
By the time the model finishes, the user is already most of the way through reading.
```

The total wall-clock time is the same. **The perceived latency is dramatically lower.** Streaming is the single biggest UX win in LLM products.

For coding agents specifically, streaming is even more critical:

- Tool calls stream too (you can show "I'm about to read X" before the args are finalized)
- Long thinking blocks stream (the user can watch the model reason)
- The user can hit `Esc` to abort if they see the response going wrong

You cannot ship a serious coding agent without streaming.

## How it works under the hood: SSE

Streaming uses **Server-Sent Events (SSE)** — an HTTP protocol where the server keeps the connection open and sends chunks of text separated by blank lines.

A raw SSE response from Anthropic looks like this:

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_...","role":"assistant","content":[],...}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}

event: message_stop
data: {"type":"message_stop"}
```

Each event has a type and a JSON data payload. You parse them in order to assemble the full message.

You don't have to parse SSE yourself — the Anthropic SDK does it for you. But knowing what's underneath helps when things break.

## Streaming with the Anthropic SDK

The SDK gives you an async iterator:

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const stream = await client.messages.stream({
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 256,
  messages: [{ role: "user", content: "Count to 5 slowly." }],
});

for await (const event of stream) {
  console.log(event.type, event);
}
```

You'll see events like:

- `message_start` — message begins
- `content_block_start` — a new content block (text, tool_use, thinking)
- `content_block_delta` — a chunk of that block
- `content_block_stop` — block done
- `message_delta` — usage update
- `message_stop` — entire message done

There's also `stream.finalMessage()`:

```ts
const stream = await client.messages.stream({...});

for await (const event of stream) {
  // do streaming UI updates
}

const finalMessage = await stream.finalMessage();
// Get the complete assembled message after streaming finishes
```

This is the pattern you'll use everywhere: stream events for UI, then get the complete message at the end.

## Async iterators in Node.js

If `for await (const event of stream)` is new to you, here's the gist:

An **async iterator** is anything that implements `Symbol.asyncIterator`. You consume it with `for await`. It yields values asynchronously — each `next()` call returns a promise.

You can build your own:

```ts
async function* numbers() {
  yield 1;
  await sleep(100);
  yield 2;
  await sleep(100);
  yield 3;
}

for await (const n of numbers()) {
  console.log(n);  // 1, then 2 (after 100ms), then 3
}
```

This is how we'll model LLM streams in our transport layer. **Every `stream()` function returns an async iterable of events.**

## Tool calls in a stream

Tool calls also stream. Here's what that looks like:

```
message_start
content_block_start    { type: "tool_use", id: "...", name: "read_file", input: {} }
content_block_delta    { delta: { type: "input_json_delta", partial_json: '{"pa' } }
content_block_delta    { delta: { type: "input_json_delta", partial_json: 'th": "x' } }
content_block_delta    { delta: { type: "input_json_delta", partial_json: '.txt"}' } }
content_block_stop
message_delta          { stop_reason: "tool_use" }
message_stop
```

The arguments arrive as a stream of JSON fragments. You concatenate them and `JSON.parse` at the end.

> 💡 **Why fragmented JSON?** The model is producing tokens. Each token might be one or a few characters of JSON. You receive them as they're generated. By the time `content_block_stop` fires, you have the complete JSON.

You can also try to parse partial JSON to show the user what's being constructed in real-time. Chapter 3 covers this.

## Non-streaming as a fallback

There's still `client.messages.create()` (non-streaming). It blocks until the entire response is ready, then returns the complete message.

When to use:

- Tests (deterministic, easier to assert on)
- Background jobs where latency doesn't matter
- Calling small models for fast responses (you don't perceive the difference)

When **not** to use:

- Anything user-facing in real time. Always stream.

For our agent, we'll stream everything. We can build a `complete()` helper on top of `stream()` for tests:

```ts
async function complete(model, context) {
  const stream = streamFn(model, context);
  for await (const _ of stream) { /* drain */ }
  return await stream.finalMessage();
}
```

## What "abort" means with a stream

When the user hits `Esc`:

1. You call `controller.abort()` on an `AbortController`
2. The signal propagates to the underlying `fetch()`
3. The HTTP connection closes
4. The async iterator throws or returns

Your loop has to handle the abort case — produce a partial assistant message with `stopReason: "aborted"` so the agent state stays consistent.

We'll cover abort in detail in Chapter 5. For now, know that streaming makes abort possible. Non-streaming requests are not abortable mid-flight from the API's perspective.

## Stop and try this

Create `src/app/main.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const stream = await client.messages.stream({
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 200,
  messages: [
    { role: "user", content: "Tell me a 3-sentence story about a robot learning to bake bread." },
  ],
});

process.stdout.write("\n");
for await (const event of stream) {
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    process.stdout.write(event.delta.text);
  }
}
process.stdout.write("\n\n");

const final = await stream.finalMessage();
console.log("Tokens used:", final.usage);
```

Run with `npm start`. You'll see the story type out word by word, then the token usage at the end.

**This is what your agent UI will look like.** Now you've felt streaming from the API perspective. Next we're going to wrap this in our own protocol.

## Key takeaways

1. Streaming dramatically reduces perceived latency. It's not optional for coding agents.
2. Under the hood: SSE, server keeps connection open, sends chunks until done.
3. The Anthropic SDK gives you an async iterator over typed events.
4. Tool call arguments stream too — JSON fragments concatenated.
5. `stream.finalMessage()` gives you the assembled message after streaming completes.

---

**Next:** [Lesson 2.3 — The Event Protocol](./03-the-event-protocol.md)
