/**
 * Example 2.3: Streaming with a normalized event protocol (mini transport)
 *
 * This is a self-contained implementation of the transport layer described in
 * Lesson 2.4. It collapses all of types.ts, event-stream.ts, anthropic.ts,
 * and stream.ts into ONE file you can run.
 *
 * Compare this to packages/ai/src/providers/anthropic.ts in pi-mono.
 *
 * Run with:
 *   ANTHROPIC_API_KEY=sk-... npx tsx 03-normalized-events.ts
 */

import Anthropic from "@anthropic-ai/sdk";

// ─── Types ───────────────────────────────────────────────────────────────

interface TextContent { type: "text"; text: string; }
interface ToolCall { type: "toolCall"; id: string; name: string; arguments: Record<string, any>; }

interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ToolCall)[];
  model: string;
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
  errorMessage?: string;
  timestamp: number;
}

type Event =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };

// ─── EventStream (queue with async iteration) ────────────────────────────

class EventStream implements AsyncIterable<Event> {
  private queue: Event[] = [];
  private waiters: Array<(r: IteratorResult<Event>) => void> = [];
  private done = false;

  push(event: Event) {
    if (this.waiters.length > 0) {
      this.waiters.shift()!({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
    if (event.type === "done" || event.type === "error") this.end();
  }
  end() {
    this.done = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()!({ value: undefined as any, done: true });
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<Event> {
    return {
      next: () => {
        if (this.queue.length > 0) return Promise.resolve({ value: this.queue.shift()!, done: false });
        if (this.done) return Promise.resolve({ value: undefined as any, done: true });
        return new Promise(r => this.waiters.push(r));
      },
    };
  }
}

// ─── The Anthropic provider implementation ───────────────────────────────

function stream(modelId: string, prompt: string): EventStream {
  const out = new EventStream();
  void run().catch(err => out.push({
    type: "error",
    reason: "error",
    error: { role: "assistant", content: [], model: modelId, stopReason: "error", errorMessage: String(err), timestamp: Date.now() },
  }));
  return out;

  async function run() {
    const client = new Anthropic();
    const partial: AssistantMessage = {
      role: "assistant",
      content: [],
      model: modelId,
      stopReason: "stop",
      timestamp: Date.now(),
    };

    out.push({ type: "start", partial: { ...partial } });
    const toolBuffers = new Map<number, string>();

    const sdk = client.messages.stream({
      model: modelId,
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });

    for await (const event of sdk) {
      switch (event.type) {
        case "content_block_start": {
          const idx = event.index;
          if (event.content_block.type === "text") {
            partial.content[idx] = { type: "text", text: "" };
            out.push({ type: "text_start", contentIndex: idx, partial: { ...partial } });
          } else if (event.content_block.type === "tool_use") {
            partial.content[idx] = { type: "toolCall", id: event.content_block.id, name: event.content_block.name, arguments: {} };
            toolBuffers.set(idx, "");
            out.push({ type: "toolcall_start", contentIndex: idx, partial: { ...partial } });
          }
          break;
        }
        case "content_block_delta": {
          const idx = event.index;
          if (event.delta.type === "text_delta") {
            (partial.content[idx] as TextContent).text += event.delta.text;
            out.push({ type: "text_delta", contentIndex: idx, delta: event.delta.text, partial: { ...partial } });
          } else if (event.delta.type === "input_json_delta") {
            const buf = (toolBuffers.get(idx) ?? "") + event.delta.partial_json;
            toolBuffers.set(idx, buf);
            out.push({ type: "toolcall_delta", contentIndex: idx, delta: event.delta.partial_json, partial: { ...partial } });
          }
          break;
        }
        case "content_block_stop": {
          const idx = event.index;
          const block = partial.content[idx];
          if (block.type === "text") {
            out.push({ type: "text_end", contentIndex: idx, content: block.text, partial: { ...partial } });
          } else if (block.type === "toolCall") {
            try { block.arguments = JSON.parse(toolBuffers.get(idx) ?? "{}"); } catch {}
            out.push({ type: "toolcall_end", contentIndex: idx, toolCall: block, partial: { ...partial } });
          }
          break;
        }
        case "message_delta":
          if (event.delta.stop_reason) {
            partial.stopReason =
              event.delta.stop_reason === "end_turn" ? "stop" :
              event.delta.stop_reason === "tool_use" ? "toolUse" :
              event.delta.stop_reason === "max_tokens" ? "length" : "stop";
          }
          break;
        case "message_stop":
          out.push({ type: "done", reason: partial.stopReason as any, message: { ...partial } });
          return;
      }
    }
  }
}

// ─── Demo ────────────────────────────────────────────────────────────────

const s = stream("claude-sonnet-4-5-20250929", "Count to 5 slowly, with pauses for drama.");

console.log("\n--- Normalized event stream ---\n");
for await (const event of s) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  } else if (event.type === "done") {
    console.log(`\n\n[Done. Stop reason: ${event.reason}]`);
  } else if (event.type === "error") {
    console.error(`\n[Error: ${event.error.errorMessage}]`);
  }
}
