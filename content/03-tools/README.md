# Tools — Defining and Executing

Tools are how the LLM acts in the world. This chapter covers everything about them: how to define them, validate calls, execute them, handle errors, and stream their progress.

## Lessons

1. **[What tools are](./01-what-tools-are.md)** — From the LLM's perspective and from yours
2. **[Schemas with TypeBox](./02-schemas-with-typebox.md)** — Type-safe definitions, validation
3. **[The execute contract](./03-the-execute-contract.md)** — Signal handling, progress streaming, errors
4. **[Streaming tool arguments](./04-streaming-tool-arguments.md)** — Showing the tool call before it's complete

## Examples

- `examples/01-define-a-tool.ts` — TypeBox tool definition
- `examples/02-execute-a-tool.ts` — manual tool execution loop

## Time estimate

~75 minutes total.

## What you'll know by the end

- How to define type-safe tools with auto-generated JSON schemas
- How to validate LLM-provided arguments before executing
- How to design tool `execute` functions that handle abort, errors, and progress
- The pattern for streaming partial tool arguments to the UI

## Why this chapter matters

Tool design *is* product design for a coding agent. A great `read` tool is what makes a great coding agent feel great. This chapter is how you build great tools.
