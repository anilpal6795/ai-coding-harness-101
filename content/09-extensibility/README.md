# Extensibility

Your coding agent can do a lot. But it can't do everything. Extensibility is how you let users (and yourself) add functionality without forking the code.

## Lessons

1. **[Why extensibility](./01-why-extensibility.md)** — The case for plugins
2. **[Extension API design](./02-extension-api-design.md)** — What to expose, what to hide
3. **[Loading TypeScript at runtime](./03-runtime-typescript.md)** — jiti and tsx
4. **[Skills and prompt templates](./04-skills-and-templates.md)** — Pi's "MCP-free" approach to capabilities

## Time estimate

~75 minutes total.

## What you'll know by the end

- The case for plugin systems and when not to bother
- How to design a stable extension API surface
- How to load and execute TypeScript at runtime safely
- How skills and prompt templates differ from tools, and when to use each

## Why this chapter matters

Pi's distinguishing feature is its extensibility. The core stays small; users add features. This is what enables one developer to maintain the project while it competes with VC-funded products. Understand this and you understand pi's strategy.
