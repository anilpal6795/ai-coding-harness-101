import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { BookOpen, Menu, Moon, Sun, X } from "lucide";
import { type Chapter, type CourseTree, findPage, getNeighbors, type Lesson, loadCourse } from "../lib/content.js";
import { type Heading, renderMarkdown } from "../lib/markdown.js";
import { onRouteChange, parseHash, type Route } from "../lib/router.js";
import "./content.js";
import "./sidebar.js";
import "./toc.js";
import { lucideIcon } from "./icon.js";

const THEME_KEY = "pi-course-theme";

@customElement("course-app")
export class CourseApp extends LitElement {
	createRenderRoot() {
		return this;
	}

	@state() private tree: CourseTree = loadCourse();
	@state() private route: Route = parseHash(window.location.hash);
	@state() private html = "";
	@state() private headings: Heading[] = [];
	@state() private theme: "light" | "dark" = readInitialTheme();
	@state() private mobileNavOpen = false;

	private unsubscribe: (() => void) | null = null;
	// Last route for which we've already triggered an anchor scroll, so we
	// don't fight the user when they scroll manually.
	private lastScrolledRoute = "";

	connectedCallback() {
		super.connectedCallback();
		this.unsubscribe = onRouteChange((r) => this.handleRoute(r));
		this.handleRoute(this.route);
		this.applyTheme();
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	private handleRoute(route: Route) {
		this.route = route;
		const page = findPage(this.tree, route.path);
		if (page) {
			const result = renderMarkdown(page.source, page.chapterSlug);
			this.html = result.html;
			this.headings = result.headings;
		} else {
			this.html = "";
			this.headings = [];
		}
		this.mobileNavOpen = false;
		// Scroll to top or to anchor after the DOM renders.
		this.updateComplete.then(() => this.applyScroll(route));
	}

	private applyScroll(route: Route) {
		const key = `${route.path}#${route.anchor}`;
		if (this.lastScrolledRoute === key) return;
		this.lastScrolledRoute = key;
		if (route.anchor) {
			const el = document.getElementById(route.anchor);
			if (el) {
				el.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" });
				return;
			}
		}
		// Default: scroll the main content region to the top.
		const main = this.querySelector("[data-content-scroll]");
		if (main && "scrollTo" in main) {
			(main as HTMLElement).scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
		} else {
			window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
		}
	}

	private toggleTheme = () => {
		this.theme = this.theme === "dark" ? "light" : "dark";
		try {
			localStorage.setItem(THEME_KEY, this.theme);
		} catch {}
		this.applyTheme();
	};

	private applyTheme() {
		document.documentElement.classList.toggle("dark", this.theme === "dark");
	}

	private currentPage(): Lesson | null {
		return findPage(this.tree, this.route.path);
	}

	private currentChapter(): Chapter | null {
		const page = this.currentPage();
		if (!page || !page.chapterSlug) return null;
		return this.tree.chapters.find((c) => c.slug === page.chapterSlug) ?? null;
	}

	render() {
		const page = this.currentPage();
		const chapter = this.currentChapter();
		const neighbors = page ? getNeighbors(this.tree, page) : { prev: null, next: null };

		return html`
			<div class="min-h-screen flex flex-col bg-[var(--color-background)] text-[var(--color-foreground)]">
				${this.renderHeader(page, chapter)}
				<div class="flex-1 flex w-full max-w-[1440px] mx-auto">
					${this.renderLeftSidebar()}
					<main
						data-content-scroll
						class="flex-1 min-w-0 px-5 sm:px-8 lg:px-12 py-8 lg:py-12 overflow-x-hidden"
					>
						<course-content
							.page=${page}
							.chapter=${chapter}
							.html=${this.html}
							.prev=${neighbors.prev}
							.next=${neighbors.next}
						></course-content>
					</main>
					${this.renderRightSidebar()}
				</div>
				${this.mobileNavOpen ? this.renderMobileOverlay() : nothing}
			</div>
		`;
	}

	private renderHeader(page: Lesson | null, chapter: Chapter | null) {
		const subtitle = page && chapter && page.lessonSlug ? `${chapter.title} · ${page.title}` : page?.title ?? "";
		return html`
			<header
				class="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-background)]/90 backdrop-blur"
			>
				<div class="flex items-center gap-3 px-4 sm:px-6 h-14 max-w-[1440px] mx-auto">
					<button
						type="button"
						aria-label="Toggle navigation"
						class="lg:hidden flex h-9 w-9 items-center justify-center rounded-md hover:bg-[var(--color-card)]"
						@click=${() => {
							this.mobileNavOpen = !this.mobileNavOpen;
						}}
					>
						${lucideIcon(this.mobileNavOpen ? X : Menu, "w-4 h-4")}
					</button>
					<a href="#/" class="flex items-center gap-2 font-semibold text-[var(--color-foreground)]">
						${lucideIcon(BookOpen, "w-5 h-5 text-[var(--color-accent)]")}
						<span>Pi Course</span>
					</a>
					${subtitle
						? html`<span class="hidden md:block text-sm text-[var(--color-muted)] truncate">— ${subtitle}</span>`
						: nothing}
					<div class="flex-1"></div>
					<a
						href="https://github.com/badlogic/pi-mono"
						target="_blank"
						rel="noopener noreferrer"
						class="hidden sm:inline-block text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
					>
						GitHub
					</a>
					<button
						type="button"
						aria-label="Toggle dark mode"
						class="flex h-9 w-9 items-center justify-center rounded-md hover:bg-[var(--color-card)]"
						@click=${this.toggleTheme}
					>
						${lucideIcon(this.theme === "dark" ? Sun : Moon, "w-4 h-4")}
					</button>
				</div>
			</header>
		`;
	}

	private renderLeftSidebar() {
		return html`
			<aside
				class="hidden lg:block w-72 shrink-0 border-r border-[var(--color-border)] sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto scroll-thin py-6 px-4"
			>
				<course-sidebar
					.chapters=${this.tree.chapters}
					.rootPage=${this.tree.root}
					.currentPath=${this.route.path}
				></course-sidebar>
			</aside>
		`;
	}

	private renderRightSidebar() {
		return html`
			<aside
				class="hidden xl:block w-64 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto scroll-thin py-8 px-4"
			>
				<course-toc .headings=${this.headings}></course-toc>
			</aside>
		`;
	}

	private renderMobileOverlay() {
		return html`
			<div class="fixed inset-0 z-40 lg:hidden">
				<div
					class="absolute inset-0 bg-black/40"
					@click=${() => {
						this.mobileNavOpen = false;
					}}
				></div>
				<aside
					class="absolute left-0 top-0 h-full w-80 max-w-[85vw] bg-[var(--color-background)] border-r border-[var(--color-border)] overflow-y-auto scroll-thin py-6 px-4"
				>
					<course-sidebar
						.chapters=${this.tree.chapters}
						.rootPage=${this.tree.root}
						.currentPath=${this.route.path}
					></course-sidebar>
					${this.headings.length
						? html`
								<div class="mt-6 pt-6 border-t border-[var(--color-border)]">
									<course-toc .headings=${this.headings}></course-toc>
								</div>
							`
						: nothing}
				</aside>
			</div>
		`;
	}
}

function readInitialTheme(): "light" | "dark" {
	try {
		const stored = localStorage.getItem(THEME_KEY);
		if (stored === "light" || stored === "dark") return stored;
	} catch {}
	if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
	return "light";
}
