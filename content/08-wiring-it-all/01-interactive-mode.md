# The Interactive Mode

This is the layer that owns both the Agent and the TUI and translates between them. In pi, it's `interactive-mode.ts`. In mini-pi, we'll call it the same.

## The job

```
Agent emits AgentEvent
       │
       ▼
Interactive mode subscribes
       │
       ▼
Translates to TUI component changes
       │
       ▼
TUI renders
```

And the reverse:

```
User types in editor
       │
       ▼
Editor onSubmit fires
       │
       ▼
Interactive mode calls agent.prompt(text)
       │
       ▼
Agent runs the loop
```

The interactive mode is the **only** layer that knows about both Agent and TUI. Everything else stays in its lane.

## The structure

```ts
class InteractiveMode {
  private agent: Agent;
  private tui: TUI;

  // Components
  private messagesContainer: Container;
  private editor: Editor;
  private footer: Footer;

  // Component map: messageId → its UI component
  private messageComponents = new Map<string, Component>();

  constructor(agent: Agent, tui: TUI) {
    this.agent = agent;
    this.tui = tui;
    this.setupComponents();
    this.setupSubscription();
    this.setupEditor();
  }

  private setupComponents() {
    this.messagesContainer = new Container();
    this.editor = new Editor(this.tui);
    this.footer = new Footer();

    this.tui.addChild(this.messagesContainer);
    this.tui.addChild(new Spacer());
    this.tui.addChild(this.editor);
    this.tui.addChild(this.footer);

    this.tui.setFocus(this.editor);
  }

  private setupSubscription() {
    this.agent.subscribe((event) => this.handleEvent(event));
  }

  private setupEditor() {
    this.editor.onSubmit = (text) => this.handleUserInput(text);
  }

  private handleEvent(event: AgentEvent) {
    // Translate event to UI changes
    // ...
  }

  private handleUserInput(text: string) {
    if (this.agent.state.isStreaming) {
      this.agent.steer({ role: "user", content: text, timestamp: Date.now() });
    } else {
      this.agent.prompt(text);
    }
  }

  async run() {
    this.tui.start();
    return new Promise<void>(resolve => {
      // run forever; cleanup on signal
    });
  }
}
```

The structure is straightforward. The interesting bits are in `handleEvent`.

## Translating events to UI

The pattern for each event type:

### `message_start` (any role)

A new message is about to stream. Create a component for it, add to the messages container.

```ts
case "message_start": {
  const component = createMessageComponent(event.message, this.tui);
  this.messageComponents.set(getMessageId(event.message), component);
  this.messagesContainer.add(component);
  this.tui.requestRender();
  break;
}
```

### `message_update` (streaming text/tool deltas)

The message is being updated. Find its component, tell it to refresh.

```ts
case "message_update": {
  const component = this.messageComponents.get(getMessageId(event.message));
  if (component) {
    component.setMessage?.(event.message);  // pass updated message
    this.tui.requestRender();
  }
  break;
}
```

The component knows how to re-render itself given the new message data.

### `message_end`

The message is finalized. Final update to the component.

```ts
case "message_end": {
  const component = this.messageComponents.get(getMessageId(event.message));
  if (component) {
    component.setMessage?.(event.message);
    component.finalize?.();  // optional: lock state, hide cursor, etc.
    this.tui.requestRender();
  }
  break;
}
```

### `tool_start`

A tool is starting to execute. Create a tool box component.

```ts
case "tool_start": {
  const toolBox = new ToolExecutionComponent(event.toolName, event.args);
  this.messageComponents.set(`tool-${event.toolCallId}`, toolBox);
  this.messagesContainer.add(toolBox);
  this.tui.requestRender();
  break;
}
```

### `tool_update`

Streaming progress. Pass the partial result.

```ts
case "tool_update": {
  const box = this.messageComponents.get(`tool-${event.toolCallId}`) as ToolExecutionComponent;
  box?.setPartialResult(event.partial);
  this.tui.requestRender();
  break;
}
```

### `tool_end`

The tool finished. Finalize.

```ts
case "tool_end": {
  const box = this.messageComponents.get(`tool-${event.toolCallId}`) as ToolExecutionComponent;
  box?.setResult(event.result, event.isError);
  this.tui.requestRender();
  break;
}
```

That's the entire event-to-UI translation. ~30 lines of `case` statements.

## Updating the footer

The footer shows runtime info. Update it on relevant events:

```ts
case "message_end": {
  if (event.message.role === "assistant") {
    this.footer.setUsage(event.message.usage);
  }
  break;
}

case "agent_start":
case "agent_end": {
  this.footer.setStreaming(this.agent.state.isStreaming);
  break;
}
```

The footer is a single component. It re-renders on changes.

## Handling user input

The editor's `onSubmit` fires when the user presses Enter. Two states:

- **Idle**: agent.prompt(text) — start a new turn
- **Busy**: agent.steer(text) — queue for mid-loop injection

```ts
private handleUserInput(text: string) {
  if (!text.trim()) return;

  if (this.agent.state.isStreaming) {
    this.agent.steer({ role: "user", content: text, timestamp: Date.now() });
    this.editor.showQueueIndicator();  // visual: "queued"
  } else {
    this.agent.prompt(text);
  }
}
```

