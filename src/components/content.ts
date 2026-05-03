import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { ChevronLeft, ChevronRight } from "lucide";
import type { Chapter, Lesson } from "../lib/content.js";
import { buildHash } from "../lib/router.js";
import { lucideIcon } from "./icon.js";

@customElement("course-content")
export class CourseContent extends LitElement {
	createRenderRoot() {
		return this;
	}

	@property({ attribute: false })
	page: Lesson | null = null;

	@property({ attribute: false })
	chapter: Chapter | null = null;

	@property({ type: String })
	html = "";

	@property({ attribute: false })
	prev: Lesson | null = null;

	@property({ attribute: false })
	next: Lesson | null = null;

	render() {
		if (!this.page) {
			return html`
				<div class="prose">
					<h1>Page not found</h1>
					<p>That URL doesn't match a lesson. Try the sidebar.</p>
				</div>
			`;
		}
		const breadcrumb = this.chapter
			? html`
					<nav class="text-xs text-[var(--color-muted)] mb-4 flex items-center gap-1.5">
						<a href=${buildHash("/")} class="hover:text-[var(--color-foreground)]">Course</a>
						<span aria-hidden="true">/</span>
						<a href=${buildHash(this.chapter.readme.path)} class="hover:text-[var(--color-foreground)]">
							${this.chapter.title}
						</a>
						${this.page.lessonSlug
							? html`
									<span aria-hidden="true">/</span>
									<span class="text-[var(--color-foreground)]">${this.page.title}</span>
								`
							: nothing}
					</nav>
				`
			: nothing;

		return html`
			<article class="prose mx-auto">
				${breadcrumb}
				<div>${unsafeHTML(this.html)}</div>
			</article>
			<div class="mx-auto max-w-[72ch] mt-12 grid grid-cols-2 gap-4">
				${this.renderNav("prev", this.prev)} ${this.renderNav("next", this.next)}
			</div>
		`;
	}

	private renderNav(kind: "prev" | "next", target: Lesson | null) {
		if (!target) return html`<div></div>`;
		const isPrev = kind === "prev";
		return html`
			<a
				href=${buildHash(target.path)}
				class=${`group block rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 transition-colors hover:border-[var(--color-accent)] ${
					isPrev ? "text-left" : "text-right"
				}`}
			>
				<div class="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--color-muted)] ${isPrev ? "" : "justify-end"}">
					${isPrev ? lucideIcon(ChevronLeft, "w-3 h-3") : ""}
					<span>${isPrev ? "Previous" : "Next"}</span>
					${isPrev ? "" : lucideIcon(ChevronRight, "w-3 h-3")}
				</div>
				<div class="mt-1 font-medium text-[var(--color-foreground)] group-hover:text-[var(--color-accent)]">
					${target.title}
				</div>
			</a>
		`;
	}
}
