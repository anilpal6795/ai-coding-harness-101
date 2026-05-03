# Lesson 1.2: The Agentic Loop

We saw the 10-line agent in the last lesson. Now let's blow it up into the full pattern that every production agent — pi, Claude Code, Cursor, Aider — actually uses.

## The full loop, drawn

```
┌──────────────────────────────────────────────────┐
│  USER MESSAGE arrives                            │
└─────────────────────┬────────────────────────────┘
                      ▼
              ┌───────────────┐
              │ Append to     │
              │ messages      │
              └───────┬───────┘
                      ▼
       ┌──────────────────────────────┐
       │  TURN_START                  │   ◄── event emitted
       └──────────────┬───────────────┘
                      ▼
              ┌───────────────┐
              │ Stream from   │   ◄── this is what costs $
              │ LLM           │
              └───────┬───────┘
                      ▼
            ┌─────────────────┐
            │ LLM produced... │
            └─────────────────┘
              ╱             ╲
             ╱               ╲
   ┌─────────────┐     ┌─────────────┐
   │ Just text   │     │ Tool calls  │
   └──────┬──────┘     └──────┬──────┘
          │                   ▼
          │          ┌────────────────┐
          │          │ For each call: │
          │          │   validate     │
          │          │   execute      │
          │          │   collect res. │
          │          └────────┬───────┘
          │                   ▼
          │          ┌────────────────┐
          │          │ Push results   │
          │          │ into messages  │
          │          └────────┬───────┘
          │                   │
          │                   └──── back to "Stream from LLM"
          │                          (loop continues)
          ▼
   ┌─────────────┐
   │ TURN_END    │
   │ AGENT_END   │
   └─────────────┘
          ▼
   Wait for next user message
```

Read this diagram top-to-bottom. The decision point in the middle — "just text" vs "tool calls" — is the heart of the pattern.

## The pseudocode

Here's the same thing as code:

```ts
async function agentLoop(userMessage, context, tools) {
  context.messages.push(userMessage);
  emit("agent_start");

  while (true) {
    emit("turn_start");

    // 1. CALL THE LLM
    const assistantMessage = await streamFromLlm(context, tools);
    context.messages.push(assistantMessage);
    emit("message", assistantMessage);

    // 2. EXTRACT TOOL CALLS
    const toolCalls = assistantMessage.toolCalls ?? [];

    if (toolCalls.length === 0) {
      // 3a. NO TOOLS → exit
      emit("turn_end");
      emit("agent_end");
      return;
    }

    // 3b. TOOLS → execute and loop
    for (const call of toolCalls) {
      emit("tool_start", call);
      const result = await executeOneTool(call, tools);
      context.messages.push({
        role: "toolResult",
        toolCallId: call.id,
        content: result,
      });
      emit("tool_end", call, result);
    }

    emit("turn_end");
    // implicit: loop continues, calls LLM again with new messages
  }
}
```

This is **conceptually identical** to what `runLoop` does in `packages/agent/src/agent-loop.ts:155`. Real production code adds a few things on top, but they're all elaborations of this skeleton.

## Decoding the loop

### "Turn"

A **turn** is one trip through the loop: one LLM call plus its tool executions. If the user asks "read foo.txt and write bar.txt" and the LLM does it in two tool calls (or two LLM calls), that's two turns.

### Why emit events?

Notice the `emit(...)` calls. The agent doesn't render anything — it announces what's happening. Other parts of your system (UI, logger, persister) subscribe.

This is **the agent ↔ UI boundary** from Lesson 0.2. The UI listens to events, not to the loop's internal state.

### Why "stop when no tool calls"?

The model itself decides when to stop. It produces a `stop_reason` of either `end_turn` (no more action needed) or `tool_use` (asking you to run something). Your loop just respects that signal.

You don't need explicit "should I keep going?" logic. The model handles it.

### Why `for` instead of `await Promise.all`?

In the simple version, sequential. In production, parallel where safe. We'll cover this in Chapter 5.

## What's missing from the simple loop

The simple loop is correct but spartan. Real harnesses add:

