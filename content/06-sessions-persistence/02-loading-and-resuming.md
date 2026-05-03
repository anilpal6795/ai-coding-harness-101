# Lesson 6.2: Loading and Resuming

You can write a session. Now: load it back, restore the agent, continue the conversation.

## The shape of a session manager

```ts
class SessionManager {
  static create(cwd: string): SessionManager;
  static open(filepath: string): SessionManager;
  static continueRecent(cwd: string): SessionManager;
  static list(cwd: string): SessionInfo[];

  getCwd(): string;
  getMessages(): AgentMessage[];
  appendMessage(message: AgentMessage): void;
  getSessionFile(): string;
}
```

Four constructors for different "give me a session" scenarios:

- **`create`** — start a new session
- **`open`** — load a specific file
- **`continueRecent`** — find the most recent session for this cwd, load it
- **`list`** — enumerate sessions for this cwd, for a picker UI

## A working implementation

`src/session/session-manager.ts`:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { AgentMessage } from "../agent/types.js";

export interface SessionInfo {
  id: string;
  filepath: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
}

interface Entry {
  id: string;
  parentId: string | null;
  message: AgentMessage;
}

export class SessionManager {
  private entries: Entry[] = [];
  private constructor(private filepath: string, private cwd: string) {}

  static create(cwd: string, sessionDir?: string): SessionManager {
    const dir = sessionDir ?? path.join(os.homedir(), ".mini-pi", "sessions", encodeCwd(cwd));
    fs.mkdirSync(dir, { recursive: true });
    const filename = newSessionFilename();
    return new SessionManager(path.join(dir, filename), cwd);
  }

  static open(filepath: string): SessionManager {
    const sm = new SessionManager(filepath, getCwdFromFile(filepath));
    sm.load();
    return sm;
  }

  static continueRecent(cwd: string, sessionDir?: string): SessionManager {
    const sessions = SessionManager.list(cwd, sessionDir);
    if (sessions.length === 0) {
      return SessionManager.create(cwd, sessionDir);
    }
    return SessionManager.open(sessions[0].filepath);
  }

  static list(cwd: string, sessionDir?: string): SessionInfo[] {
    const dir = sessionDir ?? path.join(os.homedir(), ".mini-pi", "sessions", encodeCwd(cwd));
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => statSession(path.join(dir, f)))
      .filter((s): s is SessionInfo => s !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private load(): void {
    if (!fs.existsSync(this.filepath)) return;
    const content = fs.readFileSync(this.filepath, "utf-8");
    const lines = content.split("\n").filter(l => l.trim());
    for (const line of lines) {
      try {
        this.entries.push(JSON.parse(line));
      } catch {
        // skip malformed
      }
    }
  }

  getCwd(): string {
    return this.cwd;
  }

  getMessages(): AgentMessage[] {
    return this.entries.map(e => e.message);
  }

  appendMessage(message: AgentMessage): void {
    const entry: Entry = {
      id: generateId(),
      parentId: this.entries.length > 0 ? this.entries[this.entries.length - 1].id : null,
      message,
    };
    this.entries.push(entry);
    fs.appendFileSync(this.filepath, JSON.stringify(entry) + "\n");
  }

  getSessionFile(): string {
    return this.filepath;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function newSessionFilename(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const id = Math.random().toString(36).slice(2, 8);
  return `${date}-${id}.jsonl`;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 12);
}

function encodeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "_");
}

function getCwdFromFile(filepath: string): string {
  // In a real impl, store this in a header or per-entry. For now, derive from path.
  const dir = path.dirname(filepath);
  return path.basename(dir).replace(/_/g, "/");
}

function statSession(filepath: string): SessionInfo | null {
  try {
    const stat = fs.statSync(filepath);
    const content = fs.readFileSync(filepath, "utf-8");
    const lines = content.split("\n").filter(l => l.trim());
    const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const id = path.basename(filepath, ".jsonl");
    const cwd = getCwdFromFile(filepath);
    const firstUserMsg = entries.find((e: any) => e.message?.role === "user");
    const preview = firstUserMsg
      ? typeof firstUserMsg.message.content === "string"
        ? firstUserMsg.message.content.slice(0, 80)
        : "(complex message)"
      : "(empty session)";
    return {
      id,
      filepath,
      cwd,
      createdAt: stat.birthtimeMs,
      updatedAt: stat.mtimeMs,
      messageCount: entries.length,
      preview,
    };
  } catch {
    return null;
  }
}
```

This is most of what `packages/coding-agent/src/core/session-manager.ts` does, simplified.

## Wiring it into the Agent

When you start, you build a SessionManager + an Agent and connect them:

```ts
const sm = SessionManager.create(process.cwd());

