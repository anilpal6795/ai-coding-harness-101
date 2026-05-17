# Slash Commands

Users want to do things that aren't conversations: switch models, see help, quit cleanly, reset the session. **Slash commands** are the convention.

## The pattern

User types `/<command> [args]` in the editor. Instead of submitting to the agent, the interactive mode intercepts:

```ts
private handleUserInput(text: string) {
  if (text.startsWith("/")) {
    this.handleSlashCommand(text);
    return;
  }
  // ... regular submit
}
```

## Defining commands

A simple registry:

```ts
interface SlashCommand {
  name: string;
  description: string;
  execute: (args: string, ctx: CommandContext) => void | Promise<void>;
}

interface CommandContext {
  agent: Agent;
  tui: TUI;
  print: (text: string) => void;
}

const commands: SlashCommand[] = [
  {
    name: "help",
    description: "Show available commands",
    execute: (_args, ctx) => {
      const lines = commands.map(c => `  /${c.name}\t${c.description}`);
      ctx.print("Available commands:\n" + lines.join("\n"));
    },
  },
  {
    name: "quit",
    description: "Exit the agent",
    execute: () => process.exit(0),
  },
  {
    name: "clear",
    description: "Reset the session",
    execute: (_args, ctx) => {
      ctx.agent.reset();
      ctx.print("Session cleared.");
    },
  },
  {
    name: "model",
    description: "Show or switch the model",
    execute: (args, ctx) => {
      if (!args) {
        ctx.print(`Current model: ${ctx.agent.state.model.id}`);
      } else {
        // Look up new model and set
        ctx.print(`Model set to: ${args}`);
      }
    },
  },
];
```

Then dispatch:

```ts
private handleSlashCommand(input: string) {
  const [cmd, ...rest] = input.slice(1).split(" ");
  const args = rest.join(" ");

  const command = commands.find(c => c.name === cmd);
  if (!command) {
    this.print(`Unknown command: /${cmd}`);
    return;
  }

  command.execute(args, {
    agent: this.agent,
    tui: this.tui,
    print: (text) => this.print(text),
  });
}
```

That's the entire pattern. Commands are data; one dispatcher.

## Where command output goes

When `/help` runs, where does its output appear?

Two options:

1. **As a system message in the transcript**: add a "system" message component to the messages container.
2. **As a transient overlay**: show, dismiss on key press, doesn't pollute history.

Pi uses option 2 for most commands. For mini-pi, option 1 is simpler. Add a `SystemNoteComponent`:

```ts
class SystemNoteComponent implements Component {
  constructor(private text: string) {}
  render(width: number): string[] {
    return wrapText(this.text, width).map(line => `\x1b[2m  ${line}\x1b[0m`);
  }
}

private print(text: string) {
  this.messagesContainer.add(new SystemNoteComponent(text));
  this.tui.requestRender();
}
```

The system message stays in the UI but isn't sent to the LLM (it's a UI-only message type — recall Lesson 4.4).

## Autocomplete for commands

When the user types `/`, show available commands:

```ts
class Editor {
  // ... existing code ...

  handleInput(data: string) {
    // ... existing handling ...

    // Show autocomplete when starting with /
    if (this.value.startsWith("/")) {
      this.showAutocomplete(filterCommands(this.value.slice(1)));
    } else {
      this.hideAutocomplete();
    }
  }
}
```

The autocomplete is a small overlay above the editor showing matching commands. Up/Down navigates; Tab completes; Enter submits.

Pi has `CombinedAutocompleteProvider` (`packages/tui/src/autocomplete.ts`) for this. For mini-pi, skip autocomplete initially — just type the full command.

## Built-in commands worth having

Useful commands for any coding agent:

| Command | What it does |
|---|---|
| `/help` | Show commands |
| `/quit` or `/q` | Exit |
| `/clear` | Reset session |
| `/model [name]` | Show/change model |
| `/save [file]` | Save session to specific file |
| `/load <file>` | Load a session |
| `/tools` | List available tools |
| `/system <prompt>` | Change system prompt |
| `/abort` | Same as Esc — abort current run |
| `/version` | Show version |

For mini-pi, start with `/help`, `/quit`, `/clear`. Add more as needed.

## More elaborate commands

Commands can do anything a function can:

```ts
{
  name: "screenshot",
  description: "Take a screenshot and attach to next message",
  execute: async (_args, ctx) => {
    const path = `/tmp/screenshot-${Date.now()}.png`;
    await captureScreenshot(path);
    ctx.print(`Screenshot saved: ${path}`);
    ctx.editor.attachImage(path);   // editor adds image to next submit
  },
}
```

Or:

```ts
{
  name: "stats",
  description: "Show conversation stats",
  execute: (_args, ctx) => {
    const messages = ctx.agent.state.messages;
    const totalTokens = messages
      .filter(m => m.role === "assistant")
      .reduce((sum, m: any) => sum + (m.usage?.input ?? 0) + (m.usage?.output ?? 0), 0);
    ctx.print(`Messages: ${messages.length}, Total tokens: ${totalTokens}`);
  },
}
```

Some commands are async (network calls, file I/O). The dispatcher awaits them so output appears in order.

## Commands vs hooks vs extensions

Three ways to add functionality:

- **Commands** — user-triggered actions (`/help`, `/model`)
- **Hooks** — runtime interceptions (`beforeToolCall`)
- **Extensions** — bundles of all of the above (Chapter 9)

Use the right one:

- "User wants to do X interactively" → command
- "I want to gate Y behavior" → hook
- "I want to ship a package of related features" → extension

## Adding a command from outside

For mini-pi the commands array is in your code. For extensibility (Chapter 9), allow registration:

```ts
class InteractiveMode {
  private commands = new Map<string, SlashCommand>();

  registerCommand(cmd: SlashCommand) {
    this.commands.set(cmd.name, cmd);
  }
}

// Usage:
mode.registerCommand({
  name: "deploy",
  description: "Deploy to staging",
  execute: async (_args, ctx) => {
    ctx.print("Deploying...");
    await runDeploy();
    ctx.print("Done!");
  },
});
```

Pi exposes this via the extension API — extensions can `pi.registerCommand({...})` and they appear in `/help`.

## Stop and try this

Add a few slash commands to your mini-pi:

```ts
const commands: SlashCommand[] = [
  { name: "help", description: "Show commands", execute: (_, ctx) => {
    ctx.print(commands.map(c => `/${c.name}\t${c.description}`).join("\n"));
  }},
  { name: "quit", description: "Exit", execute: () => process.exit(0) },
  { name: "clear", description: "Reset session", execute: (_, ctx) => {
    ctx.agent.reset();
    // Clear UI components too:
    this.messagesContainer.clear();
    ctx.print("Session cleared.");
  }},
  { name: "tools", description: "List tools", execute: (_, ctx) => {
    const list = ctx.agent.state.tools.map(t => `  ${t.name} - ${t.description}`).join("\n");
    ctx.print("Available tools:\n" + list);
  }},
];
```

Wire into your interactive mode. Run mini-pi. Type `/help`. You should see your commands. Try `/tools`. Try `/clear`.

That's a real coding agent CLI now.

## Key takeaways

1. Slash commands intercept user input before it goes to the agent.
2. Define as data (name, description, execute); dispatch via lookup.
3. Output goes via a "system note" message type (UI-only).
4. Commands can be sync or async; await async ones for ordered output.
5. Make commands registerable by extensions to enable plugins (Chapter 9).

---

**Next:** [Lesson 8.4 — The Footer](./04-the-footer.md)
