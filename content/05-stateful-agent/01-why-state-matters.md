# Lesson 5.1: Why State Matters

The minimal loop in Chapter 4 was a function. Why bother wrapping it in a class?

## What functional doesn't give you

`runAgent(prompt, context, options, emit)` is great when you have one prompt and one outcome. But a real coding agent has more:

### 1. State that persists between calls

The conversation continues across many `prompt()` calls. You need:

```ts
const agent = new Agent({...});
await agent.prompt("hello");
await agent.prompt("what did I just say?");  // remembers context
```

With pure functions you can pass the messages array around, but it gets clumsy.

### 2. Long-lived subscriptions

Subscribers (UI, logger, persister) want to attach once and stay attached:

```ts
const agent = new Agent();
agent.subscribe(uiUpdater);
agent.subscribe(persister);

await agent.prompt("first");
await agent.prompt("second");
// uiUpdater and persister see events from both calls
```

If you create a fresh `runAgent` for each prompt, you have to pass the subscribers in every time.

### 3. Mutable configuration

The user might change the model mid-session via `/model`. They might enable thinking mode. They might add a tool dynamically. State lives somewhere:

```ts
agent.state.model = newModel;
agent.state.tools = [...agent.state.tools, newTool];
agent.thinkingLevel = "high";

await agent.prompt("..."); // uses new config
```

### 4. Lifecycle methods

You need:

- `agent.abort()` — cancel current run
- `agent.waitForIdle()` — wait for current work to finish
- `agent.steer(message)` — inject mid-run
- `agent.followUp(message)` — queue for after stop

These are operations on a running agent. They need an object to attach to.

### 5. Internal queues

Steering and follow-up messages (Lesson 5.4) live in queues. Queues are state. State lives somewhere.

## What functional DOES give you

Don't throw the function away. The Agent class is built on top of the function. pi-mono has both:

- `agentLoop()` — the function, in `agent-loop.ts`
- `Agent` — the class, in `agent.ts`, which calls `agentLoop()` internally

You can use either. The class is a convenience wrapper for stateful contexts; the function is what you'd call from a custom integration.

This split is good design:

- Easy to test the loop independently
- Easy to write alternative wrappers (e.g., for a multi-session runtime)
- The function has no "magic" state — easier to reason about

We'll mirror this in mini-pi: keep `runAgent` from Chapter 4, build `Agent` on top of it.

## What state does the agent hold?

The class needs to track:

| Field | Why |
|---|---|
| `messages` | The transcript |
| `tools` | Currently registered tools |
| `model` | Current model |
| `systemPrompt` | Current system prompt |
| `isStreaming` | Is a run currently active? |
| `streamingMessage` | The partial assistant message during streaming |
| `pendingToolCalls` | IDs of currently-executing tools |
| `errorMessage` | Last error (if any) |
| `signal` / `abortController` | For aborting |
| `steeringQueue` | Messages to inject mid-run |
| `followUpQueue` | Messages for after stop |

The first four are user-controlled (set them, change them). The middle four are derived (read-only views into the loop's progress). The last three are internal lifecycle bookkeeping.

## State immutability vs mutation

Two design choices:

**Immutable state** (React-style):
```ts
agent.setState({ tools: [...agent.state.tools, newTool] });
```

**Mutable state** (object-oriented):
```ts
agent.state.tools.push(newTool);
```

pi uses **mutable with defensive copies on assignment**:

```ts
agent.state.tools = [tool1, tool2];   // copies the top-level array
agent.state.tools.push(tool3);         // mutates the copy
```

Why mutable? Simpler for consumers. The copy-on-assign defensiveness prevents the most common bug (handing the agent your array, then mutating it externally).

We'll do the same in mini-pi.

## Read-only state

Some fields are read-only — derived from the loop's internal state:

```ts
get isStreaming(): boolean { return this.activeRun !== undefined; }
get streamingMessage(): Message | undefined { return this.currentPartial; }
```

The Agent computes these. Consumers can't set them. This prevents inconsistency: `isStreaming` always reflects truth, never gets out of sync.

## Concurrency: only one run at a time

The Agent enforces: at most one `prompt()` or `continue()` is active at a time:

```ts
async prompt(input) {
  if (this.activeRun) {
    throw new Error("Agent is already processing.");
  }
  // ...
}
```

You can't `await Promise.all([agent.prompt("a"), agent.prompt("b")])` — they'd interleave. Instead, the second prompt either waits via `await agent.waitForIdle()` or uses the steering/follow-up queues.

This restriction is intentional. **A coding agent is single-user, single-conversation.** If you need multiple parallel agents, create multiple instances. For one user with one in-flight request, serialization is correct.

## State and persistence

State is what gets persisted. When you save a session, you serialize:

- `messages` (the transcript)
- `model.id` (so you can re-resolve the model on load)
- `systemPrompt`
- A few session-level metadata fields

You don't persist:

- `isStreaming`, `streamingMessage` (transient)
- `tools` (re-registered on load — they have functions which don't serialize)
- Internal queues (transient)

When you load a session, you create a new Agent and set its `messages` from the file. The transient state starts fresh. Tools get re-registered.

We'll cover persistence in Chapter 6. State design now is in service of that.

## Stop and try this

Sketch the API of an Agent class on paper. What would you put for:

- Constructor signature?
- Public methods?
- Public properties / getters?
- Events emitted?

Compare your design to what we build in Lesson 5.2. They should be similar.

## Key takeaways

1. The functional loop is great; the Agent class wraps it for stateful use.
2. State the agent holds: transcript, config, runtime status, queues.
3. Mutable with copy-on-assign is pragmatic and safe-ish.
4. One run at a time — concurrency via queues, not parallel calls.
5. State design serves persistence; think about both at once.

---

**Next:** [Lesson 5.2 — The Agent Class](./02-the-agent-class.md)
