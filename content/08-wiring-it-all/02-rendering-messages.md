# Rendering Messages

Each message type gets its own component. This lesson covers the patterns and shows minimal implementations.

## The components you need

For mini-pi:

- **UserMessageComponent** — renders user messages
- **AssistantMessageComponent** — renders assistant messages (text + thinking)
- **ToolExecutionComponent** — renders tool calls + results

In pi, there are ~30 components for various message types and dialog kinds. We'll cover just the main three.

## UserMessageComponent

Simple: just the text in a callout style.

```ts
class UserMessageComponent implements Component {
  constructor(private message: any) {}

  setMessage(m: any) { this.message = m; }

  render(width: number): string[] {
    const content = typeof this.message.content === "string"
      ? this.message.content
      : this.message.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");

    const lines = wrapText(content, width - 2);
    return lines.map((line, i) => {
      const prefix = i === 0 ? "▎ " : "  ";
      return `\x1b[36m${prefix}${line}\x1b[0m`;
    });
  }
}
```

Renders as:

```
▎ Read package.json and tell me about the project.
```

## AssistantMessageComponent

This one's more interesting — it handles streaming text, thinking blocks, and tool calls within the same message.

```ts
class AssistantMessageComponent implements Component {
  constructor(private message: any) {}

  setMessage(m: any) { this.message = m; }

  render(width: number): string[] {
    const lines: string[] = [];

    for (const block of this.message.content) {
      if (block.type === "thinking") {
        // Optional: show in dim italic
        const wrapped = wrapText(block.thinking, width - 2);
        lines.push(...wrapped.map(l => `\x1b[2;3m  ${l}\x1b[0m`));
      } else if (block.type === "text") {
        const wrapped = wrapText(block.text, width);
        lines.push(...wrapped);
      } else if (block.type === "toolCall") {
        // Tool calls handled separately via tool_start events
      }
    }

    // Show streaming cursor if this message isn't done
    if (this.message.stopReason === undefined && lines.length > 0) {
      const last = lines[lines.length - 1];
      lines[lines.length - 1] = last + "\x1b[7m \x1b[0m";  // inverted cursor
    }

    return lines;
  }
}
```

Renders as (with streaming cursor `█`):

```
I'll read package.json for you.█
```

After streaming ends:

```
I'll read package.json for you.

The project is "mini-pi" with these scripts: ...
```

In real pi, the AssistantMessageComponent uses the `Markdown` TUI component to render markdown nicely. For mini-pi we keep it plain text.

## ToolExecutionComponent

Renders a "tool box" with the call, optional progress, and the result.

```ts
class ToolExecutionComponent implements Component {
  private result: any = null;
  private isError = false;
  private partial: any = null;
  private expanded = true;

  constructor(private toolName: string, private args: any) {}

  setPartialResult(partial: any) { this.partial = partial; }
  setResult(result: any, isError: boolean) {
    this.result = result;
    this.isError = isError;
    this.partial = null;
  }

  toggleExpanded() { this.expanded = !this.expanded; }

  render(width: number): string[] {
    const lines: string[] = [];

    // Header line
    const argsStr = JSON.stringify(this.args).slice(0, width - this.toolName.length - 10);
    const status = this.result ? (this.isError ? "✗" : "✓") : "⠋";
    lines.push(`\x1b[33m${status} ${this.toolName}\x1b[0m \x1b[2m${argsStr}\x1b[0m`);

    // Result body (expandable)
    if (this.expanded) {
      const body = this.result
        ? extractText(this.result)
        : this.partial
          ? extractText(this.partial)
          : "";

      if (body) {
        const wrapped = wrapText(body, width - 4);
        const max = 10;
        const shown = wrapped.slice(0, max);
        for (const line of shown) {
          lines.push(`  \x1b[2m│\x1b[0m ${line}`);
        }
        if (wrapped.length > max) {
          lines.push(`  \x1b[2m│ ... ${wrapped.length - max} more lines (Ctrl+O to expand)\x1b[0m`);
        }
      }
    }

    return lines;
  }
}

function extractText(result: any): string {
  if (!result?.content) return "";
  return result.content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n");
}
```

Renders during execution:

```
⠋ read {"path":"package.json"}
  │ Loading...
```

After completion:

```
✓ read {"path":"package.json"}
  │ {
  │   "name": "mini-pi",
  │   "version": "0.1.0",
  │   "scripts": { ... },
  │   ...
  │ ... 23 more lines (Ctrl+O to expand)
```

Pi's tool components per-tool-type custom rendering — the `read` component shows file content with syntax highlighting; the `bash` component shows colored exit codes; etc. For mini-pi, generic is fine.

## A `wrapText` helper

```ts
function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (para.length <= width) {
      lines.push(para);
      continue;
    }
    const words = para.split(/\s+/);
    let current = "";
    for (const word of words) {
      if (current.length + word.length + 1 > width) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}
```

This is naive (doesn't handle ANSI, doesn't break long words). Pi has a more sophisticated `wrapTextWithAnsi` in `packages/tui/src/utils.ts`. For mini-pi this is enough.

## A note on Markdown rendering

Real coding agents render markdown — code blocks with syntax highlighting, bold/italic, lists, headers. Pi has a Markdown component (`packages/tui/src/components/markdown.ts`) that does this.

For mini-pi we'll stick to plain text. Adding markdown is a "nice to have" — once you have the basics working, swap in a markdown renderer.

If you want a starting point: use `marked` to parse, walk the AST, emit ANSI for each node type. ~200 lines.

## Stop and try this

Build the three components above and wire into your interactive mode. Then run a session:

```
> What's 2+2?
▎ What's 2+2?

I can compute that for you. 2+2 = 4.

> Read package.json
▎ Read package.json

I'll read that file for you.

✓ read {"path":"package.json"}
  │ {
  │   "name": "mini-pi",
  │   ...
  │ ... 12 more lines

Your package.json defines: build, test, dev. The project is...

> █
```

That's the agent in interactive mode. Streaming, tool calls, results — all rendered live.

## Compare to pi's components

Open `packages/coding-agent/src/modes/interactive/components/`:

- `user-message.ts` — same shape as yours, more polish (multi-line images, file attachments)
- `assistant-message.ts` — uses Markdown, handles thinking blocks expandable
- `tool-execution.ts` — generic dispatcher to per-tool renderers

Per-tool renderers are in `packages/coding-agent/src/core/tools/`:
- `read.ts` — renders file content with line numbers + syntax highlighting
- `bash.ts` — renders command + colored output + exit code
- `edit.ts` — renders a unified diff

Each is its own product within the product. Worth studying once your basic versions work.

## Key takeaways

1. One component per message type: User, Assistant, ToolExecution.
2. Components are rebuilt from the message data on each render — they don't track state separately.
3. `setMessage()` lets the interactive mode update components from `message_update` events.
4. Tool components have collapsible bodies — important for large outputs.
5. Pi's per-tool renderers are products in themselves; generic is fine to start.

---

**Next:** [Lesson 8.3 — Slash Commands](./03-slash-commands.md)
