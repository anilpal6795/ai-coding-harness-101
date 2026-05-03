# Lesson 6.1: The JSONL Session Format

How do you save a conversation to disk in a way that's:

- Easy to append to (each new message is one operation)
- Easy to inspect manually (human-readable)
- Resilient to crashes (a partial write doesn't corrupt the whole file)
- Efficient to load (don't parse the whole file every operation)

The answer: JSONL.

## What JSONL is

JSONL = "JSON Lines." Each line is one JSON object. The file as a whole is not valid JSON, but each line is.

Example:

```
{"id":"a","role":"user","content":"hello","timestamp":1700000000000}
{"id":"b","role":"assistant","content":[{"type":"text","text":"hi"}],"timestamp":1700000000100}
{"id":"c","role":"user","content":"what's 2+2?","timestamp":1700000000200}
```

To load: read the file line by line, JSON.parse each.
To append: open in append mode, write `JSON.stringify(msg) + "\n"`.

That's it. No "JSON.parse the whole file, push, write back" — which is what people do with `.json` files and which corrupts on crash.

## Why not JSON?

If you store messages as `[{...}, {...}, ...]` in a JSON file, every append:

1. Reads the entire file
2. Parses it
3. Pushes the new message
4. Stringifies
5. Writes back

Problems:

- O(n) per append
- A crash mid-write corrupts the file (partial JSON is invalid)
- Two writers conflict trivially
- Hard to tail/follow with `tail -f`

JSONL fixes all of these:

- O(1) append (just write a line)
- Crash mid-write loses at most one message; everything before is intact
- Concurrent appends are safe at the OS level (atomic line writes)
- `tail -f session.jsonl` works
- Easy diff / git-friendly

## What goes in each entry

Three approaches:

### A. Just the message

```json
{"role":"user","content":"hi","timestamp":1700000000000}
```

Simple. Works for linear conversations. **Doesn't support branching.**

### B. Message + ID + parentId (pi's approach)

```json
{"id":"abc","parentId":null,"message":{"role":"user","content":"hi","timestamp":...}}
{"id":"def","parentId":"abc","message":{"role":"assistant","content":[...],"timestamp":...}}
```

Each entry has an ID and a parent ID. Linear so far, but supports branching:

```json
{"id":"abc","parentId":null,"message":{"role":"user","content":"hi"}}
{"id":"def","parentId":"abc","message":{"role":"assistant","content":[{"text":"reply 1"}]}}
{"id":"xyz","parentId":"abc","message":{"role":"assistant","content":[{"text":"reply 2"}]}}  // alternative reply, same parent
```

Now your file is a tree, not a list. The "active branch" is whichever leaf you're following.

We'll cover branching in Lesson 6.3.

### C. Headers + entries

Pi prefixes the file with a header line containing session metadata:

```json
{"version":1,"id":"sess_abc","cwd":"/projects/x","createdAt":...}
{"id":"e1","parentId":null,"message":{...}}
{"id":"e2","parentId":"e1","message":{...}}
```

The first line is metadata; the rest are entries. Adds slight complexity to loading (read first line as header), gains schema versioning and metadata in one place.

For mini-pi we'll do option B (no header). Adding headers later is a small migration.

## Where files live

Conventional layout:

```
~/.pi/agent/sessions/
├── /projects/x/
│   ├── 2024-01-15-1700-abc.jsonl
│   ├── 2024-01-15-1830-def.jsonl
│   └── ...
├── /projects/y/
│   ├── 2024-01-16-0900-ghi.jsonl
│   └── ...
```

Top-level dir per project (using cwd as the key, with paths sanitized). Inside, one file per session.

For mini-pi we can use a flat structure:

```
~/.mini-pi/sessions/
├── 2024-01-15-1700-abc.jsonl
├── 2024-01-15-1830-def.jsonl
```

Or per-cwd if you want to be fancy.

## File naming

Common pattern: `<date>-<time>-<short-id>.jsonl`. The date prefix sorts naturally; the suffix avoids collisions for sessions started at the same minute.

```ts
function newSessionFilename(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const id = Math.random().toString(36).slice(2, 8);
  return `${date}-${id}.jsonl`;
}
```

You can also use UUIDs. Pi uses a short ID + timestamp.

## Atomicity considerations

Appending one line is atomic on POSIX filesystems for writes < PIPE_BUF (typically 4096 bytes). If your messages are bigger than that — and they will be for assistant messages with content — the write might be split across system calls.

Two safe approaches:

1. **Write to a temp file, then rename** (atomic):
   ```ts
   const tmp = `${file}.tmp`;
   await fs.writeFile(tmp, fullContent);
   await fs.rename(tmp, file);
   ```
   But this rewrites the whole file. Slow for large sessions.

2. **Use file locking** (advisory):
   ```ts
   const lock = await acquireLock(file);
   try {
     await fs.appendFile(file, line + "\n");
   } finally {
     await lock.release();
   }
   ```

3. **Just append and accept the rare corruption** (pragmatic):
   - Single-process access (one Agent instance per session)
   - Truncated last line on crash → drop it on load (validate JSON per line)

Pi uses approach 3. If a line fails to parse on load, log it and skip. The rest of the session is intact.

## Reading back

```ts
async function loadSession(filepath: string): Promise<Entry[]> {
  const content = await fs.readFile(filepath, "utf-8");
  const lines = content.split("\n").filter(l => l.trim());
  const entries: Entry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch (err) {
      console.warn("Skipping malformed line:", line.slice(0, 80));
    }
  }
  return entries;
}
```

Robust to corruption. Robust to truncation. Easy to reason about.

For very large sessions, you can stream-parse with a Readable + line splitter, but JSONL files rarely exceed a few MB so direct read is fine.

## What gets persisted vs not

Per Lesson 5.1, your Agent has both persistent state and transient state.

**Persisted**:
- Messages (the transcript)
- Custom message types (UI-only too — they're part of the transcript)
- Session metadata (model used, working dir, started at)

**Not persisted**:
- Tool registrations (functions don't serialize)
- Active stream / pending tool calls (transient runtime state)
- Subscribers (set up fresh on resume)
- API keys (security; live in env or auth.json)

When you resume:

1. Load the session entries
2. Reconstruct messages array
3. Create a new Agent with the saved messages, current model, current tools
4. Subscribers re-attach
5. Continue

It looks like the conversation never paused.

## Stop and try this

Build a minimal session writer:

```ts
import * as fs from "node:fs";
import * as path from "node:path";

class SessionWriter {
  constructor(private filepath: string) {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
  }

  append(entry: any) {
    fs.appendFileSync(this.filepath, JSON.stringify(entry) + "\n");
  }
}

const w = new SessionWriter("/tmp/test-session.jsonl");
w.append({ id: "1", role: "user", content: "hello", timestamp: Date.now() });
w.append({ id: "2", role: "assistant", content: "hi", timestamp: Date.now() });
w.append({ id: "3", role: "user", content: "what time is it?", timestamp: Date.now() });

console.log(fs.readFileSync("/tmp/test-session.jsonl", "utf-8"));
```

Output:

```
{"id":"1","role":"user","content":"hello","timestamp":1700...}
{"id":"2","role":"assistant","content":"hi","timestamp":1700...}
{"id":"3","role":"user","content":"what time is it?","timestamp":1700...}
```

Three lines, three messages. Easy to read, easy to append, easy to parse.

## Key takeaways

1. JSONL: one JSON object per line. Append-only. Crash-resilient.
2. Each entry includes an ID and parent ID for branching support.
3. File naming: `<date>-<id>.jsonl`. Stored per-cwd for organization.
4. Atomic appends rely on writes < PIPE_BUF; for safety, validate each line on load.
5. Persist messages, not transient runtime state.

---

**Next:** [Lesson 6.2 — Loading and Resuming](./02-loading-and-resuming.md)
