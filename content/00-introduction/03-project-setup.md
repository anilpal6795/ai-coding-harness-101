# Project Setup

Time to set up the project you'll build mini-pi in. This is short — we're not going to be too clever about tooling.

## Goal

A TypeScript project that:

- Runs TypeScript directly (no separate build step) using `tsx`
- Has the Anthropic SDK installed
- Has a clean folder structure mirroring the four layers from Lesson 0.2
- Can read your `ANTHROPIC_API_KEY` from the environment

## Step 1: Create the project

Open a terminal **somewhere outside this repo** (you'll build mini-pi as a separate project):

```bash
mkdir mini-pi
cd mini-pi
npm init -y
```

## Step 2: Install dependencies

```bash
npm install @anthropic-ai/sdk typebox
npm install -D typescript tsx @types/node
```

What each one is:

- **`@anthropic-ai/sdk`** — the Anthropic API client (we'll use Claude as our reference model)
- **`typebox`** — for defining tool schemas. JSON Schema-compatible, used by pi-mono too. (You could also use Zod or Valibot; we use TypeBox to mirror pi-mono.)
- **`typescript`** — the language
- **`tsx`** — runs `.ts` files directly without building. Faster dev loop than `tsc && node`.
- **`@types/node`** — Node.js type definitions

## Step 3: Configure TypeScript

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "noEmit": true,
    "lib": ["ES2022"]
  },
  "include": ["src/**/*"]
}
```

Key choices:

- **`strict: true`** — catches bugs early, especially around tool argument types
- **`noEmit: true`** — we'll use `tsx` to run, not `tsc` to build (until we package it)
- **`module: ESNext`** — modern ES modules, async iterator support is mature

Update `package.json` to be an ES module project:

```json
{
  "type": "module"
}
```

## Step 4: Set up the folder structure

```bash
mkdir -p src/{llm,agent,ui,app}
touch src/llm/types.ts src/agent/types.ts src/ui/tui.ts src/app/main.ts
```

You should now have:

```
mini-pi/
├── package.json
├── tsconfig.json
├── node_modules/
└── src/
    ├── llm/
    │   └── types.ts        ◄── Layer 2: Transport
    ├── agent/
    │   └── types.ts        ◄── Layer 3a: Agent
    ├── ui/
    │   └── tui.ts          ◄── Layer 3b: UI
    └── app/
        └── main.ts         ◄── Layer 4: Product
```

This matches the layering from Lesson 0.2 exactly. We'll fill in each folder as we go.

## Step 5: Smoke test

Put this in `src/app/main.ts`:

```ts
console.log("mini-pi starting up...");
console.log("API key present:", !!process.env.ANTHROPIC_API_KEY);
```

Run it:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # your real key
npx tsx src/app/main.ts
```

You should see:

```
mini-pi starting up...
API key present: true
```

If you see `API key present: false`, double-check that your environment variable is set in the same shell.

## Step 6: Add useful npm scripts

Edit `package.json` to add:

```json
{
  "scripts": {
    "start": "tsx src/app/main.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

Now you can run `npm start` to launch mini-pi and `npm run typecheck` to verify types.

## Step 7: Add .gitignore

```bash
cat > .gitignore <<EOF
node_modules/
dist/
.env
*.log
sessions/
EOF
```

We'll create the `sessions/` directory in Chapter 6 — adding it to `.gitignore` now means your conversation history won't accidentally end up in git.

## Optional: dotenv for API keys

If you don't want to `export ANTHROPIC_API_KEY=...` every time, install dotenv:

```bash
npm install dotenv
```

Create `.env` in your project root:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Then add to the very top of `src/app/main.ts`:

```ts
import "dotenv/config";
```

Now your API key loads automatically.

## What you have now

A minimal but correct TypeScript project:

```
mini-pi/
├── package.json          ✓ ESM project, scripts set up
├── tsconfig.json         ✓ strict mode, modern target
├── .gitignore            ✓ won't leak secrets
├── .env                  (optional)
└── src/
    ├── llm/types.ts
    ├── agent/types.ts
    ├── ui/tui.ts
    └── app/main.ts       ✓ smoke-tested
```

This is intentionally barebones. Real-world projects layer on Biome/ESLint, vitest, husky, etc. — none of which we need to learn the concepts. Add them later if you're shipping a real product.

## Common gotchas

- **"Cannot find module"** when importing from another file: ESM in Node requires the `.js` extension on imports even if the file is `.ts`. Yes, it's weird. Yes, it's correct:
  ```ts
  import { stream } from "../llm/stream.js";  // even though the file is stream.ts
  ```
  This is what pi-mono does too. Get used to it.

- **`export type` vs `export`**: when you have a type-only export, prefer `export type` so it gets erased at compile time. Doesn't matter for `tsx`-only flows but matters when you bundle.

- **Can't run `tsx` directly**: use `npx tsx` or add it to a script in `package.json`.

## Stop and try this

Add this to `src/app/main.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 256,
  messages: [{ role: "user", content: "Say hello in exactly 3 words." }],
});

console.log(response.content);
```

Run with `npm start`. You should see something like:

```
[
  {
    type: 'text',
    text: 'Hi there, friend!'
  }
]
```

Congratulations — you have a working LLM client. In Chapter 2 we're going to wrap this into a streaming, normalized event protocol. But the bones are here.

---

**Next:** [Chapter 1 — Agent Fundamentals](../01-agent-fundamentals/)
