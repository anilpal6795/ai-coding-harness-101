/**
 * Example 4.1: Minimal agent loop in one file
 *
 * Self-contained demonstration of the agent loop. Combines a simplified
 * LLM transport, the loop itself, and a tool. Runs an end-to-end agent.
 *
 * Run with:
 *   ANTHROPIC_API_KEY=sk-... npx tsx 01-minimal-loop.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "node:fs/promises";

// ─── Types ────────────────────────────────────────────────────────────

interface ToolCall { type: "toolCall"; id: string; name: string; arguments: Record<string, any>; }
interface TextBlock { type: "text"; text: string; }
interface AssistantMessage {
  role: "assistant";
  content: (TextBlock | ToolCall)[];
  stopReason: "stop" | "toolUse" | "error";
}
interface UserMessage { role: "user"; content: string | any[]; }
interface ToolResultMessage { role: "toolResult"; toolCallId: string; toolName: string; content: any[]; isError: boolean; }
type Message = UserMessage | AssistantMessage | ToolResultMessage;

interface Tool {
  name: string;
  description: string;
  input_schema: any;
  execute: (args: any) => Promise<{ content: any[] }>;
}

// ─── Tools ────────────────────────────────────────────────────────────

const readTool: Tool = {
  name: "read",
  description: "Read a file from disk",
  input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  async execute(args: { path: string }) {
    const content = await fs.readFile(args.path, "utf-8");
    return { content: [{ type: "text", text: content.slice(0, 2000) }] };
  },
};

const lsTool: Tool = {
  name: "ls",
  description: "List files in a directory",
  input_schema: { type: "object", properties: { dir: { type: "string" } }, required: ["dir"] },
  async execute(args: { dir: string }) {
    const entries = await fs.readdir(args.dir);
    return { content: [{ type: "text", text: entries.join("\n") }] };
  },
};

const tools = [readTool, lsTool];

// ─── The Agent Loop ────────────────────────────────────────────────────

async function callClaude(systemPrompt: string, messages: Message[]) {
  const client = new Anthropic();
  const apiMessages = messages.map(m => {
    if (m.role === "toolResult") {
      return {
        role: "user" as const,
        content: [{ type: "tool_result" as const, tool_use_id: m.toolCallId, content: m.content.map((c: any) => c.text).join("\n"), is_error: m.isError }],
      };
    }
    return m;
  });

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2048,
    system: systemPrompt,
    tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
    messages: apiMessages as any,
  });

  return {
    role: "assistant" as const,
    content: response.content.map((c: any) => {
      if (c.type === "tool_use") return { type: "toolCall" as const, id: c.id, name: c.name, arguments: c.input };
      return { type: "text" as const, text: c.text };
    }),
    stopReason: response.stop_reason === "tool_use" ? "toolUse" as const : "stop" as const,
  };
}

async function agentLoop(prompt: string) {
  const messages: Message[] = [{ role: "user", content: prompt }];
  const systemPrompt = "You are a coding assistant. Use the available tools to inspect the filesystem when needed.";

  let turn = 1;
  while (true) {
    console.log(`\n──── Turn ${turn} ────`);
    const assistant = await callClaude(systemPrompt, messages);
    messages.push(assistant);

    for (const block of assistant.content) {
      if (block.type === "text") {
        console.log(`\n[ASSISTANT]\n${block.text}`);
      } else {
        console.log(`\n[TOOL CALL] ${block.name}(${JSON.stringify(block.arguments)})`);
      }
    }

    const toolCalls = assistant.content.filter((c): c is ToolCall => c.type === "toolCall");
    if (toolCalls.length === 0) {
      console.log(`\n──── DONE ────`);
      return messages;
    }

    for (const call of toolCalls) {
      const tool = tools.find(t => t.name === call.name);
      if (!tool) {
        messages.push({ role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: "Tool not found" }], isError: true });
        continue;
      }
      try {
        const result = await tool.execute(call.arguments);
        const preview = (result.content[0] as any).text.slice(0, 100);
        console.log(`[TOOL RESULT] ${preview}${preview.length === 100 ? "..." : ""}`);
        messages.push({ role: "toolResult", toolCallId: call.id, toolName: call.name, content: result.content, isError: false });
      } catch (err: any) {
        console.log(`[TOOL ERROR] ${err.message}`);
        messages.push({ role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: err.message }], isError: true });
      }
    }

    turn++;
  }
}

// ─── Run it ────────────────────────────────────────────────────────────

await agentLoop("List the files in the current directory, then read the package.json file and tell me what scripts are defined.");
