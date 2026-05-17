# Multi-Provider Support

Mini-pi only supports Anthropic. Real users want OpenAI, Google, local models, etc. This lesson covers how to add them without rewriting your agent.

## Why bother

Single-provider lock-in has costs:

- **Outages** — when Anthropic is down, your agent is down
- **Pricing** — OpenAI might be cheaper for some queries
- **Capabilities** — Google has the longest context; OpenAI has the cheapest tiers
- **Privacy** — local models (Ollama, vLLM) don't send data anywhere
- **User preference** — they have an OpenAI subscription, not Anthropic

Pi supports 15+ providers because users want them. You don't need to start with 15. But adding even one more (e.g., OpenAI) doubles your reach.

## The provider interface

Recall from Chapter 2 — all providers conform to one signature:

```ts
function streamProvider(
  model: Model,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream;
```

Same input, same output. The provider's job is to translate to/from its native format.

## Adding OpenAI

The same pattern as Anthropic:

```ts
// src/llm/openai.ts

import OpenAI from "openai";
import { EventStream } from "./event-stream.js";
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  StreamOptions,
} from "./types.js";

export function streamOpenAI(
  model: Model,
  context: Context,
  options: StreamOptions = {},
): AssistantMessageEventStream {
  const stream = new EventStream();
  void runOpenAIStream(model, context, options, stream).catch(err => {
    stream.push({ type: "error", reason: "error", error: makeErrorMessage(model, err) });
  });
  return stream;
}

async function runOpenAIStream(model, context, options, out) {
  const client = new OpenAI({ apiKey: options.apiKey });

  const partial: AssistantMessage = {
    role: "assistant",
    content: [],
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  out.push({ type: "start", partial: { ...partial } });

  const sdkStream = await client.chat.completions.create({
    model: model.id,
    messages: convertToOpenAIMessages(context),
    tools: convertToOpenAITools(context.tools),
    stream: true,
  }, { signal: options.signal });

  // OpenAI's stream uses different event names — translate
  for await (const chunk of sdkStream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) {
      // text delta
      // ... emit text_delta event
    }
    if (delta?.tool_calls) {
      // tool call delta
      // ... emit toolcall_delta event
    }
    if (chunk.choices[0]?.finish_reason) {
      // done
      out.push({ type: "done", reason: mapFinishReason(chunk.choices[0].finish_reason), message: { ...partial } });
      return;
    }
  }
}

function convertToOpenAIMessages(context: Context): any[] {
  // OpenAI: system message is first; tool results have "role: tool"
  const messages: any[] = [];
  if (context.systemPrompt) {
    messages.push({ role: "system", content: context.systemPrompt });
  }
  for (const m of context.messages) {
    if (m.role === "user") {
      messages.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      // OpenAI uses tool_calls field, not content blocks
      const text = m.content.filter(c => c.type === "text").map(c => c.text).join("");
      const toolCalls = m.content.filter(c => c.type === "toolCall").map(c => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.arguments) },
      }));
      messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls.length ? toolCalls : undefined });
    } else if (m.role === "toolResult") {
      messages.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content.map(c => c.type === "text" ? c.text : "").join(""),
      });
    }
  }
  return messages;
}

function convertToOpenAITools(tools: any[]): any[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function mapFinishReason(reason: string): "stop" | "length" | "toolUse" {
  if (reason === "tool_calls") return "toolUse";
  if (reason === "length") return "length";
  return "stop";
}
```

About the same length as the Anthropic version. The translation differs but the shape doesn't.

Then update your dispatcher:

```ts
// src/llm/stream.ts
import { streamAnthropic } from "./anthropic.js";
import { streamOpenAI } from "./openai.js";

export function stream(model: Model, context: Context, options?: StreamOptions) {
  if (model.provider === "anthropic") return streamAnthropic(model, context, options);
  if (model.provider === "openai") return streamOpenAI(model, context, options);
  throw new Error(`Unknown provider: ${model.provider}`);
}
```

That's adding a provider. **Nothing else in your agent changes.**

## Cross-provider message replay

Subtle issue: a conversation started with Anthropic might continue with OpenAI. The transcript has Anthropic-style messages (with thinking blocks). OpenAI doesn't accept thinking blocks.

Solutions:

### A. Provider-aware conversion

In your `convertToOpenAIMessages`, drop or transform thinking blocks:

