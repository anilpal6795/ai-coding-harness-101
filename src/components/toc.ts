import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Heading } from "../lib/markdown.js";

@customElement("course-toc")
export class CourseToc extends LitElement {
	createRenderRoot() {
		return this;
	}

	@property({ attribute: false })
	headings: Heading[] = [];

	// Element used as the "viewport" for active-heading detection. Defaults to
	// document, but the app passes the scroll container if it differs.
	@property({ attribute: false })
	scrollRoot: HTMLElement | null = null;

	@state()
	private activeId = "";

	private observer: IntersectionObserver | null = null;

	connectedCallback() {
		super.connectedCallback();
		this.setupObserver();
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		this.observer?.disconnect();
		this.observer = null;
	}

	updated(changed: Map<string, unknown>) {
		if (changed.has("headings") || changed.has("scrollRoot")) {
			this.setupObserver();
		}
	}

	private setupObserver() {
		this.observer?.disconnect();
		this.observer = null;
		this.activeId = this.headings[0]?.id ?? "";

		// Defer one frame so headings are present in the DOM after content render.
		requestAnimationFrame(() => {
			const targets = this.headings
				.map((h) => document.getElementById(h.id))
				.filter((el): el is HTMLElement => !!el);
			if (!targets.length) return;
			this.observer = new IntersectionObserver(
				(entries) => {
					// Pick the heading closest to the top that's currently visible.
					const visible = entries
						.filter((e) => e.isIntersecting)
						.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
					if (visible.length) {
						this.activeId = visible[0].target.id;
					}
				},
				{
					rootMargin: "-80px 0px -70% 0px",
					threshold: [0, 1],
				},
			);
			for (const t of targets) this.observer.observe(t);
		});
	}

	render() {
		if (!this.headings.length) {
			return html`<div class="text-sm text-[var(--color-muted)]">No sections.</div>`;
		}
		return html`
			<div class="text-xs uppercase tracking-wider font-semibold text-[var(--color-muted)] mb-3">
				On this page
			</div>
			<ul class="flex flex-col gap-1 text-sm border-l border-[var(--color-border)]">
				${this.headings.map((h) => {
					const isActive = h.id === this.activeId;
					const indentClass = h.level === 3 ? "pl-7" : "pl-3";
					const activeClass = isActive
						? "text-[var(--color-accent)] border-[var(--color-accent)] font-medium"
						: "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] border-transparent";
					return html`
						<li>
							<a
								href=${`#${this.cleanHash()}#${h.id}`}
								class=${`block py-1 ${indentClass} -ml-px border-l-2 transition-colors ${activeClass}`}
							>
								${h.text}
							</a>
						</li>
					`;
				})}
			</ul>
		`;
	}

	private cleanHash(): string {
		const hash = window.location.hash.slice(1);
		const idx = hash.indexOf("#");
		return idx >= 0 ? hash.slice(0, idx) : hash;
	}
}
