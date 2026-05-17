import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import { type HighlighterCore, createHighlighter } from "shiki";
import { normalizePath } from "./content.js";

export interface Heading {
	id: string;
	text: string;
	level: 2 | 3;
}

export interface RenderResult {
	html: string;
	headings: Heading[];
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

// Shiki is heavy and async to initialize, so we lazy-load a singleton on the
// first render. While it loads, code blocks fall back to plain <pre><code> and
// re-highlight after `ensureHighlighter()` resolves (the app re-renders the
// current route once the promise settles).
const SUPPORTED_LANGS = [
	"typescript",
	"javascript",
	"tsx",
	"jsx",
	"json",
	"jsonc",
	"bash",
	"shell",
	"sh",
	"zsh",
	"html",
	"css",
	"scss",
	"markdown",
	"md",
	"python",
	"go",
	"rust",
	"sql",
	"yaml",
	"toml",
	"diff",
	"docker",
	"plaintext",
	"text",
] as const;

let highlighter: HighlighterCore | null = null;
let highlighterPromise: Promise<HighlighterCore> | null = null;

export function ensureHighlighter(): Promise<HighlighterCore> {
	if (highlighter) return Promise.resolve(highlighter);
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: ["github-light", "github-dark"],
			langs: SUPPORTED_LANGS as unknown as string[],
		}).then((hl) => {
			highlighter = hl as HighlighterCore;
			return highlighter;
		});
	}
	return highlighterPromise;
}

// Normalize a markdown fence info string to a language we have loaded.
function normalizeLang(raw: string): { lang: string; label: string } {
	const trimmed = (raw || "").trim().toLowerCase();
	if (!trimmed) return { lang: "plaintext", label: "text" };
	const aliasMap: Record<string, string> = {
		ts: "typescript",
		js: "javascript",
		sh: "bash",
		shell: "bash",
		zsh: "bash",
		py: "python",
		yml: "yaml",
		md: "markdown",
		dockerfile: "docker",
		text: "plaintext",
		plain: "plaintext",
	};
	const lang = aliasMap[trimmed] ?? trimmed;
	const labelMap: Record<string, string> = {
		typescript: "ts",
		javascript: "js",
		bash: "bash",
		json: "json",
		jsonc: "jsonc",
		yaml: "yaml",
		markdown: "md",
		python: "py",
		plaintext: "text",
	};
	const label = labelMap[lang] ?? lang;
	return { lang, label };
}

function renderCodeBlock(code: string, rawLang: string): string {
	const { lang, label } = normalizeLang(rawLang);
	const supported = (SUPPORTED_LANGS as readonly string[]).includes(lang);
	const targetLang = supported ? lang : "plaintext";

	let inner: string;
	if (highlighter) {
		inner = highlighter.codeToHtml(code, {
			lang: targetLang,
			themes: { light: "github-light", dark: "github-dark" },
			defaultColor: false,
		});
	} else {
		// Pre-highlighter fallback. Once the highlighter loads the app will
		// re-render and replace this with the themed version.
		inner = `<pre class="shiki shiki-fallback"><code>${escapeHtml(code)}</code></pre>`;
	}

	const encoded = escapeHtml(code).replace(/\n/g, "&#10;");
	return `<div class="code-block" data-lang="${escapeHtml(label)}">
<div class="code-block-header">
  <span class="code-block-lang">${escapeHtml(label)}</span>
  <button type="button" class="code-block-copy" data-code="${encoded}" aria-label="Copy code">
    <span class="code-block-copy-label">Copy</span>
  </button>
</div>
<div class="code-block-body">${inner}</div>
</div>`;
}

const md: MarkdownIt = new MarkdownIt({
	html: true,
	linkify: true,
	typographer: false,
	breaks: false,
});

// Render fenced code blocks via our own wrapper. We override the fence rule
// (rather than passing `highlight`) because markdown-it auto-wraps the
// highlight return in <pre><code> unless it starts with "<pre", and our
// output begins with a <div>. Overriding fence sidesteps that wrapping
// entirely.
md.renderer.rules.fence = (tokens, idx) => {
	const token = tokens[idx];
	const lang = token.info ? token.info.trim().split(/\s+/)[0] : "";
	return renderCodeBlock(token.content, lang);
};

