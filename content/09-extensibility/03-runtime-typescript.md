# Lesson 9.3: Loading TypeScript at Runtime

Extensions are TypeScript files. Your host needs to load and execute them. The user shouldn't have to compile them first. This lesson covers how.

## Why this is hard

Node.js doesn't natively run `.ts` files. You need to:

1. Find the file
2. Compile it to JS
3. Cache the result (so repeated loads are fast)
4. Handle imports (the extension might `import` things)
5. Provide types for the host's API

If you make users compile extensions before installing, they will hate you. So the host must handle TS loading transparently.

## Three options

### Option 1: tsx (or ts-node)

These let you run TS directly:

```bash
npx tsx my-script.ts
```

But tsx is a CLI runner. Calling it from inside another Node program is awkward.

You CAN do `import("./extension.ts")` in a Node process started with tsx. But your host has to be tsx-launched, which is a project requirement.

For mini-pi this works — your host is launched with `npx tsx`. Just `import("./extensions/hello.ts")` works.

### Option 2: jiti

[jiti](https://github.com/unjs/jiti) is a TypeScript loader you can use programmatically:

```ts
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const extensionModule = await jiti.import("./extensions/hello.ts");
const factory = extensionModule.default;
```

jiti compiles TS on-demand, caches the result, supports ES modules and CommonJS. **It's what pi uses.**

Install: `npm install jiti`.

The benefit over tsx: jiti is a library, not a CLI runner. Your host can be plain Node, jiti loads TS extensions on demand.

### Option 3: pre-compile

Require extensions to be `.js` (already compiled). Make the developer ship `dist/` artifacts.

This works for npm-published extensions (they ship JS anyway). For local development, it's annoying — every change requires `npm run build`.

Pi mostly uses jiti for local dev, accepts JS for npm packages.

## A jiti-based loader

```ts
import { createJiti } from "jiti";
import * as path from "node:path";

class ExtensionLoader {
  private jiti = createJiti(import.meta.url, {
    interopDefault: true,
    cache: true,
  });

  async load(filepath: string): Promise<any> {
    const absolute = path.resolve(filepath);
    const module = await this.jiti.import(absolute);
    return module.default ?? module;
  }
}
```

Usage:

```ts
const loader = new ExtensionLoader();
const factory = await loader.load("./extensions/hello.ts");
factory(api);
```

That's it. jiti handles the compilation, the caching, the module resolution.

## Caching

jiti caches compiled output by default. Subsequent loads of the same file are fast. The cache lives in `node_modules/.cache/jiti` (or similar).

If you change the extension file, jiti detects (via mtime) and recompiles. No manual cache invalidation needed.

For long-running hosts, you might want to **hot-reload** extensions on file changes:

```ts
import { watch } from "fs/promises";

async function watchExtension(filepath: string, onChange: (mod: any) => void) {
  for await (const _ of watch(filepath)) {
    const mod = await loader.load(filepath);
    onChange(mod);
  }
}
```

Tricky: when you reload, you need to unregister the old extension's stuff and register the new. Pi has this for theme files (which are JSON-like, easier to hot-reload). For extensions with side effects, hot-reload is harder.

For mini-pi, skip hot-reload. The user can restart.

## Imports inside extensions

Extensions might want to `import` things:

```ts
// extension
import { readFile } from "fs/promises";
import * as path from "node:path";
import myUtil from "./util.js";

export default function (api: any) {
  // ...
}
```

jiti handles this — Node modules and relative imports work normally.

But: **what about imports of the HOST**? An extension might want types from the host:

```ts
import type { ExtensionAPI } from "your-host";
```

Two strategies:

### A. Publish a types package

Your host publishes `your-host-types` to npm. Extensions install it as a dev dep:

```ts
import type { ExtensionAPI } from "your-host-types";
```

Pi does this with `@mariozechner/pi-coding-agent` exporting types from its `index.ts`.

### B. Provide types via a global

Set up TypeScript to inject globals:

```ts
declare global {
  const pi: ExtensionAPI;
}

// extension just uses `pi` without importing
pi.registerTool({...});
```

Less explicit but no install required. Pi doesn't do this.

For mini-pi, A is cleaner.

## Security notes

Loading user code = running arbitrary code. The extension can:

- Read your filesystem
- Send your env vars to a remote server
- Inject malicious tools that the LLM might call

There's no real defense for "the user installed a malicious package." All you can do:

- Document risk loudly (pi does)
- Encourage users to read source before installing
- Maintain a curated registry of trusted extensions

VM-based sandboxing exists (Node's `vm` module, isolated-vm) but it's hard to do well and limits what extensions can do. For most coding agents, "trust the npm install model" is the pragmatic choice.

## Native modules

If an extension uses a native module (like better-sqlite3), jiti can't help — those need building. The extension's `package.json` should list them in `dependencies`, `npm install` builds them, jiti loads them through normal `require`.

This works in pi but adds setup steps for the user. Worth a mention.

## Stop and try this

Add jiti to your mini-pi:

```bash
npm install jiti
```

Update your loader:

```ts
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

async function loadExtension(filepath: string) {
  const module = await jiti.import(filepath);
  return module.default;
}
```

Create `extensions/timer.ts`:

```ts
export default function (api: any) {
  api.registerTool({
    name: "current_time",
    description: "Get the current time",
    parameters: { type: "object", properties: {} },
    async execute() {
      return {
        content: [{ type: "text", text: new Date().toISOString() }],
      };
    },
  });
}
```

Load it from your main.ts:

```ts
const factory = await loadExtension("./extensions/timer.ts");
factory(api);
```

Run mini-pi, ask it for the current time. The agent should call your tool.

You just loaded a TypeScript extension at runtime. That's the whole infrastructure for plugins.

## Key takeaways

1. Loading TS at runtime: use jiti (library) or rely on tsx (CLI launcher).
2. jiti compiles on-demand, caches, supports modern features.
3. Imports inside extensions work normally; types from host published as separate package.
4. Hot-reload is possible but tricky with side effects; skip for v1.
5. Security: trust the npm install model; document risks; sandbox only if you must.

---

**Next:** [Lesson 9.4 — Skills and Prompt Templates](./04-skills-and-templates.md)
