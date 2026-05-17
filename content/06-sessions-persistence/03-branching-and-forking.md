# Branching and Forking

Sessions get long. Sometimes you want to go back to a previous point and try a different approach. This is what branching gives you.

## Two related but different operations

- **Branching** (in-place): the same session file contains multiple paths. You navigate the tree.
- **Forking**: you create a *new* session file from a point in an existing session. Cleaner separation.

Pi supports both. The distinction matters because:

- Branching keeps history together (good for related explorations)
- Forking gives a fresh start (good for major direction changes)

## How branching works with parent IDs

Recall the entry structure from Lesson 6.1:

```json
{"id":"a","parentId":null,"message":{"role":"user","content":"..."}}
{"id":"b","parentId":"a","message":{"role":"assistant","content":[...]}}
{"id":"c","parentId":"b","message":{"role":"user","content":"..."}}
```

Linear so far. Now suppose at point `b` you want to try a different next message. You go back to `b` and add a new child:

```json
{"id":"a","parentId":null,"message":{"role":"user","content":"..."}}
{"id":"b","parentId":"a","message":{"role":"assistant","content":[...]}}
{"id":"c","parentId":"b","message":{"role":"user","content":"..."}}     // original branch
{"id":"d","parentId":"b","message":{"role":"user","content":"..."}}     // new branch
```

`c` and `d` both have `b` as parent. The session is now a tree:

```
a → b ──→ c
      ╲
       ╲→ d
```

Each entry knows its parent. The "active branch" is whichever leaf you're currently following.

## The active branch

Most of the time you're working linearly. The agent appends new entries with `parentId` = the current leaf.

The "active path" is the chain from root to the current leaf, walked via parent IDs:

```ts
function getActivePath(entries: Entry[], leafId: string): Entry[] {
  const byId = new Map(entries.map(e => [e.id, e]));
  const path: Entry[] = [];
  let current: string | null = leafId;
  while (current) {
    const entry = byId.get(current);
    if (!entry) break;
    path.unshift(entry);
    current = entry.parentId;
  }
  return path;
}
```

That's the messages array fed to the agent. Other branches exist in the file but aren't sent to the LLM.

## Switching branches

To go back to point `b` and try `d` instead of `c`:

1. Set the "active leaf" to `b`
2. New messages have `parentId: "b"`
3. The agent sees only the path `a → b → newMsg`, not `c`

Clean. The file holds all the history; the agent only sees the current path.

UI presents this as a tree:

```
a "Refactor this function"
└── b (assistant: "I'll do X")
    ├── c "Use approach 1"
    │   └── ...
    ├── d "Use approach 2 instead"
    │   └── ...
    └── e "Actually nevermind, use 3"
        └── ...
```

The user can click into any branch to make it active.

## Implementing the "current leaf" pointer

You need to know which leaf is active. Two options:

1. **Implicit**: always the latest entry in the file. Doesn't support switching.
2. **Explicit**: store a pointer in the file (or alongside it).

Pi stores the active leaf ID in the file header:

```json
{"version":1,"id":"sess_x","activeLeaf":"d","cwd":"..."}
{"id":"a","parentId":null,"message":{...}}
{"id":"b","parentId":"a","message":{...}}
{"id":"c","parentId":"b","message":{...}}
{"id":"d","parentId":"b","message":{...}}
```

When you switch branches, you append a new header line with the updated `activeLeaf` (or rewrite the file with a new header). Pi rewrites — small cost for guaranteed consistency.

For mini-pi, simpler: track active leaf in memory only, default to "latest entry on disk." We won't support full branching in mini-pi to keep scope manageable.

## Forking

Forking copies a path from an existing session into a new file:

```ts
function fork(sourceFile: string, atEntryId: string): string {
  const sourceEntries = loadEntries(sourceFile);
  const path = getActivePath(sourceEntries, atEntryId);

  const newFile = createNewSessionFile();
  for (const entry of path) {
    appendEntry(newFile, entry);
  }
  return newFile;
}
```

