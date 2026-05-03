# Lesson 5.3: Abort and Cancellation

The user hits `Esc`. What happens? More than you'd think. This lesson covers it.

## The user-facing behavior

In a coding agent, abort means: stop whatever you're doing, gracefully, and let me give you new direction.

What "gracefully" requires:

- Stop the LLM stream (don't keep paying for tokens)
- Stop in-flight tool executions (don't let `bash` keep running)
- Don't crash the agent (state should be consistent, ready for next prompt)
- Save what you have (partial response counts as a real message)
- Tell the UI cleanly what just happened

## The mechanism: AbortSignal

JavaScript's standard cancellation mechanism. You create an `AbortController`, pass its `signal` everywhere, then call `controller.abort()` to fire it.

```ts
const controller = new AbortController();
const signal = controller.signal;

setTimeout(() => controller.abort(), 5000);  // abort after 5s

// Pass signal everywhere it might matter
const response = await fetch(url, { signal });
const child = spawn("cmd", { signal });

// Or check manually
signal.throwIfAborted();
```

When `abort()` fires, anything that received the signal sees it as aborted. `fetch()` rejects. `spawn` kills the process. Manual checks throw `AbortError`.

## Threading the signal through

For abort to work end-to-end, the signal must flow through every layer:

```
Agent.abort()
  ↓ (sets controller.signal aborted)
Loop sees signal in next iteration check
  ↓
streamAssistantResponse passes signal to stream()
  ↓
stream() passes to providers.anthropic.ts
  ↓
streamAnthropic passes to client.messages.stream({ signal })
  ↓
SDK passes to underlying fetch({ signal })
  ↓
fetch closes the HTTP connection on abort
```

If ANY layer drops the signal, abort won't work at that layer. Tool execution especially: if your `bash` tool doesn't pass signal to `spawn`, the child process keeps running after abort.

This is why we drilled signal-passing in Chapter 3.

## Where abort gets handled

The signal fires in the middle of:

- An LLM stream
- A tool execution
- Between iterations

Each case has different cleanup.

### Mid-stream

The provider's `for await` loop throws an `AbortError`. Your provider catches it and emits an `error` event with `reason: "aborted"`:

```ts
try {
  for await (const event of sdkStream) { ... }
} catch (err: any) {
  const reason = err?.name === "AbortError" ? "aborted" : "error";
  out.push({ type: "error", reason, error: makePartialMessage() });
}
```

The partial message has whatever content was streamed so far, plus `stopReason: "aborted"`. The agent loop pushes this into messages — **the partial response is preserved**.

This is important for UX: the user might say "stop, that's enough." They want to see what was generated so far, not lose it.

### Mid-tool-execution

The tool's `execute` function should honor the signal. Best practice:

```ts
async execute(_id, args, signal) {
  signal?.throwIfAborted();
  const child = spawn("...");
  signal?.addEventListener("abort", () => child.kill("SIGTERM"));
  // ...
}
```

If the tool throws (because of abort), the loop catches it and creates a tool result with the abort message:

```ts
} catch (err) {
  const result = { content: [{ type: "text", text: "Aborted" }] };
  await emitToolResult(call, result, true, ...);
}
```

The model sees "tool was aborted" if you continue. But typically after an abort the user takes over, so this rarely matters.

### Between iterations

Easy: check the signal at the top of the loop:

```ts
while (true) {
  if (signal?.aborted) {
    emit({ type: "agent_end", messages });
    return;
  }
  // ...
}
```

This catches "user aborted while between turns" — usually because the previous turn ended quickly.

## What about tools that ignore signal?

A common bug: a tool ignores `signal`. The agent aborts, but the tool keeps running.

Result: the user thinks the agent stopped. They send a new prompt. Now you have a zombie tool running in the background. When it finishes, it might:

- Throw because the agent is in a different state
- Try to emit `tool_end` for an event that the next run doesn't recognize
- Just silently log

This is a bug-prone area. Defenses:

1. **Document signal handling as required** in your tool contract
2. **Default to short timeouts** for tools that can hang
3. **Track running tools** at the agent level — if one is still running when a new prompt starts, refuse

pi takes the third approach: it tracks `pendingToolCalls` and won't accept new prompts while any are pending.

## The Agent class with abort

Add to your `Agent` class:

```ts
abort(): void {
  this.activeRun?.abortController.abort();
}

get signal(): AbortSignal | undefined {
  return this.activeRun?.abortController.signal;
}
```

That's it. Two lines for the public API. The rest of the work is in:

- The loop checking the signal
- Providers passing it through
- Tools honoring it

## Abort vs error

In our event protocol we distinguish `aborted` from `error`:

```ts
{ type: "error"; reason: "aborted" | "error"; error: AssistantMessage }
```

UIs treat them differently:

- **Error** — show a scary red message: "Something went wrong: <details>"
- **Aborted** — show a quiet gray note: "Stopped"

Same event type, different `reason`. The UI decides how to render.

## Common abort patterns

### Single key (Esc)

```ts
process.stdin.on("data", (data) => {
  if (data[0] === 0x1b) {  // ESC
    agent.abort();
  }
});
```

### Cooperative abort with confirmation

```ts
process.stdin.on("data", (data) => {
  if (data[0] === 0x03) {  // Ctrl+C
    if (agent.state.isStreaming) {
      agent.abort();
      console.log("Aborted current operation. Press Ctrl+C again to quit.");
    } else {
      process.exit(0);
    }
  }
});
```

Pi does this — Ctrl+C aborts; second Ctrl+C quits.

### Timeout

```ts
const timeout = setTimeout(() => agent.abort(), 60_000);
await agent.prompt("...");
clearTimeout(timeout);
```

### Multiple signals (compose)

```ts
const controller = new AbortController();
userController.signal.addEventListener("abort", () => controller.abort());
timeoutController.signal.addEventListener("abort", () => controller.abort());
// pass controller.signal to agent
```

Or use `AbortSignal.any([sig1, sig2])` (Node 20+).

## A common mistake: don't swallow AbortError

```ts
try {
  await tool.execute(args, signal);
} catch (err) {
  console.error("Tool failed:", err);   // Wrong — masks abort
}
```

If `signal.aborted`, the error is an abort, not a tool failure. Treat it as such:

```ts
try {
  await tool.execute(args, signal);
} catch (err: any) {
  if (signal?.aborted || err?.name === "AbortError") {
    // Aborted — re-throw or mark as aborted
    throw err;
  }
  // Real error — handle as tool failure
}
```

In the agent loop, "aborted" should propagate up cleanly so the UI can show the right state.

## Aborts and the message log

A common question: should the partial assistant message stay in `messages` after an abort?

**Yes.** It represents real work. The user might want to:

- See what the model was about to say
- Continue from that point ("OK, that's wrong, do X instead")
- Replay it later

pi keeps aborted messages with `stopReason: "aborted"` and `errorMessage: "Aborted by user"`. The next prompt sees them in context. The LLM understands "the previous response was cut off" and proceeds.

If the user wants to wipe the partial message, they can `/edit` or just send a different prompt.

## Stop and try this

Add abort to your `mini-pi`:

```ts
const agent = new Agent({...});

agent.subscribe((event) => {
  if (event.type === "message_update") {
    // render
  }
});

// Trigger abort after 2 seconds
setTimeout(() => agent.abort(), 2000);

await agent.prompt("Write a 500-word essay about cats. Take your time.");

console.log("\n\n--- After ---");
console.log("isStreaming:", agent.state.isStreaming);
console.log("Last message stop reason:",
  agent.state.messages[agent.state.messages.length - 1].stopReason);
console.log("Partial content length:",
  (agent.state.messages[agent.state.messages.length - 1] as any).content?.length);
```

Run it. You should see:

- The essay starts streaming
- After 2 seconds, it stops
- Stop reason is "aborted"
- The partial content is preserved

**That's correct abort behavior.**

## Key takeaways

1. Abort = `AbortController.abort()`, signal threaded through every async boundary.
2. The signal fires; mid-stream throws AbortError; mid-tool throws if signal honored.
3. Partial assistant messages stay in `messages` with `stopReason: "aborted"`.
4. UIs distinguish "aborted" from "error" — aborts are quiet, errors are loud.
5. Tools that ignore signal create zombie processes; document and enforce the contract.

---

**Next:** [Lesson 5.4 — Steering and Follow-up Queues](./04-steering-and-follow-up.md)
