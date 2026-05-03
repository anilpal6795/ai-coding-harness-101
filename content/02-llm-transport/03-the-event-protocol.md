# Lesson 2.3: The Event Protocol

You've seen Anthropic's raw events. Now we design our own. This is the most important design decision in the transport layer.

## Why a normalized event protocol?

The raw Anthropic SDK gives you Anthropic-specific events. If you were to build your agent loop directly on those events:

```ts
// BAD: agent loop directly on Anthropic types
for await (const event of anthropicStream) {
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    // ...
  }
}
```

You're now coupled to Anthropic forever. The day you want to support OpenAI:

- OpenAI events are completely differently shaped
- Tool call args stream differently
- Thinking is signaled differently
- Content block indices work differently

You'd rewrite the agent loop. Or build a translation layer. The translation layer is what we're building now — but **before** the agent loop, not after.

## The design

We define a single event type that every provider normalizes to:

```ts
export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };
```

This is from `packages/ai/src/types.ts:259`. Read it carefully.

The pattern: for each kind of content (text, thinking, toolcall), we have `start → delta(s) → end` events. The whole stream begins with `start` and ends with either `done` or `error`.

## Why this exact shape?

### Why `start` / `delta` / `end` per content block?

A consumer typically wants to:

- Allocate UI on `*_start`
- Update UI on `*_delta`
- Finalize/lock UI on `*_end`

Having explicit start/end markers means you don't have to infer "is this a new block?" from comparing indices.

### Why `partial` on every event?

Every event includes a snapshot of the assistant message *as it is right now*. So a UI can do:

```ts
case "text_delta":
  this.lastMessage = event.partial;  // always current
  this.invalidate();
```

You always have a complete picture — never a partial one you have to assemble yourself. This is crucial for live UI updates.

### Why `contentIndex`?

A single message can have multiple content blocks (text, then tool call, then more text). The `contentIndex` tells you *which* block this delta belongs to. If you're rendering each block as a separate UI element, the index is your handle.

### Why separate `toolcall_*` events?

Tool calls behave differently from text:

- They have an ID and name set when they start
- The arguments stream as JSON fragments
- The completed args (`toolCall` field on `toolcall_end`) are validated and parsed

By giving them their own event type, the consumer can do tool-specific UI (a "tool card" component) cleanly.

### Why `done` vs `error`?

Two terminal events instead of one with a status field. Reason:

- `done` carries the successful final message
- `error` carries the partial message + error info

Switching on event type is cleaner than checking a status field.

> 💡 **Sidebar:** pi-ai's `error` event uses `reason: "aborted" | "error"` instead of just `"error"`. The distinction matters because UIs treat aborts differently from real errors (silent vs scary).

## The full data model

The events above reference `AssistantMessage`, `ToolCall`, etc. Here are the data types they assume. From `packages/ai/src/types.ts`:

```ts
export interface TextContent {
  type: "text";
  text: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ImageContent {
  type: "image";
  data: string;            // base64
  mimeType: string;
}

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: string;          // which API family
  provider: string;     // which provider
  model: string;        // which model
  usage: Usage;
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
  errorMessage?: string;
  timestamp: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
  timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface Tool {
  name: string;
  description: string;
  parameters: any;       // JSON schema
}

export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}
```

Read this carefully. **This is the entire data model your agent will use.** Almost everything else in the course is built on these types.

A few things that may surprise you:

- `tool_result` is its own message role, not a content block in a user message. (Anthropic's API uses content blocks; we normalize.)
- Assistant messages have `api`, `provider`, `model` fields — useful when replaying conversations across providers.
- Every message has a `timestamp` — useful for session files and analytics.

## The public stream signature

Putting it together, our transport layer exposes:

```ts
export function stream(
  model: Model,
  context: Context,
  options?: StreamOptions,
): AsyncIterable<AssistantMessageEvent> & {
  result(): Promise<AssistantMessage>;
};
```

You call `stream()`, you get back something you can `for await` over (events) AND call `.result()` on (the final message). Both work — they're the same stream, just two views.

In pi-ai this is implemented via an `EventStream` class. We'll build a simpler version in the next lesson.

## Cross-provider compatibility

Here's the key win of the normalized protocol: **all your downstream code is provider-agnostic.**

```ts
// Works with Anthropic
const stream1 = stream(getModel("anthropic", "claude-sonnet-4"), context);

// Works with OpenAI
const stream2 = stream(getModel("openai", "gpt-4o"), context);

// Same event types come out either way
for await (const event of stream1) { ... }
for await (const event of stream2) { ... }
```

The agent loop, the UI, the session persister — none of them care which provider you used.

This is also how pi-ai supports cross-provider conversation handoffs (Chapter 10) — start a conversation with Claude, switch to GPT, the agent loop doesn't notice.

## Stop and try this

Look at `packages/ai/src/types.ts:259-271` — the `AssistantMessageEvent` definition.

Then look at `packages/ai/src/providers/anthropic.ts` — find where it emits each event type. (Hint: search for `text_delta`, `toolcall_end`, etc.)

You'll see the pattern: the Anthropic provider listens to Anthropic SDK events and emits normalized events. That's all a provider does.

## Key takeaways

1. Define your own normalized event protocol, not the provider's.
2. The shape is `start → delta(s) → end` per content block, terminating in `done` or `error`.
3. Every event carries the full `partial` message so UIs always have current state.
4. Separate event types for text, thinking, toolcall — each has its own UI lifecycle.
5. The protocol decouples your agent from any specific provider — you can swap or add providers without rewriting the loop.

---

**Next:** [Lesson 2.4 — Building the Transport](./04-building-the-transport.md)
