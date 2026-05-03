# Lesson 5.4: Steering and Follow-up Queues

You've sent your agent on a long task. While it's working, you realize there's something it should know. You can't wait for it to finish. What now?

## The problem

A coding agent might run for minutes. During that time, the user might:

- Realize they forgot to mention something ("oh wait, also check the staging env")
- See the agent going the wrong direction ("no, use a different approach")
- Want to queue work for after ("when you're done, also commit")

Without steering or follow-up, the user has to:

1. Hit `Esc` to abort
2. Wait for the abort to clean up
3. Type the new prompt
4. Lose the agent's mid-flight progress

That's terrible UX. Better:

1. Type the message, hit Enter
2. Agent finishes its current tool batch
3. Sees your message
4. Adjusts and continues

That's steering.

## Steering vs follow-up

Two different timing semantics:

- **Steering** — inject ASAP, between tool batches. Agent is *interrupted* and redirected.
- **Follow-up** — inject after the agent would otherwise stop. Agent finishes its current task, then sees your message.

When the user types depends on what they want. Pi's UX:

- **Enter** → steering (quick interrupt)
- **Alt+Enter** → follow-up (queue for later)

Both can be queued multiple times. Both can be drained one-at-a-time or all-at-once.

## How it works in the loop

The simple loop has one `while`:

```ts
while (true) {
  // turn
}
```

To support steering, we add an inner check at each turn boundary:

```ts
while (hasMoreToolCalls || pendingMessages.length > 0) {
  if (pendingMessages.length > 0) {
    // inject pending messages into context, emit events
    pendingMessages.forEach(m => context.messages.push(m));
    pendingMessages = [];
  }

  // turn (LLM call + tools)

  pendingMessages = await getSteeringMessages();   // pull from queue
}
```

Then for follow-up, we wrap that in an outer while:

```ts
while (true) {                       // outer: follow-up
  while (hasMoreToolCalls || ...) {  // inner: steering
    // ...
  }
  // Agent would stop here. Check follow-up.
  const followUps = await getFollowUpMessages();
  if (followUps.length > 0) {
    pendingMessages = followUps;
    continue;
  }
  break;
}
```

That's exactly what `runLoop` in `packages/agent/src/agent-loop.ts:155` does. The two `while`s are why.

## The Agent class API

Two new methods:

```ts
class Agent {
  steer(message: AgentMessage): void {
    this.steeringQueue.push(message);
  }

  followUp(message: AgentMessage): void {
    this.followUpQueue.push(message);
  }
}
```

The agent stores the messages in queues. The loop polls them between turns.

## Drain modes

Two ways to drain a queue:

- **`one-at-a-time`** (default) — pop the first message; the rest wait for the next iteration.
- **`all`** — drain everything, deliver as one batch.

When does which make sense?

**`one-at-a-time`** is what you usually want. The agent responds to each user message one at a time. If the user types three steering messages, the agent sees one, responds, sees the next, responds, etc.

**`all`** is for cases where the user types multiple related messages and wants them treated as one logical input. Less common.

Pi defaults to `one-at-a-time`; configurable via settings.

## The agent's view

From inside the loop, getting steering messages looks like polling:

```ts
async function runLoop(...) {
  let pending = await config.getSteeringMessages?.();

  while (true) {
    const innerLoop = async () => {
      while (hasToolCalls || pending.length > 0) {
        if (pending.length > 0) {
          // inject pending messages
          for (const m of pending) {
            emit({ type: "message_start", message: m });
            emit({ type: "message_end", message: m });
            currentContext.messages.push(m);
          }
          pending = [];
        }

        // ... LLM call + tools ...

        // Poll after each turn
        pending = (await config.getSteeringMessages?.()) ?? [];
      }
    };

    await innerLoop();

    // Inner exited. Try follow-up.
    const followUps = (await config.getFollowUpMessages?.()) ?? [];
    if (followUps.length === 0) break;
    pending = followUps;
  }

  emit({ type: "agent_end", messages: currentContext.messages });
}
```

Two important things:

