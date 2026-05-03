# Lesson 1.3: What Makes a Coding Agent

We've established what an agent is. Now: what's special about a *coding* agent?

## The core difference

A coding agent is an agent whose primary tools manipulate **code and computers**:

- Read and write files
- Run shell commands
- Search across files
- Apply structured edits
- Run tests, builds, linters

Generic agents might have tools like "send email," "look up calendar," "query database." Coding agents have tools like `read`, `write`, `edit`, `bash`, `grep`.

That's the surface difference. Underneath, coding agents have **specific design pressures** that other agents don't:

## Pressure 1: Long sessions

A user asks a coding agent: "refactor this codebase to use TypeScript strict mode."

That's not one tool call. It might be:

- Read 50 files to understand the structure
- Write 30 files to apply changes
- Run `tsc` to find errors
- Read those errors
- Fix the errors
- Run `tsc` again
- Iterate until clean

That could be 200+ tool calls and consume 100,000+ tokens. **Coding agents need to handle very long contexts.**

This is why pi (and any serious coding agent) needs:

- **Context compaction** — when the LLM's context window fills, summarize old turns to make room
- **Persistent sessions** — if the conversation is hours long, you need to be able to come back to it
- **Token/cost tracking** — users want to know what they're spending

## Pressure 2: Destructive actions

If a generic chatbot is wrong, you laugh and try again. If a coding agent is wrong:

- It overwrites your work
- It deletes a file you cared about
- It pushes to main when you wanted a feature branch
- It runs `rm -rf` based on a misunderstanding

Coding agents need **safety mechanisms**:

- Permission prompts before destructive actions (some agents)
- Sandboxing (containers, git worktrees)
- File mutation queues so concurrent operations don't race
- Reversibility (every operation should be undoable, ideally)
- Read-only modes for "review" use cases

pi takes a position on this: **no permission popups by default**, but it provides hooks (`beforeToolCall`) so you can add your own gates if you want them. The philosophy is "give the user enough control to build their own safety."

## Pressure 3: Live progress

Code operations take time:

- `npm install` runs for 30 seconds
- A build might run for minutes
- A test suite might run for tens of minutes

Users will not stare at a frozen terminal. Coding agents need:

- **Streaming** — as the LLM produces text, show it character by character
- **Progress indicators** — for long-running tools, stream updates ("now reading file 42 of 100")
- **Abort** — let the user say "stop, you're going the wrong direction"
- **Steering** — let the user inject "actually, also do X" without restarting

These are why coding agents have rich TUIs, not just `console.log`.

## Pressure 4: Tool design matters more

In a chatbot, the LLM produces text. In a coding agent, the LLM uses tools. **Tool design is now product design.**

A `read` tool that returns "file contents" is fine. A `read` tool that:

- Auto-truncates huge files
- Adds line numbers
- Detects if the file is an image and returns it as image content
- Returns metadata about whether the file exists

…is a much better tool. It saves the LLM from having to handle edge cases and produces better-looking results.

You'll see in `packages/coding-agent/src/core/tools/read.ts` how much thought goes into a single "read" tool. It's 400+ lines. That's not bloat — every line is removing a failure mode.

The lesson: **in a coding agent, every tool is a small product.** Design them carefully.

## Pressure 5: Project context matters

A generic chatbot doesn't know what project you're in. A coding agent should.

That's why pi loads:

- `AGENTS.md` (or `CLAUDE.md`) — project-specific instructions
- The current working directory
- The contents of relevant files when you `@mention` them
- Git status, branch name, recent commits

Without this context, the agent gives generic answers. With it, the agent knows your conventions, your stack, your in-flight work.

This is why the system prompt for a coding agent is much richer than a chatbot's. We'll see how to build one in Chapter 8.

## Pressure 6: Reproducibility and debugging

When a chatbot says something weird, you screenshot it. When a coding agent does something weird, you need to:

- See exactly what tool calls it made
- See exactly what the tools returned
- See what was in the model's context at the time
- Re-run from a specific point with a different prompt

This is why pi has:

- Session JSONL files with every message
- A tree view (`/tree`) to navigate session history
- Branching — fork a session at any point and try a different path
- Export to HTML for sharing

Coding agents are **inspectable** in a way chatbots aren't.

## What this means for our build

Because of these pressures, mini-pi will need (at minimum):

- ✅ Streaming responses (Chapter 2)
- ✅ Tool execution with proper error handling (Chapter 3-5)
- ✅ Built-in coding tools: read, write, edit, bash (Chapter 5)
- ✅ Session persistence to disk (Chapter 6)
- ✅ A real TUI, not just `console.log` (Chapter 7)
- ✅ Abort and steering (Chapter 5, Chapter 8)
- ✅ Project context loading (Chapter 8)

These aren't optional polish. They're **what makes it a coding agent** instead of a generic chat-with-tools demo.

## What we'll skip (and why)

To keep mini-pi tractable, we'll skip:

- **Compaction** beyond a simple "drop oldest messages" strategy. Real compaction (summarizing old turns) is its own essay.
- **Sandboxing.** We'll trust the user's filesystem. Real coding agents often run in Docker or git worktrees for safety.
- **Tree-view session navigation.** We'll have linear sessions only. pi's tree is great UX but adds significant complexity.
- **Export to HTML.** Nice feature, not essential to learn the concepts.

You can add any of these once you understand the core. They're features, not architecture.

## The market

To put this in context, here are some coding agents in the wild and what makes each one notable:

| Agent | Notable for |
|---|---|
| **Cursor** | Tight IDE integration, predictive edits |
| **Claude Code** | Anthropic's first-party CLI, very polished |
| **Aider** | Git-native, designed around commits |
| **pi** | Aggressively extensible, terminal-first |
| **Cline / Roo Code** | VSCode extension, plan + execute modes |
| **Continue** | Open-source, multi-IDE |
| **Codex** | OpenAI's CLI, ChatGPT-tied |

Look at the differences: same agent loop underneath, very different products. The differentiation is in:

1. The UX (terminal vs IDE vs web)
2. The tools (which ones, how they're presented)
3. The safety model (sandboxed vs not)
4. The integrations (git, IDE, CI)
5. The auth model (subscription vs API key)

What you're learning in this course is the *common substrate*. The product on top is your design choice.

## A philosophical question

Is a coding agent just a "chatbot with tools that touch a filesystem"? Technically yes. But the design pressures listed above mean the product feels completely different to use:

- A chatbot is a *conversation*
- A coding agent is a *collaborator*

That's not just marketing. The presence of streaming, tool execution, abort, project context, and session persistence creates an interaction that feels like working with someone, not asking a magic 8-ball. Your job as a harness builder is to lean into that.

## Stop and try this

If you have access to two different coding agents (e.g., pi and Claude Code), open both and ask the same question to each:

> "Read package.json and tell me if any dependencies look outdated"

Note the differences in:

- How the tool calls are presented visually
- What information is shown vs hidden
- Whether you can interrupt mid-execution
- What it does when it's "done"

These differences are *all UX decisions in the harness*. The model is doing the same job in both cases.

## Key takeaways

1. Coding agents are agents with code/system tools.
2. Design pressures unique to coding: long sessions, destructive actions, slow tools, project context, inspectability.
3. These pressures dictate features: streaming, persistence, abort, sandboxing, rich TUIs.
4. Tool design is product design — invest in your tools.
5. Same agent loop everywhere; the differentiation is UX and tool quality.

---

**Next:** [Lesson 1.4 — Anatomy of pi](./04-anatomy-of-pi.md)
