# Building the Transport

Time to write code. By the end of this lesson, your `mini-pi/src/llm/` folder will have a working streaming client that emits the normalized events from Lesson 2.3.

## What we're building

```
src/llm/
├── types.ts        ← All the data types and event types
├── stream.ts       ← The public stream() function
└── anthropic.ts    ← The Anthropic implementation
```

## Step 1: Define the types

`src/llm/types.ts`:

```ts
export interface TextContent {
  type: "text";
  text: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  model: string;
  usage: Usage;
  stopReason: StopReason;
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
  parameters: Record<string, any>;  // JSON schema
}

export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

export interface Model {
  id: string;
  provider: "anthropic";  // we'll add more later
  contextWindow: number;
  costPerInputToken: number;
  costPerOutputToken: number;
}

export interface StreamOptions {
  apiKey?: string;
  signal?: AbortSignal;
  maxTokens?: number;
}

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
  | { type: "done"; reason: Exclude<StopReason, "error" | "aborted">; message: AssistantMessage }
  | { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };

export interface AssistantMessageEventStream extends AsyncIterable<AssistantMessageEvent> {
  result(): Promise<AssistantMessage>;
}
```

**This is your transport contract.** Everything else builds on these types.

## Step 2: A minimal EventStream implementation

We need a class that lets us:

- `push(event)` to add events from the producer
- `for await` to consume events on the consumer side
- `result()` to await the final message

`src/llm/event-stream.ts`:

```ts
import type { AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream } from "./types.js";

export class EventStream implements AssistantMessageEventStream {
  private events: AssistantMessageEvent[] = [];
  private waiters: Array<(value: IteratorResult<AssistantMessageEvent>) => void> = [];
  private done = false;
  private finalMessage?: AssistantMessage;
  private resultResolvers: Array<(msg: AssistantMessage) => void> = [];

  push(event: AssistantMessageEvent): void {
    if (event.type === "done") {
      this.finalMessage = event.message;
    } else if (event.type === "error") {
      this.finalMessage = event.error;
    }

    this.events.push(event);
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: this.events.shift()!, done: false });
    }

    if (event.type === "done" || event.type === "error") {
      this.end();
    }
  }

  end(): void {
    this.done = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      const next = this.events.shift();
      waiter(next ? { value: next, done: false } : { value: undefined as any, done: true });
    }
    if (this.finalMessage) {
      for (const resolve of this.resultResolvers) {
        resolve(this.finalMessage);
      }
      this.resultResolvers = [];
    }
  }

  result(): Promise<AssistantMessage> {
    if (this.finalMessage) return Promise.resolve(this.finalMessage);
    return new Promise(resolve => {
      this.resultResolvers.push(resolve);
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    return {
      next: (): Promise<IteratorResult<AssistantMessageEvent>> => {
        if (this.events.length > 0) {
          return Promise.resolve({ value: this.events.shift()!, done: false });
        }
        if (this.done) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise(resolve => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}
```

This is a basic single-consumer queue with promise-based backpressure. Production code (see `packages/ai/src/utils/event-stream.ts`) is more sophisticated — handles errors better, supports multiple iterators, etc. — but this works.

## Step 3: The Anthropic provider

