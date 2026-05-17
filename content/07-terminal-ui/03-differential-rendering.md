# Differential Rendering

A naive renderer redraws the whole screen on every update. That's slow and flickery. **Differential rendering** updates only what changed.

## The naive way (don't do this)

```ts
private doRender() {
  const lines = this.root.render(this.terminal.columns);
  this.terminal.write("\x1b[2J\x1b[H");      // clear screen, top-left
  this.terminal.write(lines.join("\n") + "\n");
}
```

Every render: clear screen, redraw everything. For a 50-line UI, that's 50 lines of redraw, even if only one character changed. The terminal flickers visibly. The CPU does work that wasn't needed.

## The diffing approach

Keep the previously-rendered lines in memory. On a new render:

1. Compute the new lines
2. Compare to the previous lines
3. Find the first line that changed
4. Move the cursor to that line
5. Redraw from there to the end
6. Save the new lines as the new previous

```ts
private previousLines: string[] = [];

private doRender() {
  const newLines = this.root.render(this.terminal.columns);

  // Find first changed line
  let firstDiff = 0;
  while (
    firstDiff < this.previousLines.length &&
    firstDiff < newLines.length &&
    this.previousLines[firstDiff] === newLines[firstDiff]
  ) {
    firstDiff++;
  }

  if (firstDiff === newLines.length && firstDiff === this.previousLines.length) {
    return;  // nothing changed
  }

  // Move cursor up to the first changed line
  const linesAbove = this.previousLines.length;
  const linesToMove = linesAbove - firstDiff;
  if (linesToMove > 0) {
    this.terminal.write(`\x1b[${linesToMove}A`);  // move up
  }
  this.terminal.write("\r\x1b[J");  // start of line, clear to end of screen

  // Write changed and new lines
  for (let i = firstDiff; i < newLines.length; i++) {
    this.terminal.write(newLines[i]);
    if (i < newLines.length - 1) this.terminal.write("\n");
  }

  this.previousLines = newLines;
}
```

This is the core idea. Pi-tui has more sophistication (handles width changes, viewport management, scrollback) but the principle is the same.

## Three render strategies

Pi-tui actually has three strategies, picked based on what changed:

### Strategy 1: First render

No previous state. Just write everything to stdout.

### Strategy 2: Width changed (or change above current viewport)

You can't safely diff if the terminal width changed (everything will re-flow). And if a change happened above the current cursor (e.g., a message was inserted in the middle), partial updates won't work.

In these cases: clear the screen, redraw everything. It's the same as the naive approach, but it's only the rare case.

### Strategy 3: Normal update

The common case. Find the first changed line, redraw from there. As shown above.

## Why this works (cursor management)

The trick: we always know where the cursor is. After every render, the cursor is at the bottom of the rendered content (because we wrote a `\n` after each line and the last line ends without one).

To redraw from line N (counting from top of rendered content):

- Lines below N = `previousLines.length - N - 1`
- Move cursor up by that amount + 1 (to get to the start of line N)
- Clear from cursor to end of screen
- Write the new lines

The math is fiddly but predictable.

## Terminal scrollback complications

What if the rendered content is longer than the terminal's row count? Some lines have scrolled off the top.

Two strategies:

1. **Don't scroll**: clamp content to terminal rows. Hides old content. Used by `htop`, `top`, etc.
2. **Allow scrolling**: render more lines than terminal rows; the terminal scrolls naturally. The user can scroll up to see history. Used by `less`, `vim` (in some modes), pi.

Pi's choice (option 2) is better for chat-like UIs where history matters. The cost: cursor management gets harder, because some lines have scrolled past.

Pi maintains a "viewport top" pointer — which line is at the top of the visible area. Render math accounts for it.

For mini-pi we'll keep it simple: render everything, let the terminal scroll naturally, redraw the last N lines on update. Good enough.

## Synchronized output makes everything cleaner

Wrap your render in synchronized output:

```ts
private doRender() {
  this.terminal.write("\x1b[?2026h");  // begin sync

  const newLines = this.root.render(this.terminal.columns);
  // ... diff and write ...

  this.terminal.write("\x1b[?2026l");  // end sync
}
```

The terminal queues all writes between the markers and applies them atomically. You never see a half-rendered frame.

This is a single line of code that eliminates 90% of flicker. Use it.

## Throttling renders

If you call `requestRender()` 100 times in a millisecond (e.g., during streaming), you don't want 100 renders.

Throttle to one render per tick:

```ts
private renderRequested = false;

requestRender(): void {
  if (this.renderRequested) return;
  this.renderRequested = true;
  process.nextTick(() => {
    this.renderRequested = false;
    this.doRender();
  });
}
```

Or use `setImmediate` or a `setTimeout(_, 0)` if you want to batch a bit longer. `process.nextTick` is fastest — runs at end of current call stack.

Pi uses `setImmediate`. Either works.

## Don't redraw what didn't change — at the component level too

The renderer diffing is line-level. You can also have component-level caching (Lesson 7.2):

```ts
class CachedComponent implements Component {
  private cached?: { width: number; lines: string[] };

  render(width: number): string[] {
    if (this.cached?.width === width) return this.cached.lines;
    this.cached = { width, lines: this.compute(width) };
    return this.cached.lines;
  }
}
```

When a component's state changes, call `invalidate()` to clear the cache.

This is a different optimization than line diffing. Both compose: components cache to avoid recomputing render; the TUI diffs to avoid redrawing identical lines.

## Width detection on resize

When the terminal resizes:

```ts
process.stdout.on("resize", () => {
  this.requestRender();
});
```

Inside render, you'll detect that the new width != previous width. Switch to "Strategy 2" (full re-render) for that one frame.

For component caches: they should invalidate when the width they were cached for differs from the current width. The example above does this.

## Writing only what changed (text level)

Even within a "redraw this line" operation, you could be smarter — write only the chars that differ. But:

- Implementation complexity is high
- ANSI handling is tricky
- Modern terminals are fast enough that line-level is plenty

Pi does line-level diffing. So will mini-pi.

## When diffing fails

Diffing can fail in a few cases:

- Line N's apparent string is the same but the ANSI background differs (unlikely with consistent rendering)
- The terminal didn't process a previous frame yet (rare with synchronized output)
- An external process wrote to stdout (e.g., a tool that wasn't captured)

Detection: hard. Mitigation: provide a manual "redraw" key (Ctrl+L is conventional).

```ts
if (matchesKey(data, "ctrl+l")) {
  this.previousLines = [];   // force full redraw
  this.requestRender();
}
```

## Stop and try this

Build a minimal differential renderer:

```ts
class MiniTUI {
  private previousLines: string[] = [];

  render(newLines: string[]) {
    process.stdout.write("\x1b[?2026h");  // sync begin

    let firstDiff = 0;
    while (
      firstDiff < this.previousLines.length &&
      firstDiff < newLines.length &&
      this.previousLines[firstDiff] === newLines[firstDiff]
    ) firstDiff++;

    const linesAbove = this.previousLines.length;
    const upBy = linesAbove - firstDiff;
    if (upBy > 0) process.stdout.write(`\x1b[${upBy}A`);
    process.stdout.write("\r\x1b[J");

    for (let i = firstDiff; i < newLines.length; i++) {
      process.stdout.write(newLines[i]);
      if (i < newLines.length - 1) process.stdout.write("\n");
    }

    this.previousLines = newLines;
    process.stdout.write("\x1b[?2026l");  // sync end
  }
}

const tui = new MiniTUI();
tui.render(["Line 1", "Line 2", "Line 3"]);

setTimeout(() => tui.render(["Line 1", "Line 2 changed", "Line 3"]), 1000);
setTimeout(() => tui.render(["Line 1", "Line 2 changed", "Line 3", "Line 4 added"]), 2000);
setTimeout(() => process.exit(0), 3000);
```

Run with `npx tsx`. You'll see the lines update without flicker — only the changed line redraws.

That's differential rendering. About 30 lines of code. The pi-tui implementation is more complex, but the same idea.

## Key takeaways

1. Diff previous lines vs new lines, find first difference, redraw from there.
2. Three strategies: first render (full), width change (full), normal (diff).
3. Wrap renders in CSI 2026 synchronized output — eliminates flicker.
4. Throttle `requestRender` to one per tick to coalesce updates.
5. Provide a manual redraw key (Ctrl+L) for the rare case diffing fails.

---

**Next:** [Lesson 7.4 — Input Handling](./04-input-handling.md)
