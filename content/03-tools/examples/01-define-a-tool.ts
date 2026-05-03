/**
 * Example 3.1: Defining a tool with TypeBox
 *
 * Shows the canonical shape of a tool: TypeBox schema for params,
 * Static<> for typed args, and an execute function. Then exercises
 * validation manually.
 *
 * Run with:
 *   npx tsx 01-define-a-tool.ts
 */

import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

// ─── 1. Define the schema ─────────────────────────────────────────────

const greetingSchema = Type.Object({
  name: Type.String({ description: "Name of person to greet", minLength: 1 }),
  enthusiasm: Type.Optional(
    Type.Number({
      description: "Number of exclamation marks (0-10)",
      minimum: 0,
      maximum: 10,
    })
  ),
});

// ─── 2. Get the typed args ────────────────────────────────────────────

type GreetingArgs = Static<typeof greetingSchema>;
// type GreetingArgs = { name: string; enthusiasm?: number }

// ─── 3. Define the tool ───────────────────────────────────────────────

const greetingTool = {
  name: "greet",
  description: "Generate a friendly greeting for someone",
  parameters: greetingSchema,
  async execute(_id: string, args: GreetingArgs) {
    const punctuation = "!".repeat(args.enthusiasm ?? 1);
    const greeting = `Hello, ${args.name}${punctuation}`;
    return {
      content: [{ type: "text" as const, text: greeting }],
      details: { name: args.name, enthusiasm: args.enthusiasm ?? 1 },
    };
  },
};

// ─── 4. Try valid arguments ───────────────────────────────────────────

const validArgs = { name: "Ada", enthusiasm: 3 };

if (Value.Check(greetingTool.parameters, validArgs)) {
  const result = await greetingTool.execute("test-1", validArgs);
  console.log("✓ Valid call");
  console.log("  content:", result.content[0]);
  console.log("  details:", result.details);
}

// ─── 5. Try invalid arguments ─────────────────────────────────────────

const invalidArgs = { name: "Ada", enthusiasm: 999 };

if (!Value.Check(greetingTool.parameters, invalidArgs)) {
  const errors = [...Value.Errors(greetingTool.parameters, invalidArgs)];
  console.log("\n✗ Invalid call");
  for (const err of errors.slice(0, 3)) {
    console.log(`  ${err.path}: ${err.message}`);
  }
}

// ─── 6. Show what gets sent to the LLM ────────────────────────────────

console.log("\n--- LLM-facing JSON ---");
console.log(JSON.stringify({
  name: greetingTool.name,
  description: greetingTool.description,
  input_schema: greetingTool.parameters,
}, null, 2));