The new session starts with a copy of everything up to `atEntryId`. From there it's a fresh, independent timeline.

Pi's `/fork` opens a picker showing previous user messages, lets you select one, and forks at that point. The selected message text gets pre-filled in the editor for editing.

## When to use which

- **Branch in place** when you want to compare two paths side-by-side. E.g., "let me try a completely different approach but keep the original for reference."
- **Fork** when you want a clean session for a different topic. E.g., "I'm going to take this conversation in a new direction; let's start fresh from this point."

In practice, forking is more common. Branching is a power-user feature.

## Skip-or-add for mini-pi

For mini-pi, consider:

- **MVP**: linear sessions only. No branching, no forking. Implement when you need them.
- **Slightly more**: forking only (just file-copying, no parent IDs needed if you don't care about branching).

Pi's branching is one of its differentiating features. Most other coding agents don't have it. It's worth building **if** your users do iterative exploration.

## A simple fork implementation

If you want to add fork to mini-pi:

```ts
// In SessionManager:

static fork(sourceFile: string, beforeMessageIndex: number): SessionManager {
  const sourceContent = fs.readFileSync(sourceFile, "utf-8");
  const lines = sourceContent.split("\n").filter(l => l.trim());
  const entriesToCopy = lines.slice(0, beforeMessageIndex);

  const newFile = createNewSessionFile(getCwdFromFile(sourceFile));
  fs.writeFileSync(newFile, entriesToCopy.join("\n") + "\n");

  return SessionManager.open(newFile);
}
```

Then in the CLI:

```bash
pi --fork session-abc-1700.jsonl
```

This forks at the end. To fork at a specific point, you need a UI (or a `--at <index>` flag). Pi has both.

## A common mistake: append vs rewrite

When you switch branches and add new messages, do NOT clear the file and rewrite. Append the new entries with proper parentIds.

Bad:

```ts
// User switched to branch d, added message x.
// Wrong: rewrite file with [a, b, d, x]
fs.writeFileSync(file, JSON.stringify([a, b, d, x]));
// Now you've lost c and any other branches!
```

Good:

```ts
// Append new entry, preserving everything else
appendEntry(file, { id: "x", parentId: "d", message: {...} });
// File now has [a, b, c, d, x]
```

The file is **append-only**. Once data is in, it stays. The "active branch" is just a view.

## Related operation: replay

If you have a session file, you can "replay" it — reconstruct the conversation as if it just happened. Useful for:

- Migrating to a new format
- Re-rendering for export
- Testing your UI against historical data

Just call `agent.state.messages = sm.getMessages()` and let the UI render.

If you want to replay with the LLM (re-run all the assistant calls), you can — but you'll get different answers each time and burn tokens. Usually not what you want.

## Stop and try this

Implement a basic `--fork` for mini-pi:

```ts
const args = process.argv.slice(2);
const forkArg = args.find(a => a.startsWith("--fork="));
let sm: SessionManager;

if (forkArg) {
  const sourceFile = forkArg.slice("--fork=".length);
  sm = SessionManager.fork(sourceFile, Infinity);  // fork at end
  console.log(`Forked from ${sourceFile} into ${sm.getSessionFile()}`);
} else {
  sm = SessionManager.create(process.cwd());
}
```

Run a session, then fork it:

```bash
npm start
> hello
> what time is it?

# Now in another terminal:
npm start -- --fork=/path/to/that-session.jsonl
> what was my first question?
# Should say "hello"
```

The fork inherits the conversation. It's a fresh session you can take in a different direction without polluting the original.

## Key takeaways

1. Branching = tree structure in one file via `parentId`. Forking = new file from a point in an old one.
2. Active branch = path from root to current leaf, traversed via parent pointers.
3. Files are append-only; never rewrite to "switch branches."
4. Pi supports both; for mini-pi, fork is the simpler addition.
5. Power users love branching; most users don't need it. Build it when there's demand.

---

**Next:** [Lesson 6.4 — Compaction](./04-compaction.md)
