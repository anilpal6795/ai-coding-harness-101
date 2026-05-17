import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ChevronDown, ChevronRight } from "lucide";
import type { Chapter, Lesson } from "../lib/content.js";
import { buildHash } from "../lib/router.js";
import { lucideIcon } from "./icon.js";

@customElement("course-sidebar")
export class CourseSidebar extends LitElement {
	// Use light DOM so global Tailwind styles apply.
	createRenderRoot() {
		return this;
	}

	static styles = css``;

	@property({ attribute: false })
	chapters: Chapter[] = [];

	@property({ attribute: false })
	rootPage: Lesson | null = null;

	@property({ type: String })
	currentPath = "/";

	// Track which chapters are expanded. By default the chapter containing the
	// current page is open; the rest start collapsed.
	private collapsed = new Set<string>();
	private initialized = false;

	willUpdate(changed: Map<string, unknown>) {
		if (!this.initialized && this.chapters.length) {
			for (const ch of this.chapters) {
				if (!this.isChapterActive(ch)) this.collapsed.add(ch.slug);
			}
			this.initialized = true;
		}
		// Auto-expand the active chapter when the route changes.
		if (changed.has("currentPath")) {
			for (const ch of this.chapters) {
				if (this.isChapterActive(ch)) this.collapsed.delete(ch.slug);
			}
		}
	}

	private isChapterActive(ch: Chapter): boolean {
		return this.currentPath.startsWith(`/${ch.slug}`);
	}

	private toggleChapter(slug: string, ev: Event) {
		ev.preventDefault();
		ev.stopPropagation();
		if (this.collapsed.has(slug)) this.collapsed.delete(slug);
		else this.collapsed.add(slug);
		this.requestUpdate();
	}

	private linkClass(active: boolean, indent = false) {
		return [
			"block rounded-md px-3 py-1.5 text-sm transition-colors",
			indent ? "ml-4 pl-3 border-l border-[var(--color-border)]" : "",
			active
				? "bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-medium"
				: "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-card)]",
		].join(" ");
	}

	render() {
		return html`
			<nav class="flex flex-col gap-1 text-sm">
				${this.rootPage
					? html`
							<a
								href=${buildHash(this.rootPage.path)}
								class=${this.linkClass(this.currentPath === "/")}
							>
								Guide overview
							</a>
							<div class="my-2 border-t border-[var(--color-border)]"></div>
						`
					: ""}
				${this.chapters.map((ch) => this.renderChapter(ch))}
			</nav>
		`;
	}

	private renderChapter(ch: Chapter) {
		const collapsed = this.collapsed.has(ch.slug);
		const chapterActive = this.currentPath === ch.readme.path;
		return html`
			<div class="flex flex-col">
				<div class="flex items-stretch gap-1">
					<button
						type="button"
						aria-label=${collapsed ? "Expand chapter" : "Collapse chapter"}
						class="flex w-6 shrink-0 items-center justify-center rounded-md text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-card)]"
						@click=${(e: Event) => this.toggleChapter(ch.slug, e)}
					>
						${lucideIcon(collapsed ? ChevronRight : ChevronDown, "w-3.5 h-3.5")}
					</button>
					<a
						href=${buildHash(ch.readme.path)}
						class=${`flex-1 ${this.linkClass(chapterActive)} font-medium text-[var(--color-foreground)]`}
					>
						${stripNumberPrefix(ch.readme.title)}
					</a>
				</div>
				${collapsed
					? ""
					: html`
							<div class="mt-1 ml-7 flex flex-col gap-0.5">
								${ch.lessons.map(
									(lesson) => html`
										<a
											href=${buildHash(lesson.path)}
											class=${this.linkClass(this.currentPath === lesson.path, true)}
										>
											${stripNumberPrefix(lesson.title)}
										</a>
									`,
								)}
								${ch.examples.length
									? html`
											<div class="mt-2 mb-0.5 pl-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
												Examples
											</div>
											${ch.examples.map(
												(ex) => html`
													<a
														href=${buildHash(ex.path)}
														class=${this.linkClass(this.currentPath === ex.path, true)}
													>
														${stripNumberPrefix(ex.title)}
													</a>
												`,
											)}
										`
									: ""}
							</div>
						`}
			</div>
		`;
	}
}

// Drops the leading "Chapter N:" / "Lesson X.Y:" / "Example X.Y:" prefix from
// a heading so the nav shows just titles. Source markdown is left untouched.
function stripNumberPrefix(title: string): string {
	return title.replace(/^(?:chapter|lesson|example|part|section)\s+[\d.]+\s*[:.\-–—]\s*/i, "").trim();
}
