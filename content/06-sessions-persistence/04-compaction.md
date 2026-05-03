# Lesson 6.4: Compaction

Long coding sessions accumulate tokens fast. Eventually you hit the context window. Compaction is how you keep going.

## The problem

Models have context windows: Claude Sonnet 4 has 200K tokens. That's roughly 150K words. A long coding session can:

- Read 50 files (40K tokens of file content)
- Run 30 bash commands (10K tokens of output)
- Generate 100 assistant turns (50K tokens of explanations)

You're at 100K and climbing. By turn 150 you're hitting the limit. The next API call returns `"context length exceeded"`.

## Two responses

### Response A: Crash

Simplest: return an error to the user, suggest starting a new session. Bad UX. They lose context.

### Response B: Compact

Summarize old messages into a shorter form. Continue with the summary in place of the originals.

The user's experience: "the conversation continues" even though under the hood we replaced 50 messages with a 1-paragraph summary.

## Compaction: the algorithm

```
1. When approaching the context limit (e.g., at 80% capacity):
2. Identify the OLDEST messages to compact (e.g., everything before turn N-K)
3. Send those messages to the LLM with a "summarize this" prompt
4. Receive a summary
5. Replace the old messages with one CompactionSummary message
6. Continue
```

Pseudocode:

```ts
async function compactIfNeeded(messages: Message[], model: Model): Promise<Message[]> {
  if (estimateTokens(messages) < model.contextWindow * 0.8) {
    return messages;  // no need yet
  }

  // Keep the last K messages verbatim
  const KEEP_RECENT = 10;
  const toCompact = messages.slice(0, -KEEP_RECENT);
  const recent = messages.slice(-KEEP_RECENT);

  const summary = await summarizeMessages(toCompact, model);

  return [
    {
      role: "compactionSummary",
      summary,
      compactedCount: toCompact.length,
      timestamp: Date.now(),
    },
    ...recent,
  ];
}
```

Two key parameters:

- **When to compact** (e.g., at 80% capacity)
- **What to keep** (e.g., last 10 messages verbatim)

Both are heuristics. Tune to taste.

## The summarization prompt

What do you ask the LLM to summarize?

A naive "summarize this conversation" loses too much. A coding agent's transcript has:

- Files that were read (and matter for future context)
- Decisions that were made
- Bugs that were found
- Outputs that the user is referring to ("the error from earlier")

A better prompt:

```
You are summarizing the first portion of a coding session.
The summary will replace these messages in the conversation context,
so future messages can reference it.

Include:
- Files read or modified, with key contents
- Decisions and their rationale
- Errors encountered and their resolutions
- Any unresolved questions

Format as a concise but complete summary preserving technical detail.
Avoid pleasantries.

<messages>
[the messages to compact]
</messages>
```

Pi's compaction prompt is more elaborate — see `packages/coding-agent/src/core/compaction/`. The point: domain-aware summarization beats generic.

## Where compaction fits in the loop

Recall `transformContext` from Lesson 4.4. That's the hook:

```ts
const config: AgentLoopConfig = {
  transformContext: async (messages, signal) => {
    if (estimateTokens(messages) > model.contextWindow * 0.8) {
      return await compact(messages, model, signal);
    }
    return messages;
  },
};
```

`transformContext` runs *before* `convertToLlm`. It returns the messages to use for this LLM call. If compaction triggered, the new messages array has the summary instead of the originals.

The transcript on disk is unchanged — compaction only affects what's sent to the LLM. **Your full history is preserved.** You can `/tree` to navigate it (in pi's UI), or just read the JSONL file.

This is the elegance of `transformContext`: compaction is a function, not a state mutation. The agent's `messages` array stays full; the LLM gets a compressed view.

## When compaction triggers

Two strategies:

### Reactive: triggered by overflow error

The LLM call fails with "context too long." You catch it, compact, retry.

```ts
try {
  await stream(model, context);
} catch (err) {
  if (isContextOverflowError(err)) {
    context.messages = await compact(context.messages, model);
    return await stream(model, context);  // retry
  }
  throw err;
}
```

