# The Reactor Pattern

Before writing the loop, let's understand its shape: the **reactor pattern**.

## What's a reactor?

A reactor is a loop that:

1. Waits for an event
2. Reacts to it
3. Possibly produces new events
4. Loops

Real-world examples: an event loop in Node.js, a game loop, a server's request handler, a UI's render loop. They're all reactors.

The agent loop is a reactor over LLM responses:

1. Wait for the LLM to finish responding
2. React to what it said (text? tool calls?)
3. If tool calls, execute them — producing new "events" (tool results) for the LLM
4. Loop

The "event" in our reactor is one complete LLM response. Each iteration is one **turn**. The loop ends when the LLM produces a response with no tool calls.

## Why "reactor" matters

This pattern has consequences:

### 1. The loop is sequential by default

One turn at a time. Tools execute, then back to the LLM. You can parallelize tools *within* a turn (Chapter 5), but turns themselves are sequential.

This is *fine*. LLMs are slow; the bottleneck is the LLM, not your code. Sequential is correct.

### 2. The loop has a single termination condition

When `assistantMessage.content` has no `toolCall` blocks, the loop exits. Easy to reason about. No timeouts, no max-iterations (unless you add them).

### 3. State lives in the messages array

The conversation history IS the state. The loop appends to it. There's no separate "agent memory" struct; just `messages`.

This is why agents are easy to persist: serialize `messages` to JSON, restore it, continue from there.

### 4. Side effects happen at predictable points

Tools execute between LLM calls. Nothing else side-effects. So you can reason about what happened: "before turn 3, the messages were X; we called these tools; now they're Y."

This is the foundation of session replay, debugging, and reproducibility.

## The shape, more formally

```
fn agent_loop(initial_message, context, tools):
  context.messages.push(initial_message)
  emit("agent_start")

  loop:
    emit("turn_start")

    // ---- LLM CALL ----
    assistant_message = stream_llm(context, tools)
    context.messages.push(assistant_message)
    emit("message_complete", assistant_message)

    // ---- DECISION ----
    tool_calls = assistant_message.content.filter(is_tool_call)
    if tool_calls.empty:
      emit("turn_end")
      break

    // ---- TOOL EXECUTION ----
    for call in tool_calls:
      result = execute_tool(call, signal)
      tool_result = build_tool_result_message(call, result)
      context.messages.push(tool_result)
      emit("tool_executed", call, result)

    emit("turn_end")
    // implicit: loop continues

  emit("agent_end")
  return context.messages
```

This is the *entire shape*. Everything else in this chapter is implementing it.

## Compare to other patterns

### "Plan-and-execute" agents

Some agent designs separate planning from execution:

```
plan = llm_make_plan(user_request)
for step in plan:
  result = execute_step(step)
```

This is **not** the reactor pattern. It's pipeline. Pipelines are easier to reason about but less flexible — the model can't adjust based on intermediate results.

You can implement plan-and-execute *on top of* the reactor: have a `make_plan` tool that returns a plan, and `execute_step` tools that consume it. But the loop itself is still a reactor.

### "ReAct" (reasoning + acting)

ReAct prompts the LLM to interleave thinking and tool calls:

```
Thought: I need to read the file first.
Action: read_file({path: "x.txt"})
Observation: File contents...
Thought: Now I'll search for the bug.
Action: grep({pattern: "TODO"})
...
```

This was an early agent paper from 2022. Modern instruction-tuned models with tool calling do this naturally — the "thinking" comes via thinking blocks, the "actions" via tool calls. **Same reactor pattern, different prompt format.**

### "Function calling" (OpenAI's old term)

Same as tool calling. Same loop.

### LangChain `AgentExecutor`

Same reactor, wrapped in OO machinery. Under the hood there's a `while` loop calling `_take_next_step`.

The takeaway: **agentic loops are all the reactor pattern.** The names and structures differ but the shape is identical.

## What the reactor needs to know

For each iteration, the reactor needs:

| Need | Where it comes from |
|---|---|
| What the LLM wants to do | LLM response (assistant message) |
| What tools are available | `context.tools` |
| What the conversation looks like | `context.messages` |
| When to stop | `tool_calls.length === 0` |
| When user wants to abort | `AbortSignal` |
| How to talk to the LLM | `streamFn(model, context, options)` |
| How to execute a tool | `tool.execute(...)` |

That's it. Eight inputs. The reactor is just orchestration on top of these.

## What the reactor produces

| Output | When |
|---|---|
| Events for the UI | Throughout (turn_start, message_*, tool_*, turn_end) |
| Updated messages array | At the end |
| Eventual response | Implicit in the final assistant message |

The reactor is a **transformer**: input is a user message and a context; output is an updated context plus an event stream.

## The reactor is small

Spelled out:

```ts
async function agentLoop(
  userMessage: Message,
  context: Context,
  tools: Tool[],
  emit: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  context.messages.push(userMessage);
  emit({ type: "agent_start" });

  while (true) {
    emit({ type: "turn_start" });
    signal?.throwIfAborted();

    const assistantMsg = await streamAssistantResponse(context, tools, emit, signal);
    context.messages.push(assistantMsg);

    const toolCalls = assistantMsg.content.filter(c => c.type === "toolCall") as ToolCall[];
    if (toolCalls.length === 0) {
      emit({ type: "turn_end" });
      break;
    }

    for (const call of toolCalls) {
      const result = await executeOneTool(call, tools, emit, signal);
      const resultMsg: ToolResultMessage = {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: result.content,
        isError: result.isError,
        timestamp: Date.now(),
      };
      context.messages.push(resultMsg);
    }

    emit({ type: "turn_end" });
  }

  emit({ type: "agent_end", messages: context.messages });
}
```

That's about 30 lines. **You just read the entire agent loop.** Lesson 4.2 will write each helper function. Lesson 4.3 will polish the events. Lesson 4.4 will explain the most important boundary in the entire system.

## Stop and try this

Reread the pseudocode. Trace through it for two scenarios:

**Scenario A**: User asks "What's 2+2?". The LLM returns text "4", no tools. How many iterations of the `while` loop? What events fire?

**Scenario B**: User asks "Read README.md". The LLM calls `read` tool. Then reads the result and returns text "It's a project README about...". How many iterations? What events?

Spend 5 minutes on this. If you can answer, you understand the loop.

(Answers: A = 1 iteration. agent_start, turn_start, [LLM events], turn_end, agent_end. B = 2 iterations. agent_start, turn_start, [LLM events], [tool events], turn_end, turn_start, [LLM events], turn_end, agent_end.)

## Key takeaways

1. The agent loop is a reactor: wait for LLM → react → maybe loop.
2. Each iteration is a "turn": one LLM call + tool executions.
3. State lives in `context.messages`. The loop just appends.
4. Termination = LLM returns no tool calls. Simple.
5. The whole loop is ~30 lines. Frameworks hide this; you don't have to.

---

**Next:** [Lesson 4.2 — The Minimal Loop](./02-the-minimal-loop.md)
