# Chapter 6: Sessions & Persistence

A coding agent without persistence is a chat interface. With persistence, it's a tool that survives across days, machines, and weeks of work. This chapter covers the disk format, branching, and compaction.

## Lessons

1. **[The JSONL session format](./01-jsonl-session-format.md)** — Append-only log, why it works
2. **[Loading and resuming](./02-loading-and-resuming.md)** — Restore a session faithfully
3. **[Branching and forking](./03-branching-and-forking.md)** — Explore alternate paths
4. **[Compaction](./04-compaction.md)** — Don't blow the context window

## Time estimate

~70 minutes total.

## What you'll know by the end

- Why JSONL beats JSON for conversation logs
- How to design a format that supports branching
- The compaction algorithm and its tradeoffs
- A minimal, robust session manager you can drop into any agent

## Why this chapter matters

Sessions turn an agent from a toy into infrastructure. Once your conversations persist, you start using the agent for real work. This chapter is short but essential.
