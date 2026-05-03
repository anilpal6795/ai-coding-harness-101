# Lesson 9.1: Why Extensibility

Should your coding agent have a plugin system? Most projects say yes; most should say no. This lesson covers when extensibility is actually worth it.

## The case for extensions

A coding agent has limitless potential capabilities:

- Read/write to your specific cloud storage
- Integrate with your company's deploy system
- Run your custom linter
- Generate your team's PR template
- Talk to your internal API

You can't build all of these. **Each is valuable to a small subset of users.** Extensions let those users add what they need without you maintaining their code.

This is the open-source playbook: keep core small, push variation to plugins.

## The case against extensions

Plugins have costs:

- **API surface stability** — once an extension exists, your API can't break it
- **Loading complexity** — finding plugins, validating, sandboxing
- **Failure modes** — what if a plugin throws? Crashes the whole agent?
- **Debugging** — "is this a core bug or a plugin bug?"
- **Maintenance** — your test matrix multiplies by N plugins

For most projects, **just adding the feature to core is cheaper** than building a plugin system. Plugin systems pay off when:

- You can't predict what users want
- The user base is large enough that long-tail features matter
- The features differ enough that they shouldn't all be in core

Pi qualifies on all three. Most internal tools don't.

## Pi's design choice

Pi's philosophy: make extensibility a first-class feature. The core is **minimalist by intent** — just 7 built-in tools, a handful of slash commands, basic settings. Everything else is meant to be a plugin.

The README explicitly says:

> Pi ships with powerful defaults but skips features like sub agents and plan mode. Instead, you can ask pi to build what you want or install a third party pi package that matches your workflow.

This is unusual. Most coding agents bundle every feature their authors want. Pi defers to the user.

This is sustainable because:

- One person can maintain the small core
- Power users build their own plugins
- The community shares plugins via npm/git

## What an extension can do (in pi)

Pi's extension API lets you:

- **Add tools** — alongside (or replacing) the built-in `read`, `write`, `bash`, etc.
- **Add slash commands** — `/deploy`, `/review`, anything
- **Replace built-in tools** — your `bash` runs in a Docker sandbox instead of locally
- **Hook events** — `beforeToolCall`, `afterToolCall`, `onMessageEnd`
- **Add UI components** — widgets above/below editor, custom dialog overlays
- **Add status line items** — e.g., git branch, queue depth
- **Replace the editor** — use your own input component
- **Register LLM providers** — talk to your custom proxy
- **Add keybindings** — bind any key to any function
- **Customize compaction** — your own summarization strategy

That's a lot. The trade-off: pi's `extensions/` API is large and stable.

## The "make it look like Claude Code" example

A real pi extension makes pi UI look like Claude Code. That's the ultimate flex: an extension reskins the entire app.

The extension provides:

- A different theme
- Different message components (with different layout)
- Different slash commands
- Different keybindings

The core agent loop is unchanged. The user gets a different product.

If you can build "make it look like a different product" as an extension, you have over-engineered the right way.

## When mini-pi should add extensions

Skip extensions in mini-pi. They're not worth the complexity for a learning project. Add them when:

- Multiple users want different features and you can't satisfy all
- You want to release the core but let others customize
- You want to charge for "premium plugins" while keeping core open

For mini-pi v1: stop at Chapter 8. For mini-pi v2 (if you're building a real product): consider Chapter 9.

## Plugin types: a taxonomy

Three common plugin patterns:

### 1. Hook plugins (simple)

Register callbacks for specific events:

```ts
plugin.on("toolCall", (event) => { ... });
plugin.on("messageEnd", (msg) => { ... });
```

Limited but easy to design. Good for logging, telemetry, simple automations.

### 2. Function plugins (medium)

Register named functions that the host calls:

```ts
plugin.registerTool({ name, description, parameters, execute });
plugin.registerCommand({ name, description, execute });
```

This is what pi does for tools and commands.

### 3. Component plugins (complex)

Register custom UI components, replace built-in ones:

```ts
plugin.registerEditor(MyCustomEditor);
plugin.addWidget(MyStatusLineWidget, "footer");
```

These need the host to define a Component interface (which yours does, Chapter 7). Pi has this.

For a starter plugin system, do (1) and (2). Add (3) only when needed.

## Sandboxing (or not)

Plugins are code you didn't write. Two questions:

- **Should they be sandboxed?** (Limited filesystem, network, etc.)
- **Should they run in the same process?**

Pi: no sandbox, same process. Plugins have full system access.

Pi's reasoning: this is a CLI tool the user runs locally. They'd give a regular `npm install` package full access too. Adding sandboxing is a lot of work and false comfort.

The pi README is explicit:

> Pi packages run with full system access. Extensions execute arbitrary code, and skills can instruct the model to perform any action including running executables. Review source code before installing third-party packages.

If you're targeting an enterprise market, sandboxing matters more. Use VM2, isolated processes, or container per-plugin. Significant complexity.

## Stop and think

Before adding a plugin system to your coding agent, answer:

1. What features do users want that you don't want to build?
2. How many users are asking for each?
3. Could a simpler solution (config file, CLI args) work?
4. Are you ready to maintain a stable API forever?

If most answers are "I don't know," skip plugins for now. Build them when you have evidence of need.

## Key takeaways

1. Plugin systems pay off for big, varied user bases. Skip for small/uniform ones.
2. Pi's strategy: small core, big plugin API, push variation to community.
3. Three plugin tiers: hooks, functions, components — pick the simplest that works.
4. No sandboxing in pi; trust the user's `npm install` model.
5. Don't add a plugin system "just in case." Add when you have evidence you need one.

---

**Next:** [Lesson 9.2 — Extension API Design](./02-extension-api-design.md)
