# The convertToLlm Boundary

This is the most important design decision in the entire harness. Once you understand it, a lot of seemingly-mysterious things in pi click into place.

## The problem

Your agent's transcript ends up containing things the LLM should not see:

- A "thinking" status notification while a tool runs
- A "compaction summary" replacing 50 old messages
- A "skill invocation" UI block describing which skill was loaded
- A "branch summary" inserted after a `/fork`
- A random user-friendly note like "[Session resumed from disk]"

These are *real things in your conversation transcript*. They show up in the UI. They get persisted to disk. **But they're not LLM messages.** If you sent them to the LLM, the model would either be confused or fail (most providers reject unknown roles).

How do you have a transcript with both LLM messages and UI-only messages, without the two interfering?

## The solution: a boundary function

You define your transcript using a **superset** of LLM messages:

```ts
type AgentMessage = LlmMessage | UiOnlyMessage;
```

You can put either type in `context.messages`. Your UI renders both. Your persister saves both. **But every time you call the LLM, you run a function that filters the agent messages down to just the LLM ones:**

```ts
function convertToLlm(messages: AgentMessage[]): LlmMessage[] {
  return messages.flatMap((m) => {
    if (m.role === "user" || m.role === "assistant" || m.role === "toolResult") {
      return [m];   // pass through
    }
    if (m.role === "compactionSummary") {
      return [{ role: "user", content: `[Earlier conversation was: ${m.summary}]`, timestamp: m.timestamp }];
    }
    if (m.role === "uiNote") {
      return [];   // strip out
    }
    return [];
  });
}
```

This function is the boundary. It runs every LLM call:

```ts
async function streamAssistantResponse(context, ...) {
  const llmMessages = convertToLlm(context.messages);
  const response = await stream(model, { ...context, messages: llmMessages });
  // ...
}
```

## Why this is huge

Think about what this enables:

### 1. UI message types you couldn't otherwise have

```ts
// In the transcript:
{ role: "bashExecution", command: "npm test", output: "...", exitCode: 0 }
{ role: "skillInvocation", skillName: "code-reviewer", parameters: {...} }
{ role: "compactionMarker", summarizedTurns: 47 }
```

These render beautifully in the UI as their own component types. Other agents can't have these without breaking the LLM call.

### 2. Custom messages don't poison context

If you stuck a "compactionSummary" message into the LLM's context as some random user message, the model would get confused. With `convertToLlm`, the summary becomes a properly-formatted user message at LLM time, but stays as its rich type in your transcript.

### 3. Compaction becomes natural

Compaction (Chapter 6) replaces N old messages with one summary message. With `convertToLlm`, the summary IS a custom message type:

```ts
{ role: "compactionSummary", text: "Earlier you discussed X, Y, Z..." }
```

The UI renders it as a "summary card." `convertToLlm` turns it into a `user` message for the LLM that conveys the same info.

### 4. You can experiment with new UI without breaking the loop

Want to add a "code review widget" message type? Add it to `AgentMessage`. Add a UI component for it. Update `convertToLlm` to either drop it or convert it. **The agent loop doesn't change.**

## How this is implemented in pi

In `packages/agent/src/types.ts`, pi has:

```ts
export interface CustomAgentMessages {
  // Empty by default — apps extend via TypeScript declaration merging
}

export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
```

The clever bit: `CustomAgentMessages` is an empty interface that consumers extend via TypeScript declaration merging:

```ts
// in pi-coding-agent:
declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    bashExecution: BashExecutionMessage;
    compactionSummary: CompactionSummaryMessage;
    branchSummary: BranchSummaryMessage;
    // ...
  }
}
```

Now in pi-coding-agent, `AgentMessage` includes those types everywhere. **Full type safety throughout the codebase, with extensibility.** No `any`s.

The agent core itself doesn't know what those types ARE. It just calls `convertToLlm` (provided by the consumer) before each LLM call:

```ts
const llmMessages = await config.convertToLlm(messages);
```

The consumer (pi-coding-agent) provides the actual `convertToLlm` function that knows how to handle the custom types.

## The naming

"convertToLlm" is descriptive. Other names you might see:

- "messageFilter"
- "transformForLlm"
- "preLlmHook"
- "prepareMessages"

All the same idea. pi's name (`convertToLlm`) is clearest.

## When `convertToLlm` runs

```
context.messages   ← what your transcript looks like
       │
       │  (every LLM call):
       ▼
[transformContext]   ← optional pre-step (compaction, pruning)
       │
       ▼
[convertToLlm]   ← the boundary
       │
       ▼
llmMessages   ← what gets sent to the LLM
       │
       ▼
[stream() to provider]
```

