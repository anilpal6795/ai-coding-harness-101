/**
 * Example 4.2: Agent loop with event emission
 *
 * Same agent loop as 01-minimal-loop, but refactored to emit events
 * that multiple subscribers can observe. Demonstrates the pattern
 * we'll use throughout the rest of the course.
 *
 * Run with:
 *   ANTHROPIC_API_KEY=sk-... npx tsx 02-loop-with-events.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "node:fs/promises";

// ─── Types (truncated for brevity — same as 01-minimal-loop.ts) ───────

interface ToolCall { type: "toolCall"; id: string; name: string; arguments: any; }
interface TextBlock { type: "text"; text: string; }
type Message =
  | { role: "user"; content: string | any[]; }
  | { role: "assistant"; content: (TextBlock | ToolCall)[]; }
  | { role: "toolResult"; toolCallId: string; toolName: string; content: any[]; isError: boolean; };

interface Tool {
  name: string;
  description: string;
  input_schema: any;
  execute: (args: any) => Promise<{ content: any[] }>;
}

type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "turn_start"; turnNumber: number }
  | { type: "turn_end"; turnNumber: number }
  | { type: "message_added"; message: Message }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_end"; toolCallId: string; isError: boolean };

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

const tools = [readTool];

// ─── Subscription mechanism ───────────────────────────────────────────

class EventBus {
  private listeners = new Set<(e: AgentEvent) => void>();

  subscribe(listener: (e: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: AgentEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

// ─── The agent loop with event emission ───────────────────────────────

async function agentLoop(prompt: string, bus: EventBus) {
  const client = new Anthropic();
  const messages: Message[] = [{ role: "user", content: prompt }];
  bus.emit({ type: "agent_start" });
  bus.emit({ type: "message_added", message: messages[0] });

  let turn = 1;
  while (true) {
    bus.emit({ type: "turn_start", turnNumber: turn });

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
      tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
      messages: apiMessages as any,
    });

    const assistant: Message = {
      role: "assistant",
      content: response.content.map((c: any) => c.type === "tool_use"
        ? { type: "toolCall", id: c.id, name: c.name, arguments: c.input }
        : { type: "text", text: c.text }),
    };
    messages.push(assistant);
    bus.emit({ type: "message_added", message: assistant });

    const toolCalls = assistant.content.filter((c): c is ToolCall => c.type === "toolCall");
    if (toolCalls.length === 0) {
      bus.emit({ type: "turn_end", turnNumber: turn });
      bus.emit({ type: "agent_end" });
      return messages;
    }

    for (const call of toolCalls) {
      bus.emit({ type: "tool_start", toolCallId: call.id, toolName: call.name, args: call.arguments });
      const tool = tools.find(t => t.name === call.name)!;
      let isError = false;
      let content: any[] = [];
      try {
        const result = await tool.execute(call.arguments);
        content = result.content;
      } catch (err: any) {
        isError = true;
        content = [{ type: "text", text: err.message }];
      }
      const resultMsg: Message = { role: "toolResult", toolCallId: call.id, toolName: call.name, content, isError };
      messages.push(resultMsg);
      bus.emit({ type: "tool_end", toolCallId: call.id, isError });
      bus.emit({ type: "message_added", message: resultMsg });
    }

    bus.emit({ type: "turn_end", turnNumber: turn });
    turn++;
  }
}

// ─── Run with multiple observers ──────────────────────────────────────

const bus = new EventBus();

// Subscriber 1: print events for visibility
bus.subscribe((e) => console.log(`  📡 ${e.type}${"turnNumber" in e ? ` ${e.turnNumber}` : ""}`));

// Subscriber 2: count tool calls
let toolCount = 0;
bus.subscribe((e) => { if (e.type === "tool_start") toolCount++; });

// Subscriber 3: write each message to a log file (simulated)
const messageLog: Message[] = [];
bus.subscribe((e) => { if (e.type === "message_added") messageLog.push(e.message); });

await agentLoop(
  "Read the package.json file and tell me the project name.",
  bus,
);

console.log(`\n📊 Stats:`);
console.log(`   Tool calls: ${toolCount}`);
console.log(`   Messages logged: ${messageLog.length}`);
