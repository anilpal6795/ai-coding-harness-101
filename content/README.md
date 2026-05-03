# Build a Coding Agent Harness Like Pi — From Scratch

A self-paced course that walks you through every layer of a production-grade coding agent CLI. By the end, you'll have built your own working coding agent — and more importantly, you'll understand exactly what's happening at every layer of tools like Claude Code, Cursor, Aider, and pi itself.

---

## Who this course is for

You're the right student if:

- You've used a coding agent (Claude Code, Cursor, Aider, pi) and want to understand how it works under the hood
- You can write TypeScript or JavaScript at an intermediate level
- You've called an LLM API at least once (we'll go deeper, but you should know what an API key is)
- You learn best by building, not by reading specs

You're **not** the right student if:

- You're looking for prompt engineering tips (this isn't that)
- You want a no-code "how to use ChatGPT" guide (also not that)
- You want a survey of every agent framework (we focus on building one, not comparing many)

## What you'll build

By Chapter 10, you'll have built a working coding agent in roughly **1,500 lines of TypeScript** that can:

- Stream responses from any LLM provider
- Execute tools (read files, write files, run bash commands)
- Maintain a conversation that survives multiple turns
- Persist sessions to disk and resume them later
- Render in a terminal UI with live updates and proper input handling
- Be extended with plugins

This is roughly the same architecture as `pi` itself, just smaller.

## Prerequisites

- **Node.js 20+** — we use modern async iteration features
- **An Anthropic API key** — sign up at https://console.anthropic.com (we use Claude as the reference provider; everything you learn applies to other providers)
- **A terminal** — you'll be running CLI apps a lot
- **TypeScript familiarity** — types, generics, async/await, basic interfaces
- **Git** — for cloning the reference codebase (this very repo)

That's it. No knowledge of agent frameworks, no LangChain experience, no ML background needed.

## How to use this course

### Recommended pace

The course is **10 chapters**, each with 3-5 lessons. Estimated time investment:

- **Light pace**: 1 chapter per week (~10 weeks)
- **Standard pace**: 2 chapters per week (~5 weeks)
- **Intensive**: 1 chapter per day (~10 days)

Don't skip chapters — each one builds on the last. Especially do not skip Chapter 4 (The Agent Loop) — it's the centerpiece.

### How to consume each chapter

Every chapter follows this pattern:

1. **Read the chapter README** — overview of what you'll learn
2. **Work through lessons in order** — each is a focused topic, 10-30 minutes of reading
3. **Run the examples** — most chapters have working code in `examples/` you can `npx tsx` directly
4. **Do the exercises** — at the end of most chapters
5. **Reference the real code** — every concept points to the equivalent in pi-mono so you can see "production" version

### A note on theory vs code

This course is **theory-heavy by design**. The reason: the concepts are universal but the code rots. If you understand the concepts deeply, you can rebuild a coding agent in any language, on any provider, in any UI framework. If you only memorize code, you're stuck.

That said — every chapter has runnable code, and Chapters 4, 7, and 8 contain enough working code that you'll have a real agent by the end.

---

## Course outline

### Foundations

**[Chapter 0: Introduction & Setup](./00-introduction/)**
What you'll build. Setting up your project. How agent harnesses are structured.

**[Chapter 1: Agent Fundamentals](./01-agent-fundamentals/)**
What an agent actually is. The agentic loop. Why coding agents are special. The pi-mono mental model.

### The transport layer

**[Chapter 2: The LLM Transport Layer](./02-llm-transport/)**
How LLM APIs work. Streaming. Message formats. Building a normalized event protocol.

**[Chapter 3: Tools — Defining and Executing](./03-tools/)**
What tools look like to an LLM. JSON Schema and TypeBox. Validating arguments. Streaming partial JSON.

### The harness

**[Chapter 4: The Agent Loop](./04-agent-loop/)**
The reactor pattern. Building a 50-line working agent loop. The `convertToLlm` boundary. Event subscription.

**[Chapter 5: The Stateful Agent](./05-stateful-agent/)**
Wrapping the loop in a stateful class. Abort and cancellation. Steering & follow-up queues. Hooks. Error handling.

**[Chapter 6: Sessions & Persistence](./06-sessions-persistence/)**
Why sessions matter. JSONL format. Branching and forking. Compaction strategies.

### The user interface

**[Chapter 7: Building a Terminal UI](./07-terminal-ui/)**
Terminal fundamentals (ANSI, escape codes). The component model. Differential rendering. Synchronized output. Input handling.

**[Chapter 8: Wiring Agent + TUI](./08-wiring-it-all/)**
The interactive mode. Subscribing to agent events. Rendering messages and tool calls. Slash commands. The footer.

### Going to production

**[Chapter 9: Extensibility](./09-extensibility/)**
Why plugin systems matter. Designing an extension API. Loading TypeScript at runtime. Skills and prompt templates.

**[Chapter 10: Going Beyond](./10-going-beyond/)**
Multi-provider support. Alternate run modes (RPC, print). Where to take this next.

---

## How this course relates to pi-mono

This entire course was written based on a careful reading of the [pi-mono](https://github.com/badlogic/pi-mono) codebase, which lives in this same repository. Throughout the course you'll see references like:

> See `packages/agent/src/agent-loop.ts:155` for the production version

That means: "what we just built is the simplified pedagogical version; the real-world code is at that location, with all the edge cases handled."

You're encouraged to keep the pi-mono source open in another window. **Reading production code after you've built the simple version yourself is one of the fastest ways to learn.**

---

## Conventions used in this course

- **Code blocks** are TypeScript unless otherwise noted
- **`packages/X/src/Y.ts:N`** points to a file and line in pi-mono
- **Sidebars** like the one below mark optional deep-dives:

> 💡 **Deep dive**: Optional sections like this give you the "why" behind a design choice. Skip on first read; come back when you want to know more.

- **Exercises** appear at the end of chapters — don't skip them
- **"Stop and try this"** boxes mid-chapter ask you to pause and experiment

---

## Setting up

Before Chapter 0, make sure you can run:

```bash
node --version    # should be 20+
npm --version     # any recent version
```

If both work, you're ready. Head to **[Chapter 0: Introduction & Setup](./00-introduction/)**.

---

## A final note before you start

Building an agent harness is a **systems engineering** task, not a machine learning task. You don't need to know anything about transformers, fine-tuning, or RLHF. You're going to be writing clean async TypeScript that orchestrates an LLM, a UI, a filesystem, and a user.

That said — the design decisions you make here have outsized impact on how your agent feels to use. The difference between a great coding agent and a bad one is rarely the model; it's the harness. **You are about to learn how to build the harness.**

Let's go.
