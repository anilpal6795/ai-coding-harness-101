# Extension API Design

If you decide to add an extension API, design it carefully. You're committing to keeping it stable.

## The shape

A typical extension is a TypeScript file with a default export:

```ts
// my-extension.ts
import type { ExtensionAPI } from "pi-core";

export default function (api: ExtensionAPI) {
  api.registerTool({
    name: "deploy",
    description: "Deploy to production",
    parameters: { type: "object", properties: { env: { type: "string" } } },
    execute: async (args) => {
      // ...
    },
  });

  api.on("tool_call", (event) => {
    console.log(`Tool called: ${event.toolName}`);
  });
}
```

The host calls the default export with an `ExtensionAPI` object. The extension uses the API to register stuff.

## What's on the API surface

```ts
interface ExtensionAPI {
  // Tool registration
  registerTool(tool: ToolDefinition): void;
  unregisterTool(name: string): void;
  replaceTool(name: string, tool: ToolDefinition): void;

  // Command registration
  registerCommand(cmd: SlashCommand): void;
  unregisterCommand(name: string): void;

  // Event subscription
  on(event: string, handler: Function): () => void;

  // Hook registration
  registerBeforeToolCall(handler: BeforeToolCallHook): void;
  registerAfterToolCall(handler: AfterToolCallHook): void;

  // UI extension
  ui: {
    addWidget(component: Component, location: "above-editor" | "below-editor" | "footer"): WidgetHandle;
    showOverlay(component: Component, options?: OverlayOptions): OverlayHandle;
    showDialog(message: string, options: DialogOptions): Promise<string>;
  };

  // Provider registration
  registerProvider(provider: ProviderDefinition): void;

  // Settings access
  getSetting<T>(key: string, defaultValue: T): T;
  setSetting<T>(key: string, value: T): void;

  // Logging
  log(level: "debug" | "info" | "warn" | "error", ...args: any[]): void;
}
```

That's a lot. But each piece is a single function. The API is **flat** — no deep nesting, no class hierarchies.

Pi's actual API is slightly larger. See `packages/coding-agent/src/core/extensions/types.ts`.

## Stability matters

Once an extension exists, you can't break the API. Or rather: every break costs you (extensions stop working until updated).

Strategies for stability:

### 1. Add, don't change

If you want to enhance `registerTool`, don't change its signature — add `registerToolV2`. Keep the old one working.

```ts
registerTool(tool: ToolDefinition): void;
registerToolV2(tool: ToolDefinitionV2): void;  // new shape
```

Tedious but safe. After enough versions, deprecate the old.

### 2. Use feature detection

Make it possible for an extension to check for capabilities:

```ts
if (api.supports("ui.showImage")) {
  api.ui.showImage(buffer);
}
```

Extensions degrade gracefully when running on older hosts.

### 3. Versioning

Include an API version. Extensions declare what they need:

```ts
export const apiVersion = "2.x";
```

Host warns if mismatched.

### 4. Generous types

Make argument types extensible by making fields optional and accepting unknown extras:

```ts
interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
  execute: ExecuteFn;
  // future fields can be added; extensions can pass extras
  [key: string]: any;
}
```

Tradeoff: less type safety. Worth it for stability.

## Implementation

Building the API in your host:

```ts
class ExtensionRunner {
  private extensions: ExtensionInstance[] = [];

  async load(filePath: string) {
    const module = await import(filePath);
    const factory = module.default;
    if (typeof factory !== "function") {
      throw new Error(`Extension ${filePath} has no default export function`);
    }

    const api = this.createAPI(filePath);
    try {
      await factory(api);
      this.extensions.push({ path: filePath, api });
    } catch (err) {
      console.error(`Failed to load extension ${filePath}:`, err);
    }
  }

  private createAPI(extensionPath: string): ExtensionAPI {
    // The API is constructed PER extension so we can track which extension registered what
    return {
      registerTool: (tool) => {
        this.tools.push({ ...tool, source: extensionPath });
        // also register with the agent
        this.agent.state.tools = [...this.agent.state.tools, tool];
      },
      registerCommand: (cmd) => { /* ... */ },
      on: (event, handler) => { /* ... */ },
      // ... etc
    };
  }
}
```

Notice: each extension gets its own API instance. This lets you track "extension X registered tool Y" so you can unregister all of X's stuff if X is removed.

## Letting extensions intercept

Hooks are the most powerful extension type. Multiple extensions might want to hook the same event:

