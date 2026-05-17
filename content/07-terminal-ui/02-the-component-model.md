# The Component Model

A TUI needs a way to organize what's on screen. Pi-tui uses a **component model**: small composable units, each responsible for rendering itself.

## The interface

```ts
interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate?(): void;
}
```

Three methods:

- **`render(width)`**: returns an array of strings, one per line. Each line ≤ `width` columns.
- **`handleInput(data)`** (optional): called when this component has focus and receives keystrokes.
- **`invalidate()`** (optional): called to clear any cached render state.

That's the entire contract. Components compose. The TUI calls `render()` and concatenates the lines.

## Why this design?

Compare to React/Vue/SwiftUI: those have heavy machinery (virtual DOM, reactivity, lifecycle methods). For a TUI, that's overkill.

The component model here is **pull-based**: when the TUI needs to render, it asks each component for its lines. No "state changed → re-render" mechanism. You call `tui.requestRender()` when you want a redraw.

This is simple and fast. The cost: you must remember to call `requestRender()` when state changes. In practice, this is fine — UIs always have an obvious "something happened" moment (received an event, user typed, etc.) where you trigger a render.

## A first component

```ts
class Text implements Component {
  constructor(private text: string) {}

  render(width: number): string[] {
    // Naive: split on newlines, truncate each line to width
    return this.text.split("\n").map(line =>
      line.length > width ? line.slice(0, width - 1) + "…" : line
    );
  }
}
```

That's a component. You construct it with text; it renders to lines.

To use:

```ts
const t = new Text("Hello\nWorld!");
console.log(t.render(80));  // ["Hello", "World!"]
```

## Containers

Components can hold other components:

```ts
class Container implements Component {
  children: Component[] = [];

  addChild(c: Component): void {
    this.children.push(c);
  }

  removeChild(c: Component): void {
    const i = this.children.indexOf(c);
    if (i !== -1) this.children.splice(i, 1);
  }

  render(width: number): string[] {
    const lines: string[] = [];
    for (const child of this.children) {
      lines.push(...child.render(width));
    }
    return lines;
  }
}
```

A container's render is just the concatenation of its children's renders. Trivially composable.

## The TUI class

The top-level `TUI` is a container plus a render loop:

```ts
class TUI {
  private root = new Container();
  private renderRequested = false;

  constructor(private terminal: Terminal) {}

  addChild(c: Component): void {
    this.root.addChild(c);
  }

  requestRender(): void {
    if (this.renderRequested) return;
    this.renderRequested = true;
    process.nextTick(() => {
      this.renderRequested = false;
      this.doRender();
    });
  }

  start(): void {
    this.terminal.start(
      (data) => this.handleInput(data),
      () => this.requestRender(),  // resize
    );
    this.requestRender();
  }

  stop(): void {
    this.terminal.stop();
  }

  private doRender(): void {
    const width = this.terminal.columns;
    const lines = this.root.render(width);
    // Write lines to terminal — Lesson 7.3 covers diffing
    this.terminal.write(lines.join("\n") + "\n");
  }

  private handleInput(data: string): void {
    // Route to focused component — Lesson 7.4 covers this
  }
}
```

This is enough to render a static UI. Lesson 7.3 will add diffing so re-renders don't redraw the whole screen.

## Width-aware rendering

The `render(width)` parameter is critical. The TUI passes the terminal width; the component decides how to use it.

A few scenarios:

### Truncation

```ts
class TruncatedText implements Component {
  constructor(private text: string) {}
  render(width: number): string[] {
    if (this.text.length <= width) return [this.text];
    return [this.text.slice(0, width - 1) + "…"];
  }
}
```

### Word wrap

```ts
class WrappedText implements Component {
  constructor(private text: string) {}
  render(width: number): string[] {
    const words = this.text.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      if (current.length + word.length + 1 > width) {
        lines.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) lines.push(current);
    return lines;
  }
}
```

### Padding to width

```ts
class FullWidthText implements Component {
  constructor(private text: string, private bg: string = "") {}
  render(width: number): string[] {
    const padded = this.text.padEnd(width);
    return [this.bg + padded + "\x1b[0m"];
  }
}
```

