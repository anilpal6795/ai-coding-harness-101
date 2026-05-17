# Agent Harness 101

**Read it live → https://ai-coding-harness-101.vercel.app/**

A self-paced course on building a production-grade coding agent CLI from
scratch — read it as a [documentation-style web app](./content/).

By the end of the course you'll have built your own working coding agent
in roughly 1,500 lines of TypeScript, and you'll understand exactly what
tools like Claude Code, Cursor, and Aider are doing under the hood.

The course material lives in [`content/`](./content/). The web app in
[`src/`](./src/) renders it with:

- Left sidebar — chapter and lesson navigation
- Center — markdown rendered with syntax highlighting and anchor links
- Right sidebar — auto-generated table of contents with scroll-spy
- Hash routing, dark mode, mobile nav, prev/next navigation

## Develop

```bash
npm install
npm run dev
```

The dev server runs at http://localhost:5180.

## Build

```bash
npm run build       # → dist/
npm run preview     # serve the production build
```

## Adding lessons

Drop new markdown files into `content/<chapter>/<lesson>.md`. Filenames are
sorted by their leading number prefix (e.g. `03-foo.md`). Each chapter
directory should contain a `README.md` that acts as the chapter index.

## Stack

Vite + Lit + Tailwind v4 + markdown-it + highlight.js. No router or markdown
framework — just a small SPA that pulls all markdown at build time via
`import.meta.glob`.

## License

MIT