1. The loop **pulls** from the queue, not the agent **pushing** events into the loop. Polling is simpler than push semantics for this case.
2. Steering is checked **after** each turn, not during. The user can't interrupt mid-LLM-call (that's what abort is for). Steering interrupts mid-loop, between tool batches.

## Wiring it into the Agent class

Update your `Agent`:

```ts
private steeringMode: "one-at-a-time" | "all" = "one-at-a-time";
private followUpMode: "one-at-a-time" | "all" = "one-at-a-time";

steer(message: AgentMessage): void {
  this.steeringQueue.push(message);
}

followUp(message: AgentMessage): void {
  this.followUpQueue.push(message);
}

clearSteeringQueue(): void {
  this.steeringQueue = [];
}

clearFollowUpQueue(): void {
  this.followUpQueue = [];
}

private drainQueue(queue: AgentMessage[], mode: "one-at-a-time" | "all"): AgentMessage[] {
  if (queue.length === 0) return [];
  if (mode === "all") {
    const drained = queue.slice();
    queue.length = 0;
    return drained;
  }
  return [queue.shift()!];
}
```

And inside `prompt()`, pass the polling functions:

```ts
await runAgent(
  message,
  context,
  {
    model: this._model,
    apiKey: this.apiKey,
    signal,
    convertToLlm: this.convertToLlm,
    getSteeringMessages: async () => this.drainQueue(this.steeringQueue, this.steeringMode),
    getFollowUpMessages: async () => this.drainQueue(this.followUpQueue, this.followUpMode),
  },
  (event) => this.emit(event),
);
```

You'll also need to update `runAgent` to accept these and call them at the right places (mirror what we showed above for `runLoop`). I'll let you do that as an exercise; the structure is straightforward.

## UX edge cases

A few things that come up in practice:

### What if the user steers while the agent is between tool execution and the next LLM call?

The new message is injected before the next LLM call. The LLM sees both the tool result AND the steering message. Usually it does the right thing.

### What if the user aborts AND has queued steering?

Pi: abort wins. Queued messages stay in the queue. The user sees them, can clear or re-submit. This avoids the agent immediately starting on a queued message after the user just aborted.

### What about response delivery during steering?

If the user steered and the agent is mid-streaming an assistant response, what should happen?

Option A: Abort and re-send to LLM with updated context.
Option B: Let the current response finish, then inject.

Pi does B. Aborting mid-response loses tokens and confuses the user. Letting it finish gives a clean state for the steering message.

### How does the user know their steering message is queued?

The Agent emits a `queue_update` event (pi has one). The UI shows pending steering messages in the editor area:

```
> █                                    [+ 2 queued]
```

The user can press a key (Alt+Up) to see what's queued, or Esc to abort and put queued messages back in the editor.

## Implementing the UI side

You'll wire this up in Chapter 8. Preview:

```ts
editor.onSubmit = (text) => {
  if (agent.state.isStreaming) {
    // Agent is busy → steer
    agent.steer({ role: "user", content: text, timestamp: Date.now() });
    showPendingIndicator();
  } else {
    // Agent is idle → start a new prompt
    agent.prompt(text);
  }
};
```

That's the entire UX rule. Idle = prompt. Busy = steer.

## Stop and try this

Add steering to your mini-pi and try:

```ts
const agent = new Agent({...});

const promise = agent.prompt("Slowly count from 1 to 20, one number per line.");

setTimeout(() => {
  console.log("[user] Steering: also include the squares");
  agent.steer({
    role: "user",
    content: "Also include the square of each number on the same line.",
    timestamp: Date.now(),
  });
}, 2000);

await promise;
```

You'll see the agent start counting, then receive your steering message between turns, and adapt by including squares.

That's the magic of steering. The agent feels conversational even mid-task.

## Key takeaways

1. Steering = mid-run injection; follow-up = post-stop injection.
2. The loop has two whiles: outer for follow-up, inner for steering + tool calls.
3. Drain modes: `one-at-a-time` (default) or `all`.
4. Loop **polls** queues between turns; doesn't get events pushed.
5. UI rule: idle = `prompt()`, busy = `steer()`. Two methods, totally different timing.

---

**Next:** [Lesson 5.5 — Hooks and Error Handling](./05-hooks-and-errors.md)
