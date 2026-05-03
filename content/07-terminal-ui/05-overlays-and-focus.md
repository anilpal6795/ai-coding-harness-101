# Lesson 7.5: Overlays and Focus

The final TUI piece: how to layer dialogs and modals on top of your main UI without rewriting the renderer for each one.

## What overlays are for

A coding agent's UI has a main view (messages + editor + footer). Sometimes you need to show:

- A model picker
- A confirmation dialog
- A settings panel
- A help screen

Two ways to handle this:

### Approach A: replace the main view

When showing settings, hide the messages/editor/footer and show the settings instead. When done, restore.

Simple. But: state management gets ugly. You need to remember what to show again. The message stream might keep producing events that need to render somewhere.

### Approach B: overlay on top

Render the main UI normally. Render the dialog on top of the bottom-right corner (or wherever). When done, remove it.

Cleaner. Background keeps updating. Pi uses this.

## The mental model

Overlays are like windows in a window manager:

- Each overlay has a position and size
- Overlays can stack
- Focus follows the topmost one
- The user can dismiss the topmost without affecting others below

## Adding overlays to TUI

```ts
interface Overlay {
  component: Component;
  position?: { row?: number; col?: number; anchor?: "center" | "bottom-right" | ... };
  size?: { width?: number; maxHeight?: number };
}

class TUI {
  private overlays: Overlay[] = [];

  showOverlay(component: Component, options?: OverlayOptions): OverlayHandle {
    const overlay = { component, ...options };
    this.overlays.push(overlay);
    this.setFocus(component);
    this.requestRender();
    return {
      hide: () => this.hideOverlay(overlay),
      focus: () => this.setFocus(component),
    };
  }

  hideOverlay(o: Overlay): void {
    const i = this.overlays.indexOf(o);
    if (i !== -1) this.overlays.splice(i, 1);
    if (this.overlays.length > 0) {
      this.setFocus(this.overlays[this.overlays.length - 1].component);
    } else {
      this.setFocus(this.editor);  // back to default focus
    }
    this.requestRender();
  }
}
```

The TUI maintains a stack. `showOverlay` pushes, `hide` pops. Focus is the topmost overlay (or the default if none).

## Rendering overlays

You render the main UI to a 2D grid of characters, then composite each overlay on top at its position.

Pseudocode:

```ts
private doRender() {
  const width = this.terminal.columns;
  const height = this.terminal.rows;

  // 1. Render main content
  const mainLines = this.root.render(width);

  // 2. For each overlay, render it and composite
  for (const overlay of this.overlays) {
    const overlayLines = overlay.component.render(overlayWidth);
    const { row, col } = computePosition(overlay, overlayLines, width, height);
    composite(mainLines, overlayLines, row, col);
  }

  // 3. Write the composed result
  this.writeLines(mainLines);
}
```

`composite` overwrites a portion of `mainLines` with `overlayLines` at the given position. Each line of the overlay replaces the corresponding chars of the main.

