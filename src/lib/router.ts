// Tiny hash router. Routes look like `#/00-introduction/02-the-big-picture#anchor`.
// We expose the path (without fragment) and the anchor separately so the app
// can scroll the content view to the right heading on navigation.

import { normalizePath } from "./content.js";

export interface Route {
	path: string;
	anchor: string;
}

export function parseHash(hash: string): Route {
	const raw = hash.startsWith("#") ? hash.slice(1) : hash;
	if (!raw) return { path: "/", anchor: "" };
	const idx = raw.indexOf("#");
	if (idx === -1) return { path: normalizePath(raw), anchor: "" };
	return {
		path: normalizePath(raw.slice(0, idx)),
		anchor: raw.slice(idx + 1),
	};
}

export function buildHash(path: string, anchor = ""): string {
	const p = normalizePath(path);
	return anchor ? `#${p}#${anchor}` : `#${p}`;
}

export function navigate(path: string, anchor = "", replace = false): void {
	const target = buildHash(path, anchor);
	if (replace) window.history.replaceState(null, "", target);
	else window.location.hash = target.slice(1);
}

export function onRouteChange(handler: (route: Route) => void): () => void {
	const fire = () => handler(parseHash(window.location.hash));
	window.addEventListener("hashchange", fire);
	return () => window.removeEventListener("hashchange", fire);
}
