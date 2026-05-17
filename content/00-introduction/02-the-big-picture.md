# The Big Picture

This is the most important lesson in the entire course. If you internalize the layering pattern below, every chapter that follows clicks into place.

## The four-layer model

Every modern coding agent — Claude Code, Cursor, Aider, pi, the one you're about to build — has the same four layers:

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 4: PRODUCT                                       │
│  CLI app, slash commands, sessions, settings, themes,   │
│  extensions, the polish that makes it a real product    │
└──────────────────────┬──────────────────────────────────┘
                       │
       ┌───────────────┼─────────────────┐
       │                                 │
       ▼                                 ▼
┌─────────────────────┐         ┌────────────────────┐
│  LAYER 3a: AGENT    │         │  LAYER 3b: UI      │
│  Stateful loop,     │         │  Renderer, input,  │
│  tool execution,    │         │  components,       │
│  event emission     │         │  layout            │
└─────────┬───────────┘         └────────────────────┘
          │
          ▼
┌─────────────────────┐
│  LAYER 2: TRANSPORT │
│  LLM API client,    │
│  streaming events   │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  LAYER 1: PROVIDER  │
│  Anthropic, OpenAI, │
│  Google, etc.       │
└─────────────────────┘
```

Three things to notice:

1. **Layer 3a (Agent) and Layer 3b (UI) are siblings.** The agent doesn't know about the UI. The UI doesn't know about the agent. They only meet at Layer 4.
2. **Each layer talks to the layer below via a tiny contract.** Agent ↔ Transport is just "give me a stream of events." UI ↔ Product is just "render these components." This is why you can swap any layer without touching the others.
3. **Layer 1 is not your code.** Anthropic, OpenAI, etc. own their APIs. Your transport layer (Layer 2) wraps them.

## What lives in each layer (in pi-mono)

| Layer | pi-mono package | What's inside |
|---|---|---|
| 4. Product | `pi-coding-agent` | The CLI, the interactive mode, slash commands, sessions, extensions |
| 3a. Agent | `pi-agent-core` | The agent class, the loop, tool execution |
| 3b. UI | `pi-tui` | Terminal renderer, components, input handling |
| 2. Transport | `pi-ai` | LLM clients normalized to a single event protocol |
| 1. Provider | (third-party APIs) | Anthropic SDK, OpenAI SDK, etc. |

Notice: **pi-tui has no dependency on pi-ai or pi-agent.** It's a generic terminal UI library. You could use it for a text editor, a process monitor, anything. Same for pi-ai — it's a generic LLM client that knows nothing about agents or UIs.

This is the key design move: **build each layer to be useful on its own.** When you do that, the integration at Layer 4 becomes obvious.

## The same pattern in your mini-pi

When we build mini-pi, you'll create the same layers:

```
mini-pi/
├── src/
│   ├── llm/          ◄── Layer 2 (Transport)
│   │   ├── types.ts        Message, Context, events
│   │   ├── stream.ts       stream() function
│   │   └── anthropic.ts    Anthropic implementation
│   ├── agent/        ◄── Layer 3a (Agent)
│   │   ├── types.ts        AgentEvent, AgentTool
│   │   ├── loop.ts         the loop
│   │   └── agent.ts        Agent class
│   ├── ui/           ◄── Layer 3b (UI)
│   │   ├── tui.ts          renderer
│   │   ├── component.ts    base component
│   │   └── editor.ts       text input
│   └── app/          ◄── Layer 4 (Product)
│       ├── main.ts         entry point
│       ├── interactive.ts  ties UI + Agent
│       └── tools.ts        built-in tools
```

You'll notice this mirrors pi-mono's package structure exactly. That's not because we're copying — it's because **this is the right way to layer it**.

## Why this matters: a thought experiment

Imagine a different design where everything is one big class:

```ts
class CodingAgent {
  async chat(input: string) {
    const response = await anthropic.messages.create({...});
    if (response.stop_reason === 'tool_use') {
      // execute tools
      // call anthropic again
      // render to terminal
      // ...
    }
  }
}
```

Now imagine these requirements come in:

- "Add OpenAI support" → you have to thread it through every method
- "Move from terminal to a web UI" → you rewrite the rendering inline with the agent logic
- "Add a Slack bot version" → same again
- "Support running headlessly for CI" → no clean abstraction to do this
- "Let users add their own tools" → no clean injection point

With layered design:
- New provider? Add a file in Layer 2.
- Web UI? Build a new Layer 3b. Layers 2, 3a unchanged.
- Slack bot? Build a new Layer 4 product. Reuse 2, 3a entirely.
- Headless? Skip Layer 3b, drive 3a directly via SDK.
- User tools? Layer 3a already accepts a tools array.

**The layering isn't theoretical. It's the difference between a product that survives and one that gets rewritten.**

## The three boundaries that matter

The boundaries between layers are where all the design lives. There are exactly three that matter:

### Boundary 1: Provider ↔ Transport

```
Provider API (raw SSE bytes)
        │
        ▼
Transport (normalized AssistantMessageEvent stream)
```

The contract: `stream(model, context) → AsyncIterable<Event>` where Event is your normalized type.

You'll build this in Chapter 2.

### Boundary 2: Transport ↔ Agent

```
Transport (LLM message format)
        │
        ▼
Agent (your message format, includes UI-only types)
```

The contract: `convertToLlm(myMessages) → llmMessages`. You can have any kind of message in your agent (streaming markers, status notes, tool execution traces) — `convertToLlm` strips them out before talking to the LLM.

You'll build this in Chapter 4.

### Boundary 3: Agent ↔ UI

```
Agent (stateful events: turn_start, message_update, tool_execution_end, ...)
        │
        ▼
UI (subscribe and render)
```

The contract: `agent.subscribe(event => updateUI(event))`. The UI doesn't pull from the agent; the agent pushes events.

You'll build this in Chapter 8.

**Get these three boundaries right and you have a coding agent.** Get any one wrong and you'll fight your own architecture forever. We'll come back to these boundaries again and again.

## The pi-mono mental model in one sentence

> **A coding agent is a UI subscribed to an agent loop, where the agent loop is a state machine that streams from an LLM, executes tools, and emits events.**

That's it. Memorize it.

## Stop and try this

Open three terminal windows side by side. In each:

1. **Window 1**: `cd packages/ai && ls src/` — read filenames. This is Layer 2.
2. **Window 2**: `cd packages/agent && ls src/` — read filenames. This is Layer 3a.
3. **Window 3**: `cd packages/tui && ls src/` — read filenames. This is Layer 3b.

Notice how few files each layer has. The whole agent layer is **5 files**. The whole transport layer is ~10 files plus one per provider. The TUI layer is more (because UI is fiddly) but it's still one folder.

When something is well-designed, you can read its file list and understand what it does.

## Key takeaways

1. Every coding agent has 4 layers: provider → transport → agent / UI → product
2. Agent and UI are siblings, not parent/child
3. The three boundaries (transport↔agent, agent↔llm-msgs, agent↔UI) carry all the design weight
4. Each layer should be useful on its own
5. This isn't theory — it's the difference between a product and a prototype

---

**Next:** [Lesson 0.3 — Project Setup](./03-project-setup.md)
