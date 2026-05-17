# Skills and Prompt Templates

Pi has a feature called "skills" that's worth understanding because it's a different way to extend an agent — without writing code.

## What skills are

A skill is a Markdown file describing how to do a task. Example:

```markdown
<!-- ~/.pi/agent/skills/code-reviewer/SKILL.md -->
# Code Reviewer

Use this skill when the user asks for a code review.

## Steps

1. Use `read` to load the file
2. Look for: bugs, security issues, performance problems, style violations
3. Format the review as:
   - **Critical**: things that must be fixed
   - **Suggested**: things that should be considered
   - **Style**: minor consistency things
4. Return the review
```

That's it. No code. The skill describes a workflow in natural language.

When the user invokes the skill (`/skill:code-reviewer`), the markdown content is injected into the conversation as a kind of system message:

```
[user message containing the skill content]
[user's actual question]
```

The LLM reads the skill and follows the instructions.

## Why this works

Modern LLMs are good at following structured natural language instructions. A well-written skill is like a specialized system prompt for one specific workflow.

Skills are powerful because:

- **No code** — anyone can write one
- **Composable** — multiple skills can be invoked in one session
- **Discoverable** — `pi list-skills` shows what's available
- **Sharable** — distribute as markdown files

For tasks that are workflow-shaped (read this, do that, output this) skills are usually better than tools. Tools are for atomic operations.

## Skill anatomy

```markdown
# Skill Name

Brief description (one line).

## When to use

Describe the trigger conditions for this skill.

## Steps

1. First step
2. Second step
3. ...

## Output format

Describe how the result should be structured.
```

This is the convention pi follows. Loose enough to allow variation; structured enough to be predictable.

## Skill vs tool vs prompt template

Three related things, easy to confuse:

### Tool

Code that the LLM can call. Atomic, executable. Examples: `read`, `bash`.

```ts
{ name: "read", description, parameters, execute(args) { ... } }
```

### Skill

Natural language instructions injected into the conversation. The LLM uses *existing tools* to follow the steps.

```markdown
# Code Reviewer
Use the read tool to load the file. Then ...
```

### Prompt template

A reusable user message with placeholders. Less structured than a skill.

```markdown
<!-- ~/.pi/agent/prompts/explain.md -->
Explain how {{topic}} works in the context of this codebase.
```

Triggered by typing `/explain`. The template fills with arguments and gets sent as a user message.

When to use which:

- **Tool**: an action that needs code (e.g., calling an API, reading a file)
- **Skill**: a workflow using existing tools (e.g., "review this code")
- **Prompt template**: a frequent prompt shape (e.g., "explain this thing")

## Implementing skills in mini-pi

The basic skill system is short:

```ts
// src/skills/loader.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface Skill {
  name: string;
  description: string;
  content: string;
}

export async function loadSkills(dir: string): Promise<Skill[]> {
  const skills: Skill[] = [];
  if (!await fs.access(dir).then(() => true).catch(() => false)) return skills;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillFile = path.join(dir, entry.name, "SKILL.md");
      try {
        const content = await fs.readFile(skillFile, "utf-8");
        const description = extractDescription(content);
        skills.push({ name: entry.name, description, content });
      } catch {
        // Skip if no SKILL.md
      }
    }
  }
  return skills;
}

function extractDescription(content: string): string {
  // Get the first non-heading line
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.trim() && !line.startsWith("#")) {
      return line.trim();
    }
  }
  return "";
}
```

Then in interactive mode, register slash commands `/skill:name`:

```ts
async function setupSkills(mode: InteractiveMode, skillsDir: string) {
  const skills = await loadSkills(skillsDir);
  for (const skill of skills) {
    mode.registerCommand({
      name: `skill:${skill.name}`,
      description: skill.description,
      execute: (args, ctx) => {
        const message = `${skill.content}\n\n${args}`;
        ctx.agent.prompt(message);
      },
    });
  }
}
```

That's it. ~50 lines for the skill system.

Pi's implementation in `packages/coding-agent/src/core/skills.ts` adds: validation, parameter substitution, frontmatter for metadata, more flexible discovery (multiple search paths). The core idea is what you have above.

## A useful skill: writing one

```markdown
<!-- skills/test-runner/SKILL.md -->
# Test Runner

Run tests for the user, parse failures, and explain what went wrong.

## When to use

When the user asks to run tests or debug a test failure.

## Steps

1. Use `bash` to run the test command. Common ones:
   - `npm test` for Node projects
   - `cargo test` for Rust
   - `pytest` for Python
2. If exit code is 0, summarize: "All N tests passed."
3. If exit code is non-zero:
   a. Parse the output to find failing tests
   b. For each failure, use `read` to look at the test file
   c. Use `read` to look at the source files referenced in the failure
   d. Explain what's failing and why
   e. Suggest a fix

## Output format

If passing:
> ✓ All N tests passed in Xs

If failing:
> ✗ N test(s) failed
>
> ### test_name
> [Explanation of failure]
> [Suggested fix]
```

Now `/skill:test-runner my failing tests` invokes this. The LLM follows the steps.

## MCP without MCP

Pi's author wrote a blog post arguing skills are a better solution than the Model Context Protocol (MCP). The argument:

- MCP requires a separate server, JSON-RPC, schema definitions
- Skills are just markdown
- For most use cases, skills are easier to write and adequate

This is a strong opinion. Many other tools embrace MCP. The point: there are alternative designs to "expose more capabilities to the model." Skills are one. MCP is another. You can support either or both.

## Should mini-pi have skills?

Probably not in v1. They're a power-user feature. But they're easy to add later — the implementation is small. If you have users who want pre-canned workflows, skills are a clean way to ship them.

## Stop and try this

Create `skills/explain-code/SKILL.md`:

```markdown
# Code Explainer

Explain a piece of code in detail.

## Steps

1. If the user provided a file path, use `read` to load it.
2. Walk through the code section by section.
3. Explain what each part does.
4. Note any patterns, gotchas, or interesting design choices.
5. Conclude with a 1-2 sentence summary.
```

Load via your skill loader. Add `/skill:explain-code <path>` to your slash commands.

Now `/skill:explain-code src/main.ts` triggers the workflow. The LLM reads the file, follows the steps, produces a structured explanation.

## Key takeaways

1. Skills = markdown workflows the LLM follows. No code required.
2. Good for workflow-shaped tasks; tools are for atomic actions.
3. Implementation is ~50 lines: load files, register as slash commands, prepend to user prompt.
4. Skills, tools, prompt templates serve different roles — pick based on shape.
5. Pi's "no MCP" stance: skills are simpler for most use cases.

---

**Next:** [Chapter 10 — Going Beyond](../10-going-beyond/)
