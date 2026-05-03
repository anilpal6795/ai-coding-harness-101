# Chapter 5: The Stateful Agent

The minimal loop from Chapter 4 is stateless. You call it, it runs, it returns. For a real coding agent, you need state that persists between user messages, plus a bunch of features that only make sense as a stateful object.

## Lessons

1. **[Why state matters](./01-why-state-matters.md)** — When functional isn't enough
2. **[The Agent class](./02-the-agent-class.md)** — Wrapping the loop with state
3. **[Abort and cancellation](./03-abort-and-cancellation.md)** — Graceful interruption
4. **[Steering and follow-up queues](./04-steering-and-follow-up.md)** — Mid-flight user input
5. **[Hooks and error handling](./05-hooks-and-errors.md)** — beforeToolCall, afterToolCall, retries

## Time estimate

~90 minutes total.

## What you'll know by the end

- The full Agent class API and when to use which method
- How to abort cleanly without leaving zombie processes
- How to handle "the user typed while the agent was thinking" (one of the trickiest UX problems)
- How to add permission gates, audit logs, or retries without modifying the loop

## Why this chapter matters

Up to now you have a working agent. After this chapter, you have a *production-grade* agent — one that handles all the messy real-world cases (abort, errors, mid-flight input). This is what separates a demo from a tool people use every day.
