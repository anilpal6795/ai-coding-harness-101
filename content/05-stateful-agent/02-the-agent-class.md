# Lesson 5.2: The Agent Class

Time to build the class. We'll wrap the `runAgent` function from Chapter 4 with state management.

## The shape

```ts
class Agent {
  state: AgentState;

  constructor(options: AgentOptions);

  // Inputs
  async prompt(input: string | Message): Promise<void>;
  async continue(): Promise<void>;
  steer(message: Message): void;
  followUp(message: Message): void;

  // Lifecycle
  abort(): void;
  waitForIdle(): Promise<void>;
  reset(): void;

  // Subscriptions
  subscribe(listener: (event: AgentEvent) => void): () => void;
}
```

That's the full public surface. ~10 methods.

## The state object

```ts
interface AgentState {
  systemPrompt: string;
  model: Model;
  tools: AgentTool[];
  messages: AgentMessage[];

  // Read-only view of runtime status:
  readonly isStreaming: boolean;
  readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage?: string;
}
```

Notice: messages, tools, model, systemPrompt are settable. The `readonly` ones are derived.

## The implementation

`src/agent/agent.ts`:

```ts
import { runAgent } from "./loop.js";
import type {
  AgentContext,
  AgentEvent,
  AgentTool,
  AgentMessage,
} from "./types.js";
import type { Message, Model } from "../llm/types.js";

export interface AgentOptions {
  systemPrompt?: string;
  model: Model;
  tools?: AgentTool[];
  apiKey?: string;
  convertToLlm?: (msgs: AgentMessage[]) => Message[];
}

export interface AgentState {
  systemPrompt: string;
  model: Model;
  tools: AgentTool[];
  messages: AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage?: string;
}

export class Agent {
  // Owned state (mutable, defensive on assignment)
  private _systemPrompt: string;
  private _model: Model;
  private _tools: AgentTool[];
  private _messages: AgentMessage[];

  // Runtime state (computed)
  private activeRun?: {
    promise: Promise<void>;
    abortController: AbortController;
  };
  private _streamingMessage?: AgentMessage;
  private _pendingToolCalls = new Set<string>();
  private _errorMessage?: string;

  // Steering / follow-up
  private steeringQueue: AgentMessage[] = [];
  private followUpQueue: AgentMessage[] = [];

  // Subscribers
  private listeners = new Set<(event: AgentEvent) => void>();

  // Provider config
  private apiKey?: string;
  private convertToLlm?: (msgs: AgentMessage[]) => Message[];

  constructor(options: AgentOptions) {
    this._systemPrompt = options.systemPrompt ?? "";
    this._model = options.model;
    this._tools = options.tools?.slice() ?? [];
    this._messages = [];
    this.apiKey = options.apiKey;
    this.convertToLlm = options.convertToLlm;
  }

  // ─── State accessors ────────────────────────────────────────────

  get state(): AgentState {
    const self = this;
    return {
      get systemPrompt() { return self._systemPrompt; },
      set systemPrompt(v: string) { self._systemPrompt = v; },
      get model() { return self._model; },
      set model(v: Model) { self._model = v; },
      get tools() { return self._tools; },
      set tools(v: AgentTool[]) { self._tools = v.slice(); },
      get messages() { return self._messages; },
      set messages(v: AgentMessage[]) { self._messages = v.slice(); },
      get isStreaming() { return self.activeRun !== undefined; },
      get streamingMessage() { return self._streamingMessage; },
      get pendingToolCalls() { return self._pendingToolCalls as ReadonlySet<string>; },
      get errorMessage() { return self._errorMessage; },
    };
  }

  // ─── Subscribe ──────────────────────────────────────────────────

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AgentEvent): void {
    // Track runtime state from events
    switch (event.type) {
      case "message_start":
        this._streamingMessage = event.message;
        break;
      case "message_update":
        this._streamingMessage = event.message;
        break;
      case "message_end":
        this._streamingMessage = undefined;
        break;
      case "tool_start":
        this._pendingToolCalls.add(event.toolCallId);
        break;
      case "tool_end":
        this._pendingToolCalls.delete(event.toolCallId);
        break;
      case "agent_end":
        this._streamingMessage = undefined;
        this._pendingToolCalls.clear();
        break;
    }

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("Listener threw:", err);
      }
    }
  }

  // ─── Public methods ─────────────────────────────────────────────

  async prompt(input: string | AgentMessage): Promise<void> {
    if (this.activeRun) {
      throw new Error("Agent is already processing. Use steer() or followUp().");
    }

    const message: AgentMessage = typeof input === "string"
      ? { role: "user", content: input, timestamp: Date.now() }
      : input;

    await this.runWithLifecycle(async (signal) => {
      const context: AgentContext = {
        systemPrompt: this._systemPrompt,
        messages: this._messages,
        tools: this._tools,
      };

      await runAgent(
        message,
        context,
        {
          model: this._model,
          apiKey: this.apiKey,
          signal,
          convertToLlm: this.convertToLlm,
        },
        (event) => this.emit(event),
      );
    });
  }

  steer(message: AgentMessage): void {
    this.steeringQueue.push(message);
  }

  followUp(message: AgentMessage): void {
    this.followUpQueue.push(message);
  }

  abort(): void {
    this.activeRun?.abortController.abort();
  }

  waitForIdle(): Promise<void> {
    return this.activeRun?.promise ?? Promise.resolve();
  }

  reset(): void {
    this._messages = [];
    this._streamingMessage = undefined;
    this._pendingToolCalls.clear();
    this._errorMessage = undefined;
    this.steeringQueue = [];
    this.followUpQueue = [];
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  private async runWithLifecycle(
    executor: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const abortController = new AbortController();
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    this.activeRun = { promise, abortController };
    this._errorMessage = undefined;

    try {
      await executor(abortController.signal);
    } catch (err: any) {
      this._errorMessage = err?.message ?? String(err);
    } finally {
      this.activeRun = undefined;
      resolve();
    }
  }
}
```

