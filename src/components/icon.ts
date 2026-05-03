import { type IconNode, createElement } from "lucide";
import { html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

// Small helper: render a lucide icon with an extra Tailwind class.
export function lucideIcon(node: IconNode, className = "w-4 h-4") {
	const el = createElement(node);
	el.setAttribute("class", className);
	el.setAttribute("aria-hidden", "true");
	return html`${unsafeHTML(el.outerHTML)}`;
}