| Feature | Why | Where you'll learn it |
|---|---|---|
| Streaming | Watch the LLM type live | Chapter 2 |
| Abort | Let user cancel mid-loop | Chapter 5 |
| Steering | Inject user messages between turns | Chapter 5 |
| Hooks | Permission prompts before tool execution | Chapter 5 |
| Tool argument validation | Catch malformed calls cleanly | Chapter 3 |
| Custom message types | UI-only messages that don't go to LLM | Chapter 4 |
| Persistence | Save/resume sessions | Chapter 6 |
| Compaction | Don't blow the context window | Chapter 6 |
| Errors and retries | Network flakiness, rate limits | Chapter 5 |

Each one is a layer on top of the same loop. **The loop itself does not get more complex.** That's a key design principle: features become *hooks into the loop*, not modifications of the loop.

## Variations on the loop

### One-shot agents

Some agents run once and exit:

```ts
const result = await agent.run("Refactor this function: ...");
console.log(result);
```

Same loop, no UI, runs to completion. This is what `pi --print` does.

### Long-running agents

Some agents persist across many user messages:

```ts
agent.subscribe(uiUpdater);
while (true) {
  const input = await prompt("> ");
  await agent.send(input);
}
```

The same loop runs once per user message. The agent's state persists between calls. This is interactive mode.

### Multi-agent systems

Sometimes you have multiple agents that talk to each other. Each is still the same loop. The "tool" of one might be "ask the other agent."

This is a layer on top, not a different pattern.

### Plan-and-execute

Some agents have a "planning" phase before tool calls. This is just two loops in series — one for planning, one for execution. Or one loop where the "tools" include a plan-update tool.

Any agent pattern you've heard of is some composition of this loop.

## The "stop" problem

How does the LLM know when to stop?

Modern instruction-tuned models have been trained to recognize when they've answered the user's question and produce no more tool calls. They emit a `stop_reason: end_turn`. Your loop sees zero tool calls → exits.

But what if the model never stops? Well-built tool descriptions and a good system prompt prevent runaway loops in practice. As a backstop, you can add:

- A max-turns counter
- A max-token budget
- A max-cost budget
- A timeout

We won't add these in mini-pi — modern models handle this well — but they're trivial additions if you need them.

## Stop and try this

Open `packages/agent/src/agent-loop.ts` in this repo. Find the function `runLoop` at line 155. Read it slowly.

Things to notice:

- The outer `while (true)` (line 168) and inner `while (hasMoreToolCalls || pendingMessages.length > 0)` (line 172). Why two loops? Because of steering and follow-up queues. We'll cover that in Chapter 5.
- `streamAssistantResponse` at line 191. That's the `streamFromLlm` from our pseudocode.
- `executeToolCalls` at line 206. That's the tool execution.
- The events emitted: `turn_start`, `turn_end`, `agent_end`. Same as our pseudocode.

The production loop is **70 lines**. The skeleton you read above was 25 lines. The 45 extra lines are: error handling, steering, follow-up, partial results. You'll write all of those over the next few chapters.

## A philosophical aside

The agentic loop is one of the most elegant patterns in software right now. It's three things:

1. A `while` loop
2. A function call (the LLM)
3. A switch on the response (text or tool)

That's it. The reason it works is that the LLM is doing the hard part — choosing what tool to call, when to stop, how to interpret tool results. Your job is just to be a faithful executor.

As models get smarter, the loop doesn't change. The same code that worked with Claude Sonnet 3.5 works with Claude Sonnet 4 and will work with Claude Sonnet 5. **You're writing infrastructure that outlives any specific model.**

That's why this matters.

## Key takeaways

1. The agentic loop is: stream from LLM → execute tools → repeat until LLM stops.
2. A "turn" = one LLM call + its tool executions.
3. The agent emits events; UIs subscribe. The agent doesn't render.
4. Features (abort, steering, hooks, validation) layer on top of the loop without changing it.
5. The model decides when to stop. You just respect its signal.

---

**Next:** [Lesson 1.3 — What Makes a Coding Agent](./03-what-makes-a-coding-agent.md)