const agent = new Agent({
  model: claude,
  tools: [...],
});

// Restore previous messages (if any)
agent.state.messages = sm.getMessages();

// Persist new messages as they're added
agent.subscribe((event) => {
  if (event.type === "message_end") {
    sm.appendMessage(event.message);
  }
});
```

Now every message the agent processes (user, assistant, tool result) gets written to disk.

For `--continue`:

```ts
const sm = SessionManager.continueRecent(process.cwd());
const agent = new Agent({...});
agent.state.messages = sm.getMessages();
// continue as above
```

For `--resume`:

```ts
const sessions = SessionManager.list(process.cwd());
const choice = await pickFromList(sessions);  // UI for picking
const sm = SessionManager.open(choice.filepath);
const agent = new Agent({...});
agent.state.messages = sm.getMessages();
```

Same Agent, different sources for the messages array.

## What about the model and system prompt?

Storage choices:

- **Don't persist**: each session starts with the user's current model and a system prompt freshly built from current AGENTS.md / context. This means: changing your model doesn't change *past* sessions but *applies on resume*.
- **Persist**: each session remembers what model/prompt was used. Resume uses the original.
- **Hybrid**: persist for record-keeping; use current values when resuming.

Pi does hybrid: it persists the model in the session header (so you can see "this conversation used Claude") but uses your current default model when resuming, with a fallback message if the original is unavailable.

For mini-pi, simplest is: don't persist, always use current. Add metadata later if you want.

## Identifying messages vs entries

Subtle point: `Entry` (the file representation) wraps `AgentMessage` (the in-memory representation). They're not the same:

- `Entry` has `id` and `parentId` for graph structure
- `AgentMessage` has `role`, `content`, `timestamp`

Why separate?

- The agent core doesn't care about IDs — it works with messages as a flat array
- The session layer adds IDs for branching (Lesson 6.3)
- This way the agent can be run without persistence at all (in tests, RPC mode, etc.)

If you didn't need branching, you could make `id`/`parentId` part of the message and skip the separate Entry wrapper. Pi separates them.

## Race conditions: only one writer per file

If two Agent instances open the same session file and both write, you get interleaved bytes. Bad.

Two solutions:

1. **Single writer per file**: enforce in your app that one process owns each session at a time. Use a lock file (`session.jsonl.lock`).

2. **Append-only with per-line atomicity**: each line is a complete write. Worst case: out-of-order entries by timestamp.

Pi takes approach 1 (lock file with PID check). For mini-pi, approach 2 is fine if your CLI is single-instance per session.

## Performance considerations

Loading a session = read file + parse N JSON lines. For sessions up to ~10MB this is fast (< 100ms).

For VERY long sessions (hours of conversation, tens of thousands of messages), consider:

- **Lazy loading**: load metadata first (count, dates), load full messages on demand
- **Incremental load**: stream-parse rather than load-then-parse
- **Pruning**: drop old messages from the in-memory model but keep them on disk

Don't optimize until you have a real performance problem. Most coding agent sessions are < 1MB.

## Stop and try this

Add a `--continue` flag to your mini-pi:

```ts
const args = process.argv.slice(2);
const shouldContinue = args.includes("-c") || args.includes("--continue");

const sm = shouldContinue
  ? SessionManager.continueRecent(process.cwd())
  : SessionManager.create(process.cwd());

console.log(`Session: ${sm.getSessionFile()}`);
console.log(`Existing messages: ${sm.getMessages().length}`);

const agent = new Agent({...});
agent.state.messages = sm.getMessages();
agent.subscribe((event) => {
  if (event.type === "message_end") sm.appendMessage(event.message);
});

await agent.prompt("...");
```

Run twice. The second run with `--continue` should pick up where the first left off.

## Key takeaways

1. SessionManager has `create`, `open`, `continueRecent`, `list` constructors.
2. `appendMessage` writes one line; `load` parses line by line, tolerating corruption.
3. Wire into the Agent via a subscription on `message_end`.
4. Persist messages, optionally model/prompt; don't persist transient state or functions.
5. Single writer per file; if you need multi-process, use a lock file.

---

**Next:** [Lesson 6.3 — Branching and Forking](./03-branching-and-forking.md)