The component decides. The TUI just provides the width.

## ANSI in components

Components can include ANSI codes in their output:

```ts
import chalk from "chalk";

class Header implements Component {
  render(width: number): string[] {
    return [chalk.bold.blue("=== Header ===")];
  }
}
```

But there's a subtlety: when computing line widths for truncation, ANSI codes don't take visible space. `chalk.red("Hello")` produces `\x1b[31mHello\x1b[39m` — 13 bytes but only 5 visible columns.

You need helpers:

```ts
function visibleWidth(s: string): number {
  return s.replace(/\x1b\[[0-9;]*[mGKHJ]/g, "").length;
}

function truncateToWidth(s: string, width: number): string {
  // ... truncate while preserving ANSI codes
}
```

Pi-tui provides these in `packages/tui/src/utils.ts`. You'll write similar in your mini-pi.

## Caching renders

Components can cache their renders for performance:

```ts
class CachedComponent implements Component {
  private cachedWidth?: number;
  private cachedLines?: string[];
  private dirty = true;

  render(width: number): string[] {
    if (!this.dirty && this.cachedWidth === width && this.cachedLines) {
      return this.cachedLines;
    }
    this.cachedLines = this.computeLines(width);
    this.cachedWidth = width;
    this.dirty = false;
    return this.cachedLines;
  }

  invalidate(): void {
    this.dirty = true;
  }

  private computeLines(width: number): string[] {
    // expensive computation
  }
}
```

Call `invalidate()` when state changes. Next render recomputes; subsequent same-width renders return the cache.

For cheap components (Text), don't bother. For expensive ones (Markdown rendering), cache aggressively.

## The component tree

In a real TUI, your tree might look like:

```
TUI
 └─ Container (root)
     ├─ Header (Text)
     ├─ Container (messages)
     │    ├─ UserMessage (component)
     │    ├─ AssistantMessage (component)
     │    ├─ ToolBox (component)
     │    └─ ...
     ├─ Editor (component)
     └─ Footer (component)
```

Each leaf renders itself. The container concatenates. The TUI flattens the whole tree to lines and writes.

This is exactly how pi-coding-agent builds its UI. See `packages/coding-agent/src/modes/interactive/components/` for examples.

## What components are NOT

A component is **not** a stateful object that handles its own re-renders. It's a function-of-state to lines.

If you change state, **you** call `tui.requestRender()`. The TUI re-walks the tree.

A component is **not** a router. There's no "did this click hit me?" — TUIs are keyboard-driven, not mouse-driven (mostly). Routing is by focus (Lesson 7.5).

A component is **not** a layout engine. There's no flexbox here. If you need columns, you write a container that splits its children's renders side-by-side. Pi has a few specialized containers; we'll keep it simple.

## Stop and try this

Build a tiny demo:

```ts
class Header implements Component {
  render(width: number): string[] {
    return ["=".repeat(width), `  My TUI  `, "=".repeat(width)];
  }
}

class StatusBar implements Component {
  constructor(private status: string) {}
  render(width: number): string[] {
    return [this.status.padEnd(width).slice(0, width)];
  }
  setStatus(s: string) { this.status = s; }
}

const root = new Container();
root.addChild(new Header());
root.addChild(new Text("Welcome to my app!"));
root.addChild(new StatusBar("Ready."));

const lines = root.render(40);
console.log(lines.join("\n"));
```

Run it. You'll see:

```
========================================
  My TUI  
========================================
Welcome to my app!
Ready.                                  
```

You just built the bones of a TUI. Lessons 7.3-7.5 will add the renderer, input, and overlays. The component model stays as it is.

## Key takeaways

1. Component = `render(width) → lines`. That's the contract.
2. Containers compose components by concatenating renders.
3. TUI walks the tree, gets all lines, writes to terminal.
4. ANSI in renders is fine — but compute widths via `visibleWidth`.
5. Cache renders for expensive components; recompute on invalidate.

---

**Next:** [Lesson 7.3 — Differential Rendering](./03-differential-rendering.md)
