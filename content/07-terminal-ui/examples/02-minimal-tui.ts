/**
 * Example 7.2: A minimal TUI in one file
 *
 * Component interface + Container + TUI with differential rendering +
 * input handling + a simple Editor and Counter component.
 *
 * Run with:
 *   npx tsx 02-minimal-tui.ts
 *   (Type, press Enter to submit. Up/Down to change counter. Ctrl+C to quit.)
 */

// ─── Component interface ──────────────────────────────────────────────

interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
}

// ─── Container ────────────────────────────────────────────────────────

class Container implements Component {
  children: Component[] = [];
  add(c: Component) { this.children.push(c); }
  render(width: number): string[] {
    return this.children.flatMap(c => c.render(width));
  }
}

// ─── TUI ──────────────────────────────────────────────────────────────

class TUI {
  private root = new Container();
  private focused: Component | null = null;
  private previousLines: string[] = [];
  private renderRequested = false;

  add(c: Component) { this.root.children.push(c); }
  setFocus(c: Component) { this.focused = c; }

  start() {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdout.write("\x1b[?25l"); // hide cursor

    process.stdin.on("data", (data: string) => {
      if (data === "\x03") this.stop(); // Ctrl+C
      this.focused?.handleInput?.(data);
    });

    process.stdout.on("resize", () => this.requestRender());
    this.requestRender();
  }

  stop() {
    process.stdout.write("\x1b[?25h\x1b[0m\n"); // show cursor, reset
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.exit(0);
  }

  requestRender() {
    if (this.renderRequested) return;
    this.renderRequested = true;
    process.nextTick(() => {
      this.renderRequested = false;
      this.doRender();
    });
  }

  private doRender() {
    const width = process.stdout.columns;
    const newLines = this.root.render(width);

    process.stdout.write("\x1b[?2026h"); // sync begin

    let firstDiff = 0;
    while (
      firstDiff < this.previousLines.length &&
      firstDiff < newLines.length &&
      this.previousLines[firstDiff] === newLines[firstDiff]
    ) firstDiff++;

    const upBy = this.previousLines.length - firstDiff;
    if (upBy > 0) process.stdout.write(`\x1b[${upBy}A`);
    process.stdout.write("\r\x1b[J");

    for (let i = firstDiff; i < newLines.length; i++) {
      process.stdout.write(newLines[i]);
      if (i < newLines.length - 1) process.stdout.write("\n");
    }

    this.previousLines = newLines;
    process.stdout.write("\x1b[?2026l"); // sync end
  }
}

// ─── A simple Counter component ───────────────────────────────────────

class Counter implements Component {
  private value = 0;
  constructor(private tui: TUI) {}
  handleInput(data: string) {
    if (data === "\x1b[A") this.value++;       // Up
    if (data === "\x1b[B") this.value--;       // Down
    this.tui.requestRender();
  }
  render(width: number): string[] {
    return [`Counter: \x1b[1;33m${this.value}\x1b[0m  (↑ to increment, ↓ to decrement)`];
  }
}

// ─── A minimal Editor component ───────────────────────────────────────

class Editor implements Component {
  private value = "";
  private submissions: string[] = [];
  constructor(private tui: TUI) {}

  handleInput(data: string) {
    if (data === "\r") {
      if (this.value) {
        this.submissions.push(this.value);
        this.value = "";
      }
    } else if (data === "\x7f") {
      this.value = this.value.slice(0, -1);
    } else if (data === "\x1b[A" || data === "\x1b[B") {
      // ignore arrows in editor
    } else if (data.charCodeAt(0) >= 32 || data === "\t") {
      this.value += data;
    }
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const lines: string[] = [];
    for (const s of this.submissions) {
      lines.push(`\x1b[2m> ${s}\x1b[0m`);
    }
    lines.push(`\x1b[1;36m> ${this.value}\x1b[7m \x1b[0m`); // cursor as inverted block
    return lines;
  }
}

// ─── Wire it all up ───────────────────────────────────────────────────

const tui = new TUI();

const header = { render: (w: number) => ["\x1b[1;35m── Mini TUI Demo ──\x1b[0m"] };
const counter = new Counter(tui);
const editor = new Editor(tui);

tui.add(header);
tui.add({ render: () => [""] });
tui.add(counter);
tui.add({ render: () => [""] });
tui.add(editor);

// Focus rotates: Tab in editor switches to counter, etc.
// For simplicity: counter on Up/Down, editor on everything else
tui.setFocus({
  handleInput: (data) => {
    if (data === "\x1b[A" || data === "\x1b[B") {
      counter.handleInput(data);
    } else {
      editor.handleInput(data);
    }
  },
  render: () => [],
});

tui.start();
