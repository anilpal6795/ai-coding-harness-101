# Lesson 7.1: Terminal Fundamentals

To build a TUI you need to know what a terminal actually is. This lesson is a focused tour.

## What a terminal is

Historically: a physical device with a keyboard and a CRT. Connected via serial cable to a computer. The computer sent characters; they appeared on screen. The keyboard sent characters back.

Today: a piece of software (Terminal.app, iTerm2, Windows Terminal, gnome-terminal) that emulates the physical device. It still works the same way:

- Programs write characters to its "screen" (stdout)
- Programs read characters from its "keyboard" (stdin)

Modern terminals add features: colors, cursor positioning, mouse, images, hyperlinks. All via **ANSI escape sequences** — strings of bytes that the terminal interprets as commands instead of displaying.

## The escape character

An ANSI escape starts with `ESC` (byte `0x1b`, decimal 27, displayed as `\x1b` or `\033`). Then one or more characters that form a command.

The most common escape: **CSI (Control Sequence Introducer)** = `ESC [`. Followed by parameters and a final character.

Example: `\x1b[31m` = "set foreground red." The `31` is the parameter; `m` says "this is a graphics command."

Print it:

```ts
process.stdout.write("\x1b[31mHello\x1b[0m");
//                   ^^^^^^^^                   set red
//                              Hello           text
//                                  ^^^^^^^^    reset
```

Output: red `Hello`.

## Common escape sequences

You'll use these constantly:

| Code | Meaning |
|---|---|
| `\x1b[2J` | Clear screen |
| `\x1b[H` | Move cursor to top-left |
| `\x1b[<row>;<col>H` | Move cursor to (row, col) |
| `\x1b[K` | Clear from cursor to end of line |
| `\x1b[J` | Clear from cursor to end of screen |
| `\x1b[?25l` | Hide cursor |
| `\x1b[?25h` | Show cursor |
| `\x1b[<n>A` | Move cursor up n lines |
| `\x1b[<n>B` | Move cursor down n lines |
| `\x1b[<n>D` | Move cursor left n columns |
| `\x1b[<n>C` | Move cursor right n columns |
| `\x1b[?2026h` | **Begin synchronized output** (no flicker) |
| `\x1b[?2026l` | End synchronized output |

For colors: `\x1b[<code>m`:

- 30-37: foreground colors (black, red, green, yellow, blue, magenta, cyan, white)
- 40-47: background colors
- 90-97: bright foreground
- 100-107: bright background
- 0: reset all
- 1: bold
- 4: underline
- 7: reverse video

256-color: `\x1b[38;5;<n>m` (foreground) or `\x1b[48;5;<n>m` (background).
Truecolor: `\x1b[38;2;<r>;<g>;<b>m`.

You won't memorize these. The `chalk` library wraps them so you can do `chalk.red("Hello")` without thinking. But knowing the underlying mechanism helps when things break.

## Terminal modes

A terminal has modes that change behavior:

### Cooked vs raw mode

**Cooked** (default): the terminal collects lines, lets the user edit with backspace, then delivers the whole line on Enter. Echo is on (you see what you type).

**Raw**: every keystroke comes through immediately. No editing. No echo. **You** decide what to display.

For an interactive UI you want raw mode:

```ts
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", (data) => {
  // Each keystroke arrives here as a Buffer
});
```

In raw mode, pressing `a` gives you `Buffer([0x61])`. Pressing `Backspace` gives you `Buffer([0x7f])`. Pressing `↑` gives you `Buffer([0x1b, 0x5b, 0x41])` (`ESC [ A`).

This is what your input parser handles (Lesson 7.4).

### Alternate screen

The terminal has a "main" screen (your shell history) and an "alternate" screen (a separate buffer). Vim, less, htop, etc. switch to the alternate screen so they don't pollute your scrollback.

```ts
process.stdout.write("\x1b[?1049h");  // enter alternate screen
// ... run UI ...
process.stdout.write("\x1b[?1049l");  // exit, restoring main screen
```

Pi does NOT use the alternate screen. It keeps your scrollback. Both are valid choices.

### Mouse mode

You can enable mouse reporting:

```ts
process.stdout.write("\x1b[?1000h");  // enable click reporting
process.stdout.write("\x1b[?1006h");  // SGR mouse mode (more accurate)
```

Now mouse events come through stdin as escape sequences. Most TUIs skip mouse — keyboard is enough.

## Terminal capabilities differ

Not every terminal supports every feature. Modern terminals (iTerm2, Kitty, WezTerm, Ghostty, Windows Terminal) support a lot. Older or simpler terminals might not.

Things that may or may not work:

