# Chapter 7: Building a Terminal UI

The agent and the UI are siblings. They don't depend on each other. This chapter is the entire UI side — terminals, components, rendering, input handling.

## Lessons

1. **[Terminal fundamentals](./01-terminal-fundamentals.md)** — ANSI escapes, modes, what stdout actually is
2. **[The component model](./02-the-component-model.md)** — A simple, composable design
3. **[Differential rendering](./03-differential-rendering.md)** — Don't redraw what hasn't changed
4. **[Input handling](./04-input-handling.md)** — Keys, paste, raw mode, IME
5. **[Overlays and focus](./05-overlays-and-focus.md)** — Modals and keyboard routing

## Examples

- `examples/01-raw-terminal.ts` — manual ANSI control
- `examples/02-minimal-tui.ts` — Component, TUI, render loop in one file

## Time estimate

~120 minutes total.

## What you'll know by the end

- What terminals actually do (and why your `console.log` always works)
- The Component interface that powers everything
- How differential rendering avoids flicker
- How to handle input including arrow keys, modifiers, and paste
- How to layer overlays on top of content

## Why this chapter matters

Most coding agents either embed in IDEs (no UI work) or use existing TUI libraries (Ink, blessed). Building your own TUI is more work but gives you total control over the UX. pi went this direction because the existing libraries didn't fit. This chapter teaches you to do the same.

If you'd rather use Ink for your project, you can — most concepts in this chapter still apply. But you'll understand them deeper if you build the basics yourself first.