```ts
class ExtensionRunner {
  private beforeToolCallHooks: BeforeToolCallHook[] = [];

  registerBeforeToolCall(hook: BeforeToolCallHook) {
    this.beforeToolCallHooks.push(hook);
  }

  // The agent calls this single hook, which fans out:
  async runBeforeToolCall(ctx: BeforeToolCallContext) {
    for (const hook of this.beforeToolCallHooks) {
      const result = await hook(ctx);
      if (result?.block) return result;  // first blocker wins
    }
    return undefined;
  }
}
```

Then in the agent config:

```ts
const agent = new Agent({
  ...,
  beforeToolCall: (ctx) => extRunner.runBeforeToolCall(ctx),
});
```

Multiple extensions can hook the same point; the host fans them out.

## Wrapping vs replacing

Two ways extensions can modify built-in tools:

### Wrap

```ts
api.wrapTool("bash", (originalBash) => ({
  ...originalBash,
  execute: async (id, args, signal, onUpdate) => {
    api.log("info", "bash called:", args.command);
    return originalBash.execute(id, args, signal, onUpdate);
  },
}));
```

The wrapper calls the original. Multiple extensions can wrap the same tool, each layered on the next.

### Replace

```ts
api.replaceTool("bash", {
  name: "bash",
  description: "Run a bash command in a Docker container",
  parameters: bashSchema,
  execute: dockerizedExecute,
});
```

The original is gone. Only one extension can replace a given tool.

Pi supports both. For mini-pi, pick one. Wrapping is more flexible; replacing is simpler.

## Errors in extensions

When an extension throws:

```ts
try {
  await factory(api);
} catch (err) {
  console.error(`Extension ${path} failed to load:`, err);
  // Continue without it
}
```

Don't crash the whole host because an extension misbehaves.

For runtime errors (extension hook throws), wrap in try/catch:

```ts
async runHook(hook, ctx) {
  try {
    return await hook(ctx);
  } catch (err) {
    api.log("error", "Hook threw:", err);
    return undefined;  // treat as no-op
  }
}
```

Defense in depth.

## Where extensions live

Common locations:

- **`~/.<app>/extensions/`** — global, all projects
- **`./.<app>/extensions/`** — project-local
- **npm packages** — `npm install some-pi-extension`
- **git repos** — `pi install git:user/repo`

Pi supports all of these. Discovery: scan known directories on startup, find files with default exports.

For mini-pi, just one local directory `./extensions/`. Add npm/git later.

## A complete minimal extension system

```ts
// src/extensions/runner.ts

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Agent } from "../agent/agent.js";

export class ExtensionRunner {
  private extensions: any[] = [];

  constructor(private agent: Agent) {}

  async loadAll(dir: string) {
    if (!await fs.access(dir).then(() => true).catch(() => false)) return;
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (file.endsWith(".ts") || file.endsWith(".js")) {
        await this.load(path.join(dir, file));
      }
    }
  }

  private async load(filepath: string) {
    try {
      const module = await import(filepath);
      const factory = module.default;
      if (typeof factory !== "function") return;

      const api = {
        registerTool: (tool: any) => {
          this.agent.state.tools = [...this.agent.state.tools, tool];
        },
        log: (level: string, ...args: any[]) => {
          console.error(`[${level}]`, ...args);
        },
      };

      await factory(api);
      console.error(`Loaded extension: ${filepath}`);
    } catch (err) {
      console.error(`Failed to load ${filepath}:`, err);
    }
  }
}
```

Usage:

```ts
const runner = new ExtensionRunner(agent);
await runner.loadAll("./extensions");
```

That's the entire extension system. ~30 lines. Add more capabilities (commands, hooks, UI) as needed.

## Stop and try this

Build the runner above. Create `extensions/hello.ts`:

```ts
export default function (api: any) {
  api.registerTool({
    name: "hello",
    description: "Say hello",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    async execute(_id: string, args: { name: string }) {
      return {
        content: [{ type: "text", text: `Hello, ${args.name}!` }],
      };
    },
  });
}
```

Load it on mini-pi startup. Now ask the agent "say hello to Claude" — it should call your tool.

You added a tool without modifying core. That's the win.

## Key takeaways

1. Extension API design = stable, flat, generous types.
2. Add new methods over time; don't change existing ones.
3. Hooks fan out to multiple extensions; first blocker wins for `beforeToolCall`.
4. Wrap vs replace: wrap is layered; replace overrides.
5. Catch all extension errors — don't let bad plugins crash the host.

---

**Next:** [Lesson 9.3 — Loading TypeScript at Runtime](./03-runtime-typescript.md)
