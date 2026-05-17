# Anatomy of pi

Throughout this course, pi-mono is your reference implementation. Let's tour it so you know where to look when the course points you somewhere.

This lesson is a map. You're not expected to read pi's source in detail yet — just know where everything lives.

## The packages

pi-mono is a monorepo with 7 packages:

```
packages/
├── ai/               ← Layer 2: LLM transport (15+ providers)
├── agent/            ← Layer 3a: Agent loop and class
├── tui/              ← Layer 3b: Terminal UI library
├── coding-agent/     ← Layer 4: The product (the `pi` CLI)
├── mom/              ← A different Layer 4: Slack bot (uses agent + ai)
├── web-ui/           ← A different Layer 3b: Web UI components
└── pods/             ← Unrelated: deploy LLMs to GPU pods
```

For this course, you only care about the first four. `mom`, `web-ui`, and `pods` are bonus material.

## The dependency graph

```
            pi-ai
          (transport)
              │
      ┌───────┼───────┐
      │       │       │
      ▼       ▼       ▼
pi-agent  pi-tui  (web-ui)
   │        │
   └────┬───┘
        ▼
 pi-coding-agent
   (the product)
        │
        ├──► mom (Slack bot)
        └──► pods (GPU deploy)
```

Two things to notice:

1. `pi-tui` and `pi-ai` are **siblings** — neither depends on the other. They only meet inside `pi-coding-agent`.
2. `pi-agent` depends on `pi-ai` (it needs to call the LLM) but knows nothing about UIs.

This is the layering from Lesson 0.2. It's worth re-reading that lesson now if it didn't fully click before.

## Tour of `pi-ai`

```
packages/ai/src/
├── types.ts                ◄── START HERE: the data model
├── stream.ts               ◄── public API
├── api-registry.ts         ◄── how providers register
├── env-api-keys.ts         ◄── reads OPENAI_API_KEY etc.
├── models.generated.ts     ◄── auto-generated catalog of models
├── oauth.ts                ◄── separate entry: OAuth flows
├── providers/
│   ├── register-builtins.ts        ◄── lazy loader
│   ├── anthropic.ts                ◄── one file per provider
│   ├── openai-completions.ts
│   ├── openai-responses.ts
│   ├── google.ts
│   ├── ... (15+ providers)
│   ├── transform-messages.ts       ◄── cross-provider replay
│   └── faux.ts                     ◄── fake provider for tests
└── utils/
    └── event-stream.ts     ◄── async iterable plumbing
```

**Public surface:** `stream()`, `complete()`, `streamSimple()`, `completeSimple()`, plus types.

**Job:** take a Model and a Context, return a normalized event stream.

You'll mirror this in Chapter 2.

## Tour of `pi-agent`

```
packages/agent/src/
├── types.ts        ◄── START HERE: AgentEvent, AgentTool, AgentMessage
├── agent-loop.ts   ◄── the loop itself, as plain functions
├── agent.ts        ◄── Agent class, wraps loop with state
├── proxy.ts        ◄── alternative streamFn for browser → backend
└── index.ts        ◄── exports
```

**5 files. ~1500 lines total.** That's the entire agent harness.

**Public surface:** `Agent` class, `agentLoop()` function, types.

**Job:** turn an LLM event stream into a stateful loop with tools and events.

You'll mirror this in Chapters 4-5.

## Tour of `pi-tui`

```
packages/tui/src/
├── tui.ts                  ◄── TUI class, render loop, overlays
├── terminal.ts             ◄── Terminal abstraction
├── terminal-image.ts       ◄── inline image protocols
├── keys.ts                 ◄── key parsing
├── keybindings.ts          ◄── matchesKey() helpers
├── stdin-buffer.ts         ◄── raw input chunking
├── utils.ts                ◄── visibleWidth, truncate (ANSI-aware)
├── autocomplete.ts         ◄── slash + file completion
├── fuzzy.ts                ◄── fuzzy matcher
├── undo-stack.ts           ◄── for editor
├── kill-ring.ts            ◄── for editor
├── editor-component.ts     ◄── editor type contract
└── components/
    ├── text.ts, truncated-text.ts, spacer.ts, box.ts
    ├── input.ts, editor.ts            ◄── focusable inputs
    ├── markdown.ts                    ◄── markdown renderer
    ├── select-list.ts, settings-list.ts
    ├── loader.ts, cancellable-loader.ts
    └── image.ts                       ◄── inline images
```

**Public surface:** `TUI` class, `Component` interface, all the components.

**Job:** render `Component`s to a terminal with diffing and synchronized output.

You'll mirror this in Chapter 7.

