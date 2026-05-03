import hljs from "highlight.js/lib/common";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
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

const md: MarkdownIt = new MarkdownIt({
	html: true,
	linkify: true,
	typographer: false,
	breaks: false,
	highlight(code: string, lang: string): string {
		const language = lang && hljs.getLanguage(lang) ? lang : "";
		try {
			if (language) {
				const out = hljs.highlight(code, { language, ignoreIllegals: true }).value;
				return `<pre class="hljs"><code class="hljs language-${language}">${out}</code></pre>`;
			}
			const out = hljs.highlightAuto(code).value;
			return `<pre class="hljs"><code class="hljs">${out}</code></pre>`;
		} catch {
			return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`;
		}
	},
});

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
// The course markdown contains links like:
//   [Chapter 0: Introduction & Setup](./00-introduction/)
//   [Lesson](./02-the-big-picture.md)
//   [Cross-chapter](../03-tools/02-schemas.md)
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

	// Strip ".md" suffixes — the SPA's pages are slug-based.
	combined = combined.replace(/\.md$/i, "");
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
