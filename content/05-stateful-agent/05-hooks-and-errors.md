# Lesson 5.5: Hooks and Error Handling

The final pieces: hooks for intercepting tool calls, and proper error handling for everything that can go wrong.

## Hooks: where to intervene

Two natural injection points around tool execution:

- **`beforeToolCall`** — runs after argument validation, before `tool.execute`. Can block.
- **`afterToolCall`** — runs after `tool.execute`, before the result is committed. Can rewrite.

In code:

```ts
const config: AgentLoopConfig = {
  beforeToolCall: async ({ toolCall, args, context }) => {
    // Permission check, logging, redirect, etc.
    if (toolCall.name === "bash" && args.command.startsWith("rm ")) {
      return { block: true, reason: "Destructive command blocked." };
    }
    return undefined;  // allow
  },

  afterToolCall: async ({ toolCall, result, isError, context }) => {
    // Log, redact, augment
    if (toolCall.name === "read" && !isError) {
      const augmented = `${result.content[0].text}\n[Read at ${new Date().toISOString()}]`;
      return { content: [{ type: "text", text: augmented }] };
    }
    return undefined;  // unchanged
  },
};
```

## Why hooks vs events?

Events are read-only. Hooks can change behavior.

If you want to **observe** a tool call (e.g., log it), use the `tool_start` / `tool_end` events.

If you want to **block** or **modify** it, use hooks.

The distinction matters because:

- Events fan out to many subscribers
- Hooks are single-source decisions (one function returns one verdict)
- Events are async fire-and-forget; hooks are awaited and can change state

## What `beforeToolCall` is good for

- **Permission gates**: prompt the user before destructive operations
- **Path protection**: block writes outside cwd
- **Quotas**: refuse if you've hit a tool-call budget
- **Routing**: send certain tools to a sandbox
- **Rate limiting**: throttle expensive tools

Example: a permission prompt:

```ts
beforeToolCall: async ({ toolCall, args }) => {
  if (toolCall.name === "bash") {
    const ok = await ui.askPermission(`Run: ${args.command}?`);
    if (!ok) return { block: true, reason: "Denied by user" };
  }
}
```

The agent loop sees `block: true`, builds an error tool result with the reason, sends it to the LLM. The model adapts ("the user denied that, I should ask differently").

## What `afterToolCall` is good for

- **Redaction**: strip secrets from output
- **Compression**: summarize long output
- **Augmentation**: add metadata
- **Audit logging**: record actual results
- **Result rewriting**: change the LLM's view of what happened

Example: redaction:

```ts
afterToolCall: async ({ toolCall, result, isError }) => {
  if (toolCall.name === "bash" && !isError) {
    const text = result.content[0].text;
    const redacted = text.replace(/sk-[a-zA-Z0-9]+/g, "<API_KEY>");
    return { content: [{ type: "text", text: redacted }] };
  }
}
```

## Adding hooks to your agent loop

Two changes to your loop:

```ts
async function runAgent(prompt, context, options, emit) {
  // ...

  for (const call of toolCalls) {
    const tool = context.tools.find(t => t.name === call.name);
    if (!tool) { /* error result */; continue; }

    // Validate args (skipping detail)
    const validatedArgs = call.arguments;

    // ─── beforeToolCall hook ────────────────────────────────
    if (options.beforeToolCall) {
      const decision = await options.beforeToolCall({
        toolCall: call,
        args: validatedArgs,
        context,
      });
      if (decision?.block) {
        const errorResult = {
          content: [{ type: "text", text: decision.reason ?? "Tool blocked" }],
        };
        await emitToolResult(call, errorResult, true, context, emit);
        continue;
      }
    }

    // Execute
    let result, isError = false;
    try {
      result = await tool.execute(call.id, validatedArgs, options.signal);
    } catch (err: any) {
      result = { content: [{ type: "text", text: err.message }] };
      isError = true;
    }

    // ─── afterToolCall hook ─────────────────────────────────
    if (options.afterToolCall) {
      const overrides = await options.afterToolCall({
        toolCall: call,
        args: validatedArgs,
        result,
        isError,
        context,
      });
      if (overrides) {
        result = {
          content: overrides.content ?? result.content,
          details: overrides.details ?? result.details,
        };
        if (overrides.isError !== undefined) isError = overrides.isError;
      }
    }

    await emit({ type: "tool_end", toolCallId: call.id, result, isError });
    await emitToolResult(call, result, isError, context, emit);
  }
}
```

About 10 extra lines. Now your agent supports permission gates, redaction, audit, anything.

## Error handling: the layers

Errors can happen at every level. Each needs different handling:

### 1. Tool errors

Tool throws an `Error`. The loop catches it, builds an error tool result, sends to LLM. The LLM adapts.

```ts
try {
  result = await tool.execute(...);
} catch (err: any) {
  result = { content: [{ type: "text", text: err.message }] };
  isError = true;
}
```

This is the most common error path. **Always recoverable** — the LLM sees the error and tries again.

### 2. Validation errors