Pi has this for safety — if estimation was off and you hit the actual limit.

### Proactive: triggered by estimate

Estimate token count before each call. If above threshold, compact preemptively.

```ts
transformContext: async (messages, signal) => {
  const tokens = estimateTokens(messages);
  if (tokens > model.contextWindow * 0.8) {
    return await compact(messages, model, signal);
  }
  return messages;
}
```

This avoids one wasted call (the failed one). Most production agents use proactive.

Token estimation can be approximate — character count / 4 is a decent proxy for English; tokenizer libraries (`tiktoken`) are more accurate.

## Manual compaction

The user might want to compact mid-conversation, e.g., before a long tool batch. Pi has `/compact`:

```
/compact                    # use default summarization
/compact focus on the bug fixes  # custom focus
```

This is just a slash command that calls compact() with the user's optional instructions.

Implementation:

```ts
async function manualCompact(agent: Agent, focus?: string) {
  const messages = agent.state.messages;
  const summary = await summarizeMessages(messages.slice(0, -5), agent.state.model, focus);
  agent.state.messages = [
    { role: "compactionSummary", summary, ... },
    ...messages.slice(-5),
  ];
}
```

## What you lose

Compaction is **lossy**. The summary captures the gist, not the detail. You lose:

- Exact file contents that were read
- Specific tool outputs
- Subtle conversation tone

Mitigations:

- Re-read files when needed (the agent will do this)
- Keep recent messages verbatim (last K)
- The full history is on disk; you can branch/fork to recover a state

Tell users: "I just compacted the earlier conversation. I have the summary; if you reference something specific, I might re-read it."

## How aggressive should you be?

Three modes:

| Mode | Trigger | Keep recent | Notes |
|---|---|---|---|
| Conservative | 90% full | 30 msgs | Less compression, more context |
| Balanced (default) | 80% full | 10 msgs | Pi's default |
| Aggressive | 70% full | 5 msgs | More compression, longer sessions possible |

Pi makes this configurable. For mini-pi, just pick balanced.

## Compaction in the message log

When compaction happens, you have a CompactionSummary message in the transcript. UI renders it as:

```
─────────────────────────────────────────
  Earlier conversation (47 turns) compacted:
  [summary text]
─────────────────────────────────────────
```

User can click/expand to see the summary. The original messages are still in the file (not the in-memory array, but on disk).

If you want to "uncompact," the user opens the original session file (or a previous branch) where the full history exists.

## A minimal implementation for mini-pi

You don't need full compaction to start. A naive "drop oldest N messages" works:

```ts
transformContext: (messages: AgentMessage[]): AgentMessage[] => {
  const MAX = 50;  // keep last 50 messages
  if (messages.length <= MAX) return messages;
  return messages.slice(-MAX);
};
```

This loses the summary but is one line of code. Acceptable for an MVP.

To upgrade later: replace with proper LLM-based compaction. Same `transformContext` interface, smarter implementation.

## Stop and try this

Add naive truncation to your mini-pi:

```ts
const agent = new Agent({
  ...,
  convertToLlm: (messages) => {
    if (messages.length <= 30) return messages as Message[];
    console.log(`[compaction] dropping ${messages.length - 30} old messages`);
    return messages.slice(-30) as Message[];
  },
});
```

Then run a long session and watch:

```ts
for (let i = 0; i < 50; i++) {
  await agent.prompt(`Tell me a fact about ${i}.`);
}
```

You'll see the truncation message kick in around turn 30. The agent forgets the earliest turns but keeps going.

Replace truncation with summarization once you've got the basics working. The hook is the same; just the function changes.

## Key takeaways

1. Compaction = summarize old messages to free up context window.
2. Triggered by estimation (proactive) or overflow error (reactive).
3. Implemented via `transformContext` — runs once per LLM call.
4. Lossy but recoverable: full history stays on disk.
5. Naive truncation is a fine MVP; upgrade to LLM-based summarization when you have the basics.

---

**Next:** [Chapter 7 — Building a Terminal UI](../07-terminal-ui/)
