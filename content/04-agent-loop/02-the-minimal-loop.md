# The Minimal Loop

Time to build it. By the end of this lesson, your `mini-pi/src/agent/` folder will have a working agent loop you can run.

## What we're building

```
src/agent/
├── types.ts        ← Agent-specific types (events, tools)
├── loop.ts         ← The reactor itself
└── index.ts        ← Exports
```

We'll keep it small and clear. Production-grade additions (parallel tool execution, hooks, custom message types) come in Chapter 5.

## Step 1: Agent types

`src/agent/types.ts`:

```ts
import type { TextContent, ImageContent, Message, Model, Tool } from "../llm/types.js";

// ─── Tool result ──────────────────────────────────────────────────────

export interface ToolResult<T = unknown> {
  content: (TextContent | ImageContent)[];
  details?: T;
}

// ─── Tool definition (extends LLM Tool with execute) ──────────────────

export interface AgentTool<T = unknown> extends Tool {
  execute: (
    toolCallId: string,
    args: any,
    signal?: AbortSignal,
    onUpdate?: (partial: ToolResult<T>) => void,
  ) => Promise<ToolResult<T>>;
}

// ─── Agent context ────────────────────────────────────────────────────

export interface AgentContext {
  systemPrompt?: string;
  messages: Message[];
  tools: AgentTool[];
}

// ─── Agent events ─────────────────────────────────────────────────────

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: Message[] }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "message_start"; message: Message }
  | { type: "message_update"; message: Message }
  | { type: "message_end"; message: Message }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_update"; toolCallId: string; partial: ToolResult }
  | { type: "tool_end"; toolCallId: string; result: ToolResult; isError: boolean };
```