- Truecolor (16M colors)
- Synchronized output (`?2026`)
- Inline images (Kitty graphics protocol, iTerm2 images)
- Extended keyboard protocol (Kitty keyboard protocol — distinguishes shift+enter, ctrl+enter, etc.)
- Hyperlinks (`OSC 8`)

Defensive UIs detect support and degrade gracefully:

```ts
if (process.env.TERM_PROGRAM === "iTerm.app" || process.env.KITTY_WINDOW_ID) {
  // Use inline images
} else {
  // Show "[image: filename.png]" text fallback
}
```

For mini-pi we'll target reasonable modern terminals and not worry about ancient ones.

## What `console.log` actually does

`console.log("hello")` writes `hello\n` to stdout. Python's `print`, Bash's `echo`, all the same: they produce text terminated with newline.

Newlines move the cursor to the next line, scrolling if needed. No magic.

What `console.log("\x1b[31mhello\x1b[0m")` does: writes those bytes to stdout. The terminal sees `\x1b[31m`, interprets it as "switch to red," sees `hello`, displays it red, sees `\x1b[0m`, resets.

`console.log` doesn't know about ANSI. It just writes bytes. The terminal does the work.

## Detecting terminal size

```ts
console.log(process.stdout.columns);  // width in characters
console.log(process.stdout.rows);     // height in characters
```

Resize is an event:

```ts
process.stdout.on("resize", () => {
  console.log("New size:", process.stdout.columns, "x", process.stdout.rows);
});
```

A TUI must redraw on resize because layouts depend on width.

## Synchronized output (the big win)

Without synchronized output, when you redraw a multi-line area, the user might see partial frames — flicker. The terminal renders each byte as it arrives.

Synchronized output (CSI 2026) tells the terminal: "wait until I send the end marker, then update everything at once."

```ts
process.stdout.write("\x1b[?2026h");  // begin
// ... write a bunch of cursor moves and text ...
process.stdout.write("\x1b[?2026l");  // end — terminal commits
```

The user sees the entire frame appear at once. No flicker.

Pi wraps **every** render in synchronized output. Game-changing for UX.

Older terminals ignore the unknown sequences (no harm done). Modern ones use it.

## What happens to my prompt after my TUI exits?

Common gotcha: your TUI exits but the terminal is in a weird state — cursor hidden, raw mode still on, weird colors. The user has to type `reset` to fix.

Always restore on exit:

```ts
process.on("exit", () => {
  process.stdin.setRawMode(false);
  process.stdout.write("\x1b[?25h");  // show cursor
  process.stdout.write("\x1b[0m");    // reset colors
});
```

And handle Ctrl+C / SIGINT specially:

```ts
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
```

A clean TUI leaves the terminal exactly as it was found. A bad TUI leaves it broken.

## Testing in a real terminal

You can't really test a TUI without a real terminal. `tmux` is your friend:

```bash
tmux new-session -d -s test -x 80 -y 24
tmux send-keys -t test "node my-tui.js" Enter
sleep 1
tmux capture-pane -t test -p   # see what's rendered
tmux kill-session -t test
```

For programmatic testing, libraries like `xterm-headless` give you a terminal in JS:

```ts
import { Terminal } from "@xterm/headless";
const term = new Terminal({ cols: 80, rows: 24 });
term.write("hello\n");
console.log(term.buffer.active.getLine(0)?.translateToString());  // "hello"
```

Pi uses `@xterm/headless` for tests. Worth knowing about.

## Stop and try this

A minimal raw terminal demo:

```ts
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write("\x1b[?25l"); // hide cursor

let row = 1;
process.stdout.write("\x1b[2J\x1b[H"); // clear, move to top-left
process.stdout.write("Press keys (q to quit):\n");

process.stdin.on("data", (data) => {
  if (data[0] === 0x71 /* q */) {
    process.stdout.write("\x1b[?25h\x1b[0m"); // restore
    process.exit(0);
  }
  row++;
  process.stdout.write(`\x1b[${row + 1};1H`); // move to row
  process.stdout.write(`Got bytes: ${[...data].map(b => b.toString(16)).join(" ")}`);
});
```

Run with `npx tsx`. Press keys. See the bytes. Press `q` to quit cleanly.

You just wrote a minimal raw-mode TUI. Everything else in pi-tui is layered on top.

## Key takeaways

1. Terminals interpret ANSI escape sequences for cursor movement, color, etc.
2. Raw mode = your code receives every keystroke; you control display.
3. CSI 2026 (synchronized output) is the difference between flickery and smooth.
4. Detect terminal capabilities; degrade gracefully.
5. Always clean up on exit (raw mode off, cursor on, colors reset).

---

**Next:** [Lesson 7.2 — The Component Model](./02-the-component-model.md)
