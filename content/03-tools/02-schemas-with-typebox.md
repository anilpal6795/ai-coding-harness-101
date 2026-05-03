# Lesson 3.2: Schemas with TypeBox

We need to define tool parameters in a way that's:

1. Type-safe in TypeScript (so the `execute` function gets typed args)
2. Validated at runtime (so we catch bad LLM calls)
3. Convertible to JSON Schema (so we can send it to the LLM)

TypeBox does all three. This lesson is a focused tour.

## Why TypeBox vs Zod / Valibot / JSON Schema

There are several validation libraries; they all work. Here's why pi uses TypeBox and we'll mirror it:

- **TypeBox schemas ARE JSON Schemas.** No conversion step. You can directly send them to the LLM.
- **Type inference via `Static<typeof schema>`.** You get the TS type for free.
- **Tiny dependency.** No runtime overhead.
- **JSON-serializable.** Useful for distributed systems (sending tool defs over RPC, etc.)

Zod is also great and slightly more popular. Zod schemas need conversion to JSON Schema (via `zod-to-json-schema`). For our purposes either works; we'll use TypeBox because it matches pi.

## The basics

```ts
import { Type, Static } from "typebox";

const PersonSchema = Type.Object({
  name: Type.String({ description: "Full name" }),
  age: Type.Number({ minimum: 0 }),
  email: Type.Optional(Type.String({ format: "email" })),
});

// Type inference
type Person = Static<typeof PersonSchema>;
// equivalent to:
// type Person = { name: string; age: number; email?: string };
```

`Type.Object` is the most common starting point. Inside it, the keys become property names; the values become field schemas.

## Common types

### Primitives

```ts
Type.String()
Type.Number()
Type.Integer()
Type.Boolean()
Type.Null()
```

Each accepts an options object with JSON Schema fields:

```ts
Type.String({
  description: "An ISO date",
  format: "date",
  minLength: 10,
  maxLength: 10,
})

Type.Number({
  description: "Price in USD",
  minimum: 0,
  maximum: 1000000,
})
```

### Optional and required

By default all fields are required. Wrap with `Type.Optional` to make optional:

```ts
Type.Object({
  required_field: Type.String(),
  optional_field: Type.Optional(Type.Number()),
})
```

### Enums

For string enums, use `Type.Union` or a helper:

```ts
const Mode = Type.Union([
  Type.Literal("read"),
  Type.Literal("write"),
]);
type ModeT = Static<typeof Mode>;  // "read" | "write"
```

Or pi-ai's `StringEnum` helper, which is just `Type.Union(values.map(Type.Literal))`. Enum-flavored unions like this play nicely with all providers.

> 💡 **Don't use `Type.Enum`**. It produces JSON Schema with `anyOf` + `const`, which Google's Gemini doesn't accept. Use `Type.Union(Type.Literal(...))` or `StringEnum` instead.

### Arrays

```ts
Type.Array(Type.String())                                   // string[]
Type.Array(Type.Object({ x: Type.Number() }), { minItems: 1 })
```

### Nested objects

```ts
Type.Object({
  user: Type.Object({
    name: Type.String(),
    address: Type.Object({
      city: Type.String(),
      country: Type.String(),
    }),
  }),
})
```

### Records (string-keyed maps)

```ts
Type.Record(Type.String(), Type.Number())  // { [key: string]: number }
```

## Validation

To check if a value matches a schema, use the `Value` helper:

```ts
import { Value } from "typebox/value";

const PersonSchema = Type.Object({
  name: Type.String(),
  age: Type.Number({ minimum: 0 }),
});

const candidate = { name: "Ada", age: -5 };

if (Value.Check(PersonSchema, candidate)) {
  // Type narrowed to Static<typeof PersonSchema>
  console.log(candidate.name);
} else {
  // Get errors
  const errors = [...Value.Errors(PersonSchema, candidate)];
  console.log(errors);
  // [
  //   { message: "Expected number to be greater or equal to 0", path: "/age", value: -5 }
  // ]
}
```

`Value.Check` is the validator. `Value.Errors` returns an iterator of validation errors with paths and messages.

For our agent, we'll catch validation failures and convert them to error tool results.

## Coercion (use carefully)

TypeBox can coerce values (string `"5"` → number `5`):

```ts
import { Value } from "typebox/value";

const result = Value.Convert(NumberSchema, "5");  // 5
```

This is useful when a model returns wrong-typed values. **But it can hide bugs.** Default to strict checking, only coerce specific known cases.

## Defining a tool with TypeBox

Putting it together:

```ts
import { Type, Static } from "typebox";

const readFileSchema = Type.Object({
  path: Type.String({
    description: "Path to the file (relative or absolute)",
  }),
  offset: Type.Optional(Type.Number({
    description: "Line number to start reading from (1-indexed)",
    minimum: 1,
  })),
  limit: Type.Optional(Type.Number({
    description: "Maximum number of lines to read",
    minimum: 1,
  })),
});

type ReadFileArgs = Static<typeof readFileSchema>;
// { path: string; offset?: number; limit?: number }

const readFileTool = {
  name: "read_file",
  description: "Read a file from the local filesystem. Returns text content. For very large files, use offset/limit to paginate.",
  parameters: readFileSchema,
  async execute(id: string, args: ReadFileArgs, signal: AbortSignal) {
    // args is fully typed here
    const content = await readFileFromDisk(args.path, args.offset, args.limit);
    return {
      content: [{ type: "text" as const, text: content }],
      details: { path: args.path },
    };
  },
};
```

