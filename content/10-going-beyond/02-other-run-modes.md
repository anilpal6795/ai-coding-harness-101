# Lesson 10.2: Other Run Modes

The interactive TUI is one way to use your agent. There are at least three others worth supporting.

## Print mode

Run a single prompt, print the answer, exit.

```bash
mini-pi -p "Read package.json and tell me the version"
```

Use cases:

- Scripts / CI pipelines
- One-off questions
- Piping to other tools: `cat src/x.ts | mini-pi -p "Find bugs in this code"`

## How print mode is built

It's the same Agent, different I/O:

```ts
// src/app/print-mode.ts

import { Agent } from "../agent/agent.js";

export async function runPrintMode(prompt: string, agent: Agent) {
  agent.subscribe(event => {
    if (event.type === "message_update" && event.message.role === "assistant") {
      // Print streaming text
      const text = extractText(event.message);
      process.stdout.write("\r" + text);
    }
    if (event.type === "tool_start") {
      process.stderr.write(`\n[tool: ${event.toolName}]\n`);
    }
    if (event.type === "tool_end") {
      process.stderr.write(`\n[done]\n`);
    }
  });

  await agent.prompt(prompt);

  console.log();   // newline at end
  process.exit(0);
}
```

The Agent doesn't know about TUIs. We're just subscribing differently — text to stdout, tool indicators to stderr (so they don't get piped).

## JSON mode

Same as print mode, but output structured JSON for programmatic consumption:

```bash
mini-pi --json "What's 2+2?"
```

Output: one JSON object per line (each is an event), terminating in a final result:

```jsonl
{"type":"agent_start"}
{"type":"turn_start"}
{"type":"message_start","message":{...}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"4"}]}}
{"type":"agent_end","messages":[...]}
```

Useful for:

- Other tools consuming agent output
- Generating reports / structured logs
- Testing

Implementation: subscribe to events, JSON.stringify each, write to stdout. Easy.

## RPC mode

For embedding the agent in other processes (like an IDE extension), expose it via JSON-RPC over stdin/stdout.

```bash
mini-pi --rpc
```

Now the IDE can:

```jsonl
{"jsonrpc":"2.0","method":"prompt","params":{"text":"hi"},"id":1}
```

And receive:

```jsonl
{"jsonrpc":"2.0","method":"event","params":{"type":"message_update","message":...}}
{"jsonrpc":"2.0","method":"event","params":{"type":"agent_end"}}
{"jsonrpc":"2.0","result":null,"id":1}
```

Why use RPC instead of just calling the SDK?

- IDE extensions are often in other languages (TypeScript via VS Code, Java/Kotlin via JetBrains)
- Process isolation: the agent crashing doesn't crash the IDE
- The IDE can spawn one agent per project

Pi has RPC mode (see `packages/coding-agent/src/modes/rpc/`). It uses strict LF-delimited JSONL framing — each request and response is one line.

## SDK consumption

You can also use the agent as a library in another Node program:

```ts
import { Agent } from "@yourorg/your-agent";

const agent = new Agent({
  model: yourModel,
  tools: [yourTools],
  systemPrompt: "...",
});

agent.subscribe(event => { /* ... */ });
await agent.prompt("Hello");
```

This is the pattern for building higher-level products on top:

- A web app that exposes the agent via API
- A Slack bot (this is what pi-mom does)
- A test harness for prompt iteration
- A batch processor for many prompts

For SDK consumption, you don't need any of the I/O modes — just import and use.

## How modes compose

The Agent at the center stays the same. Around it:

```
                  ┌────────────┐
                  │   Agent    │
                  └─────┬──────┘
                        │
        ┌───────────────┼─────────────────┐
        │               │                 │
        ▼               ▼                 ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Interactive  │ │  Print       │ │  RPC         │
│ TUI mode     │ │  mode        │ │  mode        │
└──────────────┘ └──────────────┘ └──────────────┘

       (Plus) SDK: just import { Agent } and use directly
```

Each mode is ~100-200 lines. The agent is the same.

This is the value of the boundaries from Chapter 0 Lesson 2: **the agent works in any I/O context.** Build new modes as you need them.

## CLI flag dispatching

Your `main.ts` checks the flags and dispatches:

```ts
async function main(args: string[]) {
  const parsed = parseArgs(args);

  const agent = createAgent(parsed);

  if (parsed.rpc) {
    await runRpcMode(agent);
  } else if (parsed.json) {
    await runJsonMode(parsed.prompt, agent);
  } else if (parsed.print) {
    await runPrintMode(parsed.prompt, agent);
  } else {
    await runInteractiveMode(agent);
  }
}
```

The agent is built once. The mode wraps it.

## Stop and try this

Add print mode to your mini-pi:

```ts
const args = process.argv.slice(2);
const printIdx = args.indexOf("-p");
if (printIdx !== -1) {
  const prompt = args[printIdx + 1];
  await runPrintMode(prompt, agent);
  process.exit(0);
}
```

Then:

```bash
npm start -- -p "What is 2+2?"
```

You should get back just the answer, no UI. Now you can pipe:

```bash
echo "What is 2+2?" | xargs npm start -p
```

Real CLI integration. Same agent, different shell.

## Key takeaways

1. The Agent is mode-agnostic. Wrap it differently for different I/O.
2. Print mode: subscribe, write to stdout, exit on `agent_end`.
3. JSON mode: same but JSON-serialize each event.
4. RPC mode: line-delimited JSON-RPC for embedding in other processes (IDEs).
5. SDK: just import the Agent class — no mode needed.

---

**Next:** [Lesson 10.3 — Where to Go Next](./03-where-to-go-next.md)
