# Lesson 2.1: LLM APIs 101

Before we build a transport layer, you need to know what we're transporting. This lesson covers how Anthropic's API works (and by extension, every other modern LLM API — they're 95% the same).

## The mental model

An LLM API call is a function:

```
generate(model_id, messages, tools?) → assistant_message
```

You send a list of messages. You get back a new assistant message. That message contains text, possibly tool calls, possibly thinking blocks.

The state lives entirely on your side. The API is stateless. **Every call sends the full conversation history.**

> 💡 **Wait, no caching?** Modern providers do cache the prefix of your request. Anthropic's prompt cache makes a request with mostly-identical history hugely cheaper. But conceptually, each call is self-contained — caching is just an optimization.

## The message shape

Here's a typical request body to Anthropic:

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 1024,
  "system": "You are a helpful assistant.",
  "messages": [
    { "role": "user", "content": "What's 2 + 2?" },
    { "role": "assistant", "content": "4" },
    { "role": "user", "content": "And 3 + 3?" }
  ]
}
```

Three things to note:

1. **System prompt is separate** from the messages array (Anthropic-style). OpenAI puts it as the first message. Most other providers do one or the other.
2. **Messages alternate user → assistant → user → assistant.** You can't have two user messages in a row (Anthropic enforces this; some providers tolerate it).
3. **The `assistant` messages are messages you sent in earlier calls.** You're feeding the LLM its own history.

## Content blocks

In simple cases, `content` is a string. In real cases, it's an **array of content blocks**:

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "What's in this image?" },
    { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } }
  ]
}
```

Block types:

- **`text`** — text content
- **`image`** — an image (base64 or URL)
- **`tool_use`** — assistant requesting a tool call (in assistant messages)
- **`tool_result`** — your response to a tool call (in user messages)
- **`thinking`** — extended thinking output (in assistant messages, for models that support it)

A single message can have multiple blocks. An assistant message can produce both text *and* a tool call:

```json
{
  "role": "assistant",
  "content": [
    { "type": "text", "text": "I'll check that for you." },
    { "type": "tool_use", "id": "toolu_123", "name": "read_file", "input": { "path": "x.txt" } }
  ]
}
```

The agent loop will see both: it shows the text to the user, then executes the tool call.

## Tool calls and tool results

When you send a `tool_use` from an assistant message, you must respond with a `tool_result` in the next user message:

```json
[
  { "role": "user", "content": "Read x.txt" },
  {
    "role": "assistant",
    "content": [
      { "type": "tool_use", "id": "toolu_123", "name": "read_file", "input": { "path": "x.txt" } }
    ]
  },
  {
    "role": "user",
    "content": [
      { "type": "tool_result", "tool_use_id": "toolu_123", "content": "Hello world" }
    ]
  }
]
```

Note:

- The `tool_result` goes in a **user** message (you, the harness, are responding).
- It's matched to the `tool_use` by ID.
- `content` is what the LLM "sees" — text or images.

If the assistant calls multiple tools in one turn, you must respond with all of them in the next user message.

## Defining tools

You declare available tools in the request:

```json
{
  "tools": [
    {
      "name": "read_file",
      "description": "Read the contents of a file from disk",
      "input_schema": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "Path to the file" }
        },
        "required": ["path"]
      }
    }
  ]
}
```

Three fields per tool:

- `name` — what the LLM uses to call it
- `description` — natural-language explanation of what it does
- `input_schema` — JSON Schema for the arguments

The LLM picks tools based on names, descriptions, and the schema. **Good descriptions are everything.** The model has no other source of truth about what your tool does.

## Stop reasons

Every assistant message has a `stop_reason`:

- **`end_turn`** — the model finished naturally; no more action
- **`tool_use`** — the model wants you to execute tool calls
- **`max_tokens`** — hit the output limit; response is truncated
- **`stop_sequence`** — hit a stop sequence you specified
- **`refusal`** — the model declined (newer Anthropic models)

Your agent loop branches on this:

```ts
if (response.stop_reason === "tool_use") {
  // execute tools, loop again
} else {
  // done, return to user
}
```

In practice, "is there a `tool_use` block in the content?" is equivalent and slightly more robust.

## Usage and cost

Every response includes usage:

```json
{
  "usage": {
    "input_tokens": 245,
    "output_tokens": 87,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  }
}
```

Multiply by the model's per-million-token cost to get the dollar amount. pi tracks this in real time and shows it in the footer.

## A complete example (non-streaming)

Here's a non-streaming call with all the pieces:

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 1024,
  system: "You are a helpful coding assistant.",
  tools: [
    {
      name: "read_file",
      description: "Read the contents of a file",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"],
      },
    },
  ],
  messages: [
    { role: "user", content: "What's in package.json?" },
  ],
});

console.log(response.stop_reason);  // "tool_use"
console.log(response.content);
// [
//   { type: "text", text: "I'll read package.json for you." },
//   { type: "tool_use", id: "toolu_...", name: "read_file", input: { path: "package.json" } }
// ]
```

To complete the loop:

1. Execute `read_file` with `path: "package.json"`
2. Build a `tool_result` user message
3. Call `messages.create` again with all of: original user msg, the assistant msg, the tool_result msg
4. The model returns text describing the file (no more `tool_use`)
5. Done

This is the agent loop you saw in Chapter 1, but now you can see it in actual API calls.

## Provider differences (briefly)

You'll work with Anthropic in this course, but here's how other providers differ:

- **OpenAI Chat Completions** — system prompt as first message; tool calls have a slightly different shape (`tool_calls` array on the message instead of `tool_use` content blocks)
- **OpenAI Responses API** — newer; closer to Anthropic's structure
- **Google Gemini** — different message structure entirely; uses `parts` and `functionCall`/`functionResponse`
- **OpenAI-compatible APIs** (Groq, xAI, Cerebras, OpenRouter, etc.) — all pretend to be OpenAI

This is why pi-ai has 15+ provider files. Each one translates to/from a normalized internal shape. **You don't have to support 15 providers.** You'll support 1 (Anthropic) in this course; adding more is a Chapter 10 exercise.

## Stop and try this

Run the example from your `mini-pi` project:

```ts
// src/app/main.ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 256,
  tools: [
    {
      name: "get_weather",
      description: "Get the weather in a location",
      input_schema: {
        type: "object",
        properties: { location: { type: "string" } },
        required: ["location"],
      },
    },
  ],
  messages: [
    { role: "user", content: "What's the weather in Paris?" },
  ],
});

console.log(JSON.stringify(response, null, 2));
```

Run it. You should see `stop_reason: "tool_use"` and a `tool_use` content block with `name: "get_weather"` and `input: { location: "Paris" }`.

Note: the LLM doesn't actually fetch weather. It produced a *request* to call your tool. **You** would execute the tool. The LLM is now waiting for the result.

That's the agent contract. Now you've seen it from the API side.

## Key takeaways

1. LLM APIs are stateless: you send full history each call.
2. Messages have `role` + `content`; `content` is an array of blocks (text, image, tool_use, tool_result, thinking).
3. `tool_use` blocks come from the model; `tool_result` blocks are your response.
4. `stop_reason: "tool_use"` means "execute tools, then call me again."
5. Provider APIs differ in shape, but the concepts are the same — that's why a normalized layer is valuable.

---

**Next:** [Lesson 2.2 — Streaming](./02-streaming.md)
