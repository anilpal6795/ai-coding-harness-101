# Lesson 10.3: Where to Go Next

You finished the course. Here's what to do with it.

## You now have

- A working coding agent harness (~1500 lines of TypeScript)
- A mental model of how every coding agent works
- The ability to read pi's source (and Cursor's, and Claude Code's) and understand what's happening
- A foundation to build a real product on, if you want to

## What to build next

Sorted by value-to-effort. Pick what serves you.

### High value, low effort

These give the most product per line of code:

- **Markdown rendering** — your assistant messages would benefit immensely. ~200 lines using `marked`.
- **AGENTS.md loading** — read project context into the system prompt. ~30 lines.
- **More built-in tools** — `grep`, `find`, `ls`. ~50 lines each.
- **`@file` syntax** — let users prefix file paths with `@` to attach in their message. Pi has this. ~50 lines.
- **Basic theming** — even just colors loaded from a JSON file. ~50 lines.
- **Better error messages** — when API key missing, when model not found, etc.

Doing all of these takes a weekend and turns mini-pi into something you'd actually use.

### Medium value, medium effort

For when you've outgrown the basics:

- **Permission gates for destructive operations** — prompt before `rm`, `git push --force`, etc. Use `beforeToolCall`.
- **OAuth for Claude Pro / GitHub Copilot subscription auth** — let users use their existing subscriptions.
- **Better compaction** — replace the truncation strategy with LLM-based summarization.
- **Branching sessions** — the tree view UX from pi.
- **Plugin system (Chapter 9)** — when users want features you don't.
- **Image input** — paste/drag images into the editor.
- **Terminal image rendering** — display images inline (Kitty graphics protocol).

These take a few days each and elevate mini-pi to feature-parity with smaller commercial agents.

### High effort

These make mini-pi a serious product:

- **15+ providers** — like pi has. Each is ~500 lines and a maintenance commitment.
- **Multi-session runtime** — run multiple agents in parallel for an IDE extension.
- **Sandbox tool execution** — Docker, git worktrees, VM-based isolation.
- **Web UI** — browser-based agent (pi has this in `pi-web-ui`).
- **Slack/Discord bot** — embed the agent in chat (pi has this in `pi-mom`).
- **Hosted version** — agent-as-a-service with billing, multi-tenant, etc.

These are weeks-to-months projects. Only worth it if you're shipping a real product.

## Where to study next

If you want to go deeper than this course:

### Read other agent codebases

Each takes a different approach:

- **[pi-mono](https://github.com/badlogic/pi-mono)** — the reference for this course
- **[Aider](https://github.com/Aider-AI/aider)** — Python, git-native, terminal
- **[Continue](https://github.com/continuedev/continue)** — IDE-focused
- **[Cline](https://github.com/cline/cline)** — VS Code extension, open-source
- **[OpenCode](https://github.com/opencode-ai/opencode)** — TypeScript, similar architecture

Compare the agent loops. You'll see the same pattern with variations.

### Read provider docs

Beyond Anthropic:

- [OpenAI Tool Use](https://platform.openai.com/docs/guides/function-calling)
- [Anthropic Tool Use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use)
- [Gemini Function Calling](https://ai.google.dev/docs/function_calling)
- [Vercel AI SDK](https://sdk.vercel.ai/) — a different abstraction worth knowing

### Read the original papers

For depth on agent design:

- **ReAct** (Yao et al., 2022) — reasoning + acting interleaved
- **Reflexion** (Shinn et al., 2023) — agent self-criticism loops
- **Toolformer** (Schick et al., 2023) — early tool-use training

These are dated now (modern instruction tuning subsumes them) but historically interesting.

### Watch building-from-scratch videos

Several developers have done "build a coding agent live" streams. Search YouTube for:

- "build agent from scratch"
- "coding agent tutorial"
- "claude code clone"

## Communities

Where the people building these things hang out:

- **pi Discord** — referenced in pi's README
- **r/LocalLLaMA** — for local model agents
- **Hugging Face** — datasets of agent sessions (pi publishes some)
- **Various Discord servers** for specific frameworks

## Keep learning by building

The single best advice: **keep building**. Pick something on the "what to build next" list and ship it. Reading more isn't going to teach you what shipping does.

Suggestions for first projects after this course:

1. **Add markdown rendering** to mini-pi. Pick a renderer, integrate. 1-2 days.
2. **Build a Slack bot** version. Reuse the agent core; add Slack as the I/O layer. 1 week.
3. **Build a tool that reads a PDF and answers questions about it.** New tool type, new prompt patterns. 2-3 days.
4. **Make a domain-specific agent** — e.g., a SQL database analyst, a Kubernetes ops agent, a customer support bot. Same harness, different tools and prompt.
5. **Open-source mini-pi.** Get feedback from real users. Their requests will teach you what's actually missing.

## A philosophical note

The agent loop is a beautiful pattern. It's small, expressive, and deeply useful. You can build incredible things with it.

But: **the model does the hard part.** Your harness is plumbing. Don't fall into the trap of thinking your harness is the magic. The magic is in Claude or GPT or Gemini.

Your job is to be a great steward of that magic — give it good tools, clean inputs, faithful execution. The product quality is in your harness's craftsmanship, not its complexity.

Pi is good because it's small and well-crafted. Aim for that.

## Final exercise: ship something

For your final exercise, pick one project from the list above. Build it. Use it for a week. Iterate based on what annoys you.

You'll learn more from one shipped project than from twenty more lessons.

## Closing

You started this course not knowing what an agent harness is. You finished knowing how to build one and what's important in the design.

That's a real skill. Coding agents are reshaping how software is built. People who understand them deeply — not just use them — have an outsized impact.

Go make something.

---

**[Back to course README](../README.md)**
