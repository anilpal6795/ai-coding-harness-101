# The Agent Loop

This is the heart of the entire course. By the end of this chapter, you'll have a working agent loop in ~100 lines of code that streams responses, executes tools, and handles multi-turn conversations.

If you only deeply understand one chapter in this course, make it this one.

## Lessons

1. **[The reactor pattern](./01-the-reactor-pattern.md)** — Why the loop is the right shape
2. **[The minimal loop](./02-the-minimal-loop.md)** — Building it, line by line
3. **[Events and subscription](./03-events-and-subscription.md)** — Letting the outside world watch
4. **[The convertToLlm boundary](./04-the-convert-to-llm-boundary.md)** — The single most important design decision

## Examples

- `examples/01-minimal-loop.ts` — the full minimal agent in one file
- `examples/02-loop-with-events.ts` — the same loop with event emission

## Time estimate

~90 minutes total.

## What you'll know by the end

- How to build the agent loop yourself, from scratch, with no framework
- The exact role each event type plays in the loop's lifecycle
- The `convertToLlm` boundary that lets you have UI-only message types
- A working agent in ~100 lines that you can run and extend

## Why this chapter matters

Frameworks hide the loop. The result: you don't understand your own agent. After this chapter, the loop will be transparent to you. You'll be able to debug any agent built on this pattern, anywhere.

This chapter is also where the course "clicks" — everything before was preparation; everything after is polish.
