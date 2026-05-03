/**
 * Example 3.2: Manual tool execution loop
 *
 * Demonstrates the full cycle:
 *  1. Send a user message + tool definition to Claude
 *  2. Receive a tool call
 *  3. Execute the tool
 *  4. Send the result back
 *  5. Receive the natural-language answer
 *
 * This is what the agent loop in Chapter 4 will automate.
 *
 * Run with:
 *   ANTHROPIC_API_KEY=sk-... npx tsx 02-execute-a-tool.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

// ─── Tool definition ──────────────────────────────────────────────────

const readSchema = Type.Object({
  path: Type.String({ description: "File path to read" }),
});

const readTool = {
  name: "read_file",
  description: "Read a file from the local filesystem",
  parameters: readSchema,
  async execute(_id: string, args: Static<typeof readSchema>) {
    const fs = await import("node:fs/promises");
    try {
      const content = await fs.readFile(args.path, "utf-8");
      return {
        content: [{ type: "text" as const, text: content.slice(0, 1000) }],
        details: { path: args.path, size: content.length },
      };
    } catch (err: any) {
      throw new Error(`Cannot read ${args.path}: ${err.message}`);
    }
  },
};

// ─── The cycle ────────────────────────────────────────────────────────

const client = new Anthropic();

const messages: any[] = [
  { role: "user", content: "Read the file package.json and tell me the project name." },
];

const tools = [
  {
    name: readTool.name,
    description: readTool.description,
    input_schema: readTool.parameters,
  },
];

// First call: should produce a tool_use
console.log("--- First call to Claude ---");
let response = await client.messages.create({
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 1024,
  tools,
  messages,
});
console.log("Stop reason:", response.stop_reason);

if (response.stop_reason === "tool_use") {
  // Push the assistant message
  messages.push({ role: "assistant", content: response.content });

  // Find tool_use blocks
  const toolUses = response.content.filter((c: any) => c.type === "tool_use");

  // Execute each
  const toolResults = [];
  for (const tu of toolUses as any[]) {
    console.log(`\n--- Executing ${tu.name}(${JSON.stringify(tu.input)}) ---`);

    if (!Value.Check(readTool.parameters, tu.input)) {
      const errors = [...Value.Errors(readTool.parameters, tu.input)];
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: `Validation error: ${errors[0].message}`,
        is_error: true,
      });
      continue;
    }

    try {
      const result = await readTool.execute(tu.id, tu.input as any);
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: result.content.map(c => c.type === "text" ? c.text : "").join("\n"),
        is_error: false,
      });
      console.log(`  -> returned ${result.details.size} bytes`);
    } catch (err: any) {
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: err.message,
        is_error: true,
      });
    }
  }

  // Push tool results as a user message
  messages.push({ role: "user", content: toolResults });

  // Second call: model uses the result
  console.log("\n--- Second call to Claude (with tool result) ---");
  response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    tools,
    messages,
  });

  console.log("Stop reason:", response.stop_reason);
  for (const block of response.content) {
    if (block.type === "text") {
      console.log("\nFINAL ANSWER:", block.text);
    }
  }
}