This is ~150 lines. Read it carefully. Each piece has a job:

- **Constructor + private state**: holds everything.
- **`state` getter**: returns an object with proxied access to private state, with copy-on-assign for arrays.
- **`emit`**: tracks runtime state from events as a side effect, then fans out to listeners.
- **`prompt`**: enforces "one run at a time," wraps in lifecycle.
- **`runWithLifecycle`**: tracks `activeRun`, sets up abort controller, ensures cleanup.

## Using it

```ts
import { Agent } from "../agent/agent.js";
import { readTool, lsTool } from "./tools.js";  // your tools

const agent = new Agent({
  model: claude,
  systemPrompt: "You are a coding assistant.",
  tools: [readTool, lsTool],
});

agent.subscribe((event) => {
  if (event.type === "message_update" && event.message.role === "assistant") {
    // render to UI
  }
});

await agent.prompt("Read package.json");
console.log("Done. Messages:", agent.state.messages.length);

await agent.prompt("Now read README.md");
console.log("Done. Messages:", agent.state.messages.length);   // bigger now
```

State persists between prompts. Subscribers stay attached. The model, tools, system prompt can be changed at any time.

## What we still need to add

The version above is functional but missing:

- **Steering and follow-up dispatch** — we have queues, but the loop doesn't poll them yet. Lesson 5.4.
- **Continue method** — for retries after errors. Easy add later.
- **Hooks** (`beforeToolCall`, `afterToolCall`) — Lesson 5.5.
- **Parallel tool execution** — change to the underlying loop. Lesson 5.5.

Let's keep building.

## A subtlety: copying messages on assignment

```ts
set messages(v: AgentMessage[]) { self._messages = v.slice(); }
```

Why `.slice()`? Because:

```ts
const externalArray = [msg1, msg2];
agent.state.messages = externalArray;
externalArray.push(msg3);   // Without slice, this would mutate agent's state!
```

With slice, the agent owns its own array. External mutations don't affect it.

But: `agent.state.messages.push(msg3)` *does* work — because the getter returns the live reference. So you can append/modify in-place; you just can't accidentally hand the agent a shared reference.

This is pragmatic, slightly weird, but it's what pi does. Fine for our purposes.

## Compare to pi's Agent

Open `packages/agent/src/agent.ts`. See:

- `class Agent` at line 158
- `state` getter at line 229 — same pattern
- `subscribe` at line 219 — same pattern
- `prompt` at line 313 — wraps `runAgentLoop`
- `abort` at line 287 — same `abortController.abort()`
- `waitForIdle` at line 297 — returns the run promise
- `_state.messages` getter/setter at line 80-85 — same copy-on-assign

Yours is simpler (no thinking budgets, no transport, no metadata, no async listeners). The shape is identical.

## Stop and try this

Build the class above and write a small test:

```ts
const agent = new Agent({ model: claude, tools: [] });

let eventCount = 0;
agent.subscribe(() => eventCount++);

console.log("Before:", agent.state.isStreaming);  // false
const promise = agent.prompt("Say hello");
console.log("During:", agent.state.isStreaming);  // true (might be! race)
await promise;
console.log("After:", agent.state.isStreaming);   // false

console.log(`Events: ${eventCount}, Messages: ${agent.state.messages.length}`);
```

Run it. You should see streaming go true → false, events fire, messages accumulate. **You have a stateful agent.**

## Key takeaways

1. The Agent class wraps the functional loop with state and subscription.
2. State has owned (mutable) and derived (read-only) parts.
3. Copy-on-assign protects against external mutation; in-place modification still works.
4. `runWithLifecycle` ensures cleanup even on errors/aborts.
5. The class has ~10 public methods. That's all the surface area you need.

---

**Next:** [Lesson 5.3 — Abort and Cancellation](./03-abort-and-cancellation.md)