`src/llm/anthropic.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { EventStream } from "./event-stream.js";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  StopReason,
  StreamOptions,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "./types.js";

export function streamAnthropic(
  model: Model,
  context: Context,
  options: StreamOptions = {},
): AssistantMessageEventStream {
  const stream = new EventStream();
  void runAnthropicStream(model, context, options, stream).catch(err => {
    // Catch-all so unhandled rejections don't crash
    stream.push({
      type: "error",
      reason: "error",
      error: makeErrorMessage(model, err),
    });
  });
  return stream;
}

async function runAnthropicStream(
  model: Model,
  context: Context,
  options: StreamOptions,
  out: EventStream,
): Promise<void> {
  const client = new Anthropic({ apiKey: options.apiKey });

  const partial: AssistantMessage = {
    role: "assistant",
    content: [],
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  out.push({ type: "start", partial: { ...partial } });

  // Track partial JSON for tool calls
  const toolCallJsonBuffers: Map<number, string> = new Map();

  try {
    const sdkStream = client.messages.stream({
      model: model.id,
      max_tokens: options.maxTokens ?? 4096,
      system: context.systemPrompt,
      messages: convertMessages(context.messages),
      tools: convertTools(context.tools),
    }, { signal: options.signal });

    for await (const event of sdkStream) {
      switch (event.type) {
        case "content_block_start": {
          const idx = event.index;
          const block = event.content_block;

          if (block.type === "text") {
            partial.content[idx] = { type: "text", text: "" } satisfies TextContent;
            out.push({ type: "text_start", contentIndex: idx, partial: { ...partial } });
          } else if (block.type === "tool_use") {
            partial.content[idx] = {
              type: "toolCall",
              id: block.id,
              name: block.name,
              arguments: {},
            } satisfies ToolCall;
            toolCallJsonBuffers.set(idx, "");
            out.push({ type: "toolcall_start", contentIndex: idx, partial: { ...partial } });
          } else if (block.type === "thinking") {
            partial.content[idx] = { type: "thinking", thinking: "" } satisfies ThinkingContent;
            out.push({ type: "thinking_start", contentIndex: idx, partial: { ...partial } });
          }
          break;
        }

        case "content_block_delta": {
          const idx = event.index;
          const delta = event.delta;

          if (delta.type === "text_delta") {
            const block = partial.content[idx] as TextContent;
            block.text += delta.text;
            out.push({
              type: "text_delta",
              contentIndex: idx,
              delta: delta.text,
              partial: { ...partial },
            });
          } else if (delta.type === "thinking_delta") {
            const block = partial.content[idx] as ThinkingContent;
            block.thinking += delta.thinking;
            out.push({
              type: "thinking_delta",
              contentIndex: idx,
              delta: delta.thinking,
              partial: { ...partial },
            });
          } else if (delta.type === "input_json_delta") {
            const buffer = (toolCallJsonBuffers.get(idx) ?? "") + delta.partial_json;
            toolCallJsonBuffers.set(idx, buffer);

            // Best-effort partial parse for live UI updates
            const block = partial.content[idx] as ToolCall;
            try {
              block.arguments = JSON.parse(buffer);
            } catch {
              // Not valid yet, keep accumulating
            }

            out.push({
              type: "toolcall_delta",
              contentIndex: idx,
              delta: delta.partial_json,
              partial: { ...partial },
            });
          }
          break;
        }

        case "content_block_stop": {
          const idx = event.index;
          const block = partial.content[idx];

          if (block.type === "text") {
            out.push({
              type: "text_end",
              contentIndex: idx,
              content: block.text,
              partial: { ...partial },
            });
          } else if (block.type === "thinking") {
            out.push({
              type: "thinking_end",
              contentIndex: idx,
              content: block.thinking,
              partial: { ...partial },
            });
          } else if (block.type === "toolCall") {
            // Final parse
            const buffer = toolCallJsonBuffers.get(idx) ?? "{}";
            try {
              block.arguments = JSON.parse(buffer);
            } catch (e) {
              block.arguments = {};
            }
            out.push({
              type: "toolcall_end",
              contentIndex: idx,
              toolCall: block,
              partial: { ...partial },
            });
          }
          break;
        }

        case "message_delta": {
          if (event.delta.stop_reason) {
            partial.stopReason = mapStopReason(event.delta.stop_reason);
          }
          if (event.usage) {
            partial.usage.output = event.usage.output_tokens ?? partial.usage.output;
          }
          break;
        }

        case "message_start": {
          if (event.message.usage) {
            partial.usage.input = event.message.usage.input_tokens;
            partial.usage.cacheRead = event.message.usage.cache_read_input_tokens ?? 0;
            partial.usage.cacheWrite = event.message.usage.cache_creation_input_tokens ?? 0;
          }
          break;
        }

        case "message_stop": {
          partial.usage.cost = computeCost(model, partial.usage);
          out.push({
            type: "done",
            reason: partial.stopReason as "stop" | "length" | "toolUse",
            message: { ...partial },
          });
          return;
        }
      }
    }
  } catch (err: any) {
    const reason: "aborted" | "error" = err?.name === "AbortError" ? "aborted" : "error";
    partial.stopReason = reason;
    partial.errorMessage = err?.message ?? String(err);
    out.push({ type: "error", reason, error: { ...partial } });
  }
}

function convertMessages(messages: any[]): any[] {
  // Simplified: in real code, handle all the conversions
  return messages.map((m: any) => {
    if (m.role === "user") return { role: "user", content: m.content };
    if (m.role === "assistant") return { role: "assistant", content: m.content };
    if (m.role === "toolResult") {
      return {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: m.toolCallId,
          content: m.content.map((c: any) => c.type === "text" ? c.text : ""),
          is_error: m.isError,
        }],
      };
    }
    return m;
  });
}

function convertTools(tools?: any[]): any[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

function mapStopReason(reason: string): StopReason {
  if (reason === "end_turn") return "stop";
  if (reason === "tool_use") return "toolUse";
  if (reason === "max_tokens") return "length";
  return "stop";
}

function computeCost(model: Model, usage: any): number {
  return (
    (usage.input * model.costPerInputToken) +
    (usage.output * model.costPerOutputToken)
  );
}

function makeErrorMessage(model: Model, err: any): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    stopReason: "error",
    errorMessage: err?.message ?? String(err),
    timestamp: Date.now(),
  };
}
```

