# Input Handling

Reading keys from a terminal is messier than you'd think. This lesson covers the encoding, the parsing, and the focus model.

## What stdin looks like in raw mode

In raw mode, every keystroke comes through `process.stdin` as bytes:

| Key | Bytes (hex) | Notes |
|---|---|---|
| `a` | `0x61` | Plain ASCII |
| `Enter` | `0x0d` | Carriage return |
| `Backspace` | `0x7f` | DEL (not BS!) |
| `Tab` | `0x09` | |
| `Escape` | `0x1b` | Just ESC |
| `Ctrl+A` | `0x01` | Ctrl + ASCII letter = letter - 0x60 |
| `Ctrl+C` | `0x03` | SIGINT in cooked mode; in raw mode, just bytes |
| `↑` | `0x1b 0x5b 0x41` | ESC [ A |
| `↓` | `0x1b 0x5b 0x42` | ESC [ B |
| `→` | `0x1b 0x5b 0x43` | |
| `←` | `0x1b 0x5b 0x44` | |
| `Home` | `0x1b 0x5b 0x48` | |
| `End` | `0x1b 0x5b 0x46` | |

Function keys, modified keys, etc. all have multi-byte sequences.

The pattern: **special keys come as escape sequences starting with `0x1b` (ESC)**. ASCII printable keys come as their ASCII byte.

## The ambiguity problem

`ESC` alone is `0x1b`. `ESC [ A` (up arrow) starts with `0x1b`. **You don't know which until you see the next bytes.**

Solutions:

1. **Wait briefly**: if no more bytes arrive within ~50ms, treat as ESC alone.
2. **Combine bytes per data event**: stdin emits chunks; an arrow key arrives as one chunk of 3 bytes.

Option 2 is what pi does. When `data` event fires, parse the entire chunk:

```ts
process.stdin.on("data", (data) => {
  const str = data.toString("utf8");
  parseAndDispatch(str);
});
```

The Buffer arrives whole. ESC alone is one event; `ESC [ A` is another single event.

## Parsing keys

A key parser converts byte strings to logical keys:

```ts
function parseKey(data: string): Key {
  if (data === "\r" || data === "\n") return { key: "enter" };
  if (data === "\x7f") return { key: "backspace" };
  if (data === "\t") return { key: "tab" };
  if (data === "\x1b") return { key: "escape" };

  if (data === "\x1b[A") return { key: "up" };
  if (data === "\x1b[B") return { key: "down" };
  if (data === "\x1b[C") return { key: "right" };
  if (data === "\x1b[D") return { key: "left" };

  // Ctrl+letter
  const code = data.charCodeAt(0);
  if (code >= 1 && code <= 26 && data.length === 1) {
    return { key: String.fromCharCode(code + 96), ctrl: true };
  }

  // Plain text
  return { key: data, text: true };
}
```

Real parsers handle: alt+key (ESC + letter), shift+arrow, function keys, more. Pi-tui's parser is in `packages/tui/src/keys.ts`.

## The Kitty keyboard protocol

The standard protocol can't distinguish `Shift+Enter` from `Enter` (both are `\r`). It can't distinguish `Ctrl+Enter` either. This is a real problem for editors.

The **Kitty keyboard protocol** is a modern extension that fixes this. You enable it:

```ts
process.stdout.write("\x1b[>1u");  // enable disambiguation
```

Now keys come through with full modifier info:

```
Shift+Enter → \x1b[13;2u
Ctrl+Enter  → \x1b[13;5u
```

Modern terminals (Kitty, WezTerm, Ghostty, recent iTerm2) support this. Older ones don't — your parser detects and degrades.

For mini-pi we won't enable this. Editor will use Tab or Ctrl+J for "newline." Add Kitty protocol later if you want.

## Matching keys against bindings

Once you have a parsed key, match it against bindings:

```ts
function matchesKey(data: string, binding: string): boolean {
  // binding examples: "ctrl+c", "enter", "shift+tab"
  const key = parseKey(data);
  const parts = binding.split("+");
  const expectedKey = parts.pop()!;
  const ctrl = parts.includes("ctrl");
  const shift = parts.includes("shift");
  const alt = parts.includes("alt");

  return (
    key.key === expectedKey &&
    !!key.ctrl === ctrl &&
    !!key.shift === shift &&
    !!key.alt === alt
  );
}
```

Usage:

```ts
if (matchesKey(data, "ctrl+c")) { handleQuit(); }
if (matchesKey(data, "enter")) { handleSubmit(); }
```

Pi has a more robust version with a `Key.ctrl("c")` builder. Same idea.

## The focus model

When the user presses a key, who handles it?

A coding agent's UI typically has:

- An editor at the bottom
- Maybe an open dialog (model picker, settings)
- Possibly a confirmation prompt

Only ONE of these should receive keys at a time.

The pattern: the TUI tracks a "focused component." Input goes to it.

```ts
class TUI {
  private focused: Component | null = null;

  setFocus(c: Component | null) {
    this.focused = c;
  }

  handleInput(data: string) {
    if (this.focused?.handleInput) {
      this.focused.handleInput(data);
    }
  }
}
```

Components register themselves as focused when shown:

```ts
const editor = new Editor();
tui.addChild(editor);
tui.setFocus(editor);

// User presses keys → editor.handleInput receives them
```

When a dialog opens:

```ts
const dialog = new ConfirmDialog("Are you sure?");
tui.showOverlay(dialog);
tui.setFocus(dialog);
// User presses keys → dialog handles them; editor is paused

// On dialog close:
tui.hideOverlay(dialog);
tui.setFocus(editor);
```

The TUI manages a focus stack so dialogs can nest cleanly.

## Global keys

Some keys should work regardless of focus:

- `Ctrl+C` to quit
- `Ctrl+L` to redraw
- `Esc` to abort the agent

Handle these before routing to the focused component:

```ts
handleInput(data: string) {
  // Global handlers first
  if (matchesKey(data, "ctrl+c")) {
    this.handleQuit();
    return;
  }
  if (matchesKey(data, "ctrl+l")) {
    this.forceRedraw();
    return;
  }

  // Otherwise, route to focused
  if (this.focused?.handleInput) {
    this.focused.handleInput(data);
  }
}
```

Pi makes global keys configurable; for mini-pi, hardcode is fine.

## Bracketed paste

When the user pastes a multi-line block, terminals send it character by character to stdin. Your editor would treat each `\n` as Enter (submit), which is bad — paste should insert literally.

**Bracketed paste mode** wraps pasted content in markers:

```ts
process.stdout.write("\x1b[?2004h");  // enable bracketed paste
```

Now when the user pastes, stdin receives:

```
\x1b[200~  (paste begin)
hello
world
\x1b[201~  (paste end)
```

Your input handler detects the markers and treats everything between as a single insert (no submit on internal newlines).

Pi-tui handles this; if you skip it, paste is broken in your editor. Worth implementing early.

## Putting it together: a tiny input loop

```ts
class InputLoop {
  private focused: Component | null = null;

  start() {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write("\x1b[?2004h"); // bracketed paste

    process.stdin.on("data", (chunk) => this.handleChunk(chunk));
  }

  stop() {
    process.stdout.write("\x1b[?2004l");
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  setFocus(c: Component) { this.focused = c; }

  private handleChunk(chunk: Buffer) {
    const data = chunk.toString("utf8");

    if (matchesKey(data, "ctrl+c")) {
      this.stop();
      process.exit(0);
    }

    if (this.focused?.handleInput) {
      this.focused.handleInput(data);
    }
  }
}
```

That's a complete input system. ~30 lines.

## A simple Editor component

```ts
class Editor implements Component {
  private value = "";
  onSubmit?: (text: string) => void;

  handleInput(data: string) {
    if (matchesKey(data, "enter")) {
      this.onSubmit?.(this.value);
      this.value = "";
    } else if (matchesKey(data, "backspace")) {
      this.value = this.value.slice(0, -1);
    } else {
      // Plain text
      const key = parseKey(data);
      if (key.text) {
        this.value += data;
      }
    }
    tui.requestRender();
  }

  render(width: number): string[] {
    return [`> ${this.value}█`];
  }
}
```

This is enough for a functional input. Real Editors add: cursor movement (arrow keys), word delete (Ctrl+W), history (up/down), autocomplete, paste, etc. But the bones are these ~15 lines.

## Stop and try this

Combine the pieces:

```ts
const editor = new Editor();
editor.onSubmit = (text) => {
  console.log(`\nYou said: ${text}`);
};

const input = new InputLoop();
input.setFocus(editor);
input.start();
```

You can't actually render this yet (no TUI integration), but if you log on submit, you'll see your text after pressing Enter. Type, see it appear (if you render). Backspace works. Ctrl+C quits.

This is the input layer. Lesson 7.5 covers the focus stack for overlays.

## Key takeaways

1. Raw mode delivers every keystroke as bytes; parse them into logical keys.
2. Special keys are escape sequences (`\x1b[A` etc.); group bytes per `data` event to avoid ambiguity.
3. Match against bindings with helpers like `matchesKey(data, "ctrl+c")`.
4. Focus model: TUI tracks one focused component, routes input there.
5. Bracketed paste avoids treating multi-line pastes as multiple Enters.

---

**Next:** [Lesson 7.5 — Overlays and Focus](./05-overlays-and-focus.md)