```ts
const text = m.content
  .filter(c => c.type === "text")
  .map(c => c.text)
  .join("");
// thinking blocks ignored
```

This works but loses information. Pi's approach: convert thinking to text with `<thinking>` tags so the LLM still sees it as context:

```ts
const parts: string[] = [];
for (const block of m.content) {
  if (block.type === "text") parts.push(block.text);
  if (block.type === "thinking") parts.push(`<thinking>${block.thinking}</thinking>`);
}
const content = parts.join("\n");
```

The OpenAI model sees the previous reasoning and can continue. Quality slightly degraded but acceptable.

### B. Forbid cross-provider switching

Don't let users switch mid-conversation. Easier; less useful.

For mini-pi, A is the right call. It's where pi-ai's `transform-messages.ts` (`packages/ai/src/providers/transform-messages.ts`) shines.

## Provider registry

For more than two providers, a registry pattern scales better:

```ts
const providers = new Map<string, StreamFunction>();

export function registerProvider(name: string, fn: StreamFunction) {
  providers.set(name, fn);
}

export function stream(model: Model, context: Context, options?: StreamOptions) {
  const fn = providers.get(model.provider);
  if (!fn) throw new Error(`Unknown provider: ${model.provider}`);
  return fn(model, context, options);
}

// In init:
registerProvider("anthropic", streamAnthropic);
registerProvider("openai", streamOpenAI);
registerProvider("google", streamGoogle);
```

Pi takes this further with **lazy registration**: providers are imported on demand:

```ts
const lazyProviders = new Map<string, () => Promise<StreamFunction>>();

lazyProviders.set("anthropic", () => import("./anthropic.js").then(m => m.streamAnthropic));
lazyProviders.set("openai", () => import("./openai.js").then(m => m.streamOpenAI));

async function stream(model, context, options) {
  const loader = lazyProviders.get(model.provider);
  const fn = await loader();
  return fn(model, context, options);
}
```

The benefit: you don't pay startup cost for providers you never use. Pi loads providers only when their model is selected.

## OpenAI-compatible providers

A bonus: many providers implement the OpenAI API format. Adding them is trivial — they reuse `streamOpenAI` with a different `baseUrl`:

```ts
const ollamaModel: Model = {
  id: "llama-3.1-8b",
  provider: "ollama",
  baseUrl: "http://localhost:11434/v1",   // Ollama's OpenAI-compatible endpoint
  ...
};

// In streamOpenAI:
const client = new OpenAI({
  apiKey: options.apiKey ?? "ollama",
  baseURL: model.baseUrl,
});
```

Same provider implementation, different baseUrl. Now you support: Ollama, vLLM, Groq, xAI, OpenRouter, Cerebras, MiniMax, etc. All "free" once you have OpenAI working.

This is why pi has 15+ providers but only ~10 actual implementations — many providers reuse the same code with different URLs.

## Model catalogs

You also need a list of available models per provider:

```ts
const MODELS: Record<string, Model[]> = {
  anthropic: [
    { id: "claude-sonnet-4-5-20250929", contextWindow: 200_000, ... },
    { id: "claude-opus-4-5-20251015", contextWindow: 200_000, ... },
  ],
  openai: [
    { id: "gpt-4o", contextWindow: 128_000, ... },
    { id: "gpt-4o-mini", contextWindow: 128_000, ... },
  ],
};
```

For pi, this is auto-generated from `models.dev` (a community-maintained model catalog). For mini-pi, hardcoded is fine.

## Stop and try this

Add OpenAI to your mini-pi:

1. `npm install openai`
2. Write `src/llm/openai.ts` (smaller version of the above)
3. Update `src/llm/stream.ts` to dispatch by provider
4. Add `/model gpt-4o-mini` slash command

Run mini-pi. Switch providers mid-session:

```
> /model gpt-4o-mini
Model set to gpt-4o-mini
> read package.json
[GPT-4o-mini reads the file]
```

You just made your agent provider-agnostic. The agent loop didn't change.

## Key takeaways

1. New providers = new files in `llm/`. Same `stream()` interface.
2. The translation layer handles cross-provider differences (thinking blocks, message formats).
3. Provider registry pattern scales; lazy registration keeps startup fast.
4. OpenAI-compatible providers reuse the OpenAI implementation with different baseUrls.
5. Adding 1 provider = a few hundred lines. Once.

---

**Next:** [Lesson 10.2 — Other Run Modes](./02-other-run-modes.md)