## Tour of `pi-coding-agent`

This is the big one. It's the product.

```
packages/coding-agent/src/
├── main.ts                       ◄── CLI bootstrap
├── cli.ts                        ◄── argv entry
├── package-manager-cli.ts        ◄── pi install / pi remove
├── config.ts                     ◄── paths, version
├── migrations.ts                 ◄── settings/auth migration
├── index.ts                      ◄── SDK re-exports
│
├── cli/                          ◄── CLI helpers
│   ├── args.ts                   flag parsing
│   ├── file-processor.ts         @file argument expansion
│   ├── initial-message.ts
│   ├── list-models.ts
│   └── session-picker.ts
│
├── core/                         ◄── domain logic, no terminal code
│   ├── sdk.ts                    public createAgentSession()
│   ├── agent-session.ts          owns Agent + sessions + compaction
│   ├── agent-session-runtime.ts  multi-session runtime
│   ├── auth-storage.ts           auth.json
│   ├── model-registry.ts         available models
│   ├── model-resolver.ts         --model pattern matching
│   ├── session-manager.ts        JSONL session files
│   ├── settings-manager.ts       settings.json
│   ├── resource-loader.ts        find extensions/skills/themes
│   ├── extensions/               extension API
│   ├── tools/                    built-in tools (read/write/bash/...)
│   ├── compaction/               auto-compact when ctx full
│   ├── prompt-templates.ts
│   ├── skills.ts
│   ├── slash-commands.ts
│   ├── keybindings.ts
│   ├── system-prompt.ts          builds the system prompt
│   ├── messages.ts               custom AgentMessage types
│   ├── footer-data-provider.ts
│   └── export-html/
│
└── modes/
    ├── interactive/              ◄── the TUI
    │   ├── interactive-mode.ts   5K-line UI integration
    │   ├── components/           ~30 message/dialog components
    │   ├── theme/                dark/light themes
    │   └── assets/
    ├── print-mode.ts             -p text/json output
    └── rpc/                      JSON-RPC over stdin/stdout
```

**Job:** glue Layers 2 + 3a + 3b together, add product features.

You'll mirror this in Chapter 8.

## Files I want you to bookmark

Throughout the course, these files are referenced repeatedly. Bookmark them now in your editor:

| File | What it is |
|---|---|
| `packages/ai/src/types.ts` | The canonical Message/Event shapes |
| `packages/ai/src/stream.ts` | The public LLM stream API |
| `packages/ai/src/providers/anthropic.ts` | A real provider implementation |
| `packages/agent/src/types.ts` | Agent contracts |
| `packages/agent/src/agent-loop.ts` | The production agent loop |
| `packages/agent/src/agent.ts` | The Agent class |
| `packages/tui/src/tui.ts` | The TUI core |
| `packages/tui/src/components/editor.ts` | The most complex TUI component |
| `packages/coding-agent/src/main.ts` | The CLI bootstrap |
| `packages/coding-agent/src/core/agent-session.ts` | The session orchestrator |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | The TUI integration |

When the course says "compare to `packages/X/Y.ts`," that's the file to open.

## Reading line counts (for context)

If you're curious about scale:

```
ai/src                       ~10,000 lines (most of it provider implementations)
agent/src                    ~1,500 lines
tui/src                      ~5,000 lines
coding-agent/src             ~30,000 lines (mostly product features)
```

Your mini-pi by the end of this course: ~1,500 lines total.

The point: **the agent core is small.** The product around it is large because products *are* large. We're focusing on the small core that you can actually understand.

## Stop and try this

Open a fresh terminal:

```bash
cd /Users/anil/Code/pi-mono   # this repo
wc -l packages/agent/src/*.ts
```

You should see something like:

```
       683 packages/agent/src/agent-loop.ts
       543 packages/agent/src/agent.ts
       366 packages/agent/src/types.ts
       130 packages/agent/src/proxy.ts
         9 packages/agent/src/index.ts
      1731 total
```

That's the **entire production agent core** that powers pi. 1,700 lines. Most of it is comments and types. The actual logic is maybe 800 lines.

You can read this in a weekend. You don't need a framework.

## Key takeaways

1. pi-mono = 7 packages, but only 4 matter for you: ai, agent, tui, coding-agent
2. Dependency graph: ai is foundation; agent and tui are siblings; coding-agent glues them
3. agent core is genuinely small — ~1500 lines
4. coding-agent (the product) is large, but the largeness is features, not architecture
5. Bookmark the files listed above; you'll reference them constantly

---

**Next:** [Chapter 2 — The LLM Transport Layer](../02-llm-transport/)
