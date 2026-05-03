# Lesson 8.4: The Footer

A status line at the bottom that shows the current model, tokens used, cost, and other useful runtime info. This is the last UI component.

## What goes in a footer

Common items for a coding agent:

| Item | Why it's useful |
|---|---|
| Model name | Confirms which model is active (especially after `/model`) |
| Working directory | You forgot which project you're in |
| Token usage | Watching consumption helps avoid context overflow |
| Cost | Real-time cost transparency |
| Streaming indicator | Shows the agent is busy |
| Pending steering count | "you have 2 messages queued" |

Optional:

- Git branch
- Time since last response
- Connection status (provider reachable?)
- Terminal capabilities (image support, etc.)

## A minimal Footer component

```ts
class Footer implements Component {
  private model = "";
  private cwd = process.cwd();
  private inputTokens = 0;
  private outputTokens = 0;
  private cost = 0;
  private streaming = false;

  setModel(m: string) { this.model = m; }
  setUsage(usage: { input: number; output: number; cost?: number }) {
    this.inputTokens = usage.input;
    this.outputTokens = usage.output;
    this.cost = usage.cost ?? this.cost;
  }
  setStreaming(s: boolean) { this.streaming = s; }

  render(width: number): string[] {
    const cwdShort = shortenPath(this.cwd, 30);
    const tokens = `${this.inputTokens / 1000 | 0}k in / ${this.outputTokens / 1000 | 0}k out`;
    const dollars = `$${this.cost.toFixed(4)}`;
    const status = this.streaming ? "▶ streaming" : "▶ idle";

    const left = `${this.model} │ ${cwdShort}`;
    const right = `${tokens} │ ${dollars} │ ${status}`;
    const space = width - left.length - right.length;

    if (space < 1) {
      // truncate
      return [left.slice(0, width)];
    }

    return [
      "─".repeat(width),
      `${left}${" ".repeat(space)}${right}`,
    ];
  }
}

function shortenPath(p: string, max: number): string {
  if (p.length <= max) return p;
  return "…" + p.slice(p.length - max + 1);
}
```

Renders as:

```
─────────────────────────────────────────────────────────
claude-sonnet-4 │ ~/code/mini-pi    14k in / 8k out │ $0.034 │ ▶ idle
```

## Wiring into the interactive mode

Update the footer in response to events:

```ts
constructor(private agent: Agent, private tui: TUI) {
  // ... setup ...
  this.footer.setModel(agent.state.model.id);
  this.footer.setStreaming(agent.state.isStreaming);

  agent.subscribe(event => {
    this.handleEvent(event);

    // Footer updates
    switch (event.type) {
      case "agent_start":
      case "agent_end":
        this.footer.setStreaming(agent.state.isStreaming);
        this.tui.requestRender();
        break;
      case "message_end":
        if (event.message.role === "assistant" && event.message.usage) {
          this.footer.setUsage(event.message.usage);
          this.tui.requestRender();
        }
        break;
    }
  });
}
```

When the user changes the model via `/model`, you also update the footer:

```ts
{
  name: "model",
  execute: (args, ctx) => {
    if (args) {
      ctx.agent.state.model = lookupModel(args);
      this.footer.setModel(args);
      ctx.print(`Model: ${args}`);
    }
  },
}
```

## Cumulative vs per-turn usage

A subtle decision: should the footer show:

- **Per-turn**: tokens for the most recent assistant message
- **Cumulative**: tokens across the entire session

Pi shows cumulative (more useful for budget tracking). Track yourself:

```ts
private cumulativeInput = 0;
private cumulativeOutput = 0;
private cumulativeCost = 0;

setUsage(usage) {
  this.cumulativeInput += usage.input;
  this.cumulativeOutput += usage.output;
  this.cumulativeCost += usage.cost ?? 0;
  // ... render
}
```

Subtle issue: prompt caching means input tokens vary call to call (some are cached). Cumulative makes sense; per-turn is misleading.

## Context usage indicator

For long sessions, show how full the context window is:

```ts
const ctxUsed = estimateTokens(messages);
const ctxMax = model.contextWindow;
const ctxPct = (ctxUsed / ctxMax) * 100;

const indicator = ctxPct > 80 ? `\x1b[31m${ctxPct.toFixed(0)}%\x1b[0m`
                : ctxPct > 60 ? `\x1b[33m${ctxPct.toFixed(0)}%\x1b[0m`
                : `\x1b[32m${ctxPct.toFixed(0)}%\x1b[0m`;
```

Color-coded: green (safe), yellow (close), red (compact soon).

Pi shows `47k / 200k (24%)` in this style.

## Live updates during streaming

When the assistant is streaming, you can update token estimates in real time:

```ts
case "message_update": {
  if (event.message.role === "assistant") {
    // estimate output tokens from text length
    const text = event.message.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text).join("");
    const estimatedOutput = text.length / 4;  // rough
    this.footer.setLiveUsage({ output: estimatedOutput });
  }
}
```

Or just update on `message_end` — less work, slightly less responsive.

## Footer styles

Pi has theming — light mode, dark mode, custom themes via TypeScript files. Each theme defines color functions.

For mini-pi, hardcode some chalk colors. Add theming later if you want.

## Stop and try this

Add the footer to your mini-pi. Run a few prompts. Watch the cost climb. Notice:

- After streaming finishes, tokens update
- Streaming indicator goes ▶/■ during runs
- Model name shows the current selection

The footer makes the agent feel professional. Even though it's "just status info," users notice when it's missing.

## Key takeaways

1. Footer = single-line status: model, cwd, tokens, cost, streaming.
2. Update on `message_end` (token usage) and `agent_start/end` (streaming).
3. Show cumulative usage; per-turn is misleading with prompt caching.
4. Color-code context usage: green/yellow/red as it fills.
5. A footer is small but high-impact UX. Don't skip.

---

**Next:** [Chapter 9 — Extensibility](../09-extensibility/)
