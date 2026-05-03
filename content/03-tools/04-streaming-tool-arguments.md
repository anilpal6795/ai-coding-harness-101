# Lesson 3.4: Streaming Tool Arguments

This lesson covers a small but consequential UX detail: how to show the user what the model is *about to do* before it's finished asking.

## The phenomenon

When the LLM emits a tool call, it streams the arguments as JSON fragments:

```
toolcall_start    { name: "read_file", arguments: {} }
toolcall_delta    { delta: '{"pa' }
toolcall_delta    { delta: 'th": "package' }
toolcall_delta    { delta: '.json"}' }
toolcall_end      { toolCall: { name: "read_file", arguments: { path: "package.json" } } }
```

By the time `toolcall_end` fires, you have complete arguments. But during the stream, you have a string of JSON fragments.

A naive UI waits for `toolcall_end` and then shows "Calling read_file with path=package.json". That works.

A better UI shows "Calling read_file..." then "...with path: package.json" as the args come in.

This isn't just polish. For long arguments (a file write with hundreds of lines), the user needs to see what's happening before the call completes.

## The technique: incremental JSON parsing

You take the partial JSON buffer and try to parse it as a complete JSON value. If it parses, you have a partial object.

The catch: `'{"pa'` is not valid JSON. `JSON.parse` throws.

You have a few options:

### Option A: try-catch and ignore

```ts
let buffer = "";
for await (const event of stream) {
  if (event.type === "toolcall_delta") {
    buffer += event.delta;
    try {
      const partial = JSON.parse(buffer);
      // Use partial
    } catch {
      // Not parseable yet, keep accumulating
    }
  }
}
```

This works only when the *entire* buffer is parseable. So you get updates only at boundaries: `{"path": "x"}` parses, but `{"path": "x", "co` doesn't.

That gives you choppy updates. Better than nothing, but not great.

### Option B: a forgiving partial JSON parser

You can write or use a parser that tolerates incomplete JSON by closing open structures. Pseudocode:

```
"{\"path\":\"package"  →  pad out to → "{\"path\":\"package\"}" → { path: "package" }
"{\"path\":\"x\",\"co"  →  pad out to → "{\"path\":\"x\",\"co\":null}" → { path: "x", co: null }
```

You append closing characters until it's parseable. This is what pi-ai does (`parseStreamingJson` utility, used by the proxy module).

The payoff: the LLM can stream a 1000-character argument and you get a usable object after every few tokens.

### Option C: per-key parsing

You scan the buffer with a state machine that knows when each top-level key is complete. As soon as you've seen `"path":"package.json"`, you can extract that value, even if other keys aren't done yet.

This is the most robust but most code. Use Option B for our purposes.

## A simple partial parser

Here's a basic version. It handles strings, objects, and arrays, but not the full JSON spec:

```ts
export function tryParsePartialJson(buffer: string): any | null {
  if (buffer.trim() === "") return null;

  // Try as-is first
  try { return JSON.parse(buffer); } catch {}

  // Count open structures and add closers
  let result = buffer;
  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (let i = 0; i < result.length; i++) {
    const c = result[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (inString) {
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{") stack.push("}");
    if (c === "[") stack.push("]");
    if (c === "}" || c === "]") stack.pop();
  }

  // Close open string
  if (inString) result += '"';

  // Close open structures (LIFO)
  while (stack.length > 0) {
    result += stack.pop();
  }

  try { return JSON.parse(result); } catch { return null; }
}
```

Test it:

```ts
console.log(tryParsePartialJson('{"path":"pack'));
// { path: "pack" }
console.log(tryParsePartialJson('{"path":"x","off'));
// { path: "x" }   (off becomes a partial key, dropped)
console.log(tryParsePartialJson('{"items":[1,2'));
// { items: [1, 2] }
```

Good enough for live UI updates.

## Where to plug it in

In your provider implementation (Lesson 2.4), in the toolcall delta handler:

