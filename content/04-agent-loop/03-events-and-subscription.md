# Events and Subscription

The loop emits events. UIs subscribe. This lesson is about why that pattern, and how to get the subscription mechanics right.

## Why events?

In Lesson 4.2 we passed an `emit` function into `runAgent`. Why not just have the function return the result?

Three reasons:

### 1. UIs need to update during the loop

A coding agent might run for minutes — multiple LLM calls, multiple tool executions. The user can't stare at a frozen terminal.

If the loop only returns at the end, the UI gets nothing in between. With events, the UI can render as the loop progresses.

### 2. Multiple consumers might want events

A single agent run might be observed by:

- The TUI (rendering messages)
- A session persister (writing to disk)
- A telemetry system (counting tokens)
- A debugger (logging to a file)
- An extension (intercepting tool calls)

All of these subscribe. None of them block the loop.

### 3. Event-based code is easier to test

Drive the loop, collect events into an array, assert on the array. No mocking required.

## Event design principles

A few rules that make events pleasant to consume:

### Events should be self-contained

Each event should carry enough information that a consumer doesn't need to track state itself.

Bad:
```ts
{ type: "delta", text: "hello" }
```
Consumer has to ask: which message is this delta for?

Good:
```ts
{ type: "message_update", messageId: "msg_123", delta: "hello", current: { ... } }
```
Consumer can render directly from the event.

### Events should be ordered

The loop emits events synchronously, in-order. Consumers process them in the order received. No race conditions.

If you're tempted to emit events from background tasks, *don't* — buffer them and emit after the foreground task completes. Out-of-order events are a debugging nightmare.

### Events should mirror the data model

If your data model has `Message`, your events should be `message_*`. If it has `ToolCall`, events should be `tool_*`. The names should make consumers' code obvious.

### Events come in lifecycle pairs

For most things: `*_start`, `*_update` (optional), `*_end`. This lets consumers allocate UI on start, update on update, finalize on end.

Pi has: `agent_start/end`, `turn_start/end`, `message_start/update/end`, `tool_execution_start/update/end`. Same pattern throughout.

## Subscription mechanics

In the minimal loop you saw a function-passed-in style:

```ts
runAgent(prompt, context, options, (event) => {
  // handle event
});
```

For a stateful Agent class (Chapter 5), we'll switch to a subscribe API:

```ts
const agent = new Agent({...});
const unsubscribe = agent.subscribe((event) => {
  // handle event
});
// later:
unsubscribe();
```

### Sync vs async listeners

If listeners are sync, they fire and forget. Fast, simple.

If listeners are async (and you `await` them), they can do work the loop waits for. Useful for:

- Persistence: "write this message to disk before the next event fires"
- Permission prompts: "ask the user before executing this tool"
- Anything where the loop should wait for the listener

pi uses async listeners with `await`-in-order semantics:

```ts
for (const listener of this.listeners) {
  await listener(event, signal);
}
```

This means listeners fire one at a time, in registration order. If listener 1 takes 100ms, listener 2 doesn't fire until then. Predictable.

The cost: a slow listener slows the loop. So listeners should be quick or do their work in the background (without `await`-ing) when possible.

For mini-pi we'll keep listeners sync. Production code (pi) supports async.

### Multi-listener mechanics

```ts
class Agent {
  private listeners = new Set<(e: AgentEvent) => void>();

  subscribe(listener: (e: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AgentEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
```

This is a Set so duplicate registrations don't fire twice. The unsubscribe function removes the specific listener.

For typed listeners that filter by event type:

```ts
agent.subscribe((event) => {
  if (event.type === "message_end") {
    // handle just message ends
  }
});
```

Some implementations let you subscribe to specific types: `agent.on("message_end", handler)`. That's syntactic sugar; the underlying mechanism is the same.

## Event handling examples

Here's how a few different consumers handle the same event stream:

### A logger

```ts
agent.subscribe((event) => {
  console.log(`[${new Date().toISOString()}] ${event.type}`);
});
```

### A persister

```ts
agent.subscribe(async (event) => {
  if (event.type === "message_end") {
    await fs.appendFile("session.jsonl", JSON.stringify(event.message) + "\n");
  }
});
```

### A token counter

```ts
let totalTokens = 0;
agent.subscribe((event) => {
  if (event.type === "message_end" && event.message.role === "assistant") {
    totalTokens += event.message.usage.input + event.message.usage.output;
    process.stderr.write(`\rTokens: ${totalTokens}`);
  }
});
```

### A live UI

```ts
agent.subscribe((event) => {
  switch (event.type) {
    case "message_start":
      ui.addMessageComponent(event.message);
      break;
    case "message_update":
      ui.updateLastMessageComponent(event.message);
      break;
    case "tool_start":
      ui.addToolBox(event.toolCallId, event.toolName, event.args);
      break;
    case "tool_end":
      ui.finalizeToolBox(event.toolCallId, event.result, event.isError);
      break;
  }
  ui.requestRender();
});
```

All four of these can run simultaneously on the same agent. They don't interfere.

## When events should NOT be used

Events are great for **observation**. They're poor for **control**.

If you want to *change* the agent's behavior, use:

- **Hooks** (Chapter 5): `beforeToolCall` returning `{block: true}` to block execution
- **Configuration**: `tools` array, `systemPrompt`, model selection
- **Steering**: queue messages mid-run

Events should be one-way: agent produces, listeners consume. Anything else gets messy.

## A subtle issue: state changes mid-event

When `message_update` fires with `event.message`, that message is a *snapshot*. The next `message_update` will fire with a new snapshot.

If you store `event.message` and later the agent mutates it… well, in pi-mono the events spread `{ ...partial }` to make snapshots. In your simpler version, be careful:

```ts
agent.subscribe((event) => {
  if (event.type === "message_update") {
    this.lastMessage = event.message;  // is this a snapshot or a live ref?
  }
});
```

If `event.message` is a live reference and the agent later mutates it, your `this.lastMessage` mutates too. Defensive code clones:

```ts
this.lastMessage = structuredClone(event.message);
```

For mini-pi we'll trust that messages are snapshots. For production code, document it explicitly: "events carry snapshots; do not mutate."

## Stop and try this

Add a logger to your `mini-pi` that prints each event type with elapsed time:

```ts
const start = Date.now();
const log = (event: AgentEvent) => {
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`[${elapsed}s] ${event.type}`);
};

await runAgent("Read package.json", context, { model: claude }, log);
```

Run a couple of prompts. Notice:

- `agent_start`, `turn_start` fire instantly
- `message_start` fires when the LLM begins responding (~500ms)
- `message_update` fires many times in quick succession during streaming
- `tool_start` / `tool_end` fire around tool execution
- A second `turn_start` fires for the post-tool turn
- `agent_end` is last

This trace IS your agent's lifecycle. Read it carefully.

## Key takeaways

1. Events let multiple consumers observe the same loop without blocking it.
2. Events should be self-contained, ordered, and mirror your data model.
3. Lifecycle pairs: `*_start`, `*_update`, `*_end` for everything streamable.
4. Subscriptions return an unsubscribe function. Multi-listener via Set.
5. Use events for observation; use hooks/config/steering for control.

---

**Next:** [Lesson 4.4 — The convertToLlm Boundary](./04-the-convert-to-llm-boundary.md)