Slash commands intercept before this:

```ts
private handleUserInput(text: string) {
  if (text.startsWith("/")) {
    return this.handleSlashCommand(text);
  }
  // ... regular submit
}
```

We'll cover slash commands in Lesson 8.3.

## Handling Esc (abort)

```ts
private setupEditor() {
  this.editor.onSubmit = (text) => this.handleUserInput(text);
  this.editor.onEscape = () => {
    if (this.agent.state.isStreaming) {
      this.agent.abort();
    }
  };
}
```

Esc when busy = abort. Esc when idle = clear editor (or maybe close an overlay).

## The full skeleton

```ts
// src/app/interactive.ts

import { Agent } from "../agent/agent.js";
import type { AgentEvent } from "../agent/types.js";
import { TUI } from "../ui/tui.js";
import { Container, Editor, Spacer } from "../ui/components.js";
import { UserMessageComponent, AssistantMessageComponent, ToolExecutionComponent } from "./components.js";
import { Footer } from "./footer.js";

export class InteractiveMode {
  private messagesContainer = new Container();
  private editor: Editor;
  private footer = new Footer();
  private componentByMessageId = new Map<string, any>();

  constructor(private agent: Agent, private tui: TUI) {
    this.editor = new Editor(tui);

    tui.addChild(this.messagesContainer);
    tui.addChild(new Spacer());
    tui.addChild(this.editor);
    tui.addChild(this.footer);
    tui.setFocus(this.editor);

    agent.subscribe(event => this.handleEvent(event));

    this.editor.onSubmit = text => this.handleUserInput(text);
    this.editor.onEscape = () => { if (agent.state.isStreaming) agent.abort(); };
  }

  private handleEvent(event: AgentEvent) {
    switch (event.type) {
      case "message_start": {
        const component = this.createComponentForMessage(event.message);
        if (component) {
          this.componentByMessageId.set(getMessageId(event.message), component);
          this.messagesContainer.add(component);
          this.tui.requestRender();
        }
        break;
      }
      case "message_update": {
        const c = this.componentByMessageId.get(getMessageId(event.message));
        c?.setMessage?.(event.message);
        this.tui.requestRender();
        break;
      }
      case "message_end": {
        const c = this.componentByMessageId.get(getMessageId(event.message));
        c?.setMessage?.(event.message);
        if (event.message.role === "assistant" && event.message.usage) {
          this.footer.setUsage(event.message.usage);
        }
        this.tui.requestRender();
        break;
      }
      case "tool_start": {
        const box = new ToolExecutionComponent(event.toolName, event.args);
        this.componentByMessageId.set(`tool-${event.toolCallId}`, box);
        this.messagesContainer.add(box);
        this.tui.requestRender();
        break;
      }
      case "tool_update": {
        const box = this.componentByMessageId.get(`tool-${event.toolCallId}`);
        box?.setPartialResult?.(event.partial);
        this.tui.requestRender();
        break;
      }
      case "tool_end": {
        const box = this.componentByMessageId.get(`tool-${event.toolCallId}`);
        box?.setResult?.(event.result, event.isError);
        this.tui.requestRender();
        break;
      }
      case "agent_start":
      case "agent_end": {
        this.footer.setStreaming(this.agent.state.isStreaming);
        this.tui.requestRender();
        break;
      }
    }
  }

  private createComponentForMessage(message: AgentMessage) {
    if (message.role === "user") return new UserMessageComponent(message);
    if (message.role === "assistant") return new AssistantMessageComponent(message);
    if (message.role === "toolResult") return null;  // handled via tool_end
    return null;
  }

  private handleUserInput(text: string) {
    if (!text.trim()) return;

    if (text.startsWith("/")) {
      this.handleSlashCommand(text);
      return;
    }

    if (this.agent.state.isStreaming) {
      this.agent.steer({ role: "user", content: text, timestamp: Date.now() });
    } else {
      this.agent.prompt(text);
    }
  }

  private handleSlashCommand(text: string) {
    const cmd = text.slice(1).split(" ")[0];
    if (cmd === "quit" || cmd === "q") process.exit(0);
    if (cmd === "help") this.showHelp();
    // ... etc
  }

  async run() {
    this.tui.start();
    return new Promise<void>(() => { /* runs forever */ });
  }
}

function getMessageId(message: any): string {
  return message.id || `${message.role}-${message.timestamp}`;
}
```

That's the entire wiring. ~120 lines. Compare to pi's `packages/coding-agent/src/modes/interactive/interactive-mode.ts` (5K+ lines) — pi has a lot more components, slash commands, themes, overlays. But the spine is what you have here.

## Key takeaways

1. The Interactive Mode owns both Agent and TUI; it's the bridge.
2. Subscribe to agent events; translate each to UI changes via `case` statements.
3. Maintain a `componentByMessageId` map so updates can find the right component.
4. Editor `onSubmit` decides: prompt vs steer based on `isStreaming`.
5. ~120 lines of glue. The rest of pi's `interactive-mode.ts` is features, not architecture.

---

**Next:** [Lesson 8.2 — Rendering Messages](./02-rendering-messages.md)