This is more code than I usually like in a lesson, but it's *the* code that ties everything together. Read it carefully. Notice:

- Producer/consumer split: the SDK loop runs in its own async function and pushes events into the `EventStream`.
- Partial reuse: we keep a single `partial` object and mutate it as deltas arrive, then spread `{ ...partial }` into events.
- Error handling: any throw becomes an `error` event with a synthetic AssistantMessage.

## Step 4: The public stream() function

`src/llm/stream.ts`:

```ts
import { streamAnthropic } from "./anthropic.js";
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  StreamOptions,
} from "./types.js";

export function stream(
  model: Model,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  if (model.provider === "anthropic") {
    return streamAnthropic(model, context, options);
  }
  throw new Error(`Unknown provider: ${model.provider}`);
}

export async function complete(
  model: Model,
  context: Context,
  options?: StreamOptions,
): Promise<AssistantMessage> {
  const s = stream(model, context, options);
  for await (const _ of s) {
    /* drain */
  }
  return s.result();
}
```

That's the whole public surface. `stream()` for streaming, `complete()` for "wait for the whole thing."

## Step 5: Try it out

`src/app/main.ts`:

```ts
import { stream } from "../llm/stream.js";
import type { Model } from "../llm/types.js";

const claude: Model = {
  id: "claude-sonnet-4-5-20250929",
  provider: "anthropic",
  contextWindow: 200_000,
  costPerInputToken: 3 / 1_000_000,
  costPerOutputToken: 15 / 1_000_000,
};

const s = stream(claude, {
  systemPrompt: "You are a coding assistant.",
  messages: [{ role: "user", content: "What's 2+2? Answer in one sentence.", timestamp: Date.now() }],
});

for await (const event of s) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  } else if (event.type === "done") {
    console.log(`\n\n[Done. ${event.message.usage.output} output tokens]`);
  }
}
```

Run with `npm start`. You should see Claude's answer streaming character by character.

## What you've built

You now have a **provider-agnostic streaming LLM transport**. Same interface as pi-ai's `stream()`. Same event protocol. Different in ways that don't matter yet (no thinking, no caching, no multi-provider, no OAuth).

This is enough to build the agent loop on top of. You'll do that in Chapter 4.

## What's missing (for later)

- **Multi-provider** — currently only Anthropic. Chapter 10.
- **Cross-provider message format conversion** — Anthropic vs OpenAI message shapes differ. Out of scope for mini-pi.
- **Prompt caching** — pi-ai sets `cache_control` markers on system prompt and last user message. Big cost saver. Worth adding once you have the basics working.
- **OAuth** — supporting Claude Pro / GitHub Copilot subscriptions. Skip for mini-pi.
- **Better error handling** — retries with backoff, distinguishing rate limit from network error. Add as needed.

## Compare to pi-ai

- Your `types.ts` ↔ `packages/ai/src/types.ts` (much shorter; pi has 15+ providers worth of types)
- Your `event-stream.ts` ↔ `packages/ai/src/utils/event-stream.ts` (similar shape)
- Your `anthropic.ts` ↔ `packages/ai/src/providers/anthropic.ts` (~500 lines vs your ~150 — extra is caching, OAuth, beta features)
- Your `stream.ts` ↔ `packages/ai/src/stream.ts` (very similar, just lookup is harder with many providers)

Open these files side by side. Notice how much of pi-ai is exactly what you wrote, with more features.

## Stop and try this

Modify the example to call a tool:

```ts
const s = stream(claude, {
  systemPrompt: "You are a coding assistant.",
  messages: [{ role: "user", content: "What's the weather in Paris?", timestamp: Date.now() }],
  tools: [{
    name: "get_weather",
    description: "Get current weather",
    parameters: {
      type: "object",
      properties: { location: { type: "string" } },
      required: ["location"],
    },
  }],
});

for await (const event of s) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
  if (event.type === "toolcall_end") {
    console.log("\n\nTool call:", event.toolCall.name, event.toolCall.arguments);
  }
  if (event.type === "done") console.log("\n[Done]");
}
```

Run it. You should see a `tool_call` event with `name: "get_weather"` and `arguments: { location: "Paris" }`. Notice we're not actually executing the tool — that's the agent loop's job (Chapter 4).

## Key takeaways

1. Transport layer = a `stream()` function that returns normalized events.
2. EventStream class: producer pushes, consumer pulls, both async.
3. Provider implementation = one async function that translates SDK events → normalized events.
4. The same shape works for any provider; you swap the file under `providers/`, not the agent.
5. Your transport is now ~250 lines and handles all of: text, thinking, tool calls, partial JSON, abort, errors. Compare that to a framework.

---

**Next:** [Chapter 3 — Tools: Defining and Executing](../03-tools/)
