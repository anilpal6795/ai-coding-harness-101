#!/usr/bin/env node
// Generates `public/og.png` — the 1200×630 social-card image referenced by
// the `og:image` / `twitter:image` meta tags in index.html. Re-run after
// changing the title/description/colors:
//   npm run generate:og
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = resolve(__dirname, "../public/og.png");

const bg = "#0c0a09"; // stone-950
const card = "#1c1917"; // stone-900
const border = "#292524"; // stone-800
const fg = "#fafaf9"; // stone-50
const muted = "#a8a29e"; // stone-400
const accent = "#a78bfa"; // violet-400

const title = "AI coding harness 101";
const subtitle = "A guide on building an agentic AI coding harness — using Pi as the reference harness.";
const url = "ai-coding-harness-101.vercel.app";

// Lucide BookOpen path, scaled up. Drawn at (cx, cy) with size `s`.
function bookOpen(cx, cy, s) {
	const k = s / 24;
	const tx = cx - s / 2;
	const ty = cy - s / 2;
	return `
		<g transform="translate(${tx} ${ty}) scale(${k})" fill="none" stroke="${accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M12 7v14" />
			<path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
		</g>
	`;
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
	<rect width="1200" height="630" fill="${bg}" />
	<!-- subtle decorative violet glow in the top-right -->
	<defs>
		<radialGradient id="glow" cx="80%" cy="0%" r="60%">
			<stop offset="0%" stop-color="${accent}" stop-opacity="0.18" />
			<stop offset="100%" stop-color="${accent}" stop-opacity="0" />
		</radialGradient>
	</defs>
	<rect width="1200" height="630" fill="url(#glow)" />

	<!-- inner card -->
	<rect x="60" y="60" width="1080" height="510" rx="24" ry="24" fill="${card}" stroke="${border}" stroke-width="1" />

	<!-- brand row -->
	${bookOpen(140, 160, 56)}
	<text x="200" y="178" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="600" fill="${fg}">Coding harness guide · Pi</text>

	<!-- title -->
	<text x="120" y="320" font-family="Helvetica, Arial, sans-serif" font-size="92" font-weight="700" fill="${fg}" letter-spacing="-2">${title}</text>

	<!-- subtitle -->
	<text x="120" y="400" font-family="Helvetica, Arial, sans-serif" font-size="32" font-weight="400" fill="${muted}">A guide on building an agentic AI coding harness —</text>
	<text x="120" y="442" font-family="Helvetica, Arial, sans-serif" font-size="32" font-weight="400" fill="${muted}">using Pi as the reference harness.</text>

	<!-- url pill — height & padding sized to fully wrap the monospace text -->
	<rect x="120" y="482" width="500" height="64" rx="14" ry="14" fill="${bg}" stroke="${border}" />
	<text x="144" y="514" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="22" fill="${accent}" dominant-baseline="middle">${url}</text>
</svg>`;

mkdirSync(dirname(out), { recursive: true });
const resvg = new Resvg(svg, {
	fitTo: { mode: "width", value: 1200 },
	background: bg,
	font: { loadSystemFonts: true },
});
const png = resvg.render().asPng();
writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