It runs **once per LLM call**, not once per message added. So you can freely add custom messages to `context.messages` between LLM calls without worrying — they only matter at the LLM call boundary.

This is critical: **you're not committing a custom message to the LLM the moment you add it.** You're just adding it to your transcript. The LLM only sees what `convertToLlm` returns.

## A worked example

Suppose your agent has a "user typed `!ls`" feature: the user can prefix a message with `!` to inject shell output into context:

```
User input: "!ls"
↓
Run `ls`, get output
↓
Add to transcript:
  { role: "bashExecution", command: "ls", output: "src\npackage.json\n", exitCode: 0 }
↓
The UI renders this as a "shell output" component.
↓
Next user message: "what files are in this directory?"
↓
Add: { role: "user", content: "what files are in this directory?" }
```

Now you call the LLM. `context.messages` has:

```
[1] { role: "user", content: "previous chat" }
[2] { role: "assistant", content: "previous reply" }
[3] { role: "bashExecution", command: "ls", output: "src\npackage.json\n", exitCode: 0 }
[4] { role: "user", content: "what files are in this directory?" }
```

`convertToLlm` runs:

```ts
function convertToLlm(messages) {
  return messages.flatMap(m => {
    if (m.role === "bashExecution") {
      return [{
        role: "user",
        content: `[Shell output]\n$ ${m.command}\n${m.output}`,
        timestamp: m.timestamp,
      }];
    }
    return [m];
  });
}
```

What the LLM sees:

```
[1] user: "previous chat"
[2] assistant: "previous reply"
[3] user: "[Shell output]\n$ ls\nsrc\npackage.json\n"
[4] user: "what files are in this directory?"
```

The bash execution becomes a `user` message containing the shell output. The LLM has perfect context. The UI shows a beautiful shell-output card. Both work.

## What you should NOT do

### Don't put custom message types directly in the LLM call

Tempting:

```ts
const llmMessages = context.messages;  // includes bashExecution
await stream(model, { ...context, messages: llmMessages });
```

Result: provider error or model confusion. The LLM doesn't know `role: "bashExecution"`.

### Don't strip custom messages from the transcript

Also tempting:

```ts
context.messages = context.messages.filter(m => standardRoles.includes(m.role));
```

Result: you lose UI-only messages forever. You can't render them. You can't persist them.

The whole point: **transcript is a superset, LLM call is a filtered view.**

### Don't run convertToLlm too often

Run it once per LLM call. Don't run it on every message addition. The function might be expensive (compaction), and it produces output you don't otherwise need.

## Adding to mini-pi

In our mini-pi we don't have custom message types yet. But we can prepare for them.

`src/agent/types.ts`:

```ts
import type { Message } from "../llm/types.js";

// In real apps, extend this via declaration merging
export interface CustomAgentMessages {}

export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

export interface AgentContext {
  systemPrompt?: string;
  messages: AgentMessage[];
  tools: AgentTool[];
}
```

`src/agent/loop.ts` (update):

```ts
export interface RunAgentOptions {
  signal?: AbortSignal;
  model: Model;
  apiKey?: string;
  maxTokens?: number;
  convertToLlm?: (messages: AgentMessage[]) => Message[];   // NEW
}

// In streamOneTurn:
const llmMessages = options.convertToLlm
  ? options.convertToLlm(context.messages)
  : (context.messages as Message[]);  // default: pass through

const llmStream = stream(options.model, { ...context, messages: llmMessages }, ...);
```

Now consumers can plug in `convertToLlm` when they have custom types. Default: pass through (works because `AgentMessage` defaults to `Message` when no extensions).

This is a **30-line change** that buys you the most powerful extensibility in the whole codebase. Worth it.

## Stop and try this

Imagine three custom message types you might want. For each, write the rule for `convertToLlm`:

1. **`statusNote`** — random "the agent is now in plan mode" UI badge. → `convertToLlm`: drop entirely.
2. **`fileWriteResult`** — UI render of a recent file write. → `convertToLlm`: drop, since the assistant already sees the tool result.
3. **`pinnedFile`** — a file the user has "pinned" so it appears in every LLM call. → `convertToLlm`: prepend as a `user` message with `[Pinned file: ...]`.

Each rule is one branch in a `flatMap`. Cumulatively they give you a rich UI that the LLM doesn't trip over.

## Key takeaways

1. Your transcript can include UI-only message types; the LLM call is a filtered view.
2. `convertToLlm(messages)` is the boundary function that runs once per LLM call.
3. This enables custom message types, compaction, status notes, anything UI-specific.
4. pi uses TypeScript declaration merging to make custom types fully type-safe.
5. The cost is one function and one extra step in the loop. The payoff is enormous flexibility.

---

**Next:** [Chapter 5 — The Stateful Agent](../05-stateful-agent/)