The math is fiddly because of ANSI codes (an overlay character doesn't take 1 byte; it might be `\x1b[31mX\x1b[0m`). Pi-tui has utilities `sliceByColumn`, `extractSegments`, `sliceWithWidth` for this. Several hundred lines of careful code.

For mini-pi, simplification: overlays are full-width centered boxes that replace lines entirely. Less general but tractable.

## Positioning overlays

Common positioning options:

- **Centered**: row = (terminal_height - overlay_height) / 2
- **Bottom-right**: row = terminal_height - overlay_height; col = terminal_width - overlay_width
- **Anchored to component**: position relative to another component (rare; pi doesn't do this)

Pi's API:

```ts
tui.showOverlay(modelPicker, {
  width: "50%",          // half terminal width
  maxHeight: 20,
  anchor: "center",
});
```

Strings like `"50%"` are parsed; numbers are absolute. Defaults: 80 columns, centered.

For mini-pi: just center, default width. Add fancier later.

## Focus stack

When an overlay opens, focus goes to it. When closed, focus returns to the previous focused component.

```ts
class TUI {
  private focusStack: Component[] = [];

  setFocus(c: Component | null) {
    if (c) this.focusStack.push(c);
  }

  unfocusTop() {
    this.focusStack.pop();
    // Focus is now whatever's on top of the stack
  }

  get focused(): Component | undefined {
    return this.focusStack[this.focusStack.length - 1];
  }
}
```

When you open an overlay, `setFocus(overlayComponent)`. When you close it, `unfocusTop()`. The previous focus restores automatically.

## Overlay lifecycle

A typical dialog:

```ts
function showConfirm(message: string, onResult: (yes: boolean) => void) {
  const dialog = new ConfirmDialog(message);
  const handle = tui.showOverlay(dialog);

  dialog.onConfirm = () => {
    handle.hide();
    onResult(true);
  };
  dialog.onCancel = () => {
    handle.hide();
    onResult(false);
  };
}
```

The caller passes a callback. The dialog calls back with the result. The handle closes the dialog.

## Example overlay components

### Confirmation dialog

```ts
class ConfirmDialog implements Component {
  onConfirm?: () => void;
  onCancel?: () => void;

  constructor(private message: string) {}

  handleInput(data: string) {
    if (matchesKey(data, "y") || matchesKey(data, "enter")) this.onConfirm?.();
    if (matchesKey(data, "n") || matchesKey(data, "escape")) this.onCancel?.();
  }

  render(width: number): string[] {
    return [
      `┌${"─".repeat(width - 2)}┐`,
      `│ ${this.message.padEnd(width - 4)} │`,
      `│ ${(`[Y]es / [N]o`).padEnd(width - 4)} │`,
      `└${"─".repeat(width - 2)}┘`,
    ];
  }
}
```

### Selection list

```ts
class SelectList<T> implements Component {
  private cursor = 0;
  onSelect?: (item: T) => void;
  onCancel?: () => void;

  constructor(private items: { label: string; value: T }[]) {}

  handleInput(data: string) {
    if (matchesKey(data, "up")) this.cursor = Math.max(0, this.cursor - 1);
    if (matchesKey(data, "down")) this.cursor = Math.min(this.items.length - 1, this.cursor + 1);
    if (matchesKey(data, "enter")) this.onSelect?.(this.items[this.cursor].value);
    if (matchesKey(data, "escape")) this.onCancel?.();
    tui.requestRender();
  }

  render(width: number): string[] {
    return this.items.map((item, i) => {
      const prefix = i === this.cursor ? "▶ " : "  ";
      return (prefix + item.label).padEnd(width).slice(0, width);
    });
  }
}
```

### Editor as overlay

You can even put the editor in an overlay (e.g., for editing a multi-line value mid-conversation). Same focus rules apply.

## Stop and try this

Mock up a tiny app with an overlay:

```ts
// Pseudocode — depends on a working TUI

const tui = new TUI(new ProcessTerminal());
const text = new Text("Press 'm' to open menu, 'q' to quit.");
tui.addChild(text);

const root = new Container();
root.addChild(text);
tui.setFocus({
  handleInput(data) {
    if (matchesKey(data, "m")) {
      const menu = new SelectList([
        { label: "Option 1", value: 1 },
        { label: "Option 2", value: 2 },
      ]);
      const handle = tui.showOverlay(menu);
      menu.onSelect = (val) => {
        text.setText(`You picked: ${val}`);
        handle.hide();
      };
      menu.onCancel = () => handle.hide();
    }
    if (matchesKey(data, "q")) process.exit(0);
  },
  render: () => [],
});
```

Run it. Press `m`. The menu appears. Arrow keys to navigate. Enter to select. The result shows in the main text.

That's overlays. The same pattern handles every dialog in pi.

## Key takeaways

1. Overlays = stacked windows on top of the main UI; focus follows the topmost.
2. TUI maintains an overlay stack; `showOverlay` pushes, `hide` pops.
3. Composite overlays into the main render output before writing.
4. Focus stack restores previous focus when an overlay closes.
5. Common overlays: confirm, select list, editor — same Component interface, different behavior.

---

**Next:** [Chapter 8 — Wiring Agent + TUI](../08-wiring-it-all/)
