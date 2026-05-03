# Lesson 3.1: What Tools Are

Two perspectives matter here: how the LLM sees tools, and how your harness sees them.

## From the LLM's perspective

The LLM gets a list of tools in its request. Each tool is:

```json
{
  "name": "read_file",
  "description": "Read the contents of a file from the local filesystem.",
  "input_schema": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Absolute or relative path to the file" }
    },
    "required": ["path"]
  }
}
```

That's all the LLM knows. Three things:

- **Name** — used to call the tool
- **Description** — natural language explanation of when/why/how to use it
- **Input schema** — JSON Schema describing the arguments

The model decides:

1. Whether to call any tool at all
2. Which tool to call
3. What arguments to pass

It does this based on the user's request, the conversation history, the system prompt, and these three fields.

## The model's tool choice mechanics

Internally, when a tool-capable model generates a response, it can produce either text tokens or "tool use" tokens that follow a specific format. The model has been trained to choose between them based on context.

When the model decides to call a tool:

1. It produces a `tool_use` content block instead of (or in addition to) text
2. The `name` field is one of the tools you offered (the model can hallucinate names but rarely does)
3. The `input` field is JSON conforming to your schema (mostly — sometimes it's wrong, hence validation)

After producing tool calls, the model emits `stop_reason: tool_use` and waits. **It is not actually executing anything.** It's saying "please run these and tell me what happened."

## Why descriptions are everything

The model's only source of truth about your tool is the description. Compare these:

```
Bad:  "Read a file"
Good: "Read the contents of a text file from disk. Returns the full file contents as a string. For binary files (images), returns an image content block instead. If the file is larger than 100KB, the output is truncated and a note is added."
```

A good description tells the model:

- What the tool does
- What it returns
- Edge cases and limits
- When to use it (vs other tools)

Models trained on more tool-use data are forgiving of bad descriptions. But you're leaving capability on the table. **A good description is worth more than fancier code.**

## From your harness's perspective

Your harness sees a `Tool` object that includes the LLM-facing fields **plus** an `execute` function:

```ts
interface Tool {
  name: string;
  description: string;
  parameters: SomeSchema;            // becomes input_schema for the LLM
  execute: (id, args, signal, onUpdate) => Promise<Result>;
}
```

When the LLM emits a `tool_use` block:

1. Your harness validates `args` against `parameters`
2. Calls `execute(id, args, signal, onUpdate)`
3. Captures the result
4. Builds a `tool_result` message and sends it back to the LLM

The model never sees `execute`. It only knows the schema.

## Validation matters

LLMs hallucinate. Sometimes the model:

- Calls a tool that doesn't exist
- Passes arguments of the wrong type
- Misses a required argument
- Adds extra arguments you didn't define

Without validation, your tool crashes with a confusing error. With validation, you can:

- Catch the error before calling `execute`
- Build a `tool_result` message saying "your call was malformed: <reason>" with `is_error: true`
- Send that back to the LLM
- The LLM tries again with corrected arguments

This is hugely powerful. **Validation errors become a teaching loop for the model.**

In our harness we'll use **TypeBox** for schemas. It gives us:

- TypeScript-native definitions (no separate `.json` files)
- Compile-time type inference (`Static<typeof schema>` gives you the validated TS type)
- Runtime validation
- Direct conversion to JSON Schema

Lesson 3.2 covers TypeBox in depth.

## Tools vs functions vs actions

The terminology around tools is wobbly. Here's how this course uses these terms:

- **Tool** — the thing you define (name + description + schema + execute). What we've been talking about.
- **Function** — what OpenAI used to call tools (legacy term). Same concept.
- **Action** — sometimes used in agent literature for "what the agent does." A tool call is an action.
- **Skill** — pi's term for a structured prompt that *guides* the model to a workflow. NOT an executable; it's a prompt fragment. Different from a tool.

If a paper or blog post uses these interchangeably, you can usually mentally map them.

## Tool design principles

A few rules of thumb that emerge from looking at well-designed tools (in pi, Cursor, Claude Code):

### 1. Tools should be small and obvious

Bad: a `git` tool that takes a "command" string. The model now has to know git syntax.
Good: separate `git_status`, `git_commit`, `git_log` tools with structured arguments.

Or: a `bash` tool that takes a command. The model knows shell. This works because shell is universal.

The principle: **structured arguments where the model lacks intuition; freeform where it has it.**

### 2. Return what's useful, not what's literal

Bad: `ls` returns `"file1.txt\nfile2.txt\n"`.
Good: `ls` returns a structured representation noting which are directories, file sizes, etc.

The model can do more with structure. But don't go overboard — text is fine when it's the right format.

### 3. Errors are part of the contract

Bad: tool throws on missing file.
Good: tool returns `{ content: "File not found: x.txt", isError: true }`.

The harness should put the error in a `tool_result` with `is_error: true`. The model sees the error and recovers.

### 4. Truncate verbosely

Bad: tool returns 500KB of text. Eats the context window.
Good: tool truncates to ~10KB and adds `[Output truncated. 487KB more available. Use offset/limit to read more.]`

The model handles this gracefully. Without truncation, one bad tool call wrecks the session.

### 5. Tool names matter

`read_file` is better than `rf`. `bash` is better than `execute_command`. The model uses names heuristically — clearer names yield better tool selection.

### 6. Make tool output renderable

The `details` field on a tool result (we'll see this in Chapter 4) lets you attach structured data for the UI. The `content` field is what the LLM sees. Use both.

For example, the `read` tool sends the file contents to the LLM but attaches `{ truncation: { ... } }` to `details` so the UI can render a "truncated by N bytes" hint.

## How many tools is too many?

Modern models handle 10-30 tools well. Above 50, performance degrades — too many options confuse the model.

If you have a lot of tools, consider:

- Grouping (one `git` tool with subcommands as enum values)
- Modal toolsets (different tools enabled in different "modes")
- Lazy registration (load specialized tools only when needed)

pi has 7 built-in tools and can be extended with arbitrary more. That's a sweet spot.

## Stop and try this

Look at `packages/coding-agent/src/core/tools/read.ts:17-21`:

```ts
const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});
```

Three fields: `path` (required), `offset` and `limit` (optional). Notice the descriptions on each field — those become hints for the model.

Then look at the rest of `read.ts` to see how complex a "simple" tool actually is in production. It handles: image detection, image resizing, byte truncation, line offsets, syntax highlighting for the UI. Each of those is a small product decision.

You don't need to build all that. But know that's where it goes.

## Key takeaways

1. The LLM sees: name, description, input schema. That's it.
2. Description quality determines tool effectiveness more than implementation quality.
3. Your harness adds `execute(args, signal, onUpdate)` to the LLM-facing definition.
4. Validation catches malformed calls; errors become teaching feedback for the model.
5. Tools are products. Design them carefully — structured args, useful output, clean errors, smart truncation.

---

**Next:** [Lesson 3.2 — Schemas with TypeBox](./02-schemas-with-typebox.md)