Args don't match schema. Caught before execute. Same resolution: error result → LLM.

```ts
if (!Value.Check(tool.parameters, call.arguments)) {
  const errors = [...Value.Errors(tool.parameters, call.arguments)];
  const reason = errors[0]?.message ?? "Invalid arguments";
  await emitErrorResult(call, reason);
  continue;
}
```

### 3. LLM stream errors

Network failure, rate limit, malformed response. The provider emits `error` event with `reason: "error"`.

The loop pushes the partial assistant message (with `stopReason: "error"`) and **exits** — the user can `continue()` to retry, or send a different prompt.

This is **not recoverable automatically**. The user has to decide.

```ts
if (assistantMessage.stopReason === "error") {
  await emit({ type: "agent_end", messages: context.messages });
  return;
}
```

### 4. Aborts

Already covered in Lesson 5.3. Same as errors but `reason: "aborted"`. UI shows quietly.

### 5. Hook errors

If `beforeToolCall` or `afterToolCall` throws, what happens?

Pi treats hook errors as tool errors:

```ts
let decision;
try {
  decision = await options.beforeToolCall({...});
} catch (err) {
  // Treat as block with the error message
  await emitErrorResult(call, `beforeToolCall hook threw: ${err.message}`);
  continue;
}
```

Some implementations crash the loop. Pi opts for graceful degradation: the LLM sees the error and continues.

### 6. Listener errors

Listeners shouldn't throw. If they do, you have a few options:

- **Log and continue** (pi does this) — listeners are observation; their failures shouldn't break the agent
- **Crash** — fail loud, find the bug

Pi catches listener throws inside `emit`:

```ts
for (const listener of this.listeners) {
  try {
    await listener(event, signal);
  } catch (err) {
    console.error("Listener error:", err);
  }
}
```

## The "continue" method for retries

Pi's `Agent` has `continue()`:

```ts
async continue(): Promise<void> {
  const last = this._messages[this._messages.length - 1];
  if (!last || last.role === "assistant") {
    throw new Error("Cannot continue from this state");
  }
  // Run the loop without adding a new prompt
}
```

When does the user use this?

- After a network error: retry the last LLM call
- After a tool error: maybe the tool will work this time
- After an abort: pick up from where you stopped

The agent doesn't add a new user message; it just runs the loop with the current messages array. The last message must be a `user` or `toolResult` (otherwise the LLM can't respond).

## Retry with backoff

For transient errors (rate limit, network), automatic retry is reasonable. pi-ai's providers do this internally for HTTP-level errors. The agent loop doesn't typically retry — that's the provider's job.

If you want loop-level retry:

```ts
let attempts = 0;
while (attempts++ < 3) {
  try {
    await streamAssistantResponse(context, options, emit);
    break;
  } catch (err) {
    if (attempts >= 3 || isFatal(err)) throw err;
    await sleep(1000 * 2 ** attempts);
  }
}
```

But: **don't retry user-facing errors silently**. If the model returned a real error, the user should see it. Retry only for transient infrastructure errors.

## Where errors land in the transcript

After all this, what does the messages array look like after errors?

**Tool error**: A `toolResult` message with `isError: true`. Looks like a normal tool result, just marked.

**LLM stream error**: An `assistant` message with `stopReason: "error"` and `errorMessage` set. Possibly empty content if the error happened before any tokens.

**Abort**: An `assistant` message with `stopReason: "aborted"`, partial content, and `errorMessage: "Aborted"` or similar.

**Validation error**: A `toolResult` with `isError: true` containing the validation reason.

All errors become messages. Nothing is silently swallowed. **The transcript is the source of truth.**

## Stop and try this

Add a `beforeToolCall` hook that logs every tool invocation, and an `afterToolCall` that adds elapsed time:

```ts
const callStart = new Map<string, number>();

const agent = new Agent({
  ...,
  beforeToolCall: async ({ toolCall }) => {
    callStart.set(toolCall.id, Date.now());
    console.log(`[hook] before ${toolCall.name}`);
    return undefined;
  },
  afterToolCall: async ({ toolCall, result }) => {
    const elapsed = Date.now() - (callStart.get(toolCall.id) ?? 0);
    console.log(`[hook] after ${toolCall.name} (${elapsed}ms)`);
    callStart.delete(toolCall.id);
    return undefined;
  },
});

await agent.prompt("Read package.json");
```

Run it. You should see `before`/`after` for each tool, with timing.

This is observability. With a few more lines you have audit logging, permission gates, redaction — all without modifying the loop.

## Key takeaways

1. Hooks (beforeToolCall, afterToolCall) are how you change behavior; events are how you observe it.
2. `beforeToolCall` returning `{block: true}` refuses the call cleanly.
3. `afterToolCall` returning overrides rewrites the result before it reaches the LLM.
4. All errors become messages with `isError: true` or `stopReason: "error"` — transcript is the truth.
5. Loop-level retries are rarely the right answer; let the user (or provider) decide.

---

**Next:** [Chapter 6 — Sessions & Persistence](../06-sessions-persistence/)
