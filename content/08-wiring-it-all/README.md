# Wiring Agent + TUI

You have an agent. You have a TUI. This chapter glues them together into a real coding agent CLI. By the end, you have mini-pi running interactively.

## Lessons

1. **[The interactive mode](./01-interactive-mode.md)** — The bridge between agent events and UI components
2. **[Rendering messages](./02-rendering-messages.md)** — One component per message type
3. **[Slash commands](./03-slash-commands.md)** — Editor extension for commands like `/help`
4. **[The footer](./04-the-footer.md)** — Status line: model, tokens, cost

## Time estimate

~75 minutes total.

## What you'll know by the end

- How to subscribe a TUI to an agent's events and translate to component changes
- How to design components for each message type (user, assistant, tool, error)
- How to add slash commands cleanly without bloating the agent
- A complete end-to-end mini-pi that you can use for real work

## Why this chapter matters

This is the payoff chapter. Everything before was preparation; this is where it becomes a product. The wiring patterns here are the same ones pi uses in `interactive-mode.ts`.
