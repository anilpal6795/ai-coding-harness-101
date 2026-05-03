# Lesson 1.1: From Chatbot to Agent

## The single conceptual jump

Here's the entire conceptual difference between a chatbot and an agent:

> **A chatbot answers your message. An agent decides what to do next.**

That's it. Read it again.

Now let's unpack it.

## A chatbot, formally

A chatbot is a function:

```
chat(messages) → next assistant message
```

You give it the conversation so far, it returns one reply. It's stateless from its own perspective (you maintain the messages array). It cannot do anything in the world. It can only produce text.

Here's a chatbot in 5 lines:

```ts
async function chatbot(userMessage: string, history: Message[]) {
  history.push({ role: "user", content: userMessage });
  const reply = await llm(history);
  history.push(reply);
  return reply.text;
}
```

That's ChatGPT (the original web UI), Claude.ai (the chat interface), the API call you make from a script. **It's a single round-trip per user message.**

## An agent, formally

An agent is a *loop* that wraps the chatbot:

```
loop:
  reply = chat(messages)
  if reply contains an "action":
    result = execute(action)
    messages.append(result)
    continue
  else:
    break
```

The agent **continues calling the LLM** as long as the LLM keeps requesting actions. Only when the LLM produces a plain text response (no actions) does the agent return control to the user.

Here's an agent in 10 lines:

```ts
async function agent(userMessage: string, history: Message[]) {
  history.push({ role: "user", content: userMessage });
  while (true) {
    const reply = await llm(history, { tools });
    history.push(reply);
    const actions = reply.toolCalls ?? [];
    if (actions.length === 0) return reply.text;
    for (const action of actions) {
      const result = await executeAction(action);
      history.push({ role: "toolResult", content: result });
    }
  }
}
```

**That's the entire conceptual leap.** A `while` loop. That's why agents are not magic, despite how they're marketed.

## What changes because of this

The `while` loop has enormous consequences:

### 1. The LLM gains agency

In a chatbot, the LLM produces text. In an agent, the LLM produces *decisions*. Those decisions can be:

- "Call the `read_file` tool with path `package.json`"
- "Call the `bash` tool with command `npm test`"
- "Call the `send_email` tool with these parameters"

The LLM is now choosing what happens in the world. That's what "agency" means in this context.

### 2. The harness gains responsibilities

Now that the LLM is making decisions, *something* has to:

- Define what tools exist
- Validate that the LLM called them with the right arguments
- Execute them safely
- Format the results back for the LLM
- Decide when to stop the loop

That something is the **agent harness**. It's what you're going to build.

### 3. Trust shifts

A chatbot is trusted to produce good text. An agent is trusted to take good actions. If your agent has a `delete_file` tool, you'd better think hard about what it might do.

The agent harness is where you encode safety: which tools exist, who can call them, what arguments are allowed, what happens before they run.

### 4. Time horizons stretch

A chatbot replies in seconds. An agent might run for minutes — calling tools, getting results, calling more tools, eventually responding. The user might want to:

- See progress as it happens (streaming)
- Cancel mid-execution (abort)
- Send a follow-up message ("actually, do X instead") while it's running (steering)

These all come from the loop existing.

## A worked example

Suppose you ask a chatbot: "What files are in my src folder?"

A chatbot responds:

> "I don't have access to your filesystem, but you can run `ls src/` to find out."

Now suppose you ask an agent the same question, where the agent has a `bash` tool.

```
User: What files are in my src folder?

Agent (LLM call 1):
  thinking: I should use the bash tool to run `ls src/`
  toolCall: bash(command="ls src/")

Harness:
  Validates the call. Executes `ls src/`. Captures output.
  Pushes toolResult into history.

Agent (LLM call 2):
  text: "Your src folder contains:
        - app.ts
        - utils.ts
        - types.ts"
  (no more tool calls)

Harness:
  Returns the text to the user.
```

Two LLM calls. One tool execution. The user sees a single coherent response. **This is the experience the user expects from an agent.**

## Why "AI agent" is a fuzzy marketing term

You'll see the word "agent" used in lots of ways:

- LangChain's `AgentExecutor` (a specific class)
- Microsoft's "Copilot agents" (a product)
- "Multi-agent systems" (multiple LLMs talking to each other)
- "Autonomous agents" (long-running with goals)

These are all variations of the same core: **an LLM in a loop that calls tools.** The differences are about scope, structure, and product framing.

When this course says "agent" we mean: **an LLM in a loop that calls tools, until it stops calling tools.**

## What an agent is not

To be precise, here's what an agent (in our definition) is **not**:

- **Not a model.** Claude is a model. An agent uses Claude.
- **Not a chatbot.** A chatbot does one round-trip. An agent loops.
- **Not autonomous.** Our agents are user-driven; they react to a user message.
- **Not a pipeline.** A pipeline has fixed steps. An agent decides its own steps.
- **Not necessarily multi-agent.** A single LLM in a loop is a perfectly valid agent.

## Stop and try this

Open the Anthropic docs for tool use: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use

Skim the example. Notice it's exactly what we just described:

1. You define tools
2. The model returns either text OR a tool_use block
3. You execute the tool, return results
4. You call the model again with the results
5. Repeat

Anthropic's docs call this an "agentic loop." That's what we mean.

## Key takeaways

1. A chatbot answers. An agent acts in a loop.
2. The loop is the source of every interesting agent property: tool execution, abort, streaming, steering.
3. The "agent" is mostly the harness — the loop and the wiring around it. The model is replaceable.
4. Our definition: **an LLM in a loop that calls tools, until it stops calling tools.**

---

**Next:** [Lesson 1.2 — The Agentic Loop](./02-the-agentic-loop.md)