Compare to `packages/agent/src/types.ts:350` — pi has more event types (we'll add a few in Chapter 5) but the shape is identical.

## Step 2: The loop

`src/agent/loop.ts`:

```ts
import { stream } from "../llm/stream.js";
import type { AssistantMessage, Message, Model, ToolCall } from "../llm/types.js";
import type { AgentContext, AgentEvent, AgentTool, ToolResult } from "./types.js";

export interface RunAgentOptions {
  signal?: AbortSignal;
  model: Model;
  apiKey?: string;
  maxTokens?: number;
}

export type EventEmitter = (event: AgentEvent) => void | Promise<void>;

export async function runAgent(
  prompt: string | Message,
  context: AgentContext,
  options: RunAgentOptions,
  emit: EventEmitter,
): Promise<void> {
  // Convert string prompt to a user message
  const userMessage: Message =
    typeof prompt === "string"
      ? { role: "user", content: prompt, timestamp: Date.now() }
      : prompt;

  // Append the user message
  context.messages.push(userMessage);
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: userMessage });
  await emit({ type: "message_end", message: userMessage });

  while (true) {
    await emit({ type: "turn_start" });

    if (options.signal?.aborted) {
      await emit({ type: "agent_end", messages: context.messages });
      return;
    }

    // ─── 1. STREAM ASSISTANT RESPONSE ──────────────────────────────
    const assistantMessage = await streamOneTurn(context, options, emit);
    context.messages.push(assistantMessage);

    if (assistantMessage.stopReason === "error" || assistantMessage.stopReason === "aborted") {
      await emit({ type: "turn_end" });
      await emit({ type: "agent_end", messages: context.messages });
      return;
    }

    // ─── 2. COLLECT TOOL CALLS ─────────────────────────────────────
    const toolCalls = assistantMessage.content.filter(
      (c): c is ToolCall => c.type === "toolCall"
    );

    if (toolCalls.length === 0) {
      await emit({ type: "turn_end" });
      break;
    }

    // ─── 3. EXECUTE TOOLS SEQUENTIALLY ─────────────────────────────
    for (const call of toolCalls) {
      const tool = context.tools.find(t => t.name === call.name);

      if (!tool) {
        const errorResult: ToolResult = {
          content: [{ type: "text", text: `Tool not found: ${call.name}` }],
        };
        await emitToolResult(call, errorResult, true, context, emit);
        continue;
      }

      await emit({ type: "tool_start", toolCallId: call.id, toolName: call.name, args: call.arguments });

      let result: ToolResult;
      let isError = false;
      try {
        result = await tool.execute(
          call.id,
          call.arguments,
          options.signal,
          (partial) => emit({ type: "tool_update", toolCallId: call.id, partial }),
        );
      } catch (err: any) {
        result = { content: [{ type: "text", text: err?.message ?? String(err) }] };
        isError = true;
      }

      await emit({ type: "tool_end", toolCallId: call.id, result, isError });
      await emitToolResult(call, result, isError, context, emit);
    }

    await emit({ type: "turn_end" });
    // loop continues
  }

  await emit({ type: "agent_end", messages: context.messages });
}

async function streamOneTurn(
  context: AgentContext,
  options: RunAgentOptions,
  emit: EventEmitter,
): Promise<AssistantMessage> {
  const llmStream = stream(
    options.model,
    {
      systemPrompt: context.systemPrompt,
      messages: context.messages,
      tools: context.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
    {
      apiKey: options.apiKey,
      signal: options.signal,
      maxTokens: options.maxTokens,
    },
  );

  let started = false;

  for await (const event of llmStream) {
    if (event.type === "start") {
      await emit({ type: "message_start", message: event.partial });
      started = true;
    } else if (
      event.type === "text_delta" ||
      event.type === "thinking_delta" ||
      event.type === "toolcall_delta" ||
      event.type === "text_end" ||
      event.type === "thinking_end" ||
      event.type === "toolcall_end"
    ) {
      await emit({ type: "message_update", message: event.partial });
    } else if (event.type === "done" || event.type === "error") {
      const finalMessage = event.type === "done" ? event.message : event.error;
      if (!started) {
        await emit({ type: "message_start", message: finalMessage });
      }
      await emit({ type: "message_end", message: finalMessage });
      return finalMessage;
    }
  }

  // Should not reach here
  return await llmStream.result();
}

async function emitToolResult(
  call: ToolCall,
  result: ToolResult,
  isError: boolean,
  context: AgentContext,
  emit: EventEmitter,
): Promise<void> {
  const message: Message = {
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content: result.content,
    isError,
    timestamp: Date.now(),
  };
  context.messages.push(message);
  await emit({ type: "message_start", message });
  await emit({ type: "message_end", message });
}
```

Read this slowly. It's longer than the pseudocode from Lesson 4.1 because it handles real things: tool not found, tool throws, error stop reasons, message_start/end emission for assistant streams.

But the **shape** is exactly what we drew:

```
push user msg → emit start
loop:
  emit turn_start
  stream from LLM → emit message_start/update/end
  if stop_reason error/aborted: emit agent_end, return
  if no tool calls: emit turn_end, break
  for each tool call:
    emit tool_start
    execute (catch errors)
    emit tool_end
    push tool result message → emit message_start/end
  emit turn_end
emit agent_end
```

That's the reactor. Pure shape, plus event emissions.

## Step 3: The exports

`src/agent/index.ts`:

```ts
export * from "./types.js";
export * from "./loop.js";
```

## Step 4: Run it

`src/app/main.ts`:

```ts
import { runAgent } from "../agent/loop.js";
import type { AgentTool } from "../agent/types.js";
import type { Model } from "../llm/types.js";
import * as fs from "node:fs/promises";

const claude: Model = {
  id: "claude-sonnet-4-5-20250929",
  provider: "anthropic",
  contextWindow: 200_000,
  costPerInputToken: 3 / 1_000_000,
  costPerOutputToken: 15 / 1_000_000,
};

const readTool: AgentTool = {
  name: "read",
  description: "Read a file from disk",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path" },
    },
    required: ["path"],
  },
  async execute(_id, args: { path: string }) {
    const content = await fs.readFile(args.path, "utf-8");
    return {
      content: [{ type: "text", text: content }],
      details: { path: args.path },
    };
  },
};

const context = {
  systemPrompt: "You are a coding assistant. Use the read tool to inspect files when asked.",
  messages: [],
  tools: [readTool],
};

await runAgent(
  "Read the file package.json and tell me what scripts are defined.",
  context,
  { model: claude },
  (event) => {
    if (event.type === "message_update") {
      const last = event.message;
      if (last.role === "assistant") {
        const text = last.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
        process.stdout.write(`\r${text}`);
      }
    } else if (event.type === "tool_start") {
      console.log(`\n\n→ ${event.toolName}(${JSON.stringify(event.args)})`);
    } else if (event.type === "tool_end") {
      console.log(`← (${event.isError ? "ERROR" : "OK"})`);
    }
  },
);

console.log("\n\n--- DONE ---");
```

Run with `npm start`. You should see:

```
[Streaming text from Claude]

→ read({"path":"package.json"})
← (OK)

[Final response from Claude listing the scripts]

--- DONE ---
```

**You just built a working agent.** Take a moment to appreciate that.

## What just happened

The agent did:

1. Got your prompt
2. Asked Claude — Claude said "I'll read package.json"
3. Called your `read` tool
4. Sent the result back to Claude
5. Claude produced a natural-language summary
6. Returned to you

The whole thing in ~150 lines of code (transport from Chapter 2 + this loop).

## What's missing

Important things the minimal loop doesn't do yet (Chapter 5 covers them):

- **Tool argument validation** with TypeBox before executing
- **Parallel tool execution** when multiple tools are called in one turn
- **Hooks** like `beforeToolCall` for permission gates
- **Steering messages** — letting the user inject mid-loop
- **Custom message types** — UI-only messages stored in context
- **Better abort** — currently we only check at iteration boundaries

But the foundation is here. Everything in Chapter 5 is additive.

## Compare to pi

Open `packages/agent/src/agent-loop.ts:155` — the `runLoop` function in pi. Compare to your `runAgent`:

- Same overall structure (push prompt → outer loop → inner loop → exit on no tool calls)
- pi has nested loops because of steering/follow-up queues (Chapter 5 adds these to yours)
- pi separates `streamAssistantResponse` (line 240) and `executeToolCalls` (line 338) — your version inlines them
- pi has more event types and richer error handling

But the spine is the same. **You can read pi's `runLoop` now and understand it.**

## Stop and try this

Modify the example to define a *second* tool — say, `list_dir`:

```ts
const lsTool: AgentTool = {
  name: "list_dir",
  description: "List files in a directory",
  parameters: {
    type: "object",
    properties: { dir: { type: "string", description: "Directory path" } },
    required: ["dir"],
  },
  async execute(_id, args: { dir: string }) {
    const entries = await fs.readdir(args.dir);
    return {
      content: [{ type: "text", text: entries.join("\n") }],
      details: { dir: args.dir, count: entries.length },
    };
  },
};

context.tools = [readTool, lsTool];
```

Then ask the agent: "List the files in `src/` and read each one."

Watch the trace: the agent might call `list_dir` first, then call `read` once per file. Multi-turn, multi-tool, automatic. **That's the loop.**

## Key takeaways

1. The minimal agent loop is ~120 lines. Most of it is event emission.
2. The shape: push user msg → loop {LLM call → if tool calls: execute, push results → repeat}.
3. Errors in tools are caught, converted to error tool results, the LLM sees them.
4. Streaming events propagate via `emit`; the consumer renders.
5. You now have a **working agent** built from scratch with no framework. Go you.

---

**Next:** [Lesson 4.3 — Events and Subscription](./03-events-and-subscription.md)