Notice:

- `parameters: readFileSchema` is the JSON-Schema-compatible TypeBox object
- The `execute` function gets typed `args` thanks to `Static`
- The schema's descriptions become hints the model uses

## Sending the schema to the LLM

The Anthropic API wants `input_schema`. You give it your TypeBox schema directly:

```ts
{
  tools: [{
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,  // TypeBox is JSON-Schema-compatible
  }]
}
```

That's it. No conversion. **TypeBox schemas are valid JSON Schema by construction.**

> 💡 **Caveat:** if you use exotic TypeBox features (Intersect, Not, conditional types), the JSON Schema gets complex and some providers may reject it. Stick to the basics: Object, String, Number, Boolean, Array, Optional, Union(Literal). Pi follows this rule.

## Validation in the agent loop

This is what your loop will do (preview from Chapter 4):

```ts
for (const toolCall of toolCalls) {
  const tool = tools.find(t => t.name === toolCall.name);

  if (!tool) {
    pushErrorResult(toolCall.id, `Tool ${toolCall.name} not found`);
    continue;
  }

  if (!Value.Check(tool.parameters, toolCall.arguments)) {
    const errors = [...Value.Errors(tool.parameters, toolCall.arguments)];
    pushErrorResult(toolCall.id, `Invalid arguments: ${errors[0].message}`);
    continue;
  }

  const result = await tool.execute(toolCall.id, toolCall.arguments, signal);
  pushResult(toolCall.id, result);
}
```

Validation as a first-class step. This is what makes the agent forgiving of LLM mistakes.

## A real-world tool with all the bells

Here's `read_file` in the style of pi's production version:

```ts
import { Type, Static } from "typebox";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const readSchema = Type.Object({
  path: Type.String({ description: "File path (relative or absolute)" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start at (1-indexed)", minimum: 1 })),
  limit: Type.Optional(Type.Number({ description: "Maximum lines to read", minimum: 1 })),
});

const MAX_BYTES = 100_000;

export const readTool = {
  name: "read",
  description: `Read a text file from disk. Returns line-numbered content for easy reference. For files over ${MAX_BYTES} bytes, output is truncated; use offset/limit to paginate.`,
  parameters: readSchema,
  async execute(_id: string, args: Static<typeof readSchema>) {
    const absPath = path.resolve(process.cwd(), args.path);

    let content: string;
    try {
      content = await fs.readFile(absPath, "utf-8");
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new Error(`File not found: ${args.path}`);
      }
      throw err;
    }

    let lines = content.split("\n");

    if (args.offset !== undefined) {
      lines = lines.slice(args.offset - 1);
    }
    if (args.limit !== undefined) {
      lines = lines.slice(0, args.limit);
    }

    let output = lines.map((line, i) => {
      const lineNum = (args.offset ?? 1) + i;
      return `${String(lineNum).padStart(5)}\t${line}`;
    }).join("\n");

    let truncated = false;
    if (output.length > MAX_BYTES) {
      output = output.slice(0, MAX_BYTES) + "\n[... output truncated ...]";
      truncated = true;
    }

    return {
      content: [{ type: "text" as const, text: output }],
      details: { path: args.path, truncated, lineCount: lines.length },
    };
  },
};
```

Things to notice:

- Path is resolved relative to `cwd`
- ENOENT becomes a friendly error (which the harness will turn into `is_error: true`)
- Lines get numbers (huge UX win for the LLM — it can reference line N in subsequent tool calls)
- Output is truncated to a max byte size with a marker
- `details` gives the UI structured info to render

This is a real, useful tool. ~30 lines. Not so bad.

## Stop and try this

In your `mini-pi/src/agent/`, create a file `tools.ts`:

```ts
import { Type, Static } from "typebox";
import { Value } from "typebox/value";

const greetingSchema = Type.Object({
  name: Type.String({ description: "Name to greet" }),
  enthusiasm: Type.Optional(Type.Number({
    description: "How many exclamation marks (0-10)",
    minimum: 0,
    maximum: 10,
  })),
});

const args = { name: "Ada", enthusiasm: 3 };

if (Value.Check(greetingSchema, args)) {
  const punctuation = "!".repeat(args.enthusiasm ?? 1);
  console.log(`Hello, ${args.name}${punctuation}`);
}

// Try with bad args
const badArgs = { name: "Ada", enthusiasm: 999 };
if (!Value.Check(greetingSchema, badArgs)) {
  console.log("Errors:", [...Value.Errors(greetingSchema, badArgs)]);
}
```

Run with `npx tsx src/agent/tools.ts`. You'll see:

```
Hello, Ada!!!
Errors: [{ ... must be <=10 ... }]
```

That's all you need. Type-safe, validated, JSON-Schema-emittable.

## Key takeaways

1. TypeBox = TypeScript types + runtime validation + JSON Schema, in one library.
2. `Static<typeof schema>` gives you the inferred TS type for free.
3. `Value.Check` validates; `Value.Errors` gives you structured errors.
4. TypeBox schemas are valid JSON Schema — send directly to LLM.
5. Stick to common constructs (Object, Array, Optional, Union of Literals) for cross-provider compatibility.

---

**Next:** [Lesson 3.3 — The Execute Contract](./03-the-execute-contract.md)
