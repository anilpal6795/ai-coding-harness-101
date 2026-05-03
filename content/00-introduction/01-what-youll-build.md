# Lesson 0.1: What You'll Build

## The end state

By the end of this course, you will have built a working coding agent — let's call it `mini-pi` — that you can run from your terminal:

```bash
$ mini-pi
> read the file package.json and tell me what scripts are defined
```

The agent will:

1. Show you a live-streaming response as the LLM thinks and types
2. Display a "tool call" box when it decides to read `package.json`
3. Execute the read tool against your filesystem
4. Show the file contents (collapsed by default — you can expand with a keypress)
5. Continue with a natural-language summary of the scripts
6. Wait for your next message

When you press `Ctrl+C`, the session is saved to disk. Next time you run `mini-pi --continue`, you pick up where you left off.

## What's in the box

By the time you finish Chapter 10, your `mini-pi` will have all of these:

| Feature | Lesson built in |
|---|---|
| Stream responses from Claude (or any LLM) | Chapter 2 |
| Define tools with type-safe schemas | Chapter 3 |
| Multi-turn conversations with tool execution | Chapter 4 |
| Built-in tools: `read`, `write`, `edit`, `bash` | Chapter 5 |
| Abort with `Esc`, queue messages while busy | Chapter 5 |
| Sessions saved to disk, resume with `--continue` | Chapter 6 |
| Terminal UI with live streaming markdown | Chapter 7 |
| Slash commands (`/help`, `/quit`, `/model`) | Chapter 8 |
| Plugin system for adding your own tools | Chapter 9 |
| Multi-provider support (Anthropic, OpenAI, ...) | Chapter 10 |

## What's NOT in the box

To keep this course focused, we **deliberately skip**:

- OAuth flows for Anthropic Pro / GitHub Copilot subscriptions (use API keys)
- Complex compaction strategies (we'll do a simple one)
- Cross-provider message replay (single-provider conversations only)
- IDE integrations (we're terminal-only)
- Web UI version (terminal-only)
- The full ~30 built-in tools pi has (we'll have ~5)

You'll have learned enough by the end to add any of these on your own.

## A taste of what we're building

Here's what your TUI will look like by the end:

```
┌──────────────────────────────────────────────┐
│ mini-pi v0.1.0                               │
│ Working dir: /Users/you/projects/myapp       │
│ Press / for commands, ? for help             │
├──────────────────────────────────────────────┤
│                                              │
│ > read package.json                          │
│                                              │
│ ⚙ I'll read package.json for you.            │
│                                              │
│ ┌─ read ──────────────────────────┐          │
│ │ package.json                    │          │
│ │ ─────────────────────────────── │          │
│ │ {                               │          │
│ │   "name": "myapp",              │          │
│ │   "scripts": {                  │          │
│ │     "build": "tsc",             │          │
│ │     ...                         │          │
│ └─────────────────────────────────┘          │
│                                              │
│ Your package.json defines three scripts:     │
│  • build — compiles TypeScript               │
│  • test  — runs the test suite               │
│  • dev   — starts dev server                 │
│                                              │
├──────────────────────────────────────────────┤
│ > █                                          │
├──────────────────────────────────────────────┤
│ claude-sonnet-4 │ 1.2k tokens │ $0.003       │
└──────────────────────────────────────────────┘
```

## How big is this?

Real talk on scope:

- pi-coding-agent (the production version): ~30,000 lines
- pi-mono total: ~80,000 lines including the AI, agent, and TUI libs
- **Your mini-pi: ~1,500 lines**

The difference isn't quality — it's features. pi has 15 LLM provider integrations, OAuth flows for 5 of them, an extension marketplace, branching session trees, theme hot-reload, keybinding customization, MCP-free skills, etc. Each of those is *a feature*, not *complexity in the core*. The core that we'll build IS the same core pi has.

That's the most important takeaway from this lesson: **the agent core is small.** The product around it is large. We're going to build the small core well, and you'll see exactly which features you'd add and how.

## The "aha" moment to look forward to

Sometime around Chapter 4, you'll write the agent loop and run it for the first time. You'll watch your terminal as Claude streams text, then makes a tool call, then sees your tool's response, then continues with new text. It will feel like magic — except you'll know exactly how it works because you wrote it.

That moment is what this course is about. Everything before that lesson is preparation; everything after is polish.

## Stop and try this

Before continuing, take 2 minutes to install pi (the production version) and play with it:

```bash
npm install -g @mariozechner/pi-coding-agent
export ANTHROPIC_API_KEY=sk-ant-...
pi
```

Type a few prompts. Try `read README.md`. Try `/help`. Type something then hit `Esc`. Press `Tab` to autocomplete a path. Press `Ctrl+T` to collapse thinking.

This is the UX you're about to learn to build. **Feel it before you build it.**

---

**Next:** [Lesson 0.2 — The Big Picture](./02-the-big-picture.md)