md.use(anchor, {
	permalink: anchor.permalink.linkAfterHeader({
		style: "aria-label",
		symbol: "#",
		assistiveText: (title: string) => `Permalink to "${title}"`,
		visuallyHiddenClass: "sr-only",
		class: "header-anchor",
	}),
	level: [1, 2, 3, 4],
	slugify: (s: string) =>
		s
			.toLowerCase()
			.trim()
			.replace(/[^\w\s-]/g, "")
			.replace(/\s+/g, "-"),
});

// Rewrite relative links so they route within the SPA.
//
// The guide markdown contains links like:
//   [Introduction & Setup](./00-introduction/)
//   [Section](./02-the-big-picture.md)
//   [Cross-link](../03-tools/02-schemas.md)
// We translate those into hash routes (`#/00-introduction/`, etc.) that the
// router understands. External links (http/mailto/etc.) and in-page anchors
// are left alone, but external links also get target="_blank" for safety.
function rewriteLink(href: string, currentChapter: string): string {
	if (!href) return href;
	if (href.startsWith("#")) return href; // in-page anchor
	if (/^[a-z][\w+.-]*:/i.test(href)) return href; // absolute URL or mailto:
	if (href.startsWith("//")) return href;

	// Split off any fragment so we route to the right file then jump to anchor.
	const hashIdx = href.indexOf("#");
	const fragment = hashIdx >= 0 ? href.slice(hashIdx) : "";
	let path = hashIdx >= 0 ? href.slice(0, hashIdx) : href;

	// Resolve relative to the current chapter directory.
	let combined: string;
	if (path.startsWith("/")) {
		combined = path;
	} else if (path.startsWith("../")) {
		// Pop up one level (out of the chapter), then apply the rest.
		combined = `/${path.slice(3)}`;
	} else if (path.startsWith("./")) {
		combined = `/${currentChapter}/${path.slice(2)}`;
	} else {
		combined = `/${currentChapter}/${path}`;
	}

	// Strip ".md" / ".ts" / ".tsx" / ".js" / ".mjs" suffixes — the SPA's pages
	// are slug-based, and example .ts files are surfaced as pages too.
	combined = combined.replace(/\.(md|tsx?|mjs|js)$/i, "");
	// Drop redundant /README at the end (chapter index page).
	combined = combined.replace(/\/README\/?$/i, "/");
	combined = normalizePath(combined);

	return `#${combined}${fragment}`;
}

const defaultLinkOpen =
	md.renderer.rules.link_open ??
	((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
	const token = tokens[idx];
	const hrefIdx = token.attrIndex("href");
	if (hrefIdx >= 0) {
		const href = token.attrs?.[hrefIdx][1] ?? "";
		const isExternal = /^https?:\/\//i.test(href);
		const rewritten = rewriteLink(href, env.currentChapter ?? "");
		token.attrs![hrefIdx][1] = rewritten;
		if (isExternal) {
			token.attrSet("target", "_blank");
			token.attrSet("rel", "noopener noreferrer");
		}
	}
	return defaultLinkOpen(tokens, idx, options, env, self);
};

const HEADING_RE = /<h([23])[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;

function stripTags(html: string): string {
	return html
		.replace(/<a [^>]*class="[^"]*header-anchor[^"]*"[\s\S]*?<\/a>/g, "")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.trim();
}

export function renderMarkdown(source: string, currentChapter: string): RenderResult {
	const env: Record<string, unknown> = { currentChapter };
	const html = md.render(source, env);

	const headings: Heading[] = [];
	for (const match of html.matchAll(HEADING_RE)) {
		const level = Number.parseInt(match[1], 10) as 2 | 3;
		const id = match[2];
		const text = stripTags(match[3]);
		if (text) headings.push({ id, text, level });
	}

	return { html, headings };
}