```ts
case "content_block_delta": {
  if (delta.type === "input_json_delta") {
    const buffer = (toolBuffers.get(idx) ?? "") + delta.partial_json;
    toolBuffers.set(idx, buffer);

    // Try a best-effort parse
    const block = partial.content[idx] as ToolCall;
    const parsed = tryParsePartialJson(buffer);
    if (parsed !== null) {
      block.arguments = parsed;
    }

    out.push({
      type: "toolcall_delta",
      contentIndex: idx,
      delta: delta.partial_json,
      partial: { ...partial },  // arguments are progressively populated
    });
  }
}
```

Now consumers receive `partial.content[idx].arguments` updated incrementally.

## How the UI uses this

In `interactive-mode.ts`, the tool execution component listens for `toolcall_delta`:

```ts
// pseudocode
case "toolcall_delta":
  const block = event.partial.content[event.contentIndex];
  if (block.arguments.path) {
    toolComponent.updateLabel(`read ${block.arguments.path}`);
  } else {
    toolComponent.updateLabel("read ...");
  }
  tui.requestRender();
```

The user sees:

```
⚙ read ...
⚙ read pa
⚙ read package.json
```

…changing in milliseconds. It feels alive.

## When you don't need this

For most tools, this is over-engineering. Even a 1-second delay between "calling tool" and "calling tool with X args" is fine for short arguments.

When it matters most:

- **`bash`** — you want to see the command being constructed
- **`write`/`edit`** — you want to see the path before the content streams (which can be huge)
- **`grep`** with complex patterns — same logic

For `read`, `ls`, `find` with simple args, the wait is imperceptible.

## A subtler issue: argument validation timing

You **don't validate** the partial arguments. They're still incomplete; required fields may be missing. Validation happens once at `toolcall_end`.

Code:

```ts
// In agent loop:

// During streaming: just show partial
case "toolcall_delta":
  // No validation here — just UI
  break;

// On end: validate, then execute
case "toolcall_end":
  const validated = Value.Check(tool.parameters, event.toolCall.arguments);
  if (!validated) { ... }
  await tool.execute(...);
  break;
```

The partial is for display. The final is for execution.

## Provider quirks

- **Anthropic** streams tool args as JSON fragments via `input_json_delta` events. ✅
- **OpenAI** streams them as `tool_call_delta` events. Similar shape.
- **Google Gemini** does NOT stream tool arguments. You get them all at once at the end. So your `toolcall_delta` event for Google providers fires once with the complete args.

When pi-ai's docs say "Google does not support function call streaming," this is what they mean. Your UI handles both: build the UI to show partial args when available, accept that for some providers it'll be all-or-nothing.

## Stop and try this

Modify your `mini-pi/src/llm/anthropic.ts` from Chapter 2 to use `tryParsePartialJson` instead of plain `JSON.parse`. Then run:

```ts
const s = stream(claude, {
  systemPrompt: "Use the read tool to fetch package.json",
  messages: [{ role: "user", content: "Read package.json", timestamp: Date.now() }],
  tools: [{
    name: "read",
    description: "Read a file",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  }],
});

for await (const event of s) {
  if (event.type === "toolcall_delta") {
    const block = event.partial.content[event.contentIndex];
    console.log("Partial args:", JSON.stringify(block.arguments));
  }
}
```

You should see output like:

```
Partial args: {}
Partial args: {"path":"pa"}
Partial args: {"path":"package."}
Partial args: {"path":"package.json"}
```

That's the live build-up of the arguments. Use it in the UI by updating tool labels in real time.

## Key takeaways

1. Tool call arguments stream as JSON fragments; you need a partial parser to expose them live.
2. Best-effort partial parsing: try `JSON.parse`, if it fails, close open strings/braces/brackets and retry.
3. Show partial args in the UI for better perceived responsiveness; never validate or execute on partials.
4. Some providers (Google) don't stream tool args at all — design UI to handle both.

---

**Next:** [Chapter 4 — The Agent Loop](../04-agent-loop/)
